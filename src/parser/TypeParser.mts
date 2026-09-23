import { ExpressionParser } from './ExpressionParser.mts';
import type { ParseNode } from './ParseNode.mts';
import { TokenValues, Token } from './tokens.mts';
import { surroundingAgent } from '#self';
import { Throw } from '../host-defined/error-messages.mts';

/**
 * proposal-runtime-types: the type sublanguage.
 * https://github.com/sirisian/proposal-runtime-types #sec-type-grammar
 *
 * This layer is only reachable through the feature-gated call sites the later
 * milestones add, so nothing here re-checks the feature flag. The `>`-splitting
 * for nested type argument lists rides the lexer's noFuseGT counter, and the
 * one speculative parse the grammar forces (an ArrayExtent expression against
 * a TupleElementList, both after `[`) uses the lexer checkpoint, guarded so a
 * rewind across a pushed scope aborts instead of corrupting parser state.
 */
/**
 * proposal-runtime-types #sec-collectcaptures: every |CaptureBinding|
 * contained in _entries_, in source text order. A nested declaration's own
 * list is not entered: its captures are its own.
 */
export function CollectCaptures(entries: readonly ParseNode[]): ParseNode.CaptureBinding[] {
  const captures: ParseNode.CaptureBinding[] = [];
  const seen = new Set<object>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) {
      return;
    }
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as { type?: string };
    if (node.type === 'TypeParameters') {
      return;
    }
    if (node.type === 'CaptureBinding') {
      captures.push(node as ParseNode.CaptureBinding);
    }
    for (const key of Object.keys(node)) {
      if (key !== 'parent' && key !== 'location') {
        visit((node as Record<string, unknown>)[key]);
      }
    }
  };
  entries.forEach(visit);
  return captures.sort((a, b) => a.location.startIndex - b.location.startIndex);
}

export abstract class TypeParser extends ExpressionParser {
  // Type :
  //   UnionType
  //   FunctionType
  // FunctionType :
  //   FunctionTypeParameters `=>` Type
  // A function type can only stand at the top of a Type, so the parenthesized
  // cover is checked for `=>` here and refined to ParenthesizedType everywhere
  // else, which is exactly the grammar's precedence.
  parseType(): ParseNode.Type {
    // proposal-runtime-types #sec-type-names: every type production funnels
    // through here, so recording it once is enough for the "contains a production
    // this proposal adds" half of ADMITS TYPE NAMES. The call half is recorded
    // where a call is parsed.
    this.state.admitsTypeNames = true;
    // proposal-runtime-types #sec-function-types: `<T>(x: T) => T` - a type
    // parameter list can begin nothing else in a type, so `<` here is a
    // GENERIC function type and the parenthesized list that follows is not a
    // cover: it must be a function type.
    if (this.test(Token.LT)) {
      const generic = this.startNode<ParseNode.FunctionType>();
      generic.TypeParameters = this.parseTypeParameters(false, 'signature');
      const { list } = this.parseCoverParenthesizedTypeAndFunctionTypeParameters();
      this.expect(Token.ARROW);
      generic.FunctionTypeParameterList = list;
      generic.ReturnType = this.parseType();
      return this.finishNode(generic, 'FunctionType');
    }
    if (this.test(Token.LPAREN)) {
      const node = this.startNode<ParseNode.FunctionType | ParseNode.ParenthesizedType>();
      const { list, trailingComma } = this.parseCoverParenthesizedTypeAndFunctionTypeParameters();
      if (this.eat(Token.ARROW)) {
        node.TypeParameters = null;
        node.FunctionTypeParameterList = list;
        node.ReturnType = this.parseType();
        return this.finishNode(node, 'FunctionType');
      }
      const paren = this.refineParenthesizedType(node, list, trailingComma);
      return this.parseUnionTypeRest(this.parseIntersectionTypeRest(this.parsePostfixTypeRest(paren)));
    }
    return this.parseUnionType();
  }

  // UnionType :
  //   IntersectionType
  //   UnionType `|` IntersectionType
  parseUnionType(): ParseNode.Type {
    // sec-type-expressions: `|`? IntersectionType. A LEADING separator, so that a
    // type written across several lines can align its members:
    //
    //   type Response =
    //     | uint32
    //     | null;
    //
    // It carries no meaning - `| T` is the type T, union or not - and eating it
    // here rather than in the loop below is what limits it to one occurrence
    // before the first member, so `A | | B` still has no parse.
    if (this.test(Token.BIT_OR)) {
      this.next();
    }
    return this.parseUnionTypeRest(this.parseIntersectionType());
  }

  private parseUnionTypeRest(first: ParseNode.Type): ParseNode.Type {
    if (!this.test(Token.BIT_OR)) {
      return first;
    }
    const node = this.startNode<ParseNode.UnionType>(first);
    const Types: ParseNode.Type[] = [first];
    while (this.eat(Token.BIT_OR)) {
      Types.push(this.parseIntersectionType());
    }
    node.Types = Types;
    return this.finishNode(node, 'UnionType');
  }

  // IntersectionType :
  //   PostfixType
  //   IntersectionType `&` PostfixType
  private parseIntersectionType(): ParseNode.Type {
    // sec-type-expressions: `&`? PrimaryType, the intersection's leading
    // separator, for the same reason and with the same one-occurrence limit.
    if (this.test(Token.BIT_AND)) {
      this.next();
    }
    return this.parseIntersectionTypeRest(this.parsePostfixType());
  }

  private parseIntersectionTypeRest(first: ParseNode.Type): ParseNode.Type {
    if (!this.test(Token.BIT_AND)) {
      return first;
    }
    const node = this.startNode<ParseNode.IntersectionType>(first);
    const Types: ParseNode.Type[] = [first];
    while (this.eat(Token.BIT_AND)) {
      Types.push(this.parsePostfixType());
    }
    node.Types = Types;
    return this.finishNode(node, 'IntersectionType');
  }

  // PostfixType :
  //   PrimaryType
  //   PostfixType `[` Type `]`
  // Indexed access binds tighter than `keyof`/`typeof` and than union and
  // intersection, so `A | T[K]` is `A | (T[K])` and `T[K][J]` chains left.
  private parsePostfixType(): ParseNode.Type {
    return this.parsePostfixTypeRest(this.parsePrimaryType());
  }

  /**
   * The postfix loop, resumable from an already-parsed |PrimaryType|.
   *
   * The parenthesized form is parsed ABOVE this level - `parseType` has to look
   * past `(` to tell a |FunctionType| from a parenthesized one - and it rejoined
   * the grammar at the intersection level, skipping the postfix one. So
   * `(A | B)["n"]` was a SyntaxError while `U["n"]` for a named alias was not,
   * which the grammar does not say: |PostfixType| is |PrimaryType|, and a
   * parenthesized type is one.
   */
  private parsePostfixTypeRest(primary: ParseNode.Type): ParseNode.Type {
    let type = primary;
    // `TypeArguments` joins the postfix loop, so a parameterization
    // composes with itself and with an indexed access in either order - the
    // same shape `IndexedAccessType` already has below.
    while (this.test(Token.LBRACK) || this.test(Token.PERIOD_LT)) {
      if (this.test(Token.PERIOD_LT)) {
        const p = this.startNode<ParseNode.ParameterizedType>(type);
        p.BaseType = type;
        p.TypeArguments = this.parseTypeArguments();
        type = this.finishNode(p, 'ParameterizedType');
        continue;
      }
      const node = this.startNode<ParseNode.IndexedAccessType>(type);
      node.ObjectType = type;
      this.expect(Token.LBRACK);
      node.IndexType = this.parseType();
      this.expect(Token.RBRACK);
      type = this.finishNode(node, 'IndexedAccessType');
    }
    return type;
  }

