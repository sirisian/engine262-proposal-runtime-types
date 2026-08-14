import { ExpressionParser } from './ExpressionParser.mts';
import type { ParseNode } from './ParseNode.mts';
import { TokenValues, Token } from './tokens.mts';
import { surroundingAgent } from '#self';

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
    if (this.test(Token.LPAREN)) {
      const node = this.startNode<ParseNode.FunctionType | ParseNode.ParenthesizedType>();
      const { list, trailingComma } = this.parseCoverParenthesizedTypeAndFunctionTypeParameters();
      if (this.eat(Token.ARROW)) {
        node.FunctionTypeParameterList = list;
        node.ReturnType = this.parseType();
        return this.finishNode(node, 'FunctionType');
      }
      const paren = this.refineParenthesizedType(node, list, trailingComma);
      return this.parseUnionTypeRest(this.parseIntersectionTypeRest(paren));
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
    let type = this.parsePrimaryType();
    while (this.test(Token.LBRACK)) {
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
      case Token.TYPEOF: {
        // TypeQueryType : `typeof` TypeName - the type of a value binding.
        const node = this.startNode<ParseNode.TypeQueryType>();
        this.next();
        node.ExpressionName = this.parseTypeName();
        return this.finishNode(node, 'TypeQueryType');
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
      // `typeof T` is a PrimaryType (TypeQueryType), so it may follow `keyof`,
      // `shared`, or `ref` like any other. Omitting it here left `keyof typeof E`
      // unparsed - `keyof` was read as a type NAME and the `typeof` after it was
      // unexpected - while `keyof (typeof E)` and a two-step alias both worked.
      // It is the spelling the enumerator names of an enum are reached by, and
      // the one a reader coming from TypeScript writes.
      case Token.TYPEOF:
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
        // `NaN` are handled there (F63). Without this a bounds-shaped meta type
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
      computed.Arguments = this.parseArguments().Arguments;
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
    // An identifier followed by `:` has no other reading in this position: a
    // named argument is told from a type by the colon alone.
    if (this.test(Token.IDENTIFIER) && this.testAhead(Token.COLON)) {
      const name = this.parseIdentifierName().name;
      this.expect(Token.COLON);
      const type = this.parseType();
      (type as { ArgumentName?: string }).ArgumentName = name;
      return type;
    }
    return this.parseType();
  }

  parseTypeArguments(): ParseNode.TypeArguments {
    const node = this.startNode<ParseNode.TypeArguments>();
    this.expect(Token.PERIOD_LT);
    this.noFuseGT += 1;
    const TypeArgumentList: ParseNode.Type[] = [this.parseTypeArgument()];
    while (this.eat(Token.COMMA)) {
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
  //   `<` TypeParameterList `,`? `>`
  // TypeParameter :
  //   BindingIdentifier TypeParameterConstraint? TypeParameterDefault?
  /**
   * `dotted` accepts the `.<` spelling an OPERATOR's own type parameters use -
   * `operator +.<B2>(...)`. Both existing call sites tested for `PERIOD_LT` and
   * then called this, which expects `<`, so every per-operator type parameter
   * list was a Syntax Error: the test passed and the parse failed one token
   * later. The `[]` operator carried the same latent bug.
   */
  parseTypeParameters(dotted = false): ParseNode.TypeParameters {
    const node = this.startNode<ParseNode.TypeParameters>();
    this.expect(dotted ? Token.PERIOD_LT : Token.LT);
    this.noFuseGT += 1;
    const TypeParameterList: ParseNode.TypeParameter[] = [];
    do {
      if (this.test(Token.GT)) {
        break; // trailing comma
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
        && this.testAhead(Token.IDENTIFIER)) {
        this.next();
        Variance = 'covariant';
      }
      param.Variance = Variance;
      param.BindingIdentifier = this.parseBindingIdentifier();
      // proposal-runtime-types #sec-higher-kinded-parameters: a parameter is
      // higher-kinded when its name is followed by a bracketed list of `_`,
      // and the count of holes is its arity. `_` is the pattern wildcard,
      // reused positionally the way `%` is the remainder operator and the
      // pipeline topic: a type parameter list is a position where a pattern
      // cannot appear, so the token is unambiguous and already means a hole.
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
      param.Arity = Arity;
      if (this.eat(Token.COLON) || this.eat(Token.EXTENDS)) {
        param.TypeParameterConstraint = this.parseType();
      } else {
        param.TypeParameterConstraint = null;
      }
      param.TypeParameterDefault = this.eat(Token.ASSIGN) ? this.parseType() : null;
      // proposal-runtime-types: a parameter carrying a default may not precede
      // one that does not, since an application supplying fewer arguments than
      // parameters fills from the END. The rule was stated in the specification
      // and enforced nowhere, which the higher-kinded work found by relying on
      // it: `Iterator<T, R, N, W<_> = Identity>` places its wrapper last
      // BECAUSE of this rule, and an unenforced rule is not a reason for
      // anything.
      const previous = TypeParameterList[TypeParameterList.length - 1];
      if (previous && previous.TypeParameterDefault && !param.TypeParameterDefault) {
        return this.unexpected();
      }
      TypeParameterList.push(this.finishNode(param, 'TypeParameter'));
    } while (this.eat(Token.COMMA));
    if (TypeParameterList.length === 0) {
      return this.unexpected();
    }
    this.expect(Token.GT);
    this.noFuseGT -= 1;
    node.TypeParameterList = TypeParameterList;
    return this.finishNode(node, 'TypeParameters');
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
    // CONTEXT, which is a return and nothing else. §7.3 of the decorators plan
    // asked whether `Reflect.Type` is a decorator context and the design
    // answers no - "a bare type expression carries no decorator" - but the
    // grammar had been admitting `let x: @f uint8`, a class field's `a: @f T`,
    // and a parameter's `p: @f T` and then DROPPING the decoration, which reads
    // as support. Refused here, where the position is known; the caller passes
    // `true` at the five return sites.
    if (allowDecorators && surroundingAgent.feature('runtime-types') && this.test(Token.AT)) {
      node.Decorators = this.parseDecorators();
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
  //   `[` `]`
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
      node.ArrayExtent = null;
      node.TypeArguments = this.test(Token.PERIOD_LT) ? this.parseTypeArguments() : null;
      return this.finishNode(node, 'ArrayType');
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
    node.Type = this.parseType();
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
    node.TypeParameters = this.test(Token.LT) ? this.parseTypeParameters() : null;
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
      return this.finishNode(node, 'FunctionTypeParameter');
    }
    node.IsThis = false;
    const refTok = this.peek();
    node.Ref = !refTok.escaped
      && refTok.type === Token.IDENTIFIER
      && refTok.value === 'ref'
      && this.aheadStartsPrimaryType()
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
    if (this.test(Token.LBRACK) && this.testAhead(Token.RBRACK)) {
      this.expect(Token.LBRACK);
      this.expect(Token.RBRACK);
      node.OperatorName = '[]';
      if (this.test(Token.PERIOD_LT)) {
        node.TypeParameters = this.parseTypeParameters(true);
      }
      this.scope.with({
        lexical: true, variable: true, variableFunctions: true, await: false, yield: false, newTarget: false,
      }, () => {
        this.scope.arrowInfoStack.push(null);
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
          node.TypeParameters = this.parseTypeParameters(true);
        }
        this.scope.with({
          lexical: true, variable: true, variableFunctions: true, await: false, yield: false, newTarget: false,
        }, () => {
          this.scope.arrowInfoStack.push(null);
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
      node.RefinementPredicate = this.parseRefinementPredicate();
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