  // PrimaryType :
  //   `shared` PrimaryType
  //   PredefinedType
  //   LiteralType
  //   TypeReference
  //   ComputedType
  //   KeyOfType
  //   ArrayOrTupleType
  //   ObjectType
  //   ReferenceType
  //   CoverParenthesizedTypeAndFunctionTypeParameters
  private parsePrimaryType(): ParseNode.Type {
    const tok = this.peek();
    switch (tok.type) {
      case Token.IDENTIFIER: {
        if (!tok.escaped
            && (tok.value === 'shared' || tok.value === 'ref' || tok.value === 'keyof')
            && this.aheadStartsPrimaryType()) {
          const node = this.startNode<ParseNode.SharedType | ParseNode.ReferenceType | ParseNode.KeyOfType>();
          const keyword = tok.value;
          this.next();
          // `keyof` binds looser than indexed access, as the comment on
          // parsePostfixType states and as TypeScript groups it: `keyof T[K]` is
          // `keyof (T[K])`, the keys of the indexed property type, not
          // `(keyof T)[K]`. So its operand is a PostfixType, which absorbs a
          // trailing index access. `shared`/`ref` keep a PrimaryType operand.
          node.Type = keyword === 'keyof' ? this.parsePostfixType() : this.parsePrimaryType();
          if (keyword === 'shared') {
            return this.finishNode(node, 'SharedType');
          }
          if (keyword === 'ref') {
            return this.finishNode(node, 'ReferenceType');
          }
          return this.finishNode(node, 'KeyOfType');
        }
        return this.parseTypeReferenceOrComputedType();
      }
      case Token.YIELD:
      case Token.AWAIT:
        return this.parseTypeReferenceOrComputedType();
      case Token.VOID:
      case Token.NULL: {
        const node = this.startNode<ParseNode.PredefinedType>();
        node.keyword = tok.type === Token.VOID ? 'void' : 'null';
        this.next();
        return this.finishNode(node, 'PredefinedType');
      }
      case Token.TRUE:
      case Token.FALSE:
      case Token.STRING:
      case Token.NUMBER:
      case Token.BIGINT:
      case Token.IMAGINARY:
      case Token.SUB: {
        const literal = this.parseLiteralType();
        // proposal-runtime-types (table-metadata-values): a range in type
        // position, whose endpoints are compile-time constants. A numeric
        // literal followed by a member of the range family begins one.
        if (this.feature('runtime-types') && this.testRangeTypeOperator()) {
          return this.parseRangeType(literal);
        }
        return literal;
      }
      case Token.DOT_DOT:
      case Token.DOT_DOT_LT:
      case Token.DOT_DOT_EQ:
        // The start-omitted forms `..<b`, `..=b`, and `..`. A leading `<..` is
        // not among them: an omitted start has no inclusivity to state.
        if (this.feature('runtime-types')) {
          return this.parseRangeType(null);
        }
        return this.unexpected();
      case Token.DIV:
        // proposal-runtime-types (table-metadata-values): a pattern in type
        // position. A `/` is division or the start of a pattern depending on
        // what precedes it, and in a type there is no division to be ambiguous
        // with, so the pattern reading is the only one.
        return this.parsePatternType();
      case Token.LBRACK:
        return this.parseArrayOrTupleType();
      case Token.LBRACE:
        return this.parseObjectType();
      case Token.LPAREN: {
        const node = this.startNode<ParseNode.FunctionType | ParseNode.ParenthesizedType>();
        const { list, trailingComma } = this.parseCoverParenthesizedTypeAndFunctionTypeParameters();
        return this.refineParenthesizedType(node, list, trailingComma);
      }
      default:
        return this.unexpected();
    }
  }

  private aheadStartsPrimaryType(): boolean {
    switch (this.peekAhead().type) {
      case Token.IDENTIFIER:
      case Token.YIELD:
      case Token.AWAIT:
      case Token.VOID:
      case Token.NULL:
      case Token.TRUE:
      case Token.FALSE:
      case Token.STRING:
      case Token.NUMBER:
      case Token.BIGINT:
      case Token.IMAGINARY:
      case Token.SUB:
      case Token.LBRACK:
      case Token.LBRACE:
      case Token.LPAREN:
        return true;
      default:
        return false;
    }
  }

  // PatternType :
  //   RegularExpressionLiteral
  //
  // Carried as source and flags: a pattern's identity is those two being
  // identical, which is what makes one pattern written in two modules one type.
  // A RegExp object is materialized only where a hook receives the metadata.
  private parsePatternType(): ParseNode.PatternType {
    const node = this.startNode<ParseNode.PatternType>();
    const literal = this.parseRegularExpressionLiteral();
    node.Source = literal.RegularExpressionBody;
    node.Flags = literal.RegularExpressionFlags;
    return this.finishNode(node, 'PatternType');
  }

  private testRangeTypeOperator(): boolean {
    return this.test(Token.DOT_DOT) || this.test(Token.DOT_DOT_LT) || this.test(Token.DOT_DOT_EQ)
      || this.test(Token.LT_DOT_DOT) || this.test(Token.LT_DOT_DOT_LT) || this.test(Token.LT_DOT_DOT_EQ);
  }

  // RangeType : the range family with constant endpoints, in type position.
  //
  // The token fixes both bounds and whether an end follows, exactly as it does
  // in expression position, so nothing here has to guess at end-presence.
  private parseRangeType(start: ParseNode.LiteralType | null): ParseNode.RangeType {
    const node = start === null
      ? this.startNode<ParseNode.RangeType>()
      : this.startNode<ParseNode.RangeType>(start);
    let startBound: ParseNode.RangeBound | null;
    let endBound: ParseNode.RangeBound | null;
    switch (this.peek().type) {
      case Token.DOT_DOT:
        startBound = start === null ? null : 'closed';
        endBound = null;
        break;
      case Token.DOT_DOT_LT:
        startBound = start === null ? null : 'closed';
        endBound = 'open';
        break;
      case Token.DOT_DOT_EQ:
        startBound = start === null ? null : 'closed';
        endBound = 'closed';
        break;
      case Token.LT_DOT_DOT:
        startBound = 'open';
        endBound = null;
        break;
      case Token.LT_DOT_DOT_LT:
        startBound = 'open';
        endBound = 'open';
        break;
      default:
        startBound = 'open';
        endBound = 'closed';
        break;
    }
    this.next(); // consume the range operator
    node.RangeTypeStart = start;
    node.RangeTypeStartBound = startBound;
    node.RangeTypeEndBound = endBound;
    node.RangeTypeEnd = endBound === null ? null : this.parseLiteralType();
    return this.finishNode(node, 'RangeType');
  }

  // LiteralType :
  //   NumericLiteral
  //   `-` NumericLiteral
  //   StringLiteral
  //   `true`
  //   `false`
  private parseLiteralType(): ParseNode.LiteralType {
    const node = this.startNode<ParseNode.LiteralType>();
    const negated = this.eat(Token.SUB);
    const tok = this.peek();
    switch (tok.type) {
      case Token.NUMBER:
        node.kind = 'number';
        break;
      case Token.BIGINT:
        node.kind = 'bigint';
        break;
      case Token.IMAGINARY:
        node.kind = 'imaginary';
        break;
      case Token.STRING:
        if (negated) {
          return this.unexpected();
        }
        node.kind = 'string';
        break;
      case Token.TRUE:
      case Token.FALSE:
        if (negated) {
          return this.unexpected();
        }
        node.kind = 'boolean';
        break;
      case Token.IDENTIFIER:
        // `-Infinity` is a NEGATED numeric literal whose numeral has a name.
        // Only reachable behind `-`, because a bare identifier in a type
        // position is a type reference and resolves as one - `Infinity` and
        // `NaN` are handled there. Without this a bounds-shaped meta type
        // could not state its own default, since `-Infinity` was a SyntaxError
        // where `Infinity` had just become writable.
        if (!negated || (tok.value !== 'Infinity' && tok.value !== 'NaN')) {
          return this.unexpected();
        }
        node.kind = 'number';
        break;
      default:
        return this.unexpected();
    }
    node.value = tok.type === Token.TRUE || tok.type === Token.FALSE
      ? tok.type === Token.TRUE
      : (tok.type === Token.IDENTIFIER
        ? (tok.value === 'NaN' ? NaN : Infinity)
        : tok.value as number | bigint | string);
    node.negated = negated;
    this.next();
    return this.finishNode(node, 'LiteralType');
  }

  // TypeReference :
  //   TypeName TypeArguments?
  // TypeName :
  //   IdentifierReference
  //   TypeName `.` IdentifierName
  // ComputedType :
  //   TypeReference Arguments
  //   ComputedType Arguments
  // TypeName :
  //   IdentifierReference
  //   TypeName `.` IdentifierName
  /**
   * Also read by the match-pattern parser: |MatchNamePattern|'s three
   * alternatives are this production's, and a juxtaposition's head must stop
   * where it stops rather than where `parseType` would.
   */
  protected parseTypeName(): ParseNode.TypeName {
    const nameNode = this.startNode<ParseNode.TypeName>();
    nameNode.IdentifierReference = this.parseIdentifierReference();
    const MemberNames: ParseNode.IdentifierName[] = [];
    while (this.eat(Token.PERIOD)) {
      MemberNames.push(this.parseIdentifierName());
    }
    nameNode.MemberNames = MemberNames;
    return this.finishNode(nameNode, 'TypeName');
  }

  // TypeReference :
  //   TypeName TypeArguments?
  protected parseTypeReference(): ParseNode.TypeReference {
    const node = this.startNode<ParseNode.TypeReference>();
    node.TypeName = this.parseTypeName();
    node.TypeArguments = this.test(Token.PERIOD_LT) ? this.parseTypeArguments() : null;
    return this.finishNode(node, 'TypeReference');
  }

  private parseTypeReferenceOrComputedType(): ParseNode.Type {
    const TypeName = this.parseTypeName();

    const refNode = this.startNode<ParseNode.TypeReference>(TypeName);
    refNode.TypeName = TypeName;
    refNode.TypeArguments = this.test(Token.PERIOD_LT) ? this.parseTypeArguments() : null;
    let result: ParseNode.TypeReference | ParseNode.ComputedType = this.finishNode(refNode, 'TypeReference');

    while (this.test(Token.LPAREN)) {
      const computed: ParseNode.Unfinished<ParseNode.ComputedType> = this.startNode(result);
      computed.Callee = result;
      // A |ComputedType|'s arguments are EXPRESSIONS, so the `>>` splitting that
      // lets a nested type argument list close - `Box.<Box.<uint8>>` - must not
      // reach them.
      //
      // #sec-type-arguments provides the escape: "A shift operator inside a type
      // argument list MUST BE PARENTHESIZED, which is only relevant to a value
      // argument, since a shift cannot otherwise appear in a type." The escape
      // did not work. `noFuseGT` stayed raised through the argument list, so
      // `B.<N(8 >> 1)>` split its `>>` into two closers - correctly, that one is
      // genuinely ambiguous - and `B.<N((8 >> 1))>` split it too, which leaves
      // the clause's remedy no way to be written. A left shift was unaffected,
      // `<<` needing no splitting, so only `>>` and `>>>` were unreachable.
      //
      // Suspended for the parenthesized argument list and restored after: a `>`
      // inside those parentheses cannot be closing this list, since the `)` must
      // come first.
      const suspended = this.noFuseGT;
      this.noFuseGT = 0;
      this.builderArgumentDepth += 1;
      try {
        computed.Arguments = this.parseArguments().Arguments;
      } finally {
        this.noFuseGT = suspended;
        this.builderArgumentDepth -= 1;
      }
      // #sec-capture-scope: the builder's own type arguments are parsed before
      // the `(` that makes it a builder call, so a capture among them is found
      // afterwards. Only the first callee is a reference; a later one is a
      // ComputedType already checked.
      if (result.type === 'TypeReference' && this.specializationEntryDepth > 0) {
        for (const capture of CollectCaptures([result.TypeArguments as unknown as ParseNode])) {
          this.addEarlyError(Throw.SyntaxError('$1', `\`const ${capture.BindingIdentifier.name}\` stands in the arguments of a builder call, which exposes no component; bind \`${capture.BindingIdentifier.name}\` at a structural position and compute the builder forward from it`), capture);
        }
      }
      result = this.finishNode(computed, 'ComputedType');
    }
    return result;
  }

  // TypeArguments :
  //   `.<` TypeArgumentList `,`? `>`
  /**
   * TypeArgument : Type
   *              : BindingIdentifier `:` Type
   *
   * The named form supplies a parameter by NAME, so an application can skip a
   * parameter that has a default rather than repeat it - `Grid.<Cols: 8>` where
   * `Grid.<float64, 4, 8>` repeats what does not differ.
   *
   * The name rides on the type node rather than wrapping it, so every consumer
   * of a TypeArgumentList keeps working unchanged and only resolution, which
   * looks for the name, sees a difference.
   *
   * ONE function serves six call sites - type references, both array forms, and
   * MemberExpression/CallExpression - so `[4].<Element: uint8>` parses here too.
   * It is refused during resolution, where the absence of a declared parameter
   * to match is what makes it an error.
   */
  parseTypeArgument(): ParseNode.Type {
    // proposal-runtime-types #sec-type-references: `... Type` SPREADS a tuple
    // into the argument list, spliced before anything binds. The flag rides on
    // the type node exactly as ArgumentName does, for the same reason.
    if (this.eat(Token.ELLIPSIS)) {
      // #sec-specialization-lists: `...const Ts` captures the run a variadic
      // parameter of the nested constructor collects.
      if (this.test(Token.CONST)) {
        return this.parseCaptureBinding(true) as unknown as ParseNode.Type;
      }
      const spread = this.parseType();
      (spread as { IsSpread?: boolean }).IsSpread = true;
      return spread;
    }
    // An identifier followed by `:` has no other reading in this position: a
    // named argument is told from a type by the colon alone.
    if (this.test(Token.IDENTIFIER) && this.testAhead(Token.COLON)) {
      const name = this.parseIdentifierName().name;
      this.expect(Token.COLON);
      // `V: const Element`: the label is the nested constructor's parameter,
      // and the capture the specialization's own name for what stands there.
      const type = this.test(Token.CONST)
        ? this.parseCaptureBinding(false) as unknown as ParseNode.Type
        : this.parseType();
      (type as { ArgumentName?: string }).ArgumentName = name;
      return type;
    }
    if (this.test(Token.CONST)) {
      return this.parseCaptureBinding(false) as unknown as ParseNode.Type;
    }
    return this.parseType();
  }

  parseTypeArguments(): ParseNode.TypeArguments {
    const node = this.startNode<ParseNode.TypeArguments>();
    this.expect(Token.PERIOD_LT);
    this.noFuseGT += 1;
    // `X.<>` supplies NO argument, so every
    // parameter takes its default.
    //
    // It exists because the base-decides rule made `Grid.<{ brand: 'V' }>` an APPLICATION wherever
    // `Grid` declares a parameter, which is right but takes away the only
    // one-step spelling a fully-defaulted generic had for being branded. Without
    // an empty list the alternative is `Grid.<float64>.<{ brand: 'V' }>`, which
    // repeats the very default the named-argument form was added to avoid
    // repeating.
    const TypeArgumentList: ParseNode.Type[] = [];
    if (!this.test(Token.GT)) {
      TypeArgumentList.push(this.parseTypeArgument());
    }
    while (TypeArgumentList.length > 0 && this.eat(Token.COMMA)) {
      if (this.test(Token.GT)) {
        break;
      }
      TypeArgumentList.push(this.parseTypeArgument());
    }
    this.expect(Token.GT);
    this.noFuseGT -= 1;
    node.TypeArgumentList = TypeArgumentList;
    return this.finishNode(node, 'TypeArguments');
  }

  // TypeParameters :
  //   `<` `>`
  //   `<` GenericEntryList `,`? `>`
  // GenericEntry :
  //   TypeParameter
  //   SpecializationEntry
  /**
   * `dotted` accepts the `.<` spelling an OPERATOR's own type parameters use -
   * `operator +.<B2>(...)`. Both existing call sites tested for `PERIOD_LT` and
   * then called this, which expects `<`, so every per-operator type parameter
   * list was a Syntax Error: the test passed and the parse failed one token
   * later. The `[]` operator carried the same latent bug.
   *
   * `context` is where the list stands, which decides what kind of list it may
   * be (#sec-type-parameters-static-semantics-early-errors).
   */
  parseTypeParameters(dotted = false, context: ParseNode.GenericListContext = 'function'): ParseNode.TypeParameters {
    const node = this.startNode<ParseNode.TypeParameters>();
    this.expect(dotted ? Token.PERIOD_LT : Token.LT);
    this.noFuseGT += 1;
    // A nested declaration's list is not an entry of an enclosing one: a
    // generic function type written inside a specialization entry declares
    // parameters of its own.
    const outerEntryDepth = this.specializationEntryDepth;
    const outerBuilderDepth = this.builderArgumentDepth;
    this.specializationEntryDepth = 0;
    this.builderArgumentDepth = 0;
    const TypeParameterList: ParseNode.TypeParameter[] = [];
    const SpecializationEntryList: ParseNode.SpecializationEntry[] = [];
    const EntryKinds: ('parameter' | 'argument')[] = [];
    // The first argument entry whose spelling most likely meant a parameter,
    // for the diagnostic reported against the whole list below.
    let hint: string | undefined;
    try {
      do {
        if (this.test(Token.GT)) {
          break; // trailing comma, or the empty list `<>`
        }
        const param = this.startNode<ParseNode.TypeParameter>();
        // proposal-runtime-types #sec-type-parameters: an optional
        // VarianceModifier, `in` or `out`, declares the parameter covariant or
        // contravariant (#sec-generic-variance).
        //
        // `in` is RESERVED, so it can only be a modifier here. `out` is not: it
        // stays an ordinary identifier everywhere, INCLUDING as a parameter's own
        // name, so it is a modifier only where a BindingIdentifier follows it
        // immediately. That is one token of lookahead, and it is what keeps
        // `<out>`, `<out: T>` and `<out = T>` meaning a parameter NAMED `out`
        // while `<out T>` declares a covariant `T` - and `<out out>` a covariant
        // parameter named `out`.
        let Variance: 'covariant' | 'contravariant' | undefined;
        if (this.test(Token.IN)) {
          this.next();
          Variance = 'contravariant';
        } else if (this.test(Token.IDENTIFIER) && this.peek().value === 'out'
          // `VarianceModifier? ... BindingIdentifier`: the modifier precedes the
          // pack marker, so `out ...Ts` is a covariant pack, and `...` can follow
          // a parameter's own name in no other reading.
          && (this.testAhead(Token.IDENTIFIER) || this.testAhead(Token.ELLIPSIS))) {
          this.next();
          Variance = 'covariant';
        }
        param.Variance = Variance;
        // proposal-runtime-types #sec-type-parameters: `...` declares a VARIADIC
        // parameter. Its
        // constraint is the type of what it collects, and what it binds is a
        // tuple; the marker sits where a rest parameter's does.
        param.IsVariadic = this.eat(Token.ELLIPSIS);
        // proposal-runtime-types #sec-type-parameters: an entry is a PARAMETER
        // only when a name is followed by `:` (or by its higher-kinded holes and
        // then `:`). Every other entry is an ARGUMENT of a specialization list
        // (#sec-specialization-lists), and which it is follows from the syntax
        // alone, never from what a name resolves to.
        const binderAhead = this.test(Token.IDENTIFIER) && (this.testAhead(Token.COLON) || this.testAhead(Token.LT));
        if (!binderAhead) {
          SpecializationEntryList.push(this.parseSpecializationEntry(param, (h) => {
            hint ??= h;
          }));
          EntryKinds.push('argument');
          continue;
        }
        TypeParameterList.push(this.parseTypeParameterRest(param, TypeParameterList));
        EntryKinds.push('parameter');
      } while (this.eat(Token.COMMA));
    } finally {
      this.specializationEntryDepth = outerEntryDepth;
      this.builderArgumentDepth = outerBuilderDepth;
    }
    this.expect(Token.GT);
    this.noFuseGT -= 1;
    // #sec-type-parameters-static-semantics-early-errors: "It is a Syntax
    // Error if the BoundNames of two |TypeParameter|s of the list are the
    // same." The later one shadowed the earlier, silently.
    const declaredNames = new Set<string>();
    for (const tp of TypeParameterList) {
      const name = tp.BindingIdentifier?.name;
      if (name === undefined) continue;
      if (declaredNames.has(name)) {
        this.addEarlyError(Throw.SyntaxError('$1', `the type parameter ${name} is declared twice in one list`), tp);
      }
      declaredNames.add(name);
    }
    node.TypeParameterList = TypeParameterList;
    node.SpecializationEntryList = SpecializationEntryList;
    node.EntryKinds = EntryKinds;
    node.ListKind = SpecializationEntryList.length === 0 && TypeParameterList.length > 0
      ? 'parameters'
      : (TypeParameterList.length === 0 ? 'specialization' : 'mixed');
    node.Captures = CollectCaptures(SpecializationEntryList);
    const finished = this.finishNode(node, 'TypeParameters');
    this.checkGenericEntryList(finished, context, hint);
    return finished;
  }

  /**
   * TypeParameter, after its VarianceModifier and `...`: the name, its holes,
   * its domain, its bound, and its default.
   */
  private parseTypeParameterRest(param: ParseNode.Unfinished<ParseNode.TypeParameter>, TypeParameterList: readonly ParseNode.TypeParameter[]): ParseNode.TypeParameter {
    param.BindingIdentifier = this.parseBindingIdentifier();
    const Arity = this.parseTypeParameterHoles();
    param.Arity = Arity;
    // The domain decides the kind (#sec-parameter-kinds): `type` declares a
    // type parameter, `[].<type>` a pack of types, and any other domain a
    // value parameter. The node keeps the checker's existing reading, in
    // which TypeParameterConstraint is what an argument is checked against
    // (the spec's EffectiveConstraint): the bound for a type parameter and
    // the domain for a value parameter. A domain written through an alias of
    // `type` is resolved by kind in a later phase; here it reads as a value.
    this.expect(Token.COLON);
    const domain = this.parseType();
    const domainText = domain.sourceText.replace(/\s+/g, '');
    const typeKind = domainText === 'type' || (param.IsVariadic && domainText === '[].<type>');
    // A higher-kinded parameter whose domain is not written `type` is refused
    // by the checker: #sec-parameterkind throws a *TypeError* for it at the
    // declaration, which is a type error rather than a Syntax Error.
    param.HigherKindedDomainWritten = Arity > 0 ? typeKind : undefined;
    const bound = this.eat(Token.EXTENDS) ? this.parseType() : null;
    if (bound && !typeKind) {
      this.addEarlyError(Throw.SyntaxError('$1', 'a value parameter has no `extends` bound; narrow its values with a `where` clause'), bound);
    }
    param.IsValueParameter = !typeKind;
    param.TypeParameterDomain = domain;
    param.TypeParameterConstraint = typeKind ? bound : domain;
    param.TypeParameterDefault = this.eat(Token.ASSIGN) ? this.parseType() : null;
    // proposal-runtime-types: a parameter carrying a default may not precede
    // one that does not, since an application supplying fewer arguments than
    // parameters fills from the END. The rule was stated in the specification
    // and enforced nowhere, which the higher-kinded work found by relying on
    // it: `Iterator<T, R, N, W<_> = Identity>` places its wrapper last
    // BECAUSE of this rule, and an unenforced rule is not a reason for
    // anything.
    //
    // #sec-type-parameters-static-semantics-early-errors states it PER RUN: a
    // variadic parameter counts as defaulted (an application may leave it
    // empty) and ENDS the run, so `<...A: [].<uint32>, N: uint32>` is legal
    // with `N` required - the parameter after a pack is what stops the run.
    const previous = TypeParameterList[TypeParameterList.length - 1];
    if (previous && !previous.IsVariadic && !param.IsVariadic && previous.TypeParameterDefault && !param.TypeParameterDefault) {
      return this.unexpected();
    }
    // The same clause's second rule: two adjacent variadic parameters where
    // the first has no constraint have no boundary between them - the first
    // admits everything, so the second could never receive an argument
    // positionally. The rest-parameter sentence, restated for packs.
    if (previous && previous.IsVariadic && param.IsVariadic && !previous.TypeParameterConstraint) {
      this.addEarlyError(Throw.SyntaxError('$1', 'two variadic parameters with nothing typed between them have no boundary'), previous);
    }
    return this.finishNode(param, 'TypeParameter');
  }

  // TypeParameterHoles : `<` TypeParameterHoleList `>`
  private parseTypeParameterHoles(): number {
    let Arity = 0;
    if (this.test(Token.LT)) {
      this.next();
      do {
        if (!this.test(Token.IDENTIFIER) || this.peek().value !== '_') {
          // Only `_` is a hole. Naming what was found matters: `<W<T>>` and
          // `<W<~>>` are both plausible spellings a reader might try, and
          // "unexpected token" would leave them guessing which part is wrong.
          return this.unexpected();
        }
        this.next();
        Arity += 1;
      } while (this.eat(Token.COMMA));
      this.expect(Token.GT);
      if (Arity === 0) {
        // `<W<>>` - a parameter of arity zero is spelled without brackets.
        return this.unexpected();
      }
    }
    return Arity;
  }

  // SpecializationEntry :
  //   Type
  //   CaptureBinding
  //   `...` CaptureBinding
  /**
   * An ARGUMENT of a declaration's list, after any VarianceModifier and `...`
   * the entry loop consumed while it could not yet tell a parameter from an
   * argument. The earlier bare-name spellings of a parameter, `<T>`,
   * `<T extends B>`, `<T = D>` and `<...Ts>`, are arguments or Syntax Errors
   * now, and `hint` receives the correction their author most likely meant.
   */
  private parseSpecializationEntry(start: ParseNode.Unfinished<ParseNode.TypeParameter>, hint: (text: string) => void): ParseNode.SpecializationEntry {
    const entry = this.startNode<ParseNode.SpecializationEntry>(start as unknown as ParseNode);
    const variadic = !!start.IsVariadic;
    if (start.Variance) {
      this.addEarlyError(Throw.SyntaxError('$1', 'a variance modifier is a promise a parameter makes; an argument of a specialization list has none'), start as unknown as ParseNode);
    }
    this.specializationEntryDepth += 1;
    try {
      if (this.test(Token.CONST)) {
        entry.Pattern = this.parseCaptureBinding(variadic);
        return this.finishNode(entry, 'SpecializationEntry');
      }
      const bareName = this.test(Token.IDENTIFIER) && !this.testAhead(Token.PERIOD) && !this.testAhead(Token.PERIOD_LT) && !this.testAhead(Token.LBRACK)
        ? this.peek().value as string
        : undefined;
      const pack = variadic ? '...' : '';
      const domain = variadic ? '[].<type>' : 'type';
      entry.Pattern = this.parseType();
      if (variadic) {
        // The grammar spreads only a capture at the top of a list; a pack of
        // arguments is written `...const Ts` there, and `...Ts` inside a nested
        // application reuses one.
        this.addEarlyError(Throw.SyntaxError('$1', bareName
          ? `\`...${bareName}\` has no domain, so it is not a parameter, and an argument list spreads only a capture; a type parameter is declared as \`...${bareName}: [].<type>\``
          : 'an argument list spreads only a capture, `...const Ts`'), entry.Pattern);
      }
      if (this.eat(Token.EXTENDS)) {
        const bound = this.parseType();
        this.addEarlyError(Throw.SyntaxError('$1', bareName
          ? `a parameter states its domain before its bound: write \`${pack}${bareName}: ${domain} extends ...\``
          : 'an argument has no `extends` bound'), bound);
      }
      if (this.eat(Token.ASSIGN)) {
        const fallback = this.parseType();
        this.addEarlyError(Throw.SyntaxError('$1', bareName
          ? `a parameter states its domain before its default: write \`${pack}${bareName}: ${domain} = ...\``
          : 'an argument has no default'), fallback);
      }
      if (bareName !== undefined && bareName !== '_') {
        hint(`\`${pack}${bareName}\` has no domain, so it is an argument, and specialization is not supported yet; a type parameter is declared as \`${pack}${bareName}: ${domain}\``);
      }
      return this.finishNode(entry, 'SpecializationEntry');
    } finally {
      this.specializationEntryDepth -= 1;
    }
  }

  // CaptureBinding :
  //   `const` BindingIdentifier TypeParameterHoles? TypeParameterDomain? TypeParameterConstraint?
  protected parseCaptureBinding(variadic: boolean): ParseNode.CaptureBinding {
    const node = this.startNode<ParseNode.CaptureBinding>();
    this.expect(Token.CONST);
    node.BindingIdentifier = this.parseBindingIdentifier();
    node.Arity = this.test(Token.LT) ? this.parseTypeParameterHoles() : 0;
    // A capture's domain and bound are ordinary types, never entries: a
    // capture written inside them would stand in no position of the target.
    const outerEntryDepth = this.specializationEntryDepth;
    this.specializationEntryDepth = 0;
    try {
      node.TypeParameterDomain = this.eat(Token.COLON) ? this.parseType() : null;
      node.TypeParameterConstraint = this.eat(Token.EXTENDS) ? this.parseType() : null;
    } finally {
      this.specializationEntryDepth = outerEntryDepth;
    }
    node.IsVariadic = variadic;
    const finished = this.finishNode(node, 'CaptureBinding');
    const name = finished.BindingIdentifier.name;
    // #sec-specialization-lists-static-semantics-early-errors: a capture
    // belongs to a specialization entry. An ordinary application supplies
    // arguments and never introduces a name.
    if (this.specializationEntryDepth === 0) {
      this.addEarlyError(Throw.SyntaxError('$1', `a capture, \`const ${name}\`, belongs in a declaration's specialization list; supply an argument here`), finished);
    } else if (this.builderArgumentDepth > 0) {
      // #sec-capture-scope: a builder is evaluated forward and never run
      // backwards, so a capture in its arguments observes nothing.
      this.addEarlyError(Throw.SyntaxError('$1', `\`const ${name}\` stands in the arguments of a builder call, which exposes no component; bind \`${name}\` at a structural position and compute the builder forward from it`), finished);
    }
    return finished;
  }

  /**
   * #sec-type-parameters-static-semantics-early-errors and
   * #sec-specialization-lists-static-semantics-early-errors, for one list.
   * The list-wide errors are added after the entries' own, and "selection is
   * not supported" last, so the first error a program reports is the most
   * specific one.
   */
  private checkGenericEntryList(list: ParseNode.TypeParameters, context: ParseNode.GenericListContext, hint: string | undefined): void {
    const callable = context === 'function' || context === 'method' || context === 'operator';
    const parametersOnly = context === 'expression' || context === 'signature' || context === 'meta' || context === 'accessor';
    // Two declarations of one capture are refused even where the annotations
    // agree: a reader could not tell whether equality or two unrelated bindings
    // was meant, and a repeated USE already says equality.
    const seen = new Map<string, ParseNode.CaptureBinding>();
    for (const capture of list.Captures ?? []) {
      const name = capture.BindingIdentifier.name;
      if (seen.has(name)) {
        this.addEarlyError(Throw.SyntaxError('$1', `\`${name}\` is already captured in this list; write \`${name}\` to require the same argument, or choose another capture name`), capture);
      } else {
        seen.set(name, capture);
      }
    }
    // A primitive block's lists are judged by the declaration parser, which
    // knows each list's role (#sec-primitive-operator-blocks).
    if (context === 'primitive') {
      return;
    }
    // #sec-type-parameters-static-semantics-early-errors: a `partial`
    // declaration has one primary elsewhere, so its list never declares
    // parameters of its own.
    if (list.ListKind === 'parameters' && context === 'partial') {
      this.addEarlyError(Throw.SyntaxError('$1', 'a `partial` declaration adds to a family whose primary declares its parameters; its list is a specialization list, which is not supported yet'), list);
      return;
    }
    if (list.ListKind === 'parameters') {
      return;
    }
    if (parametersOnly) {
      // `context === 'accessor'` has its own error at the call site.
      if (context !== 'accessor') {
        this.addEarlyError(Throw.SyntaxError('$1', context === 'meta'
          ? 'a meta declaration declares parameters only; its list may not hold arguments'
          : 'a list here describes or introduces a generic, so it declares parameters only; a specialization belongs to a named declaration'), list);
      }
      return;
    }
    if (list.ListKind === 'mixed') {
      if (!callable) {
        this.addEarlyError(Throw.SyntaxError('$1', 'a list mixing parameters and arguments declares a selector-prefixed overload, which only a function, method, or operator may; use `const T` to capture an open position of a specialization'), list);
        return;
      }
      const topCapture = (list.SpecializationEntryList ?? []).find((e) => e.Pattern.type === 'CaptureBinding');
      if (topCapture) {
        const name = (topCapture.Pattern as ParseNode.CaptureBinding).BindingIdentifier.name;
        this.addEarlyError(Throw.SyntaxError('$1', `a capture at the top of a list that also declares parameters observes nothing a caller could not name; declare \`${name}: type\`, or a value domain, as a parameter`), topCapture);
        return;
      }
    }
    // #sec-specialization-lists: "Until they are [specified], an
    // implementation reports a specialization it cannot select as an error
    // rather than accepting it and ignoring it."
    const first = (list.SpecializationEntryList ?? [])[0]?.Pattern;
    let message = hint ?? 'an argument in a declaration\'s list specializes a declared family, and specialization is not supported yet';
    if (first?.type === 'CaptureBinding') {
      message = `a capture, \`const ${first.BindingIdentifier.name}\`, belongs to a specialization list, and specialization is not supported yet`;
    } else if (!first) {
      message = '`<>` specializes a declared family at its defaults, and specialization is not supported yet';
    }
    this.addEarlyError(Throw.SyntaxError('$1', message), list);
  }

  // proposal-runtime-types: ArrowFunction : ArrowParameters TypeAnnotation? [no LineTerminator here] `=>`
  // A `:` after arrow parameters might instead belong to an enclosing
  // conditional, so the annotation parses speculatively and is kept only when
  // `=>` follows on the same line; conditionalConsequentDepth suppresses the
  // attempt where the conditional's own `:` is pending.
  tryParseArrowReturnTypeAnnotation(): ParseNode.TypeAnnotation | null {
    if (!this.test(Token.COLON)
        || this.conditionalConsequentDepth > 0
        || !surroundingAgent.feature('runtime-types')) {
      return null;
    }
    const savedEarlyErrors = new Set(this.earlyErrors);
    const checkpoint = this.getLexerCheckpoint();
    const scopeDepth = this.scope.depth;
    try {
      const annotation = this.parseTypeAnnotation();
      if (this.test(Token.ARROW) && !this.peek().hadLineTerminatorBefore) {
        return annotation;
      }
    } catch (e) {
      if (this.scope.depth !== scopeDepth) {
        throw e;
      }
    }
    this.restoreLexerCheckpoint(checkpoint);
    this.earlyErrors = savedEarlyErrors;
    return null;
  }

  // TypeAnnotation :
  //   `:` Type
  parseTypeAnnotation(allowDecorators = false): ParseNode.TypeAnnotation {
    const node = this.startNode<ParseNode.TypeAnnotation>();
    this.expect(Token.COLON);
    // proposal-runtime-types decorators.md: `d(a: uint32): @f uint32` — a
    // RETURN carries decorators, written before the type. They belong to the
    // annotation rather than to the type: `Reflect.Type` "is the one reflection
    // target that is not also a decorator context", so this is decorating the
    // return POSITION and not the type in it.
    // A DECORATOR MAY PRECEDE A TYPE ONLY IN A POSITION THAT HAS A REFLECTION
    // CONTEXT, which is a return and nothing else. Whether `Reflect.Type` is a
    // decorator context was asked, and the design answers no - "a bare type expression carries no decorator" - but the
    // grammar had been admitting `let x: @f uint8`, a class field's `a: @f T`,
    // and a parameter's `p: @f T` and then DROPPING the decoration, which reads
    // as support. Refused here, where the position is known; the caller passes
    // `true` at the five return sites.
    if (allowDecorators && surroundingAgent.feature('runtime-types') && this.test(Token.AT)) {
      node.Decorators = this.parseDecorators();
    }
    // A NARROWING PREDICATE, `: pet is Fish`, which #sec-declared-narrowing
    // gives as the source spelling of a signature's [[Narrows]]. Only a RETURN
    // annotation may carry one, which `allowDecorators` already marks - the five
    // return sites pass it and nothing else does.
    //
    // One token of lookahead settles it: a type cannot be an identifier followed
    // by `is`, so this is unambiguous against a type that happens to be named
    // `pet`. The declared return of such a signature is `boolean`; the type
    // after `is` is what the named parameter narrows to.
    if (allowDecorators && surroundingAgent.feature('runtime-types')
        && this.test(Token.IDENTIFIER) && this.testAhead('is')) {
      node.NarrowsTarget = this.parseIdentifierName().name;
      this.next();
      node.Type = this.parseType();
      return this.finishNode(node, 'TypeAnnotation');
    }
    node.Type = this.parseType();
    return this.finishNode(node, 'TypeAnnotation');
  }

  // TypedInitializer :
  //   `:=` AssignmentExpression
  parseTypedInitializer(): ParseNode.TypedInitializer {
    const node = this.startNode<ParseNode.TypedInitializer>();
    this.expect(Token.COLON_EQ);
    node.AssignmentExpression = this.parseAssignmentExpression();
    return this.finishNode(node, 'TypedInitializer');
  }

  // ArrayOrTupleType :
  //   `[` `]`                        <- the EMPTY TUPLE
  //   `[` `]` TypeArguments
  //   `[` ArrayExtent `]` TypeArguments
  //   `[` TupleElementList `,`? `]`
  // ArrayExtent :
  //   AssignmentExpression
  // An extent is an expression and a one-element tuple is a type, and both
  // follow `[`, so the extent reading is tried speculatively and committed
  // only when `]` is followed by `.<`. A rewind across a pushed scope (an
  // arrow inside the candidate extent that failed midway) aborts instead.
  private parseArrayOrTupleType(): ParseNode.ArrayType | ParseNode.TupleType {
    const node = this.startNode<ParseNode.ArrayType | ParseNode.TupleType>();
    this.expect(Token.LBRACK);
    if (this.eat(Token.RBRACK)) {
      // `[]` FOLLOWED BY `.<...>` is an
      // array - `[].<uint8>` is the dynamic array of `uint8`. `[]` ALONE is the
      // EMPTY TUPLE.
      //
      // It used to be the array of `any`, which #sec-array-and-tuple-types
      // justified as "the bound of the array and tuple family, so a type
      // parameter constrained by it is satisfied by any array or tuple". That
      // role is real and it keeps a spelling: `[].<any>` denotes the very same
      // type, and a tuple, an array and the empty tuple are all assignable to
      // it. What it does not keep is the SHORT spelling, and the measurement is
      // why: across every design document and the 190-program corpus, `[]` in
      // bound position is written ZERO times, while `[]` meaning the empty
      // tuple is written about thirty, and `tupleOf([])` - the only previous
      // way to denote the empty tuple - is written zero.
      //
      // So the terse form went to the role nobody used, and the common meaning
      // had no spelling at all. Worse, it failed SILENTLY: `type []` was not an
      // error, it was a different type, and a TypeScript reader writing
      // `First<[]>` got the array of `any` and no diagnostic.
      if (this.test(Token.PERIOD_LT)) {
        node.ArrayExtent = null;
        node.TypeArguments = this.parseTypeArguments();
        return this.finishNode(node, 'ArrayType');
      }
      node.TupleElementList = [];
      return this.finishNode(node, 'TupleType');
    }

    // #sec-specialization-lists: `[const N].<const Element>` captures a fixed
    // extent, and `[const A, ...const Rest]` the elements of a tuple. `const`
    // begins neither an expression nor a type, so it is decided before the
    // speculative extent parse below rather than by it.
    let leading: ParseNode.CaptureBinding | null = null;
    if (this.test(Token.CONST) || (this.test(Token.ELLIPSIS) && this.testAhead(Token.CONST))) {
      const variadic = this.eat(Token.ELLIPSIS);
      leading = this.parseCaptureBinding(variadic);
      if (!variadic && this.test(Token.RBRACK) && this.testAhead(Token.PERIOD_LT)) {
        this.next(); // `]`
        node.ArrayExtent = leading as unknown as ParseNode.AssignmentExpressionOrHigher;
        node.TypeArguments = this.parseTypeArguments();
        return this.finishNode(node, 'ArrayType');
      }
    }
    if (leading) {
      const element = this.startNode<ParseNode.TupleElement>(leading);
      element.Rest = leading.IsVariadic;
      element.Type = leading as unknown as ParseNode.Type;
      element.Initializer = null;
      const TupleElementList: ParseNode.TupleElement[] = [this.finishNode(element, 'TupleElement')];
      while (this.eat(Token.COMMA)) {
        if (this.test(Token.RBRACK)) {
          break;
        }
        TupleElementList.push(this.parseTupleElement());
      }
      this.expect(Token.RBRACK);
      node.TupleElementList = TupleElementList;
      return this.finishNode(node, 'TupleType');
    }

    const savedEarlyErrors = new Set(this.earlyErrors);
    const checkpoint = this.getLexerCheckpoint();
    const scopeDepth = this.scope.depth;
    try {
      const extent = this.parseAssignmentExpression();
      if (this.test(Token.RBRACK) && this.testAhead(Token.PERIOD_LT)) {
        this.next(); // `]`
        node.ArrayExtent = extent;
        node.TypeArguments = this.parseTypeArguments();
        return this.finishNode(node, 'ArrayType');
      }
    } catch (e) {
      if (this.scope.depth !== scopeDepth) {
        throw e;
      }
    }
    this.restoreLexerCheckpoint(checkpoint);
    this.earlyErrors = savedEarlyErrors;

    const TupleElementList: ParseNode.TupleElement[] = [];
    do {
      if (this.test(Token.RBRACK)) {
        break; // trailing comma
      }
      TupleElementList.push(this.parseTupleElement());
    } while (this.eat(Token.COMMA));
    this.expect(Token.RBRACK);
    node.TupleElementList = TupleElementList;
    return this.finishNode(node, 'TupleType');
  }

  // TupleElement :
  //   Type Initializer?
  //   `...` Type
  private parseTupleElement(): ParseNode.TupleElement {
    const node = this.startNode<ParseNode.TupleElement>();
    node.Rest = this.eat(Token.ELLIPSIS);
    node.Type = this.test(Token.CONST)
      ? this.parseCaptureBinding(node.Rest) as unknown as ParseNode.Type
      : this.parseType();
    node.Initializer = !node.Rest && this.eat(Token.ASSIGN) ? this.parseAssignmentExpression() : null;
    return this.finishNode(node, 'TupleElement');
  }

  // ObjectType :
  //   `{` `}`
  //   `{` TypeMemberList TypeMemberSeparator? `}`
  // TypeMemberSeparator : one of `,` `;`
  private parseObjectType(): ParseNode.ObjectType {
    const node = this.startNode<ParseNode.ObjectType>();
    this.expect(Token.LBRACE);
    const TypeMemberList: (ParseNode.TypeMember | ParseNode.IndexSignature)[] = [];
    while (!this.test(Token.RBRACE)) {
      TypeMemberList.push(this.parseTypeMember());
      if (!this.eat(Token.COMMA) && !this.eat(Token.SEMICOLON)) {
        break;
      }
    }
    this.expect(Token.RBRACE);
    node.TypeMemberList = TypeMemberList;
    return this.finishNode(node, 'ObjectType');
  }

  // TypeMember :
  //   PropertyName `?`? TypeAnnotation Initializer?
  //   PropertyName `?`? MethodSignature
  //   IndexSignature
  // IndexSignature :
  //   `[` BindingIdentifier TypeAnnotation `]` TypeAnnotation
  // A `[` opens both an index signature and a computed property name; an
  // identifier directly followed by `:` selects the index signature.
  protected parseTypeMember(): ParseNode.TypeMember | ParseNode.IndexSignature {
    const node = this.startNode<ParseNode.TypeMember | ParseNode.IndexSignature>();
    // A `readonly` modifier precedes the property/index. `readonly` is also a
    // valid property name, so only treat it as the modifier when another member
    // token follows (a name, `[`, `?`, or a string/number literal name).
    let Readonly = false;
    if (this.test('readonly')) {
      const ahead = this.peekAhead();
      if (ahead.type === Token.IDENTIFIER || ahead.type === Token.LBRACK
        || ahead.type === Token.STRING || ahead.type === Token.NUMBER
        || (ahead.type === Token.CONDITIONAL)) {
        this.next();
        Readonly = true;
      }
    }
    // proposal-runtime-types #sec-object-types: a MethodSignature with no name
    // is a CALL SIGNATURE. `(` or `<` at the start of a member has no other
    // reading, so no lookahead is needed.
    if (this.test(Token.LPAREN) || this.test(Token.LT)) {
      node.PropertyName = null;
      node.Readonly = false;
      node.Optional = false;
      node.MethodSignature = this.parseMethodSignature();
      node.TypeAnnotation = null;
      node.Initializer = null;
      return this.finishNode(node, 'TypeMember');
    }
    let PropertyName: ParseNode.PropertyNameLike;
    if (this.test(Token.LBRACK)) {
      const nameNode = this.startNode<ParseNode.PropertyName>();
      this.next(); // `[`
      if (this.test(Token.IDENTIFIER) && this.testAhead(Token.COLON)) {
        node.BindingIdentifier = this.parseBindingIdentifier();
        node.KeyTypeAnnotation = this.parseTypeAnnotation();
        this.expect(Token.RBRACK);
        node.ValueTypeAnnotation = this.parseTypeAnnotation();
        return this.finishNode(node, 'IndexSignature');
      }
      nameNode.ComputedPropertyName = this.parseAssignmentExpression();
      this.expect(Token.RBRACK);
      PropertyName = this.finishNode(nameNode, 'PropertyName');
    } else {
      PropertyName = this.parsePropertyName();
    }
    node.PropertyName = PropertyName;
    node.Readonly = Readonly;
    node.Optional = this.eat(Token.CONDITIONAL);
    if (this.test(Token.LPAREN) || this.test(Token.LT)) {
      node.MethodSignature = this.parseMethodSignature();
      node.TypeAnnotation = null;
      node.Initializer = null;
    } else {
      node.MethodSignature = null;
      node.TypeAnnotation = this.parseTypeAnnotation();
      node.Initializer = this.eat(Token.ASSIGN) ? this.parseAssignmentExpression() : null;
    }
    return this.finishNode(node, 'TypeMember');
  }

  // MethodSignature :
  //   TypeParameters? `(` FunctionTypeParameterList? `,`? `)` TypeAnnotation?
  private parseMethodSignature(): ParseNode.MethodSignature {
    const node = this.startNode<ParseNode.MethodSignature>();
    node.TypeParameters = this.test(Token.LT) ? this.parseTypeParameters(false, 'signature') : null;
    this.expect(Token.LPAREN);
    node.FunctionTypeParameterList = this.eat(Token.RPAREN)
      ? []
      : (() => {
        const { list } = this.parseFunctionTypeParameterListUntil(Token.RPAREN);
        this.expect(Token.RPAREN);
        return list;
      })();
    node.TypeAnnotation = this.test(Token.COLON) ? this.parseTypeAnnotation() : null;
    return this.finishNode(node, 'MethodSignature');
  }

  // CoverParenthesizedTypeAndFunctionTypeParameters :
  //   `(` `)`
  //   `(` FunctionTypeParameterList `,`? `)`
  private parseCoverParenthesizedTypeAndFunctionTypeParameters(): { list: ParseNode.FunctionTypeParameter[], trailingComma: boolean } {
    this.expect(Token.LPAREN);
    if (this.eat(Token.RPAREN)) {
      return { list: [], trailingComma: false };
    }
    const result = this.parseFunctionTypeParameterListUntil(Token.RPAREN);
    this.expect(Token.RPAREN);
    return result;
  }

  private parseFunctionTypeParameterListUntil(close: Token): { list: ParseNode.FunctionTypeParameter[], trailingComma: boolean } {
    const list: ParseNode.FunctionTypeParameter[] = [];
    let trailingComma = false;
    do {
      if (this.test(close)) {
        trailingComma = list.length > 0;
        break;
      }
      list.push(this.parseFunctionTypeParameter());
    } while (this.eat(Token.COMMA));
    return { list, trailingComma };
  }

  // FunctionTypeParameter :
  //   `ref`? Type
  //   `ref`? BindingIdentifier `?`? TypeAnnotation
  //   `...` BindingIdentifier TypeAnnotation
  //   `...` Type
  // An identifier directly followed by `:` or by `?` is a named parameter;
  // anything else, `ref` included when nothing type-like follows it, is a Type.
  private parseFunctionTypeParameter(): ParseNode.FunctionTypeParameter {
    const node = this.startNode<ParseNode.FunctionTypeParameter>();
    // proposal-runtime-types: a leading `this: T` declares the signature's this
    // type. `this` is the THIS token; it is a this-parameter only when a `:`
    // follows, so `this` remains usable as an ordinary type name elsewhere.
    if (this.test(Token.THIS) && this.testAhead(Token.COLON)) {
      this.next(); // `this`
      node.IsThis = true;
      node.Ref = false;
      node.Rest = false;
      node.BindingIdentifier = null;
      node.Optional = false;
      node.TypeAnnotation = this.parseTypeAnnotation();
      node.Type = null;
      node.Initializer = null;
      return this.finishNode(node, 'FunctionTypeParameter');
    }
    node.IsThis = false;
    const refTok = this.peek();
    node.Ref = !refTok.escaped
      && refTok.type === Token.IDENTIFIER
      && refTok.value === 'ref'
      // #sec-function-types: `ref` DISTRIBUTES over a rest, `ref ...refs: Cs`,
      // so an ellipsis after it claims it as the modifier too.
      && (this.aheadStartsPrimaryType() || this.testAhead(Token.ELLIPSIS))
      && this.eat('ref');
    node.Rest = this.eat(Token.ELLIPSIS);
    if (this.test(Token.IDENTIFIER)
        && (this.testAhead(Token.COLON) || (!node.Rest && this.testAhead(Token.CONDITIONAL)))) {
      node.BindingIdentifier = this.parseBindingIdentifier();
      node.Optional = !node.Rest && this.eat(Token.CONDITIONAL);
      node.TypeAnnotation = this.parseTypeAnnotation();
      node.Type = null;
    } else {
      node.BindingIdentifier = null;
      node.Optional = false;
      node.TypeAnnotation = null;
      node.Type = this.parseType();
    }
    // FunctionTypeParameter ... Initializer? - a parameter default in a function
    // TYPE, as a tuple element carries one (`[uint8, uint32 = 10]`): README,
    // "Function Interfaces", `(string = '5', named: uint32)`. A named argument
    // through a value of the type skips the parameter and the type's default
    // fills the position. Not on a rest, whose default would be an array of
    // nothing. Parsed as the tuple element's is.
    node.Initializer = !node.Rest && this.eat(Token.ASSIGN) ? this.parseAssignmentExpression() : null;
    return this.finishNode(node, 'FunctionTypeParameter');
  }

  private refineParenthesizedType(
    node: ParseNode.Unfinished<ParseNode.FunctionType | ParseNode.ParenthesizedType>,
    list: ParseNode.FunctionTypeParameter[],
    trailingComma: boolean,
  ): ParseNode.ParenthesizedType {
    // ParenthesizedType :
    //   `(` Type `)`
    if (list.length !== 1 || trailingComma) {
      return this.unexpected();
    }
    const only = list[0];
    if (only.Ref || only.Rest || only.BindingIdentifier !== null || only.Type === null) {
      return this.unexpected();
    }
    const paren = node as ParseNode.Unfinished<ParseNode.ParenthesizedType>;
    paren.Type = only.Type;
    return this.finishNode(paren, 'ParenthesizedType');
  }

  // WhereClauses :
  //   WhereClause
  //   WhereClauses WhereClause
  // WhereClause :
  //   `where` RefinementPredicate
  // OperatorDefinition :
  //   `static`? `operator` OperatorName OperatorTypeParameters? `(` FormalParameters `)` TypeAnnotation? `{` FunctionBody `}`
  //   `static`? `operator` OperatorName OperatorTypeParameters? `(` FormalParameters `)` TypeAnnotation? `;`
  //   `operator` Type `(` `)` TypeAnnotation? `{` FunctionBody `}`
  //   `*` `operator` `...` `(` `)` TypeAnnotation? `{` GeneratorBody `}`
  //   `*` `operator` `...` `(` `)` TypeAnnotation? `;`
  //
  // OperatorName :: one of
  //   `+` `-` `*` `/` `%` `**` `==` `<` `>` `<=` `>=` `&` `|` `^` `~` `<<` `>>` `>>>`
  protected parseOperatorDefinition(): ParseNode.OperatorDefinition {
    const node = this.startNode<ParseNode.OperatorDefinition>();
    node.static = false;
    node.OperatorGenerator = false;
    node.OperatorName = null;
    node.Type = null;
    node.TypeParameters = null;
    node.FormalParameters = null;
    node.TypeAnnotation = null;
    node.FunctionBody = null;
    node.GeneratorBody = null;
    if (this.eat(Token.MUL)) {
      node.OperatorGenerator = true;
      this.expect('operator');
      this.expect(Token.ELLIPSIS);
      this.expect(Token.LPAREN);
      this.expect(Token.RPAREN);
      if (this.test(Token.COLON)) {
        node.TypeAnnotation = this.parseTypeAnnotation(true);
      }
      if (this.test(Token.LBRACE)) {
        this.scope.with({
          lexical: true, variable: true, variableFunctions: true, await: false, yield: true, newTarget: false,
        }, () => {
          node.GeneratorBody = this.parseFunctionBody(false, true, false) as ParseNode.GeneratorBody;
        });
      } else {
        this.semicolon();
      }
      return this.finishNode(node, 'OperatorDefinition');
    }
    if (this.test('static') && this.testAhead('operator')) {
      this.next();
      node.static = true;
    }
    // proposal-runtime-types (operatoroverloading.md): `get operator[]` reads and
    // `set operator[]` writes, whose last parameter is the value being written. A
    // plain `operator[]` with no prefix is the read, as it always was.
    if ((this.test('get') || this.test('set')) && this.testAhead('operator')) {
      node.AccessorKind = this.test('get') ? 'get' : 'set';
      this.next();
    }
    this.expect('operator');
    // proposal-runtime-types (spec sec-class-operators): the index accessors are
    // overloadable. `operator[]` names the index accessor; the `[` `]` pair is the
    // operator name, followed by the parameter list (one or more index
    // parameters). A `get`/`set` prefix is handled by the class-element parser.
    // Only an EMPTY bracket pair names the index accessor. A `[` that opens a
    // type - `operator [number, number, string]()`, the tuple conversion target
    // of README's own example - is a conversion, and claiming every `[` for the
    // index operator made that a Syntax Error at `number`.
    // With explicit domains an index operator's own list always opens with a
    // parameter, `operator[].<I: uint32>(index: I)`, while `operator [].<number>()`
    // is a CONVERSION to the type `[].<number>`. Under the old grammar the bare
    // `number` read as a parameter name, so the conversion parsed as an index
    // operator by accident; the raw text after `.<` now decides.
    const afterBrackets = this.test(Token.LBRACK) && this.testAhead(Token.RBRACK)
      ? this.source.slice(this.peek().startIndex).match(/^\[\s*\]\s*\.<\s*(?:(?:in|out)\s+)?(?:\.\.\.)?\s*(?:const\b|[A-Za-z_$][\w$]*\s*(?:<[\s_,]*>)?\s*:)/)
      : null;
    const conversionToArray = this.test(Token.LBRACK) && this.testAhead(Token.RBRACK)
      && /^\[\s*\]\s*\.</.test(this.source.slice(this.peek().startIndex)) && !afterBrackets;
    if (this.test(Token.LBRACK) && this.testAhead(Token.RBRACK) && !conversionToArray) {
      this.expect(Token.LBRACK);
      this.expect(Token.RBRACK);
      node.OperatorName = '[]';
      if (this.test(Token.PERIOD_LT)) {
        node.TypeParameters = this.parseTypeParameters(true, 'operator');
      }
      this.scope.with({
        lexical: true, variable: true, variableFunctions: true, await: false, yield: false, newTarget: false,
      }, () => {
        this.scope.arrowInfoStack.push(null);
        this.scope.declareTypeParameters(node.TypeParameters);
        node.FormalParameters = this.parseFormalParameters();
        if (this.test(Token.COLON)) {
          node.TypeAnnotation = this.parseTypeAnnotation(true);
        }
        if (this.test(Token.LBRACE)) {
          node.FunctionBody = this.parseFunctionBody(false, false, false) as ParseNode.FunctionBody;
        } else {
          this.semicolon();
        }
        this.scope.arrowInfoStack.pop();
      });
      return this.finishNode(node, 'OperatorDefinition');
    }
    switch (this.peek().type) {
      case Token.ADD: case Token.SUB: case Token.MUL: case Token.DIV:
      case Token.MOD: case Token.EXP: case Token.EQ: case Token.LT:
      case Token.GT: case Token.LTE: case Token.GTE: case Token.BIT_AND:
      case Token.BIT_OR: case Token.BIT_XOR: case Token.BIT_NOT:
      case Token.SHL: case Token.SAR: case Token.SHR:
      // proposal-runtime-types (operatoroverloading.md): the unary operators
      // logical not, increment, and decrement. A zero-parameter declaration of
      // these (or of a spelling that is also binary, like `-`) is the unary form.
      case Token.NOT: case Token.INC: case Token.DEC:
      // proposal-runtime-types (operatoroverloading.md): the arithmetic compound
      // assignment operators. These take one parameter and mutate the receiver.
      case Token.ASSIGN_ADD: case Token.ASSIGN_SUB: case Token.ASSIGN_MUL:
      case Token.ASSIGN_DIV: case Token.ASSIGN_MOD: case Token.ASSIGN_EXP:
      case Token.ASSIGN_SHL: case Token.ASSIGN_SAR: case Token.ASSIGN_SHR:
      case Token.ASSIGN_BIT_AND: case Token.ASSIGN_BIT_OR: case Token.ASSIGN_BIT_XOR: {
        node.OperatorName = TokenValues[this.next().type] as string;
        if (this.test(Token.PERIOD_LT)) {
          // OperatorTypeParameters : `.<` TypeParameterList `>`
          node.TypeParameters = this.parseTypeParameters(true, 'operator');
        }
        this.scope.with({
          lexical: true, variable: true, variableFunctions: true, await: false, yield: false, newTarget: false,
        }, () => {
          this.scope.arrowInfoStack.push(null);
          this.scope.declareTypeParameters(node.TypeParameters);
          node.FormalParameters = this.parseFormalParameters();
          if (this.test(Token.COLON)) {
            node.TypeAnnotation = this.parseTypeAnnotation(true);
          }
          if (this.test(Token.LBRACE)) {
            node.FunctionBody = this.parseFunctionBody(false, false, false) as ParseNode.FunctionBody;
          } else {
            this.semicolon();
          }
          this.scope.arrowInfoStack.pop();
        });
        break;
      }
      default: {
        // conversion form: `operator` Type `(` `)`, and the one-parameter form
        // `operator` T `(` value `:` S `)` of sec-user-defined-conversions.
        const conversionCheckpoint = this.getLexerCheckpoint();
        const conversionEarlyErrors = new Set(this.earlyErrors);
        node.Type = this.parseType();
        // The trailing `(` `)` reads as an empty ComputedType inside the Type;
        // reclaim it for the conversion form.
        if (node.Type.type === 'ComputedType' && node.Type.Arguments.length === 0) {
          node.Type = node.Type.Callee;
        } else if (node.Type.type === 'ComputedType') {
          // NON-EMPTY arguments means a parameter list was folded into the type:
          // `parseType` ends by consuming a following `(` ... `)` through
          // `parseArguments`, which reads its contents as EXPRESSIONS. It does
          // not throw - it returns a ComputedType - and the `expect(LPAREN)`
          // below then failed on parens already eaten, which is why
          // `operator A(value: float32)` was a Syntax Error.
          //
          // So rewind and read it as what it is: the target type, then a formal
          // parameter list. Deterministic rather than speculative, because the
          // shape of the result says which form this is.
          this.restoreLexerCheckpoint(conversionCheckpoint);
          this.earlyErrors = conversionEarlyErrors;
          node.Type = this.parseTypeReference();
          node.FormalParameters = this.parseFormalParameters();
        } else {
          this.expect(Token.LPAREN);
          this.expect(Token.RPAREN);
        }
        if (this.test(Token.COLON)) {
          node.TypeAnnotation = this.parseTypeAnnotation(true);
        }
        this.scope.with({
          lexical: true, variable: true, variableFunctions: true, await: false, yield: false, newTarget: false,
        }, () => {
          node.FunctionBody = this.parseFunctionBody(false, false, false) as ParseNode.FunctionBody;
        });
        break;
      }
    }
    return this.finishNode(node, 'OperatorDefinition');
  }

  parseWhereClauses(): ParseNode.WhereClause[] {
    const clauses: ParseNode.WhereClause[] = [];
    while (this.test('where')) {
      const node = this.startNode<ParseNode.WhereClause>();
      this.next();
      // `return` is a |PrimaryExpression| only
      // HERE, so the flag is raised across the predicate and lowered after it
      // rather than being a property of the expression parser.
      const outer = (this as { inRefinementPredicate?: boolean }).inRefinementPredicate;
      (this as { inRefinementPredicate?: boolean }).inRefinementPredicate = true;
      try {
        node.RefinementPredicate = this.parseRefinementPredicate();
      } finally {
        (this as { inRefinementPredicate?: boolean }).inRefinementPredicate = outer;
      }
      clauses.push(this.finishNode(node, 'WhereClause'));
    }
    return clauses;
  }

  // RefinementPredicate :
  //   AssignmentExpression
  //   `if` `(` AssignmentExpression `)` `{` RefinementPredicate `}`
  //   `if` `(` AssignmentExpression `)` `{` RefinementPredicate `}` `else` `{` RefinementPredicate `}`
  private parseRefinementPredicate(): ParseNode.RefinementPredicate {
    if (this.test(Token.IF)) {
      const node = this.startNode<ParseNode.ConditionalRefinement>();
      this.next();
      this.expect(Token.LPAREN);
      node.Test = this.parseAssignmentExpression();
      this.expect(Token.RPAREN);
      this.expect(Token.LBRACE);
      node.Consequent = this.parseRefinementPredicate();
      this.expect(Token.RBRACE);
      if (this.eat(Token.ELSE)) {
        this.expect(Token.LBRACE);
        node.Alternate = this.parseRefinementPredicate();
        this.expect(Token.RBRACE);
      } else {
        node.Alternate = null;
      }
      return this.finishNode(node, 'ConditionalRefinement');
    }
    return this.parseAssignmentExpression();
  }
}
