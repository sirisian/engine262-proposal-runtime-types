import {
  TV,
  PropName,
  StringValue,
  IsComputedPropertyKey,
  ContainsArguments,
} from '../static-semantics/all.mts';
import type { Mutable } from '../utils/language.mts';
import { FirstFreeReference, FirstEvaluabilityViolation } from '../static-semantics/PreprocessorEvaluability.mts';
import { ScanBalancedRun } from './ScanBalancedRun.mts';
import {
  Token,
  isPropertyOrCall,
  isMember,
  isKeywordRaw,
  isAutomaticSemicolon,
  isKeyword,
} from './tokens.mts';
import { isLineTerminator, type TokenData } from './Lexer.mts';
import { FunctionParser, FunctionKind } from './FunctionParser.mts';
import { RegExpParser, type RegExpParserContext } from './RegExpParser.mts';
import type { Location, ParseNode } from './ParseNode.mts';
import { surroundingAgent, type Feature, Value } from '#self';
import { Throw } from '#self';

/**
 * What a statement list ends in, where that is a shape a `do` may not end in.
 *
 * proposal-runtime-types #sec-do-expression-early-errors, which adopts the
 * upstream proposal's EndsInIterationOrDeclaration unchanged. The rule is on the
 * COMPLETION rather than on the syntax, so it reaches through nesting: an
 * `if`/`else` one branch of which ends in a loop is refused too, since that
 * branch's value would be the loop's.
 *
 * Returns a description for the diagnostic, or null where the list is fine.
 */
function endsInIterationOrDeclaration(list: readonly ParseNode[] | undefined): string | null {
  if (!list || list.length === 0) {
    return null;
  }
  const last = list[list.length - 1] as { type: string, StatementList?: readonly ParseNode[], Statement_a?: ParseNode, Statement_b?: ParseNode | null, LabelledItem?: ParseNode, Block?: { StatementList?: readonly ParseNode[] } };
  switch (last.type) {
    case 'LexicalDeclaration':
    case 'VariableStatement':
    case 'FunctionDeclaration':
    case 'GeneratorDeclaration':
    case 'AsyncFunctionDeclaration':
    case 'AsyncGeneratorDeclaration':
    case 'ClassDeclaration':
      return 'a declaration';
    case 'WhileStatement':
    case 'DoWhileStatement':
    case 'ForStatement':
    case 'ForInStatement':
    case 'ForOfStatement':
      return 'a loop';
    case 'IfStatement': {
      // An `if` with no `else` is its own error: the value is the consequent's
      // or undefined by a condition the reader has to trace.
      if (!last.Statement_b) {
        return 'an if with no else';
      }
      return endsInIterationOrDeclaration([last.Statement_a!])
        ?? endsInIterationOrDeclaration([last.Statement_b]);
    }
    case 'Block':
      return endsInIterationOrDeclaration(last.StatementList);
    case 'LabelledStatement':
      return endsInIterationOrDeclaration([last.LabelledItem!]);
    case 'TryStatement':
      return endsInIterationOrDeclaration(last.Block?.StatementList);
    default:
      return null;
  }
}

/**
 * Whether `node` contains a topic that BELONGS TO IT.
 *
 * #sec-pipeline-early-errors. A topic inside a nested pipeline's body is that
 * pipeline's, so the walk stops there; everything else is descended, including
 * function bodies, since an arrow inside a step still sees the step's topic.
 */
function containsOwnTopic(node: unknown): boolean {
  if (!node || typeof node !== 'object') {
    return false;
  }
  const n = node as { type?: string, Body?: unknown };
  if (n.type === 'TopicReference') {
    return true;
  }
  if (n.type === 'PipelineExpression') {
    // Its left operand is in the enclosing body; its own body is not.
    return containsOwnTopic((n as { PipelineExpression?: unknown }).PipelineExpression);
  }
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'location') {
      continue;
    }
    const child = (node as Record<string, unknown>)[key];
    if (Array.isArray(child)) {
      if (child.some((c) => containsOwnTopic(c))) {
        return true;
      }
    } else if (child && typeof child === 'object' && 'type' in (child as object)) {
      if (containsOwnTopic(child)) {
        return true;
      }
    }
  }
  return false;
}

/** Whether `node` contains a |VariableStatement|, not crossing a function. */
function containsVarStatement(node: unknown): boolean {
  return containsMatching(node, (t) => t === 'VariableStatement');
}

/** Whether `node` contains an unlabelled `break` or `continue`. */
function containsUnlabelledBreakOrContinue(node: unknown): boolean {
  return containsMatching(node, (t, n) => (t === 'BreakStatement' || t === 'ContinueStatement')
    && !(n as { LabelIdentifier?: unknown }).LabelIdentifier);
}

const FUNCTION_BOUNDARIES = new Set([
  'FunctionExpression', 'FunctionDeclaration', 'ArrowFunction', 'GeneratorExpression',
  'GeneratorDeclaration', 'AsyncFunctionExpression', 'AsyncFunctionDeclaration',
  'AsyncArrowFunction', 'AsyncGeneratorExpression', 'AsyncGeneratorDeclaration',
  'ClassExpression', 'ClassDeclaration',
]);

/**
 * A walk that stops at a function boundary, since a `var` hoists to the nearest
 * function and a `break` cannot cross one - so neither reaches out of a nested
 * one to the position being asked about.
 */
function containsMatching(node: unknown, predicate: (type: string, n: unknown) => boolean): boolean {
  if (!node || typeof node !== 'object') {
    return false;
  }
  const n = node as { type?: string };
  if (n.type && FUNCTION_BOUNDARIES.has(n.type)) {
    return false;
  }
  if (n.type && predicate(n.type, node)) {
    return true;
  }
  for (const key of Object.keys(node)) {
    if (key === 'parent' || key === 'location') {
      continue;
    }
    const child = (node as Record<string, unknown>)[key];
    if (Array.isArray(child)) {
      if (child.some((c) => containsMatching(c, predicate))) {
        return true;
      }
    } else if (child && typeof child === 'object' && 'type' in (child as object)) {
      if (containsMatching(child, predicate)) {
        return true;
      }
    }
  }
  return false;
}


/**
 * Mark a reference as NOT admitting, where it turned out to sit in one of the two
 * positions `#sec-type-names` excepts. The candidate was recorded when the
 * identifier was parsed, because neither position is known until its enclosing
 * production is finished.
 */
function exceptFromAdmitting(node: unknown, alsoFromResolution = false): void {
  let target = node as { type?: string, Expression?: unknown, exceptedFromAdmitting?: boolean };
  while (target && target.type === 'ParenthesizedExpression') {
    target = target.Expression as typeof target;
  }
  if (target && target.type === 'IdentifierReference') {
    target.exceptedFromAdmitting = true;
    if (alsoFromResolution) {
      // #sec-type-names: only the ASSIGNMENT target is excepted from resolution.
      // `typeof` is excepted from admitting alone - a text that does not admit
      // has nothing bound for the probe to find, which is all existing code
      // needs, and a text that DOES admit opted in, so reporting the Type Object
      // there is what its author asked for.
      (target as { exceptedFromResolution?: boolean }).exceptedFromResolution = true;
    }
  }
}

/**
 * proposal-runtime-types, PLAN-constructor-returns.md (OQ2-B, CORRECTED in
 * phase 4): is this class a TYPED class?
 *
 * #sec-typed-classes already defines the term: "A class is typed when at least
 * one of its public or private fields carries a type annotation." That
 * definition has teeth elsewhere - a typed class "is automatically sealed and
 * its prototype frozen", and value-type-class eligibility is built on it - and
 * the engine implements it as [[SealInstances]], set from an INSTANCE field
 * annotation, public or private.
 *
 * Phase 2 decided this line independently and drew it wider: any annotation
 * anywhere, including a method's return, a constructor parameter, and a static
 * field. That was wrong, and not because the wider line is indefensible - it is
 * that "typed class" was ALREADY DEFINED, so the wider reading created a second
 * meaning for one term, with the constructor rule and the sealing rule
 * disagreeing about which classes they applied to. One term, one meaning.
 *
 * What the alignment costs, stated rather than discovered later: a class
 * annotated only on a method, a getter, a constructor parameter, or a static
 * field is NOT typed, so its constructor may still return an object and F122's
 * hole stays open there. That is a real residual, and it is the right residual:
 * the layout argument - the strongest one, and the one specific to this
 * proposal - is about what a construction PRODUCES, and only a field annotation
 * makes an instance's shape a fact. Where the rule does not reach, the class is
 * extensible, unsealed, and not layout-bearing, which is the same category an
 * untyped class is in for these purposes.
 *
 * A `static` field is excluded for the same reason the engine excludes it from
 * sealing: it is not on the instance, so it says nothing about what a
 * construction produces.
 */
function classIsTyped(elements: readonly ParseNode.ClassElement[]): boolean {
  return elements.some((element) => {
    const e = element as { type?: string, static?: boolean, TypeAnnotation?: unknown };
    return e.type === 'FieldDefinition' && !e.static && !!e.TypeAnnotation;
  });
}

export abstract class ExpressionParser extends FunctionParser {
  // proposal-runtime-types: while parsing a conditional's consequent a `:` is
  // the conditional's own colon, so arrow return annotations are suppressed
  // there (parenthesize the arrow to annotate it). Parenthesized and argument
  // contexts reset the suppression, since no conditional colon is pending
  // inside them.
  protected conditionalConsequentDepth = 0;

  protected withConditionalAnnotationsAllowed<T>(f: () => T): T {
    const saved = this.conditionalConsequentDepth;
    this.conditionalConsequentDepth = 0;
    try {
      return f();
    } finally {
      this.conditionalConsequentDepth = saved;
    }
  }

  // proposal-runtime-types: implemented by TypeParser further up the mixin chain.
  abstract tryParseArrowReturnTypeAnnotation(): ParseNode.TypeAnnotation | null;

  /** Set while an iteration statement's head is being parsed (#sec-do-expression-early-errors). */
  protected inIterationHead = false;

  /**
   * How many pipeline bodies enclose the position being parsed.
   *
   * Saved and restored around a body rather than set and cleared, so that a
   * function expression inside one keeps the topic admitted: `xs |> %.map(v =>
   * v + %.length)` is legal, and a counter cleared at a function boundary would
   * refuse it.
   */
  protected pipelineBodyDepth = 0;

  // proposal-runtime-types #sec-do-expressions: a `do` expression's plain form
  // parses a Block, which the statement parser owns.
  protected abstract parseBlock(lexical?: boolean): ParseNode.Block;

  protected abstract parseOperatorDefinition(): ParseNode.OperatorDefinition;

  protected abstract parseTypeReference(): ParseNode.TypeReference;

  protected abstract parseType(): ParseNode.Type;

  protected abstract parseTypeArguments(): ParseNode.TypeArguments;

  // proposal-runtime-types: the modifiers of the class currently being parsed,
  // for the abstract-method placement check.
  protected currentClassModifiers: readonly string[] | null = null;

  // ClassModifier : one of `abstract` `sealed` `dynamic`
  // True when a run of class modifiers can begin here; the run must reach
  // `class`, so a lone identifier never takes this route.
  protected testClassModifierRun(): boolean {
    if (!surroundingAgent.feature('runtime-types')) {
      return false;
    }
    if (!(this.test('abstract') || this.test('sealed') || this.test('dynamic') || this.test('partial'))) {
      return false;
    }
    return this.testAhead(Token.CLASS)
      || this.testAhead('abstract')
      || this.testAhead('sealed')
      || this.testAhead('dynamic')
      || this.testAhead('partial');
  }

  protected abstract override readonly state: {
    admitsTypeNames: boolean;
    typeNameReferences: { exceptedFromAdmitting?: boolean }[];
    hasTopLevelAwait: boolean;
    strict: boolean;
    json: boolean;
  };

  abstract parseBindingPattern(): ParseNode.BindingPattern;

  abstract markNodeStart(node: ParseNode.BaseParseNode | ParseNode.Unfinished): void;

  abstract parseInitializerOpt(): ParseNode.Initializer | null;

  abstract semicolon(): void;

  abstract feature(name: Feature): boolean;

  protected getLocation(inheritStart?: ParseNode.BaseParseNode): Location {
    return {
      startIndex: inheritStart ? inheritStart.location.startIndex : this.peekToken.startIndex,
      endIndex: -1,
      start: inheritStart ? { ...inheritStart.location.start } : {
        line: this.peekToken.line,
        column: this.peekToken.column,
      },
      end: {
        line: -1,
        column: -1,
      },
    };
  }

  protected markLocationEnd(node: Pick<ParseNode.Unfinished, 'location'>) {
    node.location.endIndex = this.currentToken.endIndex;
    node.location.end.line = this.currentToken.line;
    node.location.end.column = this.currentToken.column;
    return node;
  }

  /**
   * The region a moded decoration takes, or undefined where the decoration
   * declares no mode.
   *
   * `@jsx do { <div/> }` and `@jsx { <div/> }`: the region begins at the `{` and
   * ends at its match, found by ScanBalancedRun rather than by the tokenizer,
   * because its contents are not ECMAScript.
   */
/**
   * Whether a JSX element may begin where an operand is expected.
   *
   * Set while parsing a region whose decoration declared the `jsx` mode. Outside
   * one it is false, so `a < b` and a type argument list read as they always
   * did - which is the whole argument for a scoped mode over a grammar that
   * admits JSX everywhere and then has to disambiguate `<` per occurrence.
   */


  /**
   * A JSX element, scanned rather than tokenized.
   *
   * Child text is not ECMAScript - `Hi there` is two identifiers to the lexer,
   * and the space between them is lost - so the element is scanned by advancing
   * `position` directly, the way a template literal is. Its `{ ... }`
   * substitutions ARE ECMAScript and are parsed as expressions, so their tokens
   * are threaded from this parse like any other.
   *
   * The result is opaque: it is never evaluated, because the decoration that
   * admitted it replaces the whole region before evaluation. It exists to be
   * found, measured, and spliced.
   */

  /** `<tag ...>children</tag>` or `<tag ... />`, consuming through the close. */


  /** Raw text between tags, logged as one string token so its spaces survive. */


  /** The lexical mode a decoration list declared, if any. */
  modeOfDecorators(decorators: readonly ParseNode.Decorator[] | null): string | undefined {
    if (!decorators || decorators.length === 0) {
      return undefined;
    }
    let mode;
    for (const d of decorators) {
      const spelled = this.decorationName(d);
      if (spelled !== undefined) {
        const declared = (this as unknown as { decoratorModes: ReadonlyMap<string, string> }).decoratorModes?.get(spelled);
        if (declared !== undefined) {
          mode = declared;
        }
      }
    }
    return mode;
  }

  /**
   * The name a decoration is spelled with, argumented or not.
   *
   * `@m` puts the identifier in [[MemberExpression]]; `@m(X)` puts it in
   * [[CallExpression]].[[CallExpression]] and leaves [[MemberExpression]] empty.
   * Reading only the first is why an argumented decoration was never collected
   * for expansion, and - measured - why `@jsx(1) { <div/> }` did not find its
   * mode and fell through to being lexed as ECMAScript. The same shape, twice;
   * `decoratedName` in Expansion.mts already resolves it this way.
   */
  decorationName(decorator: ParseNode.Decorator): string | undefined {
    const d = decorator as unknown as {
      MemberExpression?: { type?: string, name?: string },
      CallExpression?: { CallExpression?: { type?: string, name?: string } },
    };
    const bare = d.MemberExpression;
    if (bare?.type === 'IdentifierReference' && typeof bare.name === 'string') {
      return bare.name;
    }
    const callee = d.CallExpression?.CallExpression;
    return callee?.type === 'IdentifierReference' && typeof callee.name === 'string' ? callee.name : undefined;
  }

  parseModedRegion(
    decorators: readonly ParseNode.Decorator[] | null,
    inExpressionPosition = false,
  ): ParseNode.ModedRegion | undefined {
    if (!decorators || decorators.length === 0) {
      return undefined;
    }
    const mode = this.modeOfDecorators(decorators);
    if (mode === undefined) {
      return undefined;
    }
    // The node begins where the region does, INCLUDING a `do`. Expansion splices
    // the node's source range, so starting after the `do` would leave it behind
    // for the re-parse to trip on.
    const node = this.startNode<ParseNode.ModedRegion>() as ParseNode.Unfinished<ParseNode.ModedRegion>;
    // A declaration is not a region to capture: it is ECMAScript, and what the
    // mode changes is that a JSX element may appear inside it where an operand
    // is expected. So the flag is set and the declaration parses normally -
    // which is what `@jsx function View() { return <div/>; }` needs, and what a
    // captured region can never give, since a component's body is mostly
    // ordinary code.
    if (!this.test(Token.DO) && !this.test(Token.LBRACE)) {
      return undefined;
    }
    // A MIXED mode parses its region rather than capturing it.
    //
    // This is the whole of the mixed mode, and it needs no scanner: `jsx` is
    // ECMAScript with one extra production at PrimaryExpression, so a region in
    // that mode is an ordinary Block parsed by the ordinary parser with
    // `jsxAllowed` set. Capturing the span instead is what made `if (c) { }`
    // inside a region arrive as JSX TEXT - correct for a scanner reading
    // characters between tags, and useless for a macro.
    //
    // The tokens then come from the parse log like every other token, so a
    // regular expression or a template literal in a clause is one token, and a
    // JSX element arrives as a group carrying its own structure.
    // Both parsed grammars take this path; they differ only in whether the JSX
    // element production is enabled while the Block is parsed.
    if (mode === 'parsed') {
      const parsed = this.startNode<ParseNode.ModedRegion>() as ParseNode.Unfinished<ParseNode.ModedRegion>;
      if (this.test(Token.DO)) {
        this.next();
      }
      const blockStart = this.peek().startIndex;
      const block = this.parseBlock();
      (parsed as { Mode?: string }).Mode = mode;
      (parsed as { Block?: unknown }).Block = block;
      (parsed as { Parsed?: boolean }).Parsed = true;
      (parsed as { IsExpression?: boolean }).IsExpression = inExpressionPosition;
      (parsed as { RegionText?: string }).RegionText = this.source.slice(blockStart, block.location.endIndex);
      (parsed as { Decorators?: readonly ParseNode.Decorator[] | null }).Decorators = decorators;
      return this.finishNode(parsed as ParseNode.Unfinished<ParseNode>, 'ModedRegion' as ParseNode['type']) as unknown as ParseNode.ModedRegion;
    }
    // `do` may precede the region in either position and means nothing to the
    // macro - it is consumed and dropped.
    //
    // What the node records is the POSITION, which comes from the CALLER: a
    // region parsed from a primary expression is in expression position, and one
    // parsed from the statement dispatch is not. Recording `do`'s presence
    // instead - which this did - conflated the spelling with the position, so a
    // bare region in expression position looked like a statement and a `do`
    // region in statement position looked like an expression. Both spellings are
    // legal in both positions, so the two are independent.
    if (this.test(Token.DO)) {
      this.next();
    }
    const start = this.peek().startIndex;
    if (this.source[start] !== '{') {
      // A moded decoration whose target is not a region decorates it the
      // ordinary way - `@jsx class C {}` is a decoration on a class, not an
      // error. Declaring a mode says how a REGION is scanned, not that every
      // use of the name must take one.
      return undefined;
    }
    const run = ScanBalancedRun(this.source, start);
    if (run === undefined) {
      // The delimiters do not balance. Reported at the region rather than at the
      // end of the file, which is where an unbalanced run would otherwise
      // surface.
      return this.unexpected() as never;
    }
    (node as { Mode?: string }).Mode = mode;
    (node as { RegionText?: string }).RegionText = this.source.slice(start, run.end);
    (node as { IsExpression?: boolean }).IsExpression = inExpressionPosition;
    (node as { Decorators?: readonly ParseNode.Decorator[] | null }).Decorators = decorators;
    // The tokenizer skipped nothing yet, so it is repositioned past the region -
    // the node carries the text, and expansion replaces the range.
    this.resumeLexingAt(run.end);
    const finished = this.finishNode(node as ParseNode.Unfinished<ParseNode>, 'ModedRegion' as ParseNode['type']) as unknown as ParseNode.ModedRegion;
    // markLocationEnd reads the last TOKEN's end, and no token was read for the
    // region - it was scanned by delimiter. Expansion splices the target's source
    // RANGE, so an end left at the `{` would replace only the opening brace and
    // leave the region's text behind, which the re-parse then fails on. Set it
    // from the scan.
    if (finished.location) {
      (finished.location as { endIndex: number }).endIndex = run.end;
    }
    return finished;
  }

  private isParsingArrowParameterCandidate() {
    if (this.scope.inParameters()) {
      return true;
    }
    if (this.scope.inArrowParameterCandidate() && !this.scope.inArrowBody()) {
      return true;
    }
    return this.scope.assignmentInfoStack.some((info) => info.type === 'arrow');
  }

  // Expression :
  //   AssignmentExpression
  //   Expression `,` AssignmentExpression
  parseExpression(): ParseNode.Expression {
    const AssignmentExpression = this.parseAssignmentExpression();
    if (this.eat(Token.COMMA)) {
      const CommaOperator = this.startNode<ParseNode.CommaOperator>(AssignmentExpression);
      const ExpressionList = [AssignmentExpression];
      do {
        ExpressionList.push(this.parseAssignmentExpression());
      } while (this.eat(Token.COMMA));
      CommaOperator.ExpressionList = ExpressionList;
      return this.finishNode(CommaOperator, 'CommaOperator');
    }
    return AssignmentExpression;
  }

  // AssignmentExpression :
  //   ConditionalExpression
  //   [+Yield] YieldExpression
  //   ArrowFunction
  //   AsyncArrowFunction
  //   LeftHandSideExpression `=` AssignmentExpression
  //   LeftHandSideExpression AssignmentOperator AssignmentExpression
  //   LeftHandSideExpression LogicalAssignmentOperator AssignmentExpression
  //
  // AssignmentOperator : one of
  //   *= /= %= += -= <<= >>= >>>= &= ^= |= **=
  //
  // LogicalAssignmentOperator : one of
  //   &&= ||= ??=
  parseAssignmentExpression(): ParseNode.AssignmentExpressionOrHigher {
    if (this.test(Token.YIELD) && this.scope.hasYield()) {
      return this.parseYieldExpression();
    }

    this.scope.pushAssignmentInfo('assign');
    const left = this.parseConditionalExpression();
    const assignmentInfo = this.scope.popAssignmentInfo();

    if (left.type === 'IdentifierReference') {
      // `async` [no LineTerminator here] IdentifierReference [no LineTerminator here] `=>`
      if (left.name === 'async'
          && !left.escaped
          && this.test(Token.IDENTIFIER)
          && !this.peek().hadLineTerminatorBefore
          && ((this.testAhead(Token.ARROW) && !this.peekAhead().hadLineTerminatorBefore)
            || (surroundingAgent.feature('runtime-types')
              && this.conditionalConsequentDepth === 0
              && this.testAhead(Token.COLON)))) {
        assignmentInfo.clear();
        const node = this.startNode<ParseNode.AsyncArrowFunction>(left);
        const Arguments = [this.parseIdentifierReference()];
        const asyncIdentAnnotation = this.tryParseArrowReturnTypeAnnotation();
        if (asyncIdentAnnotation) {
          node.TypeAnnotation = asyncIdentAnnotation;
        }
        return this.parseArrowFunction(node, { Arguments }, FunctionKind.ASYNC);
      }
      // IdentifierReference [no LineTerminator here] `=>`
      // proposal-runtime-types: ArrowFunction : ArrowParameters TypeAnnotation? [no LT] `=>`
      const identArrowAnnotation = this.test(Token.ARROW) ? null : this.tryParseArrowReturnTypeAnnotation();
      if (this.test(Token.ARROW) && !this.peek().hadLineTerminatorBefore) {
        assignmentInfo.clear();
        const node = this.startNode<ParseNode.ArrowFunction>(left);
        if (identArrowAnnotation) {
          node.TypeAnnotation = identArrowAnnotation;
        }
        return this.parseArrowFunction(node, { Arguments: [left] }, FunctionKind.NORMAL);
      }
    }

    // `async` [no LineTerminator here] Arguments [no LineTerminator here] `=>`
    if (left.type === 'CallExpression' && left.arrowInfo) {
      const last = left.Arguments[left.Arguments.length - 1];
      if (!left.arrowInfo.hasTrailingComma || (last && last.type !== 'AssignmentRestElement')) {
        const asyncCoverAnnotation = this.test(Token.ARROW) ? null : this.tryParseArrowReturnTypeAnnotation();
        if (this.test(Token.ARROW) && !this.peek().hadLineTerminatorBefore) {
          assignmentInfo.clear();
          const node = this.startNode<ParseNode.AsyncArrowFunction>(left);
          if (asyncCoverAnnotation) {
            node.TypeAnnotation = asyncCoverAnnotation;
          }
          return this.parseArrowFunction(node, left, FunctionKind.ASYNC);
        }
      }
    }

    if (left.type === 'CoverParenthesizedExpressionAndArrowParameterList') {
      assignmentInfo.clear();
      const node = this.startNode<ParseNode.ArrowFunction>(left);
      if (left.TypeAnnotation) {
        node.TypeAnnotation = left.TypeAnnotation;
      }
      return this.parseArrowFunction(node, left, FunctionKind.NORMAL);
    }

    switch (this.peek().type) {
      case Token.ASSIGN:
      case Token.ASSIGN_MUL:
      case Token.ASSIGN_DIV:
      case Token.ASSIGN_MOD:
      case Token.ASSIGN_ADD:
      case Token.ASSIGN_SUB:
      case Token.ASSIGN_SHL:
      case Token.ASSIGN_SAR:
      case Token.ASSIGN_SHR:
      case Token.ASSIGN_BIT_AND:
      case Token.ASSIGN_BIT_XOR:
      case Token.ASSIGN_BIT_OR:
      case Token.ASSIGN_EXP:
      case Token.ASSIGN_AND:
      case Token.ASSIGN_OR:
      case Token.ASSIGN_NULLISH: {
        assignmentInfo.clear();
        const node = this.startNode<ParseNode.AssignmentExpression>(left);
        this.validateAssignmentTarget(left);
        // #sec-type-names: the other excepted position. A sloppy-mode assignment
        // to an undeclared name creates a global rather than throwing, so it is
        // the second idiom existing code can already use these names with.
        exceptFromAdmitting(left, true);
        node.LeftHandSideExpression = left;
        // NOTE: This cast isn't strictly sound as it depends on an expectation that `this.next.value` is correlated
        //       to `this.peek().type` which cannot be verified by the type system.
        node.AssignmentOperator = this.next().value as ParseNode.AssignmentExpression['AssignmentOperator'];
        node.AssignmentExpression = this.parseAssignmentExpression();
        return this.finishNode(node, 'AssignmentExpression');
      }
      default:
        return left;
    }
  }

  validateAssignmentTarget(node: ParseNode) {
    switch (node.type) {
      case 'IdentifierReference':
        if (this.isStrictMode() && (node.name === 'eval' || node.name === 'arguments')) {
          break;
        }
        return;
      case 'CoverInitializedName':
        this.validateAssignmentTarget(node.IdentifierReference);
        return;
      case 'MemberExpression':
        if (node.MemberExpression.type === 'ObjectLiteral'
            && node.MemberExpression.PropertyDefinitionList.some((p) => p.type === 'CoverInitializedName')) {
          break;
        }
        return;
      case 'SuperProperty':
        return;
      case 'ParenthesizedExpression':
        if (node.Expression.type === 'ObjectLiteral' || node.Expression.type === 'ArrayLiteral') {
          break;
        }
        this.validateAssignmentTarget(node.Expression);
        return;
      case 'ArrayLiteral':
        node.ElementList.forEach((p, i) => {
          if (p.type === 'SpreadElement' && (i !== node.ElementList.length - 1 || node.hasTrailingComma)) {
            this.addEarlyError(Throw.SyntaxError('Spread element must be last element'), p);
          }
          if (p.type === 'AssignmentExpression') {
            this.validateAssignmentTarget(p.LeftHandSideExpression);
          } else {
            this.validateAssignmentTarget(p);
          }
        });
        return;
      case 'ObjectLiteral':
        node.PropertyDefinitionList.forEach((p, i) => {
          if (p.type === 'PropertyDefinition' && !p.PropertyName
              && i !== node.PropertyDefinitionList.length - 1) {
            this.addEarlyError(Throw.SyntaxError('Invalid assignment target'), p);
          }
          this.validateAssignmentTarget(p);
        });
        return;
      case 'PropertyDefinition':
        if (node.AssignmentExpression.type === 'AssignmentExpression') {
          this.validateAssignmentTarget(node.AssignmentExpression.LeftHandSideExpression);
        } else {
          this.validateAssignmentTarget(node.AssignmentExpression);
        }
        return;
      case 'Elision':
        return;
      case 'SpreadElement':
        if (node.AssignmentExpression.type === 'AssignmentExpression') {
          break;
        }
        this.validateAssignmentTarget(node.AssignmentExpression);
        return;
      default:
        break;
    }
    // proposal-runtime-types #sec-location-consuming-contexts: a call that
    // returns a borrow may be assigned to, and this is the one place that has
    // to admit it. Every position an assignment target can appear routes here
    // - a simple or compound assignment, an array or object pattern and their
    // nested and rest targets, and a for-in or for-of head - so relaxing the
    // rule once covers all of them uniformly, which is what the base language
    // achieves by phrasing each of those Early Errors in terms of one static
    // semantic, AssignmentTargetType.
    //
    // Whether the call actually returns a borrow is a matter of its type: a
    // callee whose return type is known and is not a `ref` type is refused
    // before the source runs, and where it is not known the check is the
    // runtime one at the store.
    if (this.markLocationConsuming(node)) {
      return;
    }
    this.addEarlyError(Throw.SyntaxError('Invalid assignment target'), node);
  }

  // YieldExpression :
  //   `yield`
  //   `yield` [no LineTerminator here] AssignmentExpression
  //   `yield` [no LineTerminator here] `*` AssignmentExpression
  parseYieldExpression(): ParseNode.YieldExpression {
    if (this.scope.inParameters()) {
      this.addEarlyError(Throw.SyntaxError('yield cannot be used in formal parameters'));
    }
    const node = this.startNode<ParseNode.YieldExpression>();
    this.expect(Token.YIELD);
    if (this.peek().hadLineTerminatorBefore) {
      node.hasStar = false;
      node.AssignmentExpression = null;
    } else {
      node.hasStar = this.eat(Token.MUL);
      if (node.hasStar) {
        node.AssignmentExpression = this.parseAssignmentExpression();
      } else {
        switch (this.peek().type) {
          case Token.EOS:
          case Token.SEMICOLON:
          case Token.RBRACE:
          case Token.RBRACK:
          case Token.RPAREN:
          case Token.COLON:
          case Token.COMMA:
          case Token.IN:
            node.AssignmentExpression = null;
            break;
          default:
            node.AssignmentExpression = this.parseAssignmentExpression();
        }
      }
    }
    if (this.isParsingArrowParameterCandidate()) {
      this.scope.arrowInfo?.yieldExpressions.push(node as ParseNode.YieldExpression);
    }
    return this.finishNode(node, 'YieldExpression');
  }

  // ConditionalExpression :
  //   ShortCircuitExpression
  //   ShortCircuitExpression `?` AssignmentExpression `:` AssignmentExpression
  /**
   * proposal-runtime-types #sec-pipeline-operator.
   *
   *   PipelineExpression :
   *     RangeExpression
   *     PipelineExpression `|>` RangeExpression
   *
   * Left-associative, and LOOSER than a range: the specification states the
   * order in both clauses, because the upstream proposal names
   * ShortCircuitExpression as its operand and this design has put ranges at
   * that level. `0..<10 |> sum(%)` pipes the range.
   */
  parsePipelineExpression(): ParseNode.Expression {
    let left = this.parseRangeExpression() as ParseNode.Expression;
    if (!surroundingAgent.feature('runtime-types')) {
      return left;
    }
    while (this.test(Token.PIPE_GT)) {
      const node = this.startNode<ParseNode.PipelineExpression>(left);
      this.next();
      node.PipelineExpression = left;
      // The body is parsed with the topic admitted; the depth is what
      // `parsePrimaryExpression` reads to tell a topic from a remainder.
      this.pipelineBodyDepth += 1;
      try {
        node.Body = this.parseRangeExpression() as ParseNode.Expression;
      } finally {
        this.pipelineBodyDepth -= 1;
      }
      // #sec-pipeline-early-errors: a body that mentions no topic OF ITS OWN
      // discards what was piped into it. The walk stops at a nested pipeline's
      // body, so `a |> f(b |> g(%))` is refused and `a |> f(%, b |> g(%))` is
      // how it is written.
      if (!containsOwnTopic(node.Body)) {
        this.addEarlyError(Throw.SyntaxError('a pipeline step must use the topic'), node.Body);
      }
      left = this.finishNode(node, 'PipelineExpression') as ParseNode.Expression;
    }
    return left;
  }

  parseConditionalExpression(): ParseNode.ConditionalExpressionOrHigher {
    const ShortCircuitExpression = this.parsePipelineExpression() as ParseNode.ShortCircuitExpressionOrHigher;
    if (this.eat(Token.CONDITIONAL)) {
      const node = this.startNode<ParseNode.ConditionalExpression>(ShortCircuitExpression);
      node.ShortCircuitExpression = ShortCircuitExpression;
      this.scope.with({ in: true }, () => {
        this.conditionalConsequentDepth += 1;
        try {
          node.AssignmentExpression_a = this.parseAssignmentExpression();
        } finally {
          this.conditionalConsequentDepth -= 1;
        }
      });
      this.expect(Token.COLON);
      node.AssignmentExpression_b = this.parseAssignmentExpression();
      return this.finishNode(node, 'ConditionalExpression');
    }
    return ShortCircuitExpression;
  }

  // proposal-runtime-types (ranges.md "Syntax", #sec-range-literals):
  // RangeExpression :
  //   ShortCircuitExpression? `..<` ShortCircuitExpression
  //   ShortCircuitExpression? `..=` ShortCircuitExpression
  //   ShortCircuitExpression `<..<` ShortCircuitExpression
  //   ShortCircuitExpression `<..=` ShortCircuitExpression
  //   ShortCircuitExpression `..`
  //   ShortCircuitExpression `<..`
  //   `..`
  //
  // Nine forms over six tokens. A range that has an end always marks whether it
  // includes it, and marks its start only where the start is exclusive, so each
  // token fixes BOTH bounds and whether an end follows. That is what retires the
  // follow-set heuristic this parser used to need: end-presence was ambiguous
  // only while a bare `..` could mean either the from form or a two-endpoint
  // form, and there is no longer a bare two-endpoint form. `a..b` therefore
  // needs no rejection code -- `a..` finishes as a from-range and the dangling
  // `b` is the ordinary unexpected-token error.
  //
  // A range binds tighter than assignment and looser than `||`/`??`, and it is
  // non-associative, so `a..<b..<c` is a Syntax Error.
  static readonly #rangeTokens = [
    Token.DOT_DOT, Token.DOT_DOT_LT, Token.DOT_DOT_EQ,
    Token.LT_DOT_DOT, Token.LT_DOT_DOT_LT, Token.LT_DOT_DOT_EQ,
  ] as const;

  testRangeOperator(): boolean {
    return ExpressionParser.#rangeTokens.some((t) => this.test(t));
  }

  parseRangeExpression(): ParseNode.RangeExpressionOrHigher {
    if (!this.feature('runtime-types')) {
      return this.parseShortCircuitExpression();
    }
    // The start-omitted forms `..<b`, `..=b`, and `..` begin with the operator.
    // A leading `<..` is not among them: an omitted start has no inclusivity to
    // state, so there is nothing for the `<` to mark.
    if (this.test(Token.DOT_DOT) || this.test(Token.DOT_DOT_LT) || this.test(Token.DOT_DOT_EQ)) {
      const node = this.startNode<ParseNode.RangeExpression>();
      return this.finishRangeExpression(node, null);
    }
    const left = this.parseShortCircuitExpression();
    if (this.testRangeOperator()) {
      const node = this.startNode<ParseNode.RangeExpression>(left);
      return this.finishRangeExpression(node, left);
    }
    return left;
  }

  finishRangeExpression(node: ParseNode.Unfinished<ParseNode.RangeExpression>, start: ParseNode.ShortCircuitExpressionOrHigher | null): ParseNode.RangeExpression {
    // The token is the whole of what the bounds and the end-presence are.
    let startBound: ParseNode.RangeBound | null;
    let endBound: ParseNode.RangeBound | null;
    switch (this.peek().type) {
      case Token.DOT_DOT: // `a..` and `..`
        startBound = start === null ? null : 'closed';
        endBound = null;
        break;
      case Token.DOT_DOT_LT: // `a..<b` and `..<b`
        startBound = start === null ? null : 'closed';
        endBound = 'open';
        break;
      case Token.DOT_DOT_EQ: // `a..=b` and `..=b`
        startBound = start === null ? null : 'closed';
        endBound = 'closed';
        break;
      case Token.LT_DOT_DOT: // `a<..`
        startBound = 'open';
        endBound = null;
        break;
      case Token.LT_DOT_DOT_LT: // `a<..<b`
        startBound = 'open';
        endBound = 'open';
        break;
      default: // Token.LT_DOT_DOT_EQ, `a<..=b`
        startBound = 'open';
        endBound = 'closed';
        break;
    }
    this.next(); // consume the range operator
    node.RangeStart = start;
    node.RangeStartBound = startBound;
    node.RangeEndBound = endBound;
    // An end is present exactly where the token marked one.
    node.RangeEnd = endBound === null ? null : this.parseShortCircuitExpression();
    // Non-associative: a second range operator is a Syntax Error.
    if (this.testRangeOperator()) {
      this.unexpected();
    }
    return this.finishNode(node, 'RangeExpression');
  }

  // ShortCircuitExpression :
  //   LogicalORExpression
  //   CoalesceExpression
  //
  // CoalesceExpression :
  //   CoalesceExpressionHead `??` BitwiseORExpression
  //
  // CoalesceExpressionHead :
  //   CoalesceExpression
  //   BitwiseORExpression
  parseShortCircuitExpression(): ParseNode.ShortCircuitExpressionOrHigher {
    if (this.state.json) {
      return this.parseUnaryExpression();
    }
    const expression = this.parseLogicalORExpression();
    if (!this.test(Token.NULLISH)) return expression;
    if (expression.type === 'LogicalANDExpression' || expression.type === 'LogicalORExpression') {
      this.raise(Throw.SyntaxError('Cannot mix logical operator with ?? operator. Add parentheses to determine precedence.'));
    }
    let result: ParseNode.CoalesceExpressionHead = expression;
    while (this.eat(Token.NULLISH)) {
      const node: ParseNode.Unfinished<ParseNode.CoalesceExpression> = this.startNode(result);
      node.CoalesceExpressionHead = result;
      node.BitwiseORExpression = this.parseBitwiseORExpression();
      result = this.finishNode(node, 'CoalesceExpression');
    }
    return result;
  }

  parseLogicalORExpression(): ParseNode.LogicalORExpressionOrHigher {
    let result: ParseNode.LogicalORExpressionOrHigher = this.parseLogicalANDExpression();
    while (this.eat(Token.OR)) {
      const node: ParseNode.Unfinished<ParseNode.LogicalORExpression> = this.startNode(result);
      node.LogicalORExpression = result;
      node.LogicalANDExpression = this.parseLogicalANDExpression();
      result = this.finishNode(node, 'LogicalORExpression');
    }
    return result;
  }

  parseLogicalANDExpression(): ParseNode.LogicalANDExpressionOrHigher {
    let result: ParseNode.LogicalANDExpressionOrHigher = this.parseBitwiseORExpression();
    while (this.eat(Token.AND)) {
      const node: ParseNode.Unfinished<ParseNode.LogicalANDExpression> = this.startNode(result);
      node.LogicalANDExpression = result;
      node.BitwiseORExpression = this.parseBitwiseORExpression();
      result = this.finishNode(node, 'LogicalANDExpression');
    }
    return result;
  }

  parseBitwiseORExpression(): ParseNode.BitwiseORExpressionOrHigher {
    let result: ParseNode.BitwiseORExpressionOrHigher = this.parseBitwiseXORExpression();
    while (this.eat(Token.BIT_OR)) {
      const node: ParseNode.Unfinished<ParseNode.BitwiseORExpression> = this.startNode(result);
      node.A = result;
      node.operator = '|';
      node.B = this.parseBitwiseXORExpression();
      result = this.finishNode(node, 'BitwiseORExpression');
    }
    return result;
  }

  parseBitwiseXORExpression(): ParseNode.BitwiseXORExpressionOrHigher {
    let result: ParseNode.BitwiseXORExpressionOrHigher = this.parseBitwiseANDExpression();
    while (this.eat(Token.BIT_XOR)) {
      const node: ParseNode.Unfinished<ParseNode.BitwiseXORExpression> = this.startNode(result);
      node.A = result;
      node.operator = '^';
      node.B = this.parseBitwiseANDExpression();
      result = this.finishNode(node, 'BitwiseXORExpression');
    }
    return result;
  }

  parseBitwiseANDExpression(): ParseNode.BitwiseANDExpressionOrHigher {
    let result: ParseNode.BitwiseANDExpressionOrHigher = this.parseEqualityExpression();
    while (this.eat(Token.BIT_AND)) {
      const node: ParseNode.Unfinished<ParseNode.BitwiseANDExpression> = this.startNode(result);
      node.A = result;
      node.operator = '&';
      node.B = this.parseEqualityExpression();
      result = this.finishNode(node, 'BitwiseANDExpression');
    }
    return result;
  }

  parseEqualityExpression(): ParseNode.EqualityExpressionOrHigher {
    let result: ParseNode.EqualityExpressionOrHigher = this.parseRelationalExpression();
    const operators: readonly Token[] = [Token.EQ, Token.NE, Token.EQ_STRICT, Token.NE_STRICT];
    while (operators.includes(this.peek().type)) {
      const node: ParseNode.Unfinished<ParseNode.EqualityExpression> = this.startNode(result);
      node.EqualityExpression = result;
      node.operator = this.next().value as ParseNode.EqualityExpression['operator'];
      node.RelationalExpression = this.parseRelationalExpression();
      result = this.finishNode(node, 'EqualityExpression');
    }
    return result;
  }

  parseRelationalExpression(): ParseNode.RelationalExpressionOrHigher {
    if (this.scope.hasIn() && this.test(Token.PRIVATE_IDENTIFIER)) {
      const PrivateIdentifier = this.parsePrivateIdentifier();
      this.scope.checkUndefinedPrivate(PrivateIdentifier);
      const node = this.startNode<ParseNode.RelationalExpression>(PrivateIdentifier);
      node.PrivateIdentifier = PrivateIdentifier;
      this.expect(Token.IN);
      node.operator = 'in';
      node.ShiftExpression = this.parseShiftExpression();
      return this.finishNode(node, 'RelationalExpression');
    }
    let result: ParseNode.RelationalExpressionOrHigher = this.parseShiftExpression();
    const operators: Token[] = [Token.LT, Token.GT, Token.LTE, Token.GTE, Token.INSTANCEOF];
    if (this.scope.hasIn()) operators.push(Token.IN);
    while (true) {
      if (operators.includes(this.peek().type)) {
        const node: ParseNode.Unfinished<ParseNode.RelationalExpression> = this.startNode(result);
        node.RelationalExpression = result;
        node.operator = this.next().value as ParseNode.RelationalExpression['operator'];
        node.ShiftExpression = this.parseShiftExpression();
        result = this.finishNode(node, 'RelationalExpression');
        continue;
      }
      if (surroundingAgent.feature('runtime-types')) {
        // RelationalExpression : RelationalExpression `:=` Type
        if (this.test(Token.COLON_EQ)) {
          const node: ParseNode.Unfinished<ParseNode.TypedConversionExpression> = this.startNode(result);
          node.Expression = result;
          this.next();
          node.Type = this.parseType();
          result = this.finishNode(node, 'TypedConversionExpression');
          continue;
        }
        // RelationalExpression : RelationalExpression [no LineTerminator here] `is` Type
        // The restriction keeps `x` and `is` on separate lines two statements.
        if (this.test('is') && !this.peek().hadLineTerminatorBefore) {
          const node: ParseNode.Unfinished<ParseNode.IsExpression> = this.startNode(result);
          node.Expression = result;
          this.next();
          // proposal-runtime-types `sec-is-pattern`: the right operand is
          // "widened from |Type| to |MatchPattern|, OF WHICH A |Type| IS ONE
          // FORM, so every existing `is` keeps its parse and its meaning". The
          // pattern forms that a |Type| cannot be are tried first; anything else
          // falls through to `parseType` UNCHANGED, which is what keeps that
          // promise literal rather than approximate.
          // "Every existing `is` keeps its PARSE and its meaning" - and a
          // parse-shape test reads `Type` off this node, which IS the parse. So
          // a BARE type pattern is unwrapped back onto `Type` and only a
          // genuinely non-type pattern populates `Pattern`. Wrapping every type
          // in a `MatchTypePattern` preserved the meaning and changed the shape,
          // which is half the promise.
          const parsed = this.parseMatchPattern();
          if (parsed.type === 'MatchTypePattern') {
            node.Type = parsed.Type;
            node.Pattern = null;
          } else {
            node.Pattern = parsed;
            node.Type = null;
          }
          result = this.finishNode(node, 'IsExpression');
          continue;
        }
      }
      break;
    }
    return result;
  }

  parseShiftExpression(): ParseNode.ShiftExpressionOrHigher {
    let result: ParseNode.ShiftExpressionOrHigher = this.parseAdditiveExpression();
    const operators: readonly Token[] = [Token.SHL, Token.SAR, Token.SHR];
    while (operators.includes(this.peek().type)) {
      const node: ParseNode.Unfinished<ParseNode.ShiftExpression> = this.startNode(result);
      node.ShiftExpression = result;
      node.operator = this.next().value as ParseNode.ShiftExpression['operator'];
      node.AdditiveExpression = this.parseAdditiveExpression();
      result = this.finishNode(node, 'ShiftExpression');
    }
    return result;
  }

  parseAdditiveExpression(): ParseNode.AdditiveExpressionOrHigher {
    let result: ParseNode.AdditiveExpressionOrHigher = this.parseMultiplicativeExpression();
    const operators: readonly Token[] = [Token.ADD, Token.SUB];
    while (operators.includes(this.peek().type)) {
      const node: ParseNode.Unfinished<ParseNode.AdditiveExpression> = this.startNode(result);
      node.AdditiveExpression = result;
      node.operator = this.next().value as ParseNode.AdditiveExpression['operator'];
      node.MultiplicativeExpression = this.parseMultiplicativeExpression();
      result = this.finishNode(node, 'AdditiveExpression');
    }
    return result;
  }

  parseMultiplicativeExpression(): ParseNode.MultiplicativeExpressionOrHigher {
    let result: ParseNode.MultiplicativeExpressionOrHigher = this.parseExponentiationExpression();
    const operators: readonly Token[] = [Token.MUL, Token.DIV, Token.MOD];
    while (operators.includes(this.peek().type)) {
      const node: ParseNode.Unfinished<ParseNode.MultiplicativeExpression> = this.startNode(result);
      node.MultiplicativeExpression = result;
      node.MultiplicativeOperator = this.next().value as ParseNode.MultiplicativeOperator;
      node.ExponentiationExpression = this.parseExponentiationExpression();
      result = this.finishNode(node, 'MultiplicativeExpression');
    }
    return result;
  }

  parseExponentiationExpression(): ParseNode.ExponentiationExpressionOrHigher {
    const left = this.parseUnaryExpression();
    if (!this.test(Token.EXP) || left.type === 'UnaryExpression' || left.type === 'AwaitExpression' || left.type === 'TypeOperatorExpression') return left;
    this.next();
    const node = this.startNode<ParseNode.ExponentiationExpression>(left);
    node.UpdateExpression = left;
    node.ExponentiationExpression = this.parseExponentiationExpression();
    return this.finishNode(node, 'ExponentiationExpression');
  }

  // UnaryExpression :
  //   UpdateExpression
  //   `delete` UnaryExpression
  //   `void` UnaryExpression
  //   `typeof` UnaryExpression
  //   `+` UnaryExpression
  //   `-` UnaryExpression
  //   `~` UnaryExpression
  //   `!` UnaryExpression
  //   [+Await] AwaitExpression
  parseUnaryExpression(): ParseNode.UnaryExpressionOrHigher {
    return this.scope.with({ in: true }, () => {
      if (this.test(Token.AWAIT) && this.scope.hasAwait()) {
        return this.parseAwaitExpression();
      }
      // proposal-runtime-types TypeOperatorExpression : `type` [no LT] Type
      //
      // `type` is a contextual keyword AND a live binding (the type type), so
      // every operand-start token has two readings. They fall in three classes.
      //
      // 1. Unambiguous: an identifier, `{`, a literal, `void`, `keyof`, `ref`.
      //    Each is a SyntaxError today (`type foo` is two identifiers, `type {`
      //    fails ASI), so the operator takes them without changing the meaning
      //    of any existing program.
      // 2. Ambiguous, resolvable by lookahead: `(`. `type (uint8) => uint8` is
      //    a function-type operand and `type (x)` is a call, and they diverge
      //    at the token after `)`. #sec-types-in-expression-position resolves
      //    that with a cover grammar. Until it is built, `(` is left to the
      //    call form, so function-type operands are not yet writable.
      // 3. Ambiguous with NO possible lookahead: `[` and `-`. `type [0]` is the
      //    tuple type of literal 0 or member access; `type -1` is the literal
      //    type -1 or subtraction. Both readings are complete and end at the
      //    same token, which is why the clause says "the only covered case is
      //    an operand that begins with `(`" - a cover grammar does not apply,
      //    so class 3 is decided by fiat. It is decided HERE in the operator's
      //    favour, as `LiteralType : `-` NumericLiteral` already required for
      //    `-`, and as ECMAScript itself decided for `let [` at statement
      //    start. A program that means the value writes `(type)[0]` or
      //    `(type) - 1`; a property access like `o.type[0]` never reaches here.
      if (surroundingAgent.feature('runtime-types') && this.test('type') && !this.peekAhead().hadLineTerminatorBefore) {
        switch (this.peekAhead().type) {
          case Token.IDENTIFIER:
          case Token.YIELD:
          case Token.AWAIT:
          case Token.LBRACE:
          case Token.LBRACK:
          case Token.STRING:
          case Token.NUMBER:
          case Token.BIGINT:
          case Token.TRUE:
          case Token.FALSE:
          case Token.NULL:
          case Token.VOID:
          case Token.SUB: {
            const node = this.startNode<ParseNode.TypeOperatorExpression>();
            this.next();
            node.Type = this.parseType();
            return this.finishNode(node, 'TypeOperatorExpression');
          }
          case Token.LPAREN: {
            // Class 2: ambiguous, but the readings diverge at the token after
            // the closing parenthesis, which is what the cover grammar of
            // #sec-types-in-expression-position refines on. Taking `(` outright
            // would break every call of a function named `type`, so the operand
            // is parsed speculatively and kept only where it turned out to be a
            // function type - i.e. where a `=>` followed the `)`.
            const covered = this.tryParseTypeOperatorFunctionType();
            if (covered) {
              return covered;
            }
            break;
          }
          default:
            break;
        }
      }
      switch (this.peek().type) {
        case Token.DELETE:
        case Token.VOID:
        case Token.TYPEOF:
        case Token.ADD:
        case Token.SUB:
        case Token.BIT_NOT:
        case Token.NOT: {
          const node = this.startNode<ParseNode.UnaryExpression>();
          node.operator = this.next().value as ParseNode.UnaryExpression['operator']; // NOTE: unsound cast
          node.UnaryExpression = this.parseUnaryExpression();
          // proposal-runtime-types #sec-type-names: `typeof` is one of the two
          // positions the clause excepts. It is excepted because it is the only
          // position in which a reference to an UNDECLARED name does not throw,
          // which makes it the idiom existing feature detection is written with -
          // `typeof string === "undefined"` must keep answering as it does today.
          if (node.operator === 'typeof') {
            exceptFromAdmitting(node.UnaryExpression);
          }
          if (node.operator === 'delete') {
            let target: ParseNode.Expression = node.UnaryExpression;
            while (target.type === 'ParenthesizedExpression') {
              target = target.Expression;
            }
            if (this.isStrictMode() && target.type === 'IdentifierReference') {
              this.addEarlyError(Throw.SyntaxError('Cannot delete an identifier in strict mode'), target);
            }
            if (target.type === 'MemberExpression' && target.PrivateIdentifier) {
              this.addEarlyError(Throw.SyntaxError('Cannot delete private names'), target);
            }
          }
          return this.finishNode(node, 'UnaryExpression');
        }
        default:
          return this.parseUpdateExpression();
      }
    });
  }

  // AwaitExpression : `await` UnaryExpression
  parseAwaitExpression(): ParseNode.AwaitExpression {
    if (this.scope.inParameters()) {
      this.addEarlyError(Throw.SyntaxError('await cannot be used in formal parameters'));
    } else if (this.scope.inClassStaticBlock()) {
      this.addEarlyError(Throw.SyntaxError('await cannot be used in class static block'));
    }
    const node = this.startNode<ParseNode.AwaitExpression>();
    this.expect(Token.AWAIT);
    node.UnaryExpression = this.parseUnaryExpression();
    if (this.isParsingArrowParameterCandidate()) {
      this.scope.arrowInfo?.awaitExpressions.push(node as ParseNode.AwaitExpression);
    }
    if (!this.scope.hasReturn()) {
      this.state.hasTopLevelAwait = true;
    }
    return this.finishNode(node, 'AwaitExpression');
  }

  // UpdateExpression :
  //   LeftHandSideExpression
  //   LeftHandSideExpression [no LineTerminator here] `++`
  //   LeftHandSideExpression [no LineTerminator here] `--`
  //   `++` UnaryExpression
  //   `--` UnaryExpression
  parseUpdateExpression(): ParseNode.UpdateExpressionOrHigher {
    if (this.test(Token.INC) || this.test(Token.DEC)) {
      const node = this.startNode<ParseNode.UpdateExpression>();
      node.operator = this.next().value as ParseNode.UpdateExpression['operator']; // NOTE: unsound cast
      node.LeftHandSideExpression = null;
      node.UnaryExpression = this.parseUnaryExpression();
      if (!this.markLocationConsuming(node.UnaryExpression)) {
        this.validateAssignmentTarget(node.UnaryExpression);
      }
      return this.finishNode(node, 'UpdateExpression');
    }
    const argument = this.parseLeftHandSideExpression();
    if (!this.peek().hadLineTerminatorBefore) {
      if (this.test(Token.INC) || this.test(Token.DEC)) {
        if (!this.markLocationConsuming(argument)) {
          this.validateAssignmentTarget(argument);
        }
        const node = this.startNode<ParseNode.UpdateExpression>(argument);
        node.operator = this.next().value as ParseNode.UpdateExpression['operator']; // NOTE: unsound cast
        node.LeftHandSideExpression = argument;
        node.UnaryExpression = null;
        return this.finishNode(node, 'UpdateExpression');
      }
    }
    return argument;
  }

  /**
   * proposal-runtime-types #sec-location-consuming-contexts: a call that
   * returns a borrow may occupy a position that consumes a location, where the
   * design's `first(a)++` writes through to the element. The base language
   * refuses a call as an assignment target outright; this admits one in those
   * positions and marks it, so the call boundary keeps the reference instead of
   * decaying it.
   *
   * Whether the call actually returns a reference is a matter of its type. A
   * checker that knows the callee's return type refuses one that is not a `ref`
   * type before the source runs; where the type is not known statically the
   * check is the runtime one, a TypeError at the operation, per the deferral
   * rule of the type errors clause.
   */
  markLocationConsuming(node: ParseNode): boolean {
    if (!surroundingAgent.feature('runtime-types') || node.type !== 'CallExpression') {
      return false;
    }
    (node as Mutable<ParseNode.CallExpression>).LocationConsuming = true;
    return true;
  }

  // LeftHandSideExpression
  parseLeftHandSideExpression(allowCalls = true): ParseNode.LeftHandSideExpression {
    let result: ParseNode.LeftHandSideExpression;
    switch (this.peek().type) {
      case Token.NEW:
        result = this.parseNewExpression();
        break;
      case Token.SUPER: {
        const node = this.startNode<ParseNode.SuperCall | ParseNode.SuperProperty>();
        this.next();
        if (this.test(Token.LPAREN)) {
          if (!this.scope.hasSuperCall()) {
            this.addEarlyError(Throw.SyntaxError('Invalid use of super'), node);
          }
          node.Arguments = this.parseArguments().Arguments;
          result = this.finishNode(node, 'SuperCall');
        } else {
          if (!this.scope.hasSuperProperty()) {
            this.addEarlyError(Throw.SyntaxError('Invalid use of super'), node);
          }
          if (this.eat(Token.LBRACK)) {
            node.Expression = this.parseExpression();
            this.expect(Token.RBRACK);
            node.IdentifierName = null;
          } else {
            this.expect(Token.PERIOD);
            node.Expression = null;
            node.IdentifierName = this.parseIdentifierName();
          }
          result = this.finishNode(node, 'SuperProperty');
        }
        break;
      }
      case Token.IMPORT: {
        const node = this.startNode<ParseNode.ImportMeta | ParseNode.ImportCall>();
        this.next();
        if (this.eat(Token.PERIOD)) {
          if (this.scope.hasImportMeta() && this.eat('meta')) {
            result = this.finishNode(node, 'ImportMeta');
            break;
          }
          if (this.eat('source')) {
            node.Phase = 'source';
          } else if (this.eat('defer')) {
            node.Phase = 'defer';
          } else {
            this.unexpected();
          }
        } else {
          node.Phase = 'evaluation';
        }
        if (!allowCalls) {
          this.unexpected();
        }
        this.expect(Token.LPAREN);
        node.AssignmentExpression = this.parseAssignmentExpression();
        if (this.eat(Token.COMMA) && !this.test(Token.RPAREN)) {
          node.OptionsExpression = this.parseAssignmentExpression();
          this.eat(Token.COMMA);
        }
        this.expect(Token.RPAREN);
        result = this.finishNode(node, 'ImportCall');
        break;
      }
      default:
        result = this.parsePrimaryExpression();
        break;
    }

    const check = allowCalls ? isPropertyOrCall : isMember;
    while (check(this.peek().type)
        || (surroundingAgent.feature('runtime-types') && this.test(Token.PERIOD_LT))) {
      let finished: ParseNode.LeftHandSideExpression;
      switch (this.peek().type) {
        case Token.LBRACK: {
          const node = this.startNode<ParseNode.MemberExpression>(result);
          this.next();
          node.MemberExpression = result;
          node.IdentifierName = null;
          node.Expression = this.parseExpression();
          this.expect(Token.RBRACK);
          finished = this.finishNode(node, 'MemberExpression');
          break;
        }
        case Token.PERIOD: {
          const node = this.startNode<ParseNode.MemberExpression>(result);
          this.next();
          node.MemberExpression = result;
          if (this.test(Token.PRIVATE_IDENTIFIER)) {
            node.PrivateIdentifier = this.parsePrivateIdentifier();
            this.scope.checkUndefinedPrivate(node.PrivateIdentifier);
            node.IdentifierName = null;
          } else {
            node.IdentifierName = this.parseIdentifierName();
            node.PrivateIdentifier = null;
          }
          node.Expression = null;
          finished = this.finishNode(node, 'MemberExpression');
          break;
        }
        case Token.LPAREN: {
          const node = this.startNode<ParseNode.CallExpression>(result);
          // `async` [no LineTerminator here] `(`
          const couldBeArrow = this.matches('async', this.currentToken)
            && result.type === 'IdentifierReference'
            && !this.peek().hadLineTerminatorBefore;
          if (couldBeArrow) {
            this.scope.pushArrowInfo(true);
            this.scope.enterArrowParameterCandidate();
          }
          const { Arguments, trailingComma } = this.parseArguments();
          node.CallExpression = result;
          node.Arguments = Arguments;
          if (couldBeArrow) {
            this.scope.exitArrowParameterCandidate();
            node.arrowInfo = this.scope.popArrowInfo();
            node.arrowInfo.hasTrailingComma = trailingComma;
          }
          finished = this.finishNode(node, 'CallExpression');
          break;
        }
        case Token.OPTIONAL: {
          if (result.type === 'NewExpression' && result.Arguments === null) {
            this.raise(Throw.SyntaxError('Unexpected token'));
          }
          const node = this.startNode<ParseNode.OptionalExpression>(result);
          node.MemberExpression = result;
          node.OptionalChain = this.parseOptionalChain();
          finished = this.finishNode(node, 'OptionalExpression');
          break;
        }
        case Token.TEMPLATE: {
          const node = this.startNode<ParseNode.TaggedTemplateExpression>(result);
          node.MemberExpression = result;
          node.TemplateLiteral = this.parseTemplateLiteral(true);
          finished = this.finishNode(node, 'TaggedTemplateExpression');
          break;
        }
        case Token.PERIOD_LT: {
          // proposal-runtime-types
          // MemberExpression : MemberExpression TypeArguments
          // CallExpression : CallExpression TypeArguments
          const node = this.startNode<ParseNode.TypeArgumentsExpression>(result);
          node.Expression = result;
          node.TypeArguments = this.parseTypeArguments();
          finished = this.finishNode(node, 'TypeArgumentsExpression');
          break;
        }
        default:
          this.unexpected();
      }
      // NOTE: unwinds ParseNode.Finish type alias to avoid circularity issues in type checker
      result = finished as ParseNode.CallExpressionOrHigher | ParseNode.MemberExpressionOrHigher;
    }
    return result;
  }

  // OptionalChain
  parseOptionalChain(): ParseNode.OptionalChain {
    this.expect(Token.OPTIONAL);
    const base = this.startNode<ParseNode.OptionalChain>();
    base.OptionalChain = null;
    if (this.test(Token.LPAREN)) {
      base.Arguments = this.parseArguments().Arguments;
    } else if (this.eat(Token.LBRACK)) {
      base.Expression = this.parseExpression();
      this.expect(Token.RBRACK);
    } else if (this.test(Token.TEMPLATE)) {
      this.raise(Throw.SyntaxError('Template in optional chain'));
    } else if (this.test(Token.PRIVATE_IDENTIFIER)) {
      base.PrivateIdentifier = this.parsePrivateIdentifier();
      this.scope.checkUndefinedPrivate(base.PrivateIdentifier);
    } else {
      base.IdentifierName = this.parseIdentifierName();
    }

    let chain = this.finishNode(base, 'OptionalChain');
    while (true) {
      const node = this.startNode<ParseNode.OptionalChain>();
      if (this.test(Token.LPAREN)) {
        node.OptionalChain = chain;
        node.Arguments = this.parseArguments().Arguments;
        chain = this.finishNode(node, 'OptionalChain');
      } else if (this.eat(Token.LBRACK)) {
        node.OptionalChain = chain;
        node.Expression = this.parseExpression();
        this.expect(Token.RBRACK);
        chain = this.finishNode(node, 'OptionalChain');
      } else if (this.test(Token.TEMPLATE)) {
        this.raise(Throw.SyntaxError('Template in optional chain'));
      } else if (this.eat(Token.PERIOD)) {
        node.OptionalChain = chain;
        if (this.test(Token.PRIVATE_IDENTIFIER)) {
          node.PrivateIdentifier = this.parsePrivateIdentifier();
          this.scope.checkUndefinedPrivate(node.PrivateIdentifier);
        } else {
          node.IdentifierName = this.parseIdentifierName();
        }
        chain = this.finishNode(node, 'OptionalChain');
      } else {
        return chain;
      }
    }
  }

  // NewExpression
  parseNewExpression(): ParseNode.NewExpressionOrHigher {
    const node = this.startNode<ParseNode.NewTarget | ParseNode.NewExpression>();
    this.expect(Token.NEW);
    // sec-new-expressions: `new` `.` Arguments constructs the type its POSITION
    // requires. Checked before `new.target`, whose branch is gated on being
    // inside a function while this form is legal anywhere; the token after the
    // dot tells them apart.
    if (surroundingAgent.feature('runtime-types')
        && this.test(Token.PERIOD) && this.testAhead(Token.LPAREN)) {
      this.next();
      (node as unknown as { Arguments?: ParseNode.Arguments }).Arguments = this.parseArguments().Arguments;
      return this.finishNode(node as unknown as ParseNode.TargetTypedNew, 'TargetTypedNew') as unknown as ParseNode.NewExpressionOrHigher;
    }
    if (this.scope.hasNewTarget() && this.eat(Token.PERIOD)) {
      this.expect('target');
      return this.finishNode(node as ParseNode.NewTarget, 'NewTarget');
    }
    // proposal-runtime-types placement form:
    //   `new` `(` AssignmentExpression (`,` AssignmentExpression){0,2} `)` MemberExpression Arguments
    // `new (expr)` where what follows the `)` cannot begin a MemberExpression
    // keeps its meaning of a parenthesized constructor, so the reading is
    // decided by a checkpointed look past the closing paren.
    let PlacementArguments: ParseNode.AssignmentExpressionOrHigher[] | null = null;
    if (surroundingAgent.feature('runtime-types') && this.test(Token.LPAREN)) {
      const checkpoint = this.getLexerCheckpoint();
      const savedEarlyErrors = new Set(this.earlyErrors);
      let speculative: ParseNode.AssignmentExpressionOrHigher[] | null = [];
      try {
        this.next();
        do {
          if (speculative.length === 3) {
            speculative = null;
            break;
          }
          speculative.push(this.parseAssignmentExpression());
        } while (this.eat(Token.COMMA));
        if (speculative && !this.eat(Token.RPAREN)) {
          speculative = null;
        }
        if (speculative) {
          switch (this.peek().type) {
            case Token.IDENTIFIER:
            case Token.YIELD:
            case Token.AWAIT:
            case Token.THIS:
            case Token.NEW:
            case Token.SUPER:
              break;
            default:
              speculative = null;
              break;
          }
        }
      } catch {
        speculative = null;
      }
      if (speculative) {
        PlacementArguments = speculative;
      } else {
        this.restoreLexerCheckpoint(checkpoint);
        this.earlyErrors = savedEarlyErrors;
      }
    }
    (node as ParseNode.Unfinished<ParseNode.NewExpression>).PlacementArguments = PlacementArguments;
    node.MemberExpression = this.parseLeftHandSideExpression(false);
    if (node.MemberExpression.type === 'OptionalExpression') {
      this.raise(Throw.SyntaxError('Unexpected token'));
    }
    if (this.test(Token.LPAREN)) {
      node.Arguments = this.parseArguments().Arguments;
    } else {
      node.Arguments = null;
      if (PlacementArguments) {
        this.raise(Throw.SyntaxError('Unexpected token'));
      }
    }
    return this.finishNode(node as ParseNode.NewExpression, 'NewExpression');
  }

  // PrimaryExpression :
  //   ...
  /**
   * proposal-runtime-types #sec-do-expressions.
   *
   *   DoExpression :
   *     `do` Block
   *     `do` `*` `{` GeneratorBody `}`
   *     `async` [no LineTerminator here] `do` `*` `{` AsyncGeneratorBody `}`
   *
   * The parameterization carries the whole distinction between the forms. The
   * plain one parses a Block with the enclosing permissions, so `return`,
   * `break`, `continue`, `await`, and `yield` inside it mean what they mean in
   * the surrounding code. The starred one opens a generator body, which is a
   * FUNCTION BOUNDARY: `yield` becomes the do-generator's own and `return` sets
   * its return value.
   */
  /**
   * ConstantExpression : `constant` [no LineTerminator here] Block
   *
   * The Block carries the enclosing permissions and reports its completion value
   * the way a `do` Block does, so the two share their body semantics. What
   * differs is when it runs: at most once per site per realm.
   */
  parseConstantExpression(): ParseNode.ConstantExpression {
    const node = this.startNode<ParseNode.ConstantExpression>();
    this.next();
    node.Block = this.parseBlock();
    // Reported as a DoBlock so the completion-value semantics and the decorator
    // context are the ones `do` already defines, rather than a second set that
    // could drift from them.
    (node.Block as { BlockKind?: string }).BlockKind = 'DoBlock';
    // The Block must be COMPILE-TIME EVALUABLE, and this is not decoration.
    // Without it,
    //
    //     function f(x) { return constant { x + 1 }; }
    //
    // caches the first call's value and answers with it for every later `x` -
    // a surprise with no defence. A Block that cannot read anything that varies
    // cannot tell how many times it ran, except through the identity of what it
    // returns, which is the point of the form.
    //
    // The same analysis a replacement decorator's body is held to, reused rather
    // than restated, so the two cannot drift into disagreeing about what
    // "evaluable" means.
    const violation = FirstFreeReference(node.Block);
    if (violation !== undefined) {
      this.addEarlyError(
        Throw.SyntaxError('a constant expression may not read $1 from outside itself', Value(violation.name)),
        violation.node,
      );
    }
    return this.finishNode(node, 'ConstantExpression');
  }

  parseDoExpression(isAsync: boolean): ParseNode.DoExpression {
    const node = this.startNode<ParseNode.DoExpression>();
    if (isAsync) {
      this.expect('async');
    }
    this.expect(Token.DO);
    node.async = isAsync;
    node.star = this.eat(Token.MUL);
    if (!node.star) {
      if (isAsync) {
        // `async do` without a star is not a form: an async block whose value
        // is a promise of its completion value is a different feature.
        this.unexpected();
      }
      node.Block = this.parseBlock();
      // The block reports `DoBlock` rather than the bare `Block` a decorator
      // would otherwise see, which is what gives a `do`'s decorator its own
      // context (#sec-do-expression-modifications).
      (node.Block as { BlockKind?: string }).BlockKind = 'DoBlock';
      // proposal-runtime-types #sec-do-expression-early-errors. Each is about a
      // completion value a reader would not predict, and each applies to the
      // PLAIN form only: a `do *` has no completion value, its body being a
      // generator body whose completion is discarded, so it may end in a loop
      // or a declaration and the design's motivating example does.
      const tail = endsInIterationOrDeclaration(node.Block.StatementList);
      if (tail) {
        this.addEarlyError(Throw.SyntaxError('a do expression may not end in $1', Value(tail)), node.Block);
      }
      // The two context-sensitive errors, which need to know WHERE the `do`
      // sits rather than what it ends with.
      //
      // A `var` inside a `do` in a parameter expression has no function body to
      // hoist into yet - the one it would reach is the one being declared.
      if (this.scope.inParameters() && containsVarStatement(node.Block)) {
        this.addEarlyError(Throw.SyntaxError('a var declaration may not appear in a do expression in a parameter'), node.Block);
      }
      // An unlabelled `break` or `continue` in a loop head targets a loop that
      // is not yet entered, so which one it means is a puzzle rather than a
      // rule.
      if (this.inIterationHead && containsUnlabelledBreakOrContinue(node.Block)) {
        this.addEarlyError(Throw.SyntaxError('an unlabelled break or continue may not appear in a do expression in a loop head'), node.Block);
      }
    } else {
      node.GeneratorBody = this.parseFunctionBody(isAsync, true, false) as ParseNode.FunctionBodyLike;
      (node.GeneratorBody as { BlockKind?: string }).BlockKind = 'DoGeneratorBlock';
    }
    return this.finishNode(node, 'DoExpression');
  }

  parsePrimaryExpression(): ParseNode.PrimaryExpression {
    // PLAN-where-on-methods.md D1. #sec-checked-contracts: "Within a
    // |WhereClause| of a function declaration, `return` is a |PrimaryExpression|
    // denoting the value the function returns. It is a Syntax Error for `return`
    // to occur as an expression anywhere else, which costs nothing, since the
    // token is ungrammatical in expression position today and no program can be
    // using it."
    //
    // The second sentence is why this needs no guard against ambiguity: outside
    // a predicate the token still falls through to the ordinary error.
    if (this.test(Token.RETURN) && (this as { inRefinementPredicate?: boolean }).inRefinementPredicate) {
      const node = this.startNode<ParseNode.ContractReturn>();
      this.next();
      return this.finishNode(node, 'ContractReturn') as unknown as ParseNode.PrimaryExpression;
    }
    // proposal-runtime-types: ClassExpression : ClassModifiers? `class` ...
    if (this.testClassModifierRun()) {
      return this.parseClassExpression();
    }
    // proposal-runtime-types `sec-match-expression`. `match` is a CONTEXTUAL
    // keyword and in EXPRESSION position "there is no overlap at all, since a
    // call followed by `{` is already a Syntax Error there" - so a speculative
    // parse suffices to keep `match(x)` a call: it declines unless a `{`
    // follows the parenthesized subject.
    // The grammar's restriction is `match [no LineTerminator here] (` - between
    // `match` AND ITS PARENTHESIS. Reading it as "no line terminator before
    // `match`" rejected every `match` that began a line, which is every one
    // inside a block, and the statement was then parsed as something else and
    // failed. The restriction belongs to the token AFTER `match`, and
    // `tryParseMatchExpression` already declines anything that is not
    // `match (`…`) {`, so the guard here need only avoid speculating on every
    // identifier named `match`.
    if (surroundingAgent.feature('runtime-types') && this.test('match')) {
      const matchExpression = this.tryParseMatchExpression();
      if (matchExpression) {
        return matchExpression as unknown as ParseNode.PrimaryExpression;
      }
    }
    // proposal-runtime-types #sec-pipeline-operator: the topic. `%` is the
    // remainder punctuator and the two are told apart by POSITION - a topic
    // stands where an operand is expected, which is here, and the remainder
    // operator between two operands, which is the binary parser. Outside a
    // pipeline body a `%` here stays the Syntax Error it is today.
    if (surroundingAgent.feature('runtime-types') && this.test(Token.MOD)
        && this.pipelineBodyDepth > 0) {
      const node = this.startNode<ParseNode.TopicReference>();
      this.next();
      return this.finishNode(node, 'TopicReference') as unknown as ParseNode.PrimaryExpression;
    }
    // proposal-runtime-types #sec-do-expressions. `do` is a RESERVED word, so
    // this form costs the grammar less than `match` did: there is no cover
    // grammar and no program whose meaning changes, only a position where the
    // word was previously a Syntax Error. A `do` in STATEMENT position begins a
    // `do`-`while` and is parsed there; this is only reached from expression
    // position.
    if (surroundingAgent.feature('runtime-types') && this.test(Token.DO)) {
      return this.parseDoExpression(false) as unknown as ParseNode.PrimaryExpression;
    }
    // proposal-runtime-types: `constant` Block.
    //
    // Unlike `do`, `constant` is NOT a reserved word - `const constant = 5`,
    // `{ constant: 7 }` and `function constant() {}` are all legal today - so it
    // is contextual and must not be recognised where an ordinary identifier was
    // meant. Two things keep that safe: it is only the keyword when a `{`
    // follows, since an identifier followed by a block continues as nothing
    // valid; and a LineTerminator between them forbids the form, because
    // `constant` alone on a line followed by a block is an ExpressionStatement
    // and a Block under ASI.
    if (surroundingAgent.feature('runtime-types')
        && this.test(Token.IDENTIFIER) && this.peek().value === 'constant'
        && this.testAhead(Token.LBRACE) && !this.peekAhead().hadLineTerminatorBefore) {
      return this.parseConstantExpression() as unknown as ParseNode.PrimaryExpression;
    }
    // `async do *`. The lookahead restriction is what keeps `async` contextual:
    // `async` on one line and `do *` on the next must remain an identifier
    // reference followed by something else.
    if (surroundingAgent.feature('runtime-types') && this.test('async')
        && !this.peek().hadLineTerminatorBefore && this.testAhead(Token.DO)) {
      return this.parseDoExpression(true) as unknown as ParseNode.PrimaryExpression;
    }
    switch (this.peek().type) {
      case Token.IDENTIFIER:
      case Token.ESCAPED_KEYWORD:
      case Token.YIELD:
      case Token.AWAIT:
        // `async` [no LineTerminator here] `function`
        if (this.test('async') && this.testAhead(Token.FUNCTION)
            && !this.peekAhead().hadLineTerminatorBefore) {
          return this.parseFunctionExpression(FunctionKind.ASYNC);
        }
        return this.parseIdentifierReference();
      case Token.THIS: {
        const node = this.startNode<ParseNode.ThisExpression>();
        this.next();
        return this.finishNode(node, 'ThisExpression');
      }
      case Token.NUMBER:
      case Token.BIGINT:
      // proposal-runtime-types #sec-imaginary-literals: `DecimalImaginaryLiteral ::
      // DecimalLiteral ImaginaryLiteralSuffix`. The lexer already scans it - and
      // already refuses `4if`, since "the source character following a numeric
      // literal must not be an identifier start" - so what was missing was an
      // expression production to take the token.
      case Token.IMAGINARY:
        return this.parseNumericLiteral();
      case Token.STRING:
        return this.parseStringLiteral();
      case Token.NULL: {
        const node = this.startNode<ParseNode.NullLiteral>();
        this.next();
        return this.finishNode(node, 'NullLiteral');
      }
      case Token.TRUE:
      case Token.FALSE:
        return this.parseBooleanLiteral();
      case Token.LBRACK:
        return this.parseArrayLiteral();
      case Token.LBRACE:
        return this.parseObjectLiteral();
      case Token.FUNCTION:
        return this.parseFunctionExpression(FunctionKind.NORMAL);
      case Token.AT: {
        if (!surroundingAgent.feature('decorators') && !surroundingAgent.feature('runtime-types')) {
          return this.unexpected();
        }
        // proposal-runtime-types decorators.md: `const b = @f { ... }` decorates
        // the OBJECT LITERAL, so `@` in expression position no longer implies a
        // class here either - the same dispatch the statement position needed.
        if (surroundingAgent.feature('runtime-types')) {
          const decorators = this.parseDecorators();
          // A decoration whose name declared a lexical MODE takes its region
          // whole. Needed HERE as well as in the statement path, because
          // `const v = @jsx do { ... }` is an expression and never reaches that
          // one - which is also the position `do` exists for, since it is the
          // carrier that yields a value.
          const moded = this.parseModedRegion(decorators, true);
          if (moded !== undefined) {
            return moded as unknown as ParseNode.PrimaryExpression;
          }
          if (this.test(Token.LBRACE)) {
            const literal = this.parseObjectLiteral();
            (literal as { Decorators?: readonly ParseNode.Decorator[] | null }).Decorators = decorators;
            return literal;
          }
          // proposal-runtime-types #sec-do-expressions: `@memo do { ... }`
          // decorates the do EXPRESSION, which is how the design writes it and
          // where a reader expects it - the decorator names the thing that
          // produces the value. The list is carried to the block, which is what
          // fires it, so the DoBlock context reaches the decorator either way.
          const isAsyncDo = this.test('async') && !this.peek().hadLineTerminatorBefore && this.testAhead(Token.DO);
          if (this.test(Token.DO) || isAsyncDo) {
            const doExpression = this.parseDoExpression(isAsyncDo);
            const target = (doExpression.Block ?? doExpression.GeneratorBody) as {
              Decorators?: readonly ParseNode.Decorator[] | null,
            } | undefined;
            if (target) {
              target.Decorators = decorators;
            }
            return doExpression as unknown as ParseNode.PrimaryExpression;
          }
          // decorators.md: `const e = @f Composite([0]); // Reflect.Tuple` and
          // `const d = @f Composite({ a: 1 }); // Reflect.Record`. The
          // decorated thing is an ordinary EXPRESSION, and which context fires
          // is decided by the VALUE it produces rather than by its syntax - a
          // composite backed by an array is a Tuple and one backed by an object
          // is a Record, the same split the composites' intern key carries.
          if (!this.test(Token.CLASS)) {
            const node = this.startNode<ParseNode.DecoratedExpression>();
            node.Decorators = decorators ?? [];
            node.Expression = this.parseAssignmentExpression();
            return this.finishNode(node, 'DecoratedExpression') as unknown as ParseNode.PrimaryExpression;
          }
          // parseClassExpression takes no decorator list; the class path
          // re-reads them from the token stream.
          return this.parseClassExpression();
        }
        return this.parseClassExpression();
      }
      case Token.CLASS:
        return this.parseClassExpression();
      case Token.TEMPLATE:
        return this.parseTemplateLiteral();
      case Token.DIV:
      case Token.ASSIGN_DIV:
        return this.parseRegularExpressionLiteral();
      case Token.LPAREN:
        return this.parseCoverParenthesizedExpressionAndArrowParameterList();
      default:
        return this.unexpected();
    }
  }

  // NumericLiteral
  parseNumericLiteral(): ParseNode.NumericLiteral {
    const node = this.startNode<ParseNode.NumericLiteral>();
    const imaginary = this.test(Token.IMAGINARY);
    if (!this.test(Token.NUMBER) && !this.test(Token.BIGINT) && !imaginary) {
      this.unexpected();
    }
    const token = this.next();
    node.value = token.valueAsNumeric();
    if (imaginary) {
      // The suffix is what makes the literal imaginary, and the value scanned is
      // the magnitude on that axis: "an imaginary literal has the type `complex`,
      // with the literal's value as its imaginary component and zero as its real
      // one, so `4i` is `complex(0, 4)`".
      (node as { Imaginary?: boolean }).Imaginary = true;
    }
    // The token's own extent, so numeric separators and a radix prefix are
    // carried as written; BigInt() reads both, and a `n` suffix is dropped
    // because the text is used only where the target is already known.
    node.SourceText = this.source.slice(token.startIndex, token.endIndex);
    return this.finishNode(node, 'NumericLiteral');
  }

  // StringLiteral
  parseStringLiteral(): ParseNode.StringLiteral {
    const node = this.startNode<ParseNode.StringLiteral>();
    if (!this.test(Token.STRING)) {
      this.unexpected();
    }
    node.value = this.next().valueAsString();
    return this.finishNode(node, 'StringLiteral');
  }

  // BooleanLiteral :
  //   `true`
  //   `false`
  parseBooleanLiteral(): ParseNode.BooleanLiteral {
    const node = this.startNode<ParseNode.BooleanLiteral>();
    switch (this.peek().type) {
      case Token.TRUE:
        this.next();
        node.value = true;
        break;
      case Token.FALSE:
        this.next();
        node.value = false;
        break;
      default:
        this.unexpected();
    }
    return this.finishNode(node, 'BooleanLiteral');
  }

  // ArrayLiteral :
  //   `[` `]`
  //   `[` Elision `]`
  //   `[` ElementList `]`
  //   `[` ElementList `,` `]`
  //   `[` ElementList `,` Elision `]`
  parseArrayLiteral(): ParseNode.ArrayLiteral {
    const node = this.startNode<ParseNode.ArrayLiteral>();
    this.expect(Token.LBRACK);
    const ElementList: Mutable<ParseNode.ElementList> = [];
    node.ElementList = ElementList;
    node.hasTrailingComma = false;
    while (true) {
      while (this.test(Token.COMMA)) {
        const elision = this.startNode<ParseNode.Elision>();
        this.next();
        ElementList.push(this.finishNode(elision, 'Elision'));
      }
      if (this.eat(Token.RBRACK)) {
        break;
      }
      if (this.test(Token.ELLIPSIS)) {
        const spread = this.startNode<ParseNode.SpreadElement>();
        this.next();
        spread.AssignmentExpression = this.parseAssignmentExpression();
        ElementList.push(this.finishNode(spread, 'SpreadElement'));
      } else {
        ElementList.push(this.parseAssignmentExpression());
      }
      if (this.eat(Token.RBRACK)) {
        node.hasTrailingComma = false;
        break;
      }
      node.hasTrailingComma = true;
      this.expect(Token.COMMA);
    }
    return this.finishNode(node, 'ArrayLiteral');
  }

  // ObjectLiteral :
  //   `{` `}`
  //   `{` PropertyDefinitionList `}`
  //   `{` PropertyDefinitionList `,` `}`
  parseObjectLiteral(): ParseNode.ObjectLiteral {
    const node = this.startNode<ParseNode.ObjectLiteral>();
    this.expect(Token.LBRACE);
    const PropertyDefinitionList: Mutable<ParseNode.PropertyDefinitionList> = [];
    node.PropertyDefinitionList = PropertyDefinitionList;
    let hasProto = false;
    while (true) {
      if (this.eat(Token.RBRACE)) {
        break;
      }
      const PropertyDefinition = this.parsePropertyDefinition();
      if (!this.state.json
          && PropertyDefinition.type === 'PropertyDefinition'
          && PropertyDefinition.PropertyName
          && !IsComputedPropertyKey(PropertyDefinition.PropertyName)
          && PropertyDefinition.PropertyName.type !== 'NumericLiteral'
          && StringValue(PropertyDefinition.PropertyName).stringValue() === '__proto__') {
        if (hasProto) {
          this.scope.registerObjectLiteralEarlyError(this.addEarlyError(Throw.SyntaxError('Duplicate __proto__ property'), PropertyDefinition.PropertyName));
        } else {
          hasProto = true;
        }
      }
      PropertyDefinitionList.push(PropertyDefinition);
      if (this.eat(Token.RBRACE)) {
        break;
      }
      this.expect(Token.COMMA);
    }
    return this.finishNode(node, 'ObjectLiteral');
  }

  parsePropertyDefinition(): ParseNode.PropertyDefinitionLike {
    // proposal-runtime-types decorators.md: an object literal's members carry
    // decorators exactly as a class's do - `@f a: 1`, `@f m() {}`, `@f get c()`.
    // The list is parsed here and the member that follows decides which context
    // it takes, the same shape the class members use.
    if (surroundingAgent.feature('runtime-types') && this.test(Token.AT)) {
      const decorators = this.parseDecorators();
      const definition = this.parsePropertyDefinitionInner();
      (definition as { Decorators?: readonly ParseNode.Decorator[] | null }).Decorators = decorators;
      return definition;
    }
    return this.parsePropertyDefinitionInner();
  }

  parsePropertyDefinitionInner(): ParseNode.PropertyDefinitionLike {
    // proposal-runtime-types #sec-typed-destructuring: the parenthesized member
    // of a destructuring ASSIGNMENT, `({ (ref x) } = o)` and `({ (ref r): x } =
    // o)`. An object literal has no other reading for a `(` at this position, so
    // admitting one costs nothing and this is a cover: the form is refined into
    // an assignment pattern where it is one, and reported where it is not.
    //
    // Only `ref` is admitted. An ANNOTATION here would have to mean a check
    // rather than a binding - there is no new binding in an assignment to give
    // a type to - and it would leave `({ (a: uint8) } = src)` with two types
    // for one target where `a` was declared at another. `is` and `:=` already
    // express the check.
    // Only `(ref` is claimed here. A `(` at this position ALREADY means a typed
    // own property, `{ (a: uint8): 1 }`, so the two are told apart by the token
    // after the parenthesis rather than by the parenthesis itself.
    if (surroundingAgent.feature('runtime-types') && this.test(Token.LPAREN)
        && this.peekAhead().type === Token.IDENTIFIER && this.peekAhead().value === 'ref') {
      return this.parseRefAssignmentProperty();
    }
    return this.parseBracketedDefinition('property');
  }

  /** `(` `ref` IdentifierReference `)` (`:` PropertyName)? */
  parseRefAssignmentProperty(): ParseNode.PropertyDefinitionLike {
    const node = this.startNode<ParseNode.PropertyDefinition>();
    this.expect(Token.LPAREN);
    // The caller has already established that `ref` follows the parenthesis.
    this.next();
    const target = this.parseIdentifierReference();
    if (this.test(Token.COLON)) {
      this.unexpected(this.peek());
    }
    if (this.test(Token.CONDITIONAL)) {
      this.addEarlyError(Throw.SyntaxError('A ref member may not be optional'), this.peek());
    }
    this.expect(Token.RPAREN);
    (node as ParseNode.Unfinished<ParseNode.PropertyDefinition> & { RefTarget?: unknown }).RefTarget = target;
    // Without a rename the property is the target's own name.
    node.PropertyName = this.eat(Token.COLON)
      ? this.parsePropertyName()
      : this.repurpose({ ...target }, 'IdentifierName') as never;
    node.AssignmentExpression = target as never;
    return this.finishNode(node, 'PropertyDefinition');
  }

  parseFunctionExpression(kind: FunctionKind): ParseNode.FunctionExpressionLike {
    return this.parseFunction(true, kind) as ParseNode.FunctionExpressionLike;
  }

  parseArguments(): { Arguments: ParseNode.Arguments, trailingComma: boolean } {
    const location = this.getLocation();
    this.expect(Token.LPAREN);
    if (this.eat(Token.RPAREN)) {
      return { Arguments: Object.assign([], this.markLocationEnd({ location })), trailingComma: false };
    }
    const Arguments: ParseNode.ArgumentListElement[] = [];
    let trailingComma = false;
    while (true) {
      const node = this.startNode<ParseNode.AssignmentRestElement>();
      if (this.eat(Token.ELLIPSIS)) {
        node.AssignmentExpression = this.withConditionalAnnotationsAllowed(() => this.parseAssignmentExpression());
        Arguments.push(this.finishNode(node, 'AssignmentRestElement'));
      } else if (surroundingAgent.feature('runtime-types')
          && this.test('ref')
          && !this.peekAhead().hadLineTerminatorBefore
          && (this.peekAhead().type === Token.IDENTIFIER
            || this.peekAhead().type === Token.THIS
            || this.peekAhead().type === Token.YIELD
            || this.peekAhead().type === Token.AWAIT
            // The topic, so that `ref %` reaches the refusal below with its own
            // diagnostic. Without this the lookahead declines, `ref` parses as
            // an identifier, and the `%` that follows is an unexplained
            // "Unexpected token" - refused, but for a reason the reader has to
            // work out.
            || (this.peekAhead().type === Token.MOD && this.pipelineBodyDepth > 0))) {
        // proposal-runtime-types (references extension): a `ref` argument
        // passes the operand's storage location rather than its value. `ref` is
        // contextual: `f(ref)` and `f(ref, x)` still pass an identifier named
        // ref, since no operand follows `ref` on the same line.
        const refNode = this.startNode<ParseNode.RefExpression>();
        this.next();
        refNode.Expression = this.parseLeftHandSideExpression();
        // proposal-runtime-types #sec-pipeline-static-semantics: `ref %` is
        // refused. A reference parameter binds the caller's LOCATION; the topic
        // holds the VALUE the left operand produced, so `o.a |> f(ref %)` would
        // bind a temporary and the write would reach nothing observable. It is
        // refused rather than admitted and useless, because it reads as though
        // the pipe were transparent to the place it came from.
        if (refNode.Expression.type === 'TopicReference') {
          this.addEarlyError(Throw.SyntaxError('the topic is a value, not a reference'), refNode);
        }
        // proposal-runtime-types #sec-location-consuming-contexts: `g(ref
        // first(a))` re-borrows the location a call returned, so the call keeps
        // its reference rather than decaying it at the boundary.
        this.markLocationConsuming(refNode.Expression);
        Arguments.push(this.finishNode(refNode, 'RefExpression'));
      } else if (surroundingAgent.feature('runtime-types')
          && this.conditionalConsequentDepth === 0
          && this.test(Token.IDENTIFIER)
          && this.testAhead(Token.COLON)) {
        // proposal-runtime-types: a named argument `name: expr`. An identifier
        // directly followed by `:` at the top of an argument selects a parameter
        // by name (the ternary `:` cannot appear here, since a pending
        // conditional resets the depth, and `:=` is a distinct token, so a cast
        // is unaffected). The name is read, the colon eaten, and the value parsed.
        const named = this.startNode<ParseNode.NamedArgument>();
        named.Name = this.parseIdentifierName().name;
        this.expect(Token.COLON);
        named.AssignmentExpression = this.withConditionalAnnotationsAllowed(() => this.parseAssignmentExpression());
        Arguments.push(this.finishNode(named, 'NamedArgument'));
      } else {
        Arguments.push(this.withConditionalAnnotationsAllowed(() => this.parseAssignmentExpression()));
      }
      if (this.eat(Token.RPAREN)) {
        break;
      }
      this.expect(Token.COMMA);
      if (this.eat(Token.RPAREN)) {
        trailingComma = true;
        break;
      }
    }
    return { Arguments: Object.assign(Arguments, this.markLocationEnd({ location })), trailingComma };
  }

  /** https://tc39.es/ecma262/#sec-class-definitions */
  // ClassDeclaration :
  //   DecoratorList? `class` BindingIdentifier ClassTail
  //   DecoratorList? [+Default] `class` ClassTail
  //
  // ClassExpression :
  //   DecoratorList? `class` BindingIdentifier? ClassTail
  parseClass(decoratorsAttachedToClassDeclaration: null | readonly ParseNode.Decorator[], isExpression: boolean): ParseNode.ClassLike {
    const node = this.startNode<ParseNode.ClassLike>();

    const decorators = decoratorsAttachedToClassDeclaration || this.parseDecorators();
    // proposal-runtime-types ClassModifiers
    let ClassModifiers: string[] | null = null;
    while (this.testClassModifierRun()) {
      const word = this.peek().value as string;
      this.next();
      ClassModifiers = ClassModifiers || [];
      if (ClassModifiers.includes(word)) {
        this.raise(Throw.SyntaxError('Class modifier already seen'));
      }
      ClassModifiers.push(word);
    }
    if (ClassModifiers && ClassModifiers.includes('sealed') && ClassModifiers.includes('dynamic')) {
      this.raise(Throw.SyntaxError('A class cannot be both sealed and dynamic'));
    }
    node.ClassModifiers = ClassModifiers;
    this.expect(Token.CLASS);
    // proposal-runtime-types: a `partial class` re-opens an existing class to add
    // members, so it does not declare a new binding; the name must already be
    // bound. A non-partial class declares its name as usual.
    const isPartial = !!ClassModifiers && ClassModifiers.includes('partial');

    this.scope.with({ strict: true }, () => {
      if (!this.test(Token.LBRACE) && !this.test(Token.EXTENDS) && !this.test(Token.LT)) {
        node.BindingIdentifier = this.parseBindingIdentifier();
        if (!isExpression && !isPartial) {
          this.scope.declare(node.BindingIdentifier, 'lexical');
        }
      } else if (this.test(Token.LT)) {
        // A generic class expression may omit the binding identifier: `class <T> {}`.
        node.BindingIdentifier = null;
      } else if (isExpression === false && !this.scope.isDefault()) {
        this.raise(Throw.SyntaxError('Class missing binding identifier'));
      } else {
        node.BindingIdentifier = null;
      }
      // proposal-runtime-types: a class may declare type parameters, `class A<T>`,
      // applied with `.<...>` elsewhere. Parsed only under the feature.
      if (surroundingAgent.feature('runtime-types') && this.test(Token.LT)) {
        node.TypeParameters = this.parseTypeParameters();
      } else {
        node.TypeParameters = null;
      }
      const savedClassModifiers = this.currentClassModifiers;
      this.currentClassModifiers = ClassModifiers;
      try {
        node.ClassTail = this.scope.with({ default: false }, () => this.parseClassTail());
      } finally {
        this.currentClassModifiers = savedClassModifiers;
      }
    });
    node.Decorators = decorators;

    return this.finishNode(node, isExpression ? 'ClassExpression' : 'ClassDeclaration');
  }

  // ClassTail : ClassHeritage? `{` ClassBody? `}`
  // ClassHeritage : `extends` LeftHandSideExpression
  /**
   * proposal-runtime-types #sec-class-operators: does this read direction yield
   * a REFERENCE?
   *
   * Either spelling counts, because the design uses both: an explicit return
   * annotation of a reference type, as an interface writes it, and a body that
   * returns a borrow, as `get operator[](i) { return ref this.#d[i]; }` does
   * without annotating anything. `return ref e` is its own production, so this
   * is a syntactic question and not a inference one.
   */
  readDirectionYieldsReference(e: ParseNode.OperatorDefinition): boolean {
    const annotation = (e as { TypeAnnotation?: { Type?: { type?: string } } | null }).TypeAnnotation;
    if (annotation?.Type?.type === 'ReferenceType') {
      return true;
    }
    let found = false;
    const walk = (node: unknown): void => {
      if (found || !node || typeof node !== 'object') {
        return;
      }
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      const n = node as { type?: string, Expression?: unknown };
      if (n.type === 'ReturnStatement' && (n.Expression as { type?: string } | undefined)?.type === 'RefExpression') {
        found = true;
        return;
      }
      // A nested function has its own returns, so its body is not this
      // accessor's; the walk stops at one.
      if (n.type === 'FunctionExpression' || n.type === 'FunctionDeclaration'
          || n.type === 'ArrowFunction' || n.type === 'MethodDefinition'
          || n.type === 'ClassExpression' || n.type === 'ClassDeclaration') {
        return;
      }
      for (const key of Object.keys(n)) {
        if (key !== 'parent') {
          walk((n as Record<string, unknown>)[key]);
        }
      }
    };
    walk((e as { FunctionBody?: unknown }).FunctionBody);
    return found;
  }

  /**
   * Records an index accessor and reports the pair the clause refuses: a
   * reference-returning read direction and a write direction for the same
   * number of indices.
   */
  recordIndexAccessor(
    e: ParseNode.OperatorDefinition,
    reads: Map<number, ParseNode.OperatorDefinition>,
    writes: Map<number, ParseNode.OperatorDefinition>,
  ): void {
    if (e.OperatorName !== '[]') {
      return;
    }
    const params = e.FormalParameters?.length ?? 0;
    const isWrite = (e as { AccessorKind?: string }).AccessorKind === 'set';
    // The write direction takes the indices and then the value, so its index
    // count is one less than its parameter count.
    const indices = isWrite ? Math.max(0, params - 1) : params;
    if (isWrite) {
      writes.set(indices, e);
      const read = reads.get(indices);
      if (read && this.readDirectionYieldsReference(read)) {
        this.addEarlyError(Throw.SyntaxError('an index accessor that returns a ref needs no set operator[], and declaring both gives the write two meanings'), e);
      }
      return;
    }
    reads.set(indices, e);
    if (writes.has(indices) && this.readDirectionYieldsReference(e)) {
      this.addEarlyError(Throw.SyntaxError('an index accessor that returns a ref needs no set operator[], and declaring both gives the write two meanings'), e);
    }
  }

  // ClassBody : ClassElementList
  parseClassTail(): ParseNode.ClassTail {
    const node = this.startNode<ParseNode.ClassTail>();

    if (this.eat(Token.EXTENDS)) {
      node.ClassHeritage = this.parseLeftHandSideExpression();
    } else {
      node.ClassHeritage = null;
    }

    // proposal-runtime-types ImplementsClause : `implements` ImplementsList
    if (surroundingAgent.feature('runtime-types') && this.test('implements')) {
      this.next();
      const ImplementsClause: ParseNode.TypeReference[] = [];
      do {
        ImplementsClause.push(this.parseTypeReference());
      } while (this.eat(Token.COMMA));
      node.ImplementsClause = ImplementsClause;
    } else {
      node.ImplementsClause = null;
    }

    this.expect(Token.LBRACE);
    if (this.eat(Token.RBRACE)) {
      node.ClassBody = null;
    } else {
      node.ClassBody = this.scope.with({
        superCall: !!node.ClassHeritage,
        private: true,
      }, () => {
        const ClassBody: Mutable<ParseNode.ClassElementList> = [];
        let hasConstructor = false;
        while (this.eat(Token.SEMICOLON)) {
          // nothing
        }
        const staticPrivates = new Set();
        const instancePrivates = new Set();
        // Index accessors seen so far, by index count, so that a read and a
        // write direction declared for the same count can be compared however
        // they are ordered in the body.
        const indexReads = new Map<number, ParseNode.OperatorDefinition>();
        const indexWrites = new Map<number, ParseNode.OperatorDefinition>();
        while (!this.eat(Token.RBRACE)) {
          const m = this.parseClassElement();
          ClassBody.push(m);
          while (this.eat(Token.SEMICOLON)) {
            // nothing
          }
          // PLAN-type-declared-zero.md phase 2. #sec-declared-zero:
          //
          //   ClassElement : `static` `default` `=` AssignmentExpression `;`
          //
          // A class may declare the value its bindings hold before assignment,
          // in place of the one DefaultValueOf derives field by field.
          //
          // This spelling ALREADY PARSED - `static default = 5` is an ordinary
          // static field and `Z.default` is 5 - so nothing new is parsed here.
          // What is new is recognising it: the declaration is marked so
          // `DefaultValueOf` can consult it ahead of the derived rules, which is
          // the replacement rule the clause states.
          if (surroundingAgent.feature('runtime-types')
              && m.type === 'FieldDefinition'
              && (m as { static?: boolean }).static
              && (m as { ClassElementName?: { name?: string } }).ClassElementName?.name === 'default') {
            (node as { DeclaredZero?: ParseNode }).DeclaredZero = m;
            // PLAN-type-declared-zero.md phase 4. #sec-declared-zero: the
            // |AssignmentExpression| "must be compile-time evaluable and it is a
            // type error otherwise, and it is evaluated ONCE, when the class is
            // declared".
            //
            // The restriction is what keeps the zero a FILL rather than a loop
            // of calls: `let d: [1000].<Transform>;` takes the zero a thousand
            // times, and a value that could observe or mutate the program would
            // make those thousand copies distinguishable.
            //
            // PARTIAL, and deliberately so. `FirstEvaluabilityViolation` answers
            // the PREPROCESSOR's question - it flags a fixed set of ambient
            // names like `Date` and `globalThis` - while
            // #sec-iscompiletimeevaluable asks something stricter: a reference
            // to a binding is evaluable only where the binding "is immutable and
            // its initializer is compile-time evaluable". That needs the
            // binding's MUTABILITY, which is a scope fact the parser does not
            // have, and the engine has no IsCompileTimeEvaluable to ask.
            //
            // So `static default = (Date.now(), …)` is refused and
            // `let c = 0; static default = (c += 1, …)` is not. The check is a
            // floor rather than the rule; see PLAN-type-declared-zero.md phase 4.
            const initializer = (m as { Initializer?: ParseNode | null }).Initializer;
            const violation = initializer ? FirstEvaluabilityViolation(initializer) : undefined;
            if (violation) {
              this.addEarlyError(
                Throw.SyntaxError(
                  'a declared zero is not compile-time evaluable: it names $1',
                  Value(violation.name),
                ),
                m,
              );
            }
          }
          if (m.type === 'ClassStaticBlock') {
            continue;
          }
          if (m.type === 'OperatorDefinition') {
            // proposal-runtime-types: operators have no ClassElementName and
            // take no part in the name bookkeeping below.
            //
            // #sec-class-operators: an index accessor whose read direction
            // yields a REFERENCE already denotes the place a write goes, so a
            // write direction for the same number of indices would give the
            // write two meanings. Declaring both is refused here rather than
            // letting one silently win, which would leave the other looking
            // live while nothing reached it.
            this.recordIndexAccessor(m, indexReads, indexWrites);
            continue;
          }

          if (m.ClassElementName?.type === 'PrivateIdentifier') {
            let type: 'field' | 'method' | 'set' | 'get';
            if (m.type === 'FieldDefinition') {
              type = 'field';
            } else if (m.UniqueFormalParameters) {
              type = 'method';
            } else if (m.PropertySetParameterList) {
              type = 'set';
            } else {
              type = 'get';
            }
            if (type === 'get' || type === 'set') {
              if (m.static) {
                if (instancePrivates.has(m.ClassElementName.name)) {
                  this.addEarlyError(Throw.SyntaxError('A class cannot have static and instance private methods with the same name'), m);
                } else {
                  staticPrivates.add(m.ClassElementName.name);
                }
              } else {
                if (staticPrivates.has(m.ClassElementName.name)) {
                  this.addEarlyError(Throw.SyntaxError('A class cannot have static and instance private methods with the same name'), m);
                } else {
                  instancePrivates.add(m.ClassElementName.name);
                }
              }
            }
            this.scope.declare(m.ClassElementName, 'private', type);
            if (m.ClassElementName.name === 'constructor') {
              this.addEarlyError(Throw.SyntaxError('A class element cannot be named as "constructor"'), m);
            }
          }

          const name = PropName(m);
          const isActualConstructor = !m.static
            && m.type === 'MethodDefinition'
            && !!m.UniqueFormalParameters
            && name === 'constructor';
          if (isActualConstructor) {
            if (hasConstructor) {
              this.addEarlyError(Throw.SyntaxError('Duplicate constructor'), m);
            } else {
              hasConstructor = true;
            }
          }
          if ((m.static && name === 'prototype')
              || (!m.static && !isActualConstructor && name === 'constructor')) {
            this.addEarlyError(Throw.SyntaxError('A class element cannot be named as "prototype" or "constructor"'), m);
          }
          if (m.static && m.type === 'FieldDefinition' && name === 'constructor') {
            this.addEarlyError(Throw.SyntaxError('A class static field cannot be named as "constructor"'), m);
          }
        }
        // PLAN-constructor-returns.md phase 1 (OQ1-E, scoped by OQ2-B).
        // Reported HERE and not at the `return`, because this is the first
        // point that knows whether the class is TYPED: an annotation may come
        // after the constructor, as in
        // `class C { constructor() { return {}; } x: uint8 = 1; }`.
        //
        // #sec-typed-classes asserts "the class is the type a construction
        // yields" and never states a rule that makes it so. JavaScript makes
        // it false: `[[Construct]]` returns the constructor's object when it
        // returns one, so `new C() instanceof C` is false, a declared field
        // reads `undefined`, and a private-name brand check fails (F122).
        //
        // A REFUSAL rather than a check, because a check cannot be written
        // where the offence is. A base class's returning constructor breaks
        // every subclass - `class B extends A { m() {} }` gets an object with
        // no `m` and no prototype - and whether A's returned object is
        // assignable to B is not knowable at A. Refusing makes the assertion
        // true by construction, so `new C()` keeps a monomorphic shape and
        // memorylayout.md's guarantees (placement `new`, serializers walking
        // by offset) hold without reading a constructor body.
        //
        // Scoped to a typed class so the proposal stays a superset: an
        // untyped class keeps JavaScript's semantics, including the
        // Proxy-wrapping idiom, which is the one pattern this costs.
        //
        // Run AFTER the element loop, not inside it: the loop sees elements one
        // at a time, so a constructor examined mid-loop cannot know about an
        // annotation that follows it.
        if (surroundingAgent.feature('runtime-types') && classIsTyped(ClassBody)) {
          for (const element of ClassBody) {
            const returns = (element as { ConstructorReturns?: readonly ParseNode.ReturnStatement[] }).ConstructorReturns;
            for (const offending of returns || []) {
              this.addEarlyError(
                Throw.SyntaxError('A constructor yields its class and may return only `this`; write the expression as a statement followed by `return;`, or use a static method to return something else'),
                offending,
              );
            }
          }
        }

        return ClassBody;
      });
    }

    return this.finishNode(node, 'ClassTail');
  }

  /**
   * proposal-runtime-types `sec-match-patterns`.
   *
   * The combinator layer sits ABOVE the type form, not beside it - a |Type| is
   * one |MatchPattern|, so `uint8 or number` and `not uint8` are ordinary
   * combinations of it. Parsing the special forms first and falling back to
   * `parseType` for everything else put the fallback OUTSIDE the combinators,
   * which silently dropped the operator: `1 is uint8 or number` threw and
   * `"s" is not uint8` answered *false*.
   */
  /**
   * `colonTerminates` says whether a `:` ENDS this pattern rather than
   * belonging to it.
   *
   * In a `match` CLAUSE it does - `when P:` - so an annotated binding needs a
   * SECOND colon to be told from the clause's. In `is` position, and in an
   * object pattern's member position, it does NOT, so `let x: T` is complete as
   * written. The rule genuinely differs by position, and speculating on a
   * second colon at each site got two of the three wrong; passing the context
   * down settles all of them at once.
   */
  parseMatchPattern(colonTerminates = false): ParseNode.MatchPattern {
    let left = this.parseMatchUnaryPattern(colonTerminates);
    while (this.test('and')) {
      const node = this.startNode<ParseNode.MatchAndPattern>(left);
      this.next();
      node.Left = left;
      node.Right = this.parseMatchUnaryPattern(colonTerminates);
      left = this.finishNode(node, 'MatchAndPattern');
    }
    while (this.test('or')) {
      const node = this.startNode<ParseNode.MatchOrPattern>(left);
      this.next();
      node.Left = left;
      node.Right = this.parseMatchPattern(colonTerminates);
      left = this.finishNode(node, 'MatchOrPattern');
    }
    return left;
  }

  /** `not` binds tightest. */
  parseMatchUnaryPattern(colonTerminates = false): ParseNode.MatchPattern {
    if (this.test('not')) {
      const node = this.startNode<ParseNode.MatchNotPattern>();
      this.next();
      node.Operand = this.parseMatchUnaryPattern(colonTerminates);
      return this.finishNode(node, 'MatchNotPattern');
    }
    // `let x` / `const x`, with an optional annotation. "An unadorned name is a
    // CONSTANT to compare against, not a binding site", which is why the
    // keyword is required rather than inferred from the name being fresh.
    if (this.test('let') || this.test(Token.CONST)) {
      const node = this.startNode<ParseNode.MatchBindingPattern>();
      node.IsConst = this.test(Token.CONST);
      this.next();
      node.Name = this.parseBindingIdentifier().name;
      node.TypeAnnotation = null;
      // Where a colon does NOT terminate the pattern, `let x: T` is complete as
      // written. Where it DOES - a clause - the annotation is taken only if a
      // second colon follows, which is the clause's own.
      if (this.test(Token.COLON)) {
        if (!colonTerminates) {
          this.next();
          node.TypeAnnotation = this.parseType();
        } else {
          const savedEarly = new Set(this.earlyErrors);
          const cp = this.getLexerCheckpoint();
          this.next();
          let annotation = null;
          try {
            annotation = this.parseType();
          } catch {
            annotation = null;
          }
          if (annotation && this.test(Token.COLON)) {
            node.TypeAnnotation = annotation;
          } else {
            this.restoreLexerCheckpoint(cp);
            this.earlyErrors = savedEarly;
          }
        }
      }
      return this.finishNode(node, 'MatchBindingPattern');
    }
    // `_` matches anything and binds nothing.
    if (this.test('_')) {
      const node = this.startNode<ParseNode.MatchWildcardPattern>();
      this.next();
      return this.finishNode(node, 'MatchWildcardPattern');
    }
    const t = this.peek();
    if (t.type === Token.NUMBER || t.type === Token.STRING
        || t.type === Token.TRUE || t.type === Token.FALSE || t.type === Token.NULL
        || t.type === Token.ADD || t.type === Token.SUB) {
      const node = this.startNode<ParseNode.MatchLiteralPattern>();
      // A BARE `0` matches both zeros of the position's type; an explicit `+0`
      // or `-0` distinguishes them. Recorded at the PARSE because only the
      // source can tell them apart - by the time there is a value they are one.
      node.BareZero = !(t.type === Token.ADD || t.type === Token.SUB);
      // A RANGE literal is a pattern matching by CONTAINMENT, "exactly as a
      // range `case` label does". Parsed at the RANGE level rather than the
      // unary one: a range is `lower .. upper`, so a unary parse takes the
      // lower bound and leaves the `..` behind - which made `5 is 1..<10` a
      // parse error rather than a containment test.
      const literal = this.parseRangeExpression();
      if ((literal as { type?: string }).type === 'RangeExpression') {
        const range = this.startNode<ParseNode.MatchRangePattern>(literal);
        range.Range = literal;
        return this.finishNode(range, 'MatchRangePattern');
      }
      node.Literal = literal;
      return this.finishNode(node, 'MatchLiteralPattern');
    }
    // `${expr}`: evaluate and compare - "the escape hatch from every cleverer
    // rule", and unambiguous, since a |Type| is never written this way.
    //
    // NOT a TEMPLATE token: `${` is template syntax only INSIDE a template
    // literal, and in pattern position it is a `$` identifier followed by `{`.
    // The two characters are lexed separately here for that reason.
    if (this.test(Token.IDENTIFIER) && this.peek().value === '$' && this.testAhead(Token.LBRACE)) {
      const node = this.startNode<ParseNode.MatchInterpolationPattern>();
      this.next();
      this.expect(Token.LBRACE);
      node.Expression = this.parseAssignmentExpression();
      this.expect(Token.RBRACE);
      return this.finishNode(node, 'MatchInterpolationPattern');
    }
    // A REGULAR EXPRESSION pattern. A |Type| is never written this way, so no
    // speculation is needed - and it matches the ENTIRE subject, "the
    // whole-string discipline this proposal uses everywhere a pattern
    // constrains a string".
    if (this.test(Token.DIV) || this.test(Token.ASSIGN_DIV)) {
      const node = this.startNode<ParseNode.MatchRegExpPattern>();
      node.RegExp = this.parsePrimaryExpression();
      return this.finishNode(node, 'MatchRegExpPattern');
    }
    // An ARRAY pattern, under the same rule as objects below: taken only where
    // the brackets hold something a |Type| cannot, since `[1, 2]` is a TUPLE
    // TYPE of two literal types and answers identically through that path.
    if (this.test(Token.LBRACK)) {
      const arrayPattern = this.tryParseMatchArrayPattern();
      if (arrayPattern) {
        return arrayPattern;
      }
    }
    // An OBJECT pattern, but only where the braces hold something a |Type|
    // cannot - `_`, a combinator, an interpolation. `{ x: uint8 }` is spelled
    // identically as a type and as an object pattern, and where every member's
    // sub-pattern IS a type the two agree; so the type path keeps those, and
    // every existing `is` keeps its parse, its meaning and its node shape.
    if (this.test(Token.LBRACE)) {
      const objectPattern = this.tryParseMatchObjectPattern();
      if (objectPattern) {
        return objectPattern;
      }
    }
    // An EXTRACTOR, `Expr(p1, p2, ...)`. Speculative for the same reason the
    // braced and bracketed forms are: a |Type| can be a parameterized name, and
    // only the shape after the head tells them apart.
    if (this.test(Token.IDENTIFIER)) {
      const extractor = this.tryParseMatchExtractorPattern();
      if (extractor) {
        return extractor;
      }
    }
    // Everything else is a |Type|, parsed exactly as `is` always parsed it.
    const node = this.startNode<ParseNode.MatchTypePattern>();
    node.Type = this.parseType();
    return this.finishNode(node, 'MatchTypePattern');
  }

  /**
   * Whether a sub-pattern is something a |Type| CANNOT express, which is what
   * decides whether a braced or bracketed form is a pattern or a type.
   *
   * A LITERAL is not one of them: `'a'` is a literal TYPE as much as a literal
   * pattern, so `{ kind: 'a' | 'b' }` is a type with a union member and must
   * stay on the type path - counting a literal as non-type stole it and left
   * the `| 'b'` unconsumed.
   */
  static matchPatternNeedsPatternPath(p: ParseNode.MatchPattern): boolean {
    switch (p.type) {
      case 'MatchTypePattern':
      case 'MatchLiteralPattern':
        return false;
      default:
        return true;
    }
  }

  /**
   * `match (` Expression `) {` MatchClauses `}`, or *null* where the source is
   * an ordinary call to something named `match`.
   *
   * `MatchClauses` requires AT LEAST ONE CLAUSE, which is what keeps
   * `match(x) {}` a call followed by a block.
   */
  /**
   * proposal-runtime-types #sec-types-in-expression-position: "`type (uint8) =>
   * uint8` is a type operator applied to a function type, while `type (x)` is a
   * call of a function named `type`, and the two agree until the token after the
   * closing parenthesis. This specification resolves it with a cover grammar ...
   * the parenthesized text is parsed under a cover production and refined to a
   * function-type operand or a call argument list once the token after the
   * closing parenthesis is known."
   *
   * The refinement is done here by parsing the operand speculatively and keeping
   * it only where it came out a |FunctionType|, which is exactly the case where a
   * `=>` followed the `)`. Everything else - `type (x)`, `type (x: uint8)` (a
   * call with a named argument), `type ((x) => x)` (a call taking an arrow
   * function) - is a live program that must stay a call, so the checkpoint is
   * restored and the caller falls through to the call form.
   *
   * A parenthesized NON-function type is deliberately not covered: the clause
   * refines to "a function-type operand or a call argument list", and `type
   * (uint8)` is a valid call. The union spelling needs no parentheses, since the
   * operand extends as far as one reaches - `type A | B` is the union.
   */
  tryParseTypeOperatorFunctionType(): ParseNode.TypeOperatorExpression | null {
    const savedEarlyErrors = new Set(this.earlyErrors);
    const checkpoint = this.getLexerCheckpoint();
    const scopeDepth = this.scope.depth;
    const node = this.startNode<ParseNode.TypeOperatorExpression>();
    this.next();
    try {
      const Type = this.parseType();
      if (Type.type === 'FunctionType') {
        node.Type = Type;
        return this.finishNode(node, 'TypeOperatorExpression');
      }
    } catch (e) {
      // A scope left unbalanced cannot be unwound by restoring the lexer, so
      // that failure is not one this may swallow. The same guard the arrow
      // return-type annotation uses.
      if (this.scope.depth !== scopeDepth) {
        throw e;
      }
    }
    this.restoreLexerCheckpoint(checkpoint);
    this.earlyErrors = savedEarlyErrors;
    return null;
  }

  tryParseMatchExpression(): ParseNode.MatchExpression | null {
    const savedEarlyErrors = new Set(this.earlyErrors);
    const checkpoint = this.getLexerCheckpoint();
    const node = this.startNode<ParseNode.MatchExpression>();
    this.next();
    // `match` [no LineTerminator here] `all` - the modifier, which is contextual.
    //
    // `all` is an ordinary identifier everywhere, so it is the modifier only
    // when it is followed by `(` on the same line. The LineTerminator
    // restriction is what keeps
    //
    //     match
    //     all(x) { }
    //
    // meaning what it means today - a statement, a call, and a block - rather
    // than becoming a `match all` whose subject is on the next line.
    node.All = this.test('all') && !this.peek().hadLineTerminatorBefore;
    if (node.All) {
      this.next();
    }
    // `match` [no LineTerminator here] `(` - the restriction the grammar states,
    // applied where it belongs. `match\n(x)` is a CALL to something named
    // `match`, and must stay one.
    if (!this.test(Token.LPAREN) || this.peek().hadLineTerminatorBefore) {
      this.restoreLexerCheckpoint(checkpoint);
      this.earlyErrors = savedEarlyErrors;
      return null;
    }
    this.expect(Token.LPAREN);
    node.Expression = this.parseExpression();
    if (!this.eat(Token.RPAREN) || !this.test(Token.LBRACE)) {
      this.restoreLexerCheckpoint(checkpoint);
      this.earlyErrors = savedEarlyErrors;
      return null;
    }
    this.expect(Token.LBRACE);
    const Clauses: ParseNode.MatchClause[] = [];
    while (!this.test(Token.RBRACE)) {
      const clause = this.startNode<ParseNode.MatchClause>();
      // `default` is RESERVED, so it is a keyword token rather than an
      // identifier - `test('default')` never matched, the clause fell to the
      // decline path, and the whole `match` silently became a call. That is the
      // failure mode a speculative parse turns a small bug into: not an error,
      // a different parse.
      if (this.test(Token.DEFAULT)) {
        this.next();
        // A `match all` has no `default`. It and `_` are synonyms in a `match`,
        // and a word meaning "always" in one form and "only if nothing else
        // did" one form over is a trap - so the one that would diverge is
        // refused, and the message names the spelling that does what the author
        // wanted.
        if (node.All) {
          this.addEarlyError(Throw.SyntaxError('a `match all` has no `default`: a clause that always contributes is `when _`'), clause);
        }
        clause.Pattern = null;
      } else if (this.test('when')) {
        this.next();
        clause.Pattern = this.parseMatchPattern(true);
      } else {
        this.restoreLexerCheckpoint(checkpoint);
        this.earlyErrors = savedEarlyErrors;
        return null;
      }
      // A GUARD runs after the pattern matches, "with the pattern's bindings in
      // scope and the subject narrowed; a falsy guard fails the arm and matching
      // continues".
      clause.Guard = null;
      if (clause.Pattern && this.test(Token.IF)) {
        this.next();
        this.expect(Token.LPAREN);
        clause.Guard = this.parseExpression();
        this.expect(Token.RPAREN);
      }
      this.expect(Token.COLON);
      // An arm body is an expression, a `throw` expression, or a block. `throw`
      // is admitted "because an arm that reports an impossible case is the
      // commonest arm a total `match` has".
      clause.IsThrow = this.test(Token.THROW);
      if (clause.IsThrow) {
        this.next();
      }
      // A BLOCK arm is a BLOCK, not a function body: "`return`, `break`,
      // `continue`, `await` and `yield` mean in it what they mean in the
      // enclosing function". Parsing it as a block is what makes that true - a
      // function body would rebind all five at once.
      // proposal-runtime-types #sec-reflection-shape-block: a match arm's block
      // takes decorators, as every other block position does. The test was for
      // `{` alone, so a leading `@` was an unexpected token and the
      // MatchArmBlock context could not be reached at all.
      const armDecorators = surroundingAgent.feature('runtime-types') && !clause.IsThrow && this.test(Token.AT)
        ? this.parseDecorators()
        : null;
      clause.IsBlock = !clause.IsThrow && this.test(Token.LBRACE);
      if (armDecorators?.length && !clause.IsBlock) {
        // Decorators reached, and what followed was not a block. Nothing else in
        // an arm takes them, so say which rule was broken rather than reporting
        // whatever token turned up.
        this.addEarlyError(Throw.SyntaxError('a decorator in a match arm must be followed by a block'), clause as never);
      }
      if (clause.IsBlock) {
        const armBlock = (this as unknown as { parseBlock(): ParseNode.Block }).parseBlock();
        clause.Body = armBlock;
        if (armDecorators?.length) {
          (armBlock as { Decorators?: readonly ParseNode.Decorator[] | null }).Decorators = armDecorators;
          (this as unknown as { markBlockKind(b: unknown, k: string, p?: ParseNode.BlockParts): unknown }).markBlockKind(armBlock, 'MatchArmBlock', {
            subject: node.Expression as never,
            pattern: (clause.Pattern ?? undefined) as never,
            guard: (clause.Guard ?? undefined) as never,
            index: Clauses.length,
          });
        }
        // proposal-runtime-types #sec-do-expression-modifications: a match
        // arm's Block IS a `do` expression's Block, so it carries that form's
        // Early Errors. An arm ending in a declaration was a silent ~void~
        // under the narrow rule this replaces, and a complaint at whatever read
        // the match's value; it names the declaration now.
        const armTail = endsInIterationOrDeclaration(armBlock.StatementList);
        if (armTail) {
          this.addEarlyError(Throw.SyntaxError('a match arm may not end in $1', Value(armTail)), armBlock);
        }
      } else {
        clause.Body = this.parseAssignmentExpression();
        this.eat(Token.SEMICOLON);
      }
      Clauses.push(this.finishNode(clause, 'MatchClause'));
    }
    if (!this.eat(Token.RBRACE) || Clauses.length === 0) {
      this.restoreLexerCheckpoint(checkpoint);
      this.earlyErrors = savedEarlyErrors;
      return null;
    }
    // "It is a Syntax Error if a `default` MatchClause is not the last of its
    // MatchClauses."
    Clauses.forEach((clause, index) => {
      if (clause.Pattern === null && index !== Clauses.length - 1) {
        this.addEarlyError(Throw.SyntaxError('A `default` clause must be last'), clause);
      }
    });
    node.Clauses = Clauses;
    return this.finishNode(node, 'MatchExpression');
  }

  /**
   * Speculatively parse `Expr(p1, p2, ...)`, returning *null* where it is not
   * one - a |Type| may be a plain name or a parameterized one, and the
   * parentheses are what distinguish the extractor.
   */
  tryParseMatchExtractorPattern(): ParseNode.MatchExtractorPattern | null {
    const savedEarlyErrors = new Set(this.earlyErrors);
    const checkpoint = this.getLexerCheckpoint();
    const node = this.startNode<ParseNode.MatchExtractorPattern>();
    const head = this.parseIdentifierReference();
    if (!this.test(Token.LPAREN)) {
      this.restoreLexerCheckpoint(checkpoint);
      this.earlyErrors = savedEarlyErrors;
      return null;
    }
    this.expect(Token.LPAREN);
    const Elements: ParseNode.MatchPattern[] = [];
    while (!this.test(Token.RPAREN)) {
      // A rest element is not a pattern form yet, and a speculation must
      // DECLINE rather than let a nested parse throw past its restore.
      if (this.test(Token.ELLIPSIS)) {
        this.restoreLexerCheckpoint(checkpoint);
        this.earlyErrors = savedEarlyErrors;
        return null;
      }
      Elements.push(this.parseMatchPattern());
      if (!this.eat(Token.COMMA)) {
        break;
      }
    }
    if (!this.eat(Token.RPAREN)) {
      this.restoreLexerCheckpoint(checkpoint);
      this.earlyErrors = savedEarlyErrors;
      return null;
    }
    node.Head = head;
    node.Elements = Elements;
    return this.finishNode(node, 'MatchExtractorPattern');
  }

  /**
   * Speculatively parse `[p1, p2, ...]`, returning *null* where the brackets
   * are a |Type| after all - the same discipline the object form uses, and for
   * the same reason: `[1, 2]` is a tuple type of two literal types and gives
   * the same answer through the type path.
   */
  tryParseMatchArrayPattern(): ParseNode.MatchArrayPattern | null {
    const savedEarlyErrors = new Set(this.earlyErrors);
    const checkpoint = this.getLexerCheckpoint();
    const node = this.startNode<ParseNode.MatchArrayPattern>();
    const Elements: ParseNode.MatchPattern[] = [];
    let sawNonType = false;
    this.expect(Token.LBRACK);
    while (!this.test(Token.RBRACK)) {
      // A REST element belongs to a |Type| here: patterns do not carry one yet,
      // and a nested parse that THROWS rather than declining would escape the
      // speculation entirely - the checkpoint is only restored on the paths
      // this function takes, not on an exception from inside it. Declining
      // early is what keeps `[number, ...[].<string>]` a tuple type.
      if (this.test(Token.ELLIPSIS)) {
        this.restoreLexerCheckpoint(checkpoint);
        this.earlyErrors = savedEarlyErrors;
        return null;
      }
      const element = this.parseMatchPattern();
      if (ExpressionParser.matchPatternNeedsPatternPath(element)) {
        sawNonType = true;
      }
      Elements.push(element);
      if (!this.eat(Token.COMMA)) {
        break;
      }
    }
    if (!this.eat(Token.RBRACK) || !sawNonType) {
      this.restoreLexerCheckpoint(checkpoint);
      this.earlyErrors = savedEarlyErrors;
      return null;
    }
    node.Elements = Elements;
    return this.finishNode(node, 'MatchArrayPattern');
  }

  /**
   * Speculatively parse `{ key: pattern, ... }`, returning *null* where the
   * braces are a |Type| after all. The checkpoint-and-restore is the same
   * mechanism `tryParseAnnotatedArrowParameter` uses.
   */
  tryParseMatchObjectPattern(): ParseNode.MatchObjectPattern | null {
    const savedEarlyErrors = new Set(this.earlyErrors);
    const checkpoint = this.getLexerCheckpoint();
    const node = this.startNode<ParseNode.MatchObjectPattern>();
    const Properties: ParseNode.MatchProperty[] = [];
    let sawNonType = false;
    this.expect(Token.LBRACE);
    while (!this.test(Token.RBRACE)) {
      // `...let rest` is a REST BINDING - the remaining own enumerable members.
      // A spread of anything else belongs to a |Type|, and declining early is
      // what keeps it one: a nested parse that THROWS rather than declining
      // would escape the speculation entirely, since the checkpoint is restored
      // only on the paths this function takes.
      if (this.test(Token.ELLIPSIS)) {
        if (!this.testAhead('let') && !this.testAhead(Token.CONST)) {
          this.restoreLexerCheckpoint(checkpoint);
          this.earlyErrors = savedEarlyErrors;
          return null;
        }
        this.next();
        const rest = this.parseMatchUnaryPattern();
        if (rest.type !== 'MatchBindingPattern') {
          this.restoreLexerCheckpoint(checkpoint);
          this.earlyErrors = savedEarlyErrors;
          return null;
        }
        node.Rest = rest;
        sawNonType = true;
        this.eat(Token.COMMA);
        break;
      }
      const prop = this.startNode<ParseNode.MatchProperty>();
      // MatchProperty : MatchBindingPattern - the SHORTHAND, where the bound
      // name is also the member name: `when { status: 200, let body }` binds
      // `body` from the `body` member. The spec gives it as an alternative of
      // MatchProperty, and patternmatching.md's opening example uses it, but the
      // parser only accepted `key: pattern` and so refused the design's own
      // headline form.
      if (this.test('let') || this.test(Token.CONST)) {
        const binding = this.parseMatchPattern();
        if ((binding as ParseNode).type !== 'MatchBindingPattern') {
          this.restoreLexerCheckpoint(checkpoint);
          this.earlyErrors = savedEarlyErrors;
          return null;
        }
        prop.Key = (binding as unknown as { Name: string }).Name;
        prop.Pattern = binding;
        sawNonType = true;
        Properties.push(this.finishNode(prop, 'MatchProperty'));
        if (!this.eat(Token.COMMA)) {
          break;
        }
        continue;
      }
      if (!this.test(Token.IDENTIFIER) && !this.test(Token.STRING)) {
        this.restoreLexerCheckpoint(checkpoint);
        this.earlyErrors = savedEarlyErrors;
        return null;
      }
      prop.Key = this.parseIdentifierName().name;
      if (!this.eat(Token.COLON)) {
        this.restoreLexerCheckpoint(checkpoint);
        this.earlyErrors = savedEarlyErrors;
        return null;
      }
      // A member's sub-pattern is a FULL pattern, combinators included.
      const sub = this.parseMatchPattern();
      if (ExpressionParser.matchPatternNeedsPatternPath(sub)) {
        sawNonType = true;
      }
      prop.Pattern = sub;
      Properties.push(this.finishNode(prop, 'MatchProperty'));
      if (!this.eat(Token.COMMA)) {
        break;
      }
    }
    if (!this.eat(Token.RBRACE) || !sawNonType) {
      // Either it did not parse, or every member is a type - in which case the
      // TYPE path gives the same answer and keeps the existing node shape.
      this.restoreLexerCheckpoint(checkpoint);
      this.earlyErrors = savedEarlyErrors;
      return null;
    }
    node.Properties = Properties;
    return this.finishNode(node, 'MatchObjectPattern');
  }

  parseClassElement(): ParseNode.ClassElement {
    let element;
    // proposal-runtime-types decorators.md: `Reflect.ClassOperator` is a
    // decorator context, and `@f operator +` had no grammar - the operator
    // branch below is chosen BEFORE `parseBracketedDefinition` reads a
    // decorator list, so a decorated operator reached the bracketed path and
    // was a SyntaxError. The list is read here instead, ahead of the dispatch,
    // and attached to whichever element follows; the bracketed path then reads
    // an empty one. This is also what admits `@f static m() {}`, since the
    // list precedes `static` as well.
    const leadingDecorators = surroundingAgent.feature('runtime-types') && this.test(Token.AT)
      ? this.parseDecorators()
      : null;
    if (this.test('static') && this.testAhead(Token.LBRACE)) {
      const node = this.startNode<ParseNode.ClassStaticBlock>();
      this.expect('static');
      node.static = true;
      this.expect(Token.LBRACE);
      const ClassStaticBlockBody = this.startNode<ParseNode.ClassStaticBlockBody>();
      ClassStaticBlockBody.ClassStaticBlockStatementList = this.scope.with(
        {
          lexical: true,
          yield: false,
          await: true,
          return: false,
          superProperty: true,
          superCall: false,
          newTarget: true,
          label: 'boundary',
          classStaticBlock: true,
        },
        () => this.parseStatementList(Token.RBRACE),
      );
      node.ClassStaticBlockBody = this.finishNode(ClassStaticBlockBody, 'ClassStaticBlockBody');
      element = this.finishNode(node, 'ClassStaticBlock');
    } else if (surroundingAgent.feature('runtime-types') && this.classElementStartsOperatorDefinition()) {
      element = this.parseOperatorDefinition();
    } else if (surroundingAgent.feature('runtime-types') && this.classElementStartsAbstractMethod()) {
      element = this.parseAbstractMethodDefinition();
    } else {
      element = this.parseBracketedDefinition('class element');
    }
    if (leadingDecorators && leadingDecorators.length > 0) {
      // A STATIC BLOCK is not in the context table and takes no decorator.
      // Reading the list before the dispatch made `@f static { }` parse, where
      // it had been a SyntaxError - so the refusal is restored here rather than
      // falling out of the parse by accident.
      if (element.type === 'ClassStaticBlock') {
        this.addEarlyError(Throw.SyntaxError('A class static block takes no decorator'), element);
      }
      (element as { Decorators?: readonly ParseNode.Decorator[] | null }).Decorators = leadingDecorators;
    }
    return element;
  }

  // The tokens that can follow `operator` inside a class body: an OperatorName
  // punctuator, or the start of a conversion form's Type. A `(`, `=`, or line
  // terminator keeps `operator` an ordinary element name.
  private tokenStartsOperatorTail(type: Token, hadLineTerminatorBefore: boolean): boolean {
    switch (type) {
      case Token.ADD: case Token.SUB: case Token.MUL: case Token.DIV:
      case Token.MOD: case Token.EXP: case Token.EQ: case Token.LT:
      case Token.GT: case Token.LTE: case Token.GTE: case Token.BIT_AND:
      case Token.BIT_OR: case Token.BIT_XOR: case Token.BIT_NOT:
      case Token.SHL: case Token.SAR: case Token.SHR:
      // proposal-runtime-types (operatoroverloading.md): the unary logical not,
      // increment, and decrement operators.
      case Token.NOT: case Token.INC: case Token.DEC:
      // proposal-runtime-types (operatoroverloading.md): the arithmetic compound
      // assignment operators, declarable so a value type can update in place.
      case Token.ASSIGN_ADD: case Token.ASSIGN_SUB: case Token.ASSIGN_MUL:
      case Token.ASSIGN_DIV: case Token.ASSIGN_MOD: case Token.ASSIGN_EXP:
      case Token.ASSIGN_SHL: case Token.ASSIGN_SAR: case Token.ASSIGN_SHR:
      case Token.ASSIGN_BIT_AND: case Token.ASSIGN_BIT_OR: case Token.ASSIGN_BIT_XOR:
      case Token.LBRACK:
      case Token.LBRACE:
        return true;
      case Token.IDENTIFIER:
      case Token.YIELD:
      case Token.AWAIT:
        return !hadLineTerminatorBefore;
      default:
        return false;
    }
  }

  private classElementStartsOperatorDefinition(): boolean {
    if (this.test(Token.MUL)) {
      return this.testAhead('operator');
    }
    if (this.test('operator')) {
      const ahead = this.peekAhead();
      return this.tokenStartsOperatorTail(ahead.type, ahead.hadLineTerminatorBefore);
    }
    // proposal-runtime-types (operatoroverloading.md): the index accessor may be
    // written `get operator[]` or `set operator[]`, the pair that makes a read
    // dispatch and a write dispatch to different declarations.
    if ((this.test('get') || this.test('set')) && this.testAhead('operator')) {
      const checkpoint = this.getLexerCheckpoint();
      this.next();
      const ahead = this.peekAhead();
      const result = this.test('operator') && this.tokenStartsOperatorTail(ahead.type, ahead.hadLineTerminatorBefore);
      this.restoreLexerCheckpoint(checkpoint);
      return result;
    }
    if (this.test('static') && this.testAhead('operator')) {
      // `static operator = 1` is a static field named `operator`; look past
      // `static` to decide.
      const checkpoint = this.getLexerCheckpoint();
      this.next();
      const ahead = this.peekAhead();
      const result = this.test('operator') && this.tokenStartsOperatorTail(ahead.type, ahead.hadLineTerminatorBefore);
      this.restoreLexerCheckpoint(checkpoint);
      return result;
    }
    return false;
  }

  private classElementStartsAbstractMethod(): boolean {
    if (!this.test('abstract')) {
      return false;
    }
    const ahead = this.peekAhead();
    if (ahead.hadLineTerminatorBefore) {
      return false;
    }
    return this.tokenIsPropertyName(ahead.type) || ahead.type === Token.LBRACK || ahead.type === Token.PRIVATE_IDENTIFIER;
  }

  // ClassElement :
  //   `abstract` ClassElementName `(` UniqueFormalParameters `)` TypeAnnotation? `;`
  /**
   * PLAN-signature-listings.md phase 2. Shared by both spellings of an abstract
   * member, so `abstract m(): T;` and `m(): T;` fail identically in a class that
   * is not declared `abstract` - with the rule named, rather than with a caret
   * on a token.
   */
  /** Is this the constructor? It reaches the MethodDefinition branch like any other member. */
  private classElementNameIsConstructor(name: ParseNode.ClassElementName | null | undefined): boolean {
    if (!name) {
      return false;
    }
    return (name.type === 'IdentifierName' && name.name === 'constructor')
      || (name.type === 'StringLiteral' && name.value === 'constructor');
  }

  private requireAbstractClass(): void {
    if (!this.currentClassModifiers || !this.currentClassModifiers.includes('abstract')) {
      this.raise(Throw.SyntaxError('An abstract method requires an abstract class'));
    }
  }

  private parseAbstractMethodDefinition(): ParseNode.AbstractMethodDefinition {
    const node = this.startNode<ParseNode.AbstractMethodDefinition>();
    this.requireAbstractClass();
    this.expect('abstract');
    node.static = false;
    node.ClassElementName = this.parseClassElementName();
    this.scope.with({
      lexical: true, variable: true, superProperty: true, newTarget: true, await: false, yield: false,
    }, () => {
      this.scope.arrowInfoStack.push(null);
      node.UniqueFormalParameters = this.parseUniqueFormalParameters();
      this.scope.arrowInfoStack.pop();
    });
    node.TypeAnnotation = surroundingAgent.feature('runtime-types') && this.test(Token.COLON) ? this.parseTypeAnnotation(true) : null;
    this.semicolon();
    return this.finishNode(node, 'AbstractMethodDefinition');
  }

  parseClassExpression(): ParseNode.ClassExpression {
    return this.parseClass(null, true) as ParseNode.ClassExpression;
  }

  /** Where the template literal most recently parsed closed. See the backtick case. */
  protected lastTemplateEndIndex = 0;

  parseTemplateLiteral(tagged = false): ParseNode.TemplateLiteral {
    // A template is several tokens to the lexer and ONE to a macro, and its
    // parts are scanned under the parser's direction rather than through
    // `next()` - so the log is corrected once the literal is complete, as it is
    // for a regular expression. Without it `` `a${x}b` `` reached a macro as a
    // backtick, the identifier `a$` - a token that exists in no source - a
    // GROUP for the substitution, and a backtick.
    const templateLogFrom = this.tokenLog.length;
    const templateStart = this.peek().startIndex;
    const literal = this.parseTemplateLiteralInner(tagged);
    // The end is the LAST TOKEN the literal consumed, not `this.position` and
    // not the node's location. The scan position has already looked ahead past
    // the literal, so it covers the token after it; the node's end is set from
    // whatever token was current when it finished, which for a template is a
    // part rather than the whole. `currentToken` is the closing part.
    this.collapseLogFrom(templateLogFrom, 'template', templateStart, this.lastTemplateEndIndex);
    return literal;
  }

  private parseTemplateLiteralInner(tagged = false): ParseNode.TemplateLiteral {
    const node = this.startNode<ParseNode.TemplateLiteral>();
    const TemplateSpanList: string[] = [];
    const ExpressionList: ParseNode.Expression[] = [];
    let buffer = '';
    while (true) {
      if (this.position >= this.source.length) {
        this.raise(Throw.SyntaxError('Unterminated template literal'), this.position);
      }
      const c = this.source[this.position];
      switch (c) {
        case '`':
          this.position += 1;
          // The literal ends HERE, at the closing backtick, and this is the only
          // moment at which that is knowable: the parts are scanned by advancing
          // `position` directly rather than through `next()`, so afterwards the
          // scan position has moved on to the following token, and neither the
          // node's location nor `currentToken` marks the close.
          this.lastTemplateEndIndex = this.position;
          TemplateSpanList.push(buffer);
          this.next();
          if (!tagged) {
            TemplateSpanList.forEach((s) => {
              if (TV(s) === undefined) {
                this.raise(Throw.SyntaxError('Invalid template escape'), this.position);
              }
            });
          }
          node.TemplateSpanList = TemplateSpanList;
          node.ExpressionList = ExpressionList;
          return this.finishNode(node, 'TemplateLiteral');
        case '$':
          this.position += 1;
          if (this.source[this.position] === '{') {
            this.position += 1;
            TemplateSpanList.push(buffer);
            buffer = '';
            this.next();
            ExpressionList.push(this.parseExpression());
            break;
          }
          buffer += c;
          break;
        default: {
          if (c === '\\') {
            buffer += c;
            this.position += 1;
          }
          const l = this.source[this.position];
          this.position += 1;
          if (isLineTerminator(l)) {
            if (l === '\r' && this.source[this.position] === '\n') {
              this.position += 1;
            }
            if (l === '\u{2028}' || l === '\u{2029}') {
              buffer += l;
            } else {
              buffer += '\n';
            }
            this.line += 1;
            this.columnOffset = this.position;
          } else {
            buffer += l;
          }
          break;
        }
      }
    }
  }

  // RegularExpressionLiteral :
  //   `/` RegularExpressionBody `/` RegularExpressionFlags
  parseRegularExpressionLiteral(): ParseNode.RegularExpressionLiteral {
    const node = this.startNode<ParseNode.RegularExpressionLiteral>();
    // The `/` was already logged as a punctuator by the peek that got here, and
    // the body and flags are scanned outside `next()` - so the log is corrected
    // once the literal is complete. This is the parse resolving the goal symbol,
    // which is the only place it CAN be resolved.
    const logFrom = this.tokenLog.length;
    this.scanRegularExpressionBody();
    const body = this.scannedValue as string; // NOTE: unsound cast
    node.RegularExpressionBody = body;
    const flagPosition = this.position;
    this.scanRegularExpressionFlags();
    node.RegularExpressionFlags = this.scannedValue as string; // NOTE: unsound cast
    if (node.RegularExpressionFlags.includes('v') && node.RegularExpressionFlags.includes('u')) {
      this.raise(Throw.SyntaxError('u and v cannot be used together'), flagPosition);
    }
    this.collapseLogFrom(logFrom, 'regexp', node.location.startIndex, this.position);
    const parse = (flags: RegExpParserContext) => {
      const p = new RegExpParser(body, (error, position) => {
        this.decorateSyntaxError(error, node.location.startIndex + position + 1);
      });
      return p.scope(flags, () => p.parsePattern());
    };
    if (node.RegularExpressionFlags.includes('u')) {
      parse({ UnicodeMode: true, NamedCaptureGroups: true });
    } else if (node.RegularExpressionFlags.includes('v')) {
      parse({ UnicodeMode: true, UnicodeSetsMode: true, NamedCaptureGroups: true });
    } else {
      // NOTE: this part is modified by Annex B (but we're not applying it for now)
      //       NamedCaptureGroups: false breaks for RegExp /\k<a>(?<a>b)/
      parse({ NamedCaptureGroups: true });
    }
    const fakeToken = {
      endIndex: this.position - 1,
      line: this.line - 1,
      column: this.position - this.columnOffset,
    } as TokenData; // NOTE: unsound cast
    this.next();
    this.currentToken = fakeToken;
    return this.finishNode(node, 'RegularExpressionLiteral');
  }

  // CoverParenthesizedExpressionAndArrowParameterList :
  //   `(` Expression `)`
  //   `(` Expression `,` `)`
  //   `(` `)`
  //   `(` `...` BindingIdentifier `)`
  //   `(` `...` BindingPattern `)`
  //   `(` Expression `,` `...` BindingIdentifier `)`
  //   `(` Expression `.` `...` BindingPattern `)`
  // proposal-runtime-types: inside the parenthesized cover an identifier
  // directly followed by `:`, or by the adjacent pair `?` `:`, is an annotated
  // arrow parameter, which makes the cover arrow-only. Anything else restores
  // the checkpoint, so `(a ? b : c)` parses as a conditional exactly as today.
  private tryParseAnnotatedArrowParameter(): ParseNode.SingleNameBinding | null {
    const savedEarlyErrors = new Set(this.earlyErrors);
    const checkpoint = this.getLexerCheckpoint();
    const node = this.startNode<ParseNode.SingleNameBinding>();
    const BindingIdentifier = this.parseBindingIdentifier();
    let Optional = false;
    if (this.eat(Token.CONDITIONAL)) {
      if (!this.test(Token.COLON)) {
        this.restoreLexerCheckpoint(checkpoint);
        this.earlyErrors = savedEarlyErrors;
        return null;
      }
      Optional = true;
    } else if (!this.test(Token.COLON)) {
      this.restoreLexerCheckpoint(checkpoint);
      this.earlyErrors = savedEarlyErrors;
      return null;
    }
    node.BindingIdentifier = BindingIdentifier;
    node.Optional = Optional;
    node.TypeAnnotation = this.parseTypeAnnotation();
    node.Initializer = this.eat(Token.ASSIGN) ? this.parseAssignmentExpression() : null;
    return this.finishNode(node, 'SingleNameBinding');
  }

  parseCoverParenthesizedExpressionAndArrowParameterList(): ParseNode.CoverParenthesizedExpressionAndArrowParameterList | ParseNode.ParenthesizedExpression {
    const node = this.startNode<ParseNode.CoverParenthesizedExpressionAndArrowParameterList | ParseNode.ParenthesizedExpression>();
    const commaOp = this.startNode<ParseNode.CommaOperator>();
    this.expect(Token.LPAREN);
    if (this.test(Token.RPAREN)) {
      const aheadStartsAnnotation = surroundingAgent.feature('runtime-types')
        && this.conditionalConsequentDepth === 0
        && this.testAhead(Token.COLON);
      if ((!this.testAhead(Token.ARROW) || this.peekAhead().hadLineTerminatorBefore) && !aheadStartsAnnotation) {
        this.unexpected();
      }
      this.next();
      const emptyCoverAnnotation = this.test(Token.ARROW) ? null : this.tryParseArrowReturnTypeAnnotation();
      if (!this.test(Token.ARROW)) {
        this.unexpected();
      }
      if (emptyCoverAnnotation) {
        node.TypeAnnotation = emptyCoverAnnotation;
      }
      node.Arguments = [];
      return this.finishNode(node, 'CoverParenthesizedExpressionAndArrowParameterList');
    }

    this.scope.pushArrowInfo();
    this.scope.pushAssignmentInfo('arrow');

    const expressions: (ParseNode.ArgumentListElement | ParseNode.BindingRestElement | ParseNode.SingleNameBinding)[] = [];
    let arrowOnly = false;
    let rparenAfterComma;
    while (true) {
      if (this.test(Token.ELLIPSIS)) {
        const inner = this.startNode<ParseNode.BindingRestElement>();
        this.next();
        switch (this.peek().type) {
          case Token.LBRACE:
          case Token.LBRACK:
            inner.BindingPattern = this.parseBindingPattern();
            break;
          default:
            inner.BindingIdentifier = this.parseBindingIdentifier();
            break;
        }
        // proposal-runtime-types, PLAN-rest-parameters.md phase 1: an arrow's
        // parameters come through this cover, so a typed rest is read here.
        // Without it `(...a: [].<uint32>) => a` never parsed at ANY position,
        // which is a gap that predates multiple rests.
        if (surroundingAgent.feature('runtime-types') && this.test(Token.COLON)) {
          inner.TypeAnnotation = this.parseTypeAnnotation();
        }
        expressions.push(this.finishNode(inner, 'BindingRestElement'));
        // A rest is an ordinary element of the list under the feature: it may be
        // followed by further parameters and there may be several. With the
        // feature off the base language's rule stands - a rest ends the list.
        if (!surroundingAgent.feature('runtime-types')) {
          this.expect(Token.RPAREN);
          break;
        }
        arrowOnly = true;
        if (this.eat(Token.COMMA)) {
          if (this.eat(Token.RPAREN)) {
            rparenAfterComma = this.currentToken;
            break;
          }
          continue;
        }
        this.expect(Token.RPAREN);
        break;
      }
      let annotatedParameter: ParseNode.SingleNameBinding | null = null;
      // proposal-runtime-types #sec-reference-syntax: `(ref a) => {}` - a ref
      // parameter inside the parenthesized cover, which is how the design's
      // `zip(a, b, (ref x, ref y) => { ... })` callbacks are written. The
      // claim is the one every ref site uses, a name on the same line; it
      // makes the cover arrow-only, which is additive because `(ref a` has no
      // expression reading. `(ref)` and `(ref, x)` keep the identifier.
      if (surroundingAgent.feature('runtime-types')
          && this.test('ref')
          && (this.peekAhead().type === Token.IDENTIFIER
            || this.peekAhead().type === Token.YIELD
            || this.peekAhead().type === Token.AWAIT)
          && !this.peekAhead().hadLineTerminatorBefore) {
        this.next();
        const refParameter = this.startNode<ParseNode.SingleNameBinding>();
        refParameter.BindingIdentifier = this.parseBindingIdentifier();
        if (this.eat(Token.CONDITIONAL)) {
          refParameter.Optional = true;
        }
        if (this.test(Token.COLON)) {
          refParameter.TypeAnnotation = this.parseTypeAnnotation();
        }
        // A ref parameter may not carry a default, as in a declared list.
        if (this.test(Token.ASSIGN)) {
          this.addEarlyError(Throw.SyntaxError('A ref parameter may not have a default value'), this.peek());
          this.next();
          this.parseAssignmentExpression();
        }
        refParameter.Initializer = null;
        refParameter.Ref = true;
        annotatedParameter = this.finishNode(refParameter, 'SingleNameBinding');
      } else if (surroundingAgent.feature('runtime-types')
          && this.test(Token.IDENTIFIER)
          && (this.testAhead(Token.COLON) || this.testAhead(Token.CONDITIONAL))) {
        annotatedParameter = this.tryParseAnnotatedArrowParameter();
      }
      if (annotatedParameter) {
        arrowOnly = true;
        expressions.push(annotatedParameter);
      } else {
        expressions.push(this.withConditionalAnnotationsAllowed(() => this.parseAssignmentExpression()));
      }
      if (this.eat(Token.COMMA)) {
        if (this.eat(Token.RPAREN)) {
          rparenAfterComma = this.currentToken;
          break;
        }
      } else {
        this.expect(Token.RPAREN);
        break;
      }
    }

    const arrowInfo = this.scope.popArrowInfo();
    const assignmentInfo = this.scope.popAssignmentInfo();

    // ArrowParameters :
    //   CoverParenthesizedExpressionAndArrowParameterList
    // proposal-runtime-types: ArrowFunction : ArrowParameters TypeAnnotation? [no LT] `=>`
    const TypeAnnotation = this.test(Token.ARROW) ? null : this.tryParseArrowReturnTypeAnnotation();
    if (this.test(Token.ARROW) && !this.peek().hadLineTerminatorBefore) {
      node.Arguments = expressions;
      node.arrowInfo = arrowInfo;
      if (TypeAnnotation) {
        node.TypeAnnotation = TypeAnnotation;
      }
      assignmentInfo.clear();
      return this.finishNode(node, 'CoverParenthesizedExpressionAndArrowParameterList');
    } else {
      if (arrowOnly) {
        this.unexpected();
      }
      this.scope.arrowInfo?.merge(arrowInfo);
    }

    // ParenthesizedExpression :
    //   `(` Expression `)`
    if (expressions[expressions.length - 1].type === 'BindingRestElement') {
      this.unexpected(expressions[expressions.length - 1]);
    }
    if (rparenAfterComma) {
      this.unexpected(rparenAfterComma);
    }
    if (expressions.length === 1) {
      node.Expression = expressions[0] as ParseNode.Expression; // NOTE: unsound cast due to potential BindingRestElement
    } else {
      commaOp.ExpressionList = expressions as ParseNode.AssignmentExpressionOrHigher[]; // NOTE: unsound cast
      node.Expression = this.finishNode(commaOp, 'CommaOperator');
    }
    return this.finishNode(node, 'ParenthesizedExpression');
  }

  // PropertyName :
  //   LiteralPropertyName
  //   ComputedPropertyName
  // LiteralPropertyName :
  //   IdentifierName
  //   StringLiteral
  //   NumericLiteral
  // ComputedPropertyName :
  //   `[` AssignmentExpression `]`
  parsePropertyName(): ParseNode.PropertyNameLike {
    if (this.test(Token.LBRACK)) {
      const node = this.startNode<ParseNode.PropertyName>();
      this.next();
      node.ComputedPropertyName = this.parseAssignmentExpression();
      this.expect(Token.RBRACK);
      return this.finishNode(node, 'PropertyName');
    }
    if (this.test(Token.STRING)) {
      return this.parseStringLiteral();
    }
    if (this.test(Token.NUMBER) || this.test(Token.BIGINT)) {
      return this.parseNumericLiteral();
    }
    return this.parseIdentifierName();
  }

  private tokenIsPropertyName(token: Token): boolean {
    switch (token) {
      case Token.IDENTIFIER:
      case Token.YIELD:
      case Token.AWAIT:
      case Token.STRING:
      case Token.NUMBER:
      case Token.BIGINT:
      case Token.LBRACK:
      case Token.PRIVATE_IDENTIFIER:
        return true;
      default:
        return isKeyword(token);
    }
  }

  // ClassElementName :
  //   PropertyName
  //   PrivateIdentifier
  parseClassElementName(): ParseNode.ClassElementName {
    if (this.test(Token.PRIVATE_IDENTIFIER)) {
      return this.parsePrivateIdentifier();
    }
    return this.parsePropertyName();
  }

  // PropertyDefinition :
  //   IdentifierReference
  //   CoverInitializedName
  //   PropertyName `:` AssignmentExpression
  //   MethodDefinition
  //   `...` AssignmentExpression
  // MethodDefinition :
  //   ClassElementName `(` UniqueFormalParameters `)` `{` FunctionBody `}`
  //   GeneratorMethod
  //   AsyncMethod
  //   AsyncGeneratorMethod
  //   `get` ClassElementName `(` `)` `{` FunctionBody `}`
  //   `set` ClassElementName `(` PropertySetParameterList `)` `{` FunctionBody `}`
  // GeneratorMethod :
  //   `*` ClassElementName `(` UniqueFormalParameters `)` `{` GeneratorBody `}`
  // AsyncMethod :
  //   `async` [no LineTerminator here] ClassElementName `(` UniqueFormalParameters `)` `{` AsyncBody `}`
  // AsyncGeneratorMethod :
  //   `async` [no LineTerminator here] `*` ClassElementName `(` UniqueFormalParameters `)` `{` AsyncGeneratorBody `}`
  parseBracketedDefinition(type: 'class element'): ParseNode.ClassElement;

  parseBracketedDefinition(type: 'property'): ParseNode.PropertyDefinitionLike;

  parseBracketedDefinition(type: 'property' | 'class element'): ParseNode.PropertyDefinitionLike | ParseNode.ClassElement;

  parseBracketedDefinition(type: 'property' | 'class element'): ParseNode.PropertyDefinitionLike | ParseNode.ClassElement {
    const node = this.startNode<ParseNode.PropertyDefinitionLike | ParseNode.ClassElement>();

    if (type === 'property' && this.eat(Token.ELLIPSIS)) {
      node.PropertyName = null;
      node.AssignmentExpression = this.parseAssignmentExpression();
      return this.finishNode(node, 'PropertyDefinition');
    }

    // proposal-runtime-types (spec, object types): an object literal may declare a
    // typed own property at creation, `{ (a: uint8): 1 }`, giving the property a
    // declared type the same way Object.defineProperty's `type` key does. A
    // property definition cannot otherwise begin with `(`, so the form is
    // unambiguous, and it is claimed only under the feature.
    if (type === 'property'
        && this.feature('runtime-types')
        && this.test(Token.LPAREN)) {
      this.expect(Token.LPAREN);
      node.PropertyName = this.parsePropertyName();
      node.TypeAnnotation = this.parseTypeAnnotation();
      this.expect(Token.RPAREN);
      this.expect(Token.COLON);
      node.AssignmentExpression = this.parseAssignmentExpression();
      return this.finishNode(node, 'PropertyDefinition');
    }

    let staticOrAccessorButNotKeyword;
    let isAccessorField = false;
    if (type === 'class element') {
      node.Decorators = this.parseDecorators();
      const staticId = this.test('static') ? this.parseIdentifierName() : null;
      let isStaticField = true;
      if (staticId && (this.test(Token.ASSIGN)
        || this.test(Token.SEMICOLON)
        || this.peek().hadLineTerminatorBefore
        || isAutomaticSemicolon(this.peek().type))) {
        isStaticField = false;
      }
      node.static = !!staticId && isStaticField;

      if (staticId) {
        if (isStaticField) {
          node.static = true;
        } else {
          node.static = false;
          staticOrAccessorButNotKeyword = staticId;
          this.markNodeStart(node);
        }
      } else node.static = false;

      // proposal-runtime-types (README, protected members): "Like `readonly` and
      // `static` it is a modifier on an ordinary member, in the public layout
      // slot." Parsed exactly as `readonly` is, and BEFORE it, so
      // `protected readonly x` reads in the order the design writes it.
      //
      // `protected` is a FutureReservedWord in strict mode and a class body is
      // always strict, which is why this needs its own test rather than falling
      // out of the identifier path the way `readonly` and `accessor` do - and
      // why a member NAMED `protected` still has to work: the same
      // following-token check that keeps `readonly = 1` a field keeps
      // `protected = 1` one.
      node.protected = false;
      if (!staticOrAccessorButNotKeyword
          && surroundingAgent.feature('runtime-types')
          && this.test('protected')) {
        const protectedId = this.parseIdentifierName();
        if (this.test(Token.ASSIGN)
          || this.test(Token.SEMICOLON)
          || this.peek().hadLineTerminatorBefore
          || isAutomaticSemicolon(this.peek().type)
          || this.test(Token.LPAREN)) {
          staticOrAccessorButNotKeyword = protectedId;
          this.markNodeStart(node);
        } else {
          node.protected = true;
        }
      }

      // proposal-runtime-types: a `readonly` field modifier, permitted after
      // `static` (as `static readonly x`) and before the field name. As with
      // `static`, a following `=`, `;`, or line terminator means `readonly` is
      // itself the field name (`readonly = 1`), not the modifier.
      node.readonly = false;
      if (!staticOrAccessorButNotKeyword
          && surroundingAgent.feature('runtime-types')
          && this.test('readonly')) {
        const readonlyId = this.parseIdentifierName();
        if (this.test(Token.ASSIGN)
          || this.test(Token.SEMICOLON)
          || this.peek().hadLineTerminatorBefore
          || isAutomaticSemicolon(this.peek().type)
          || this.test(Token.LPAREN)) {
          // `readonly` is the field/method name, not the modifier.
          staticOrAccessorButNotKeyword = readonlyId;
          this.markNodeStart(node);
        } else {
          node.readonly = true;
        }
      }

      if (!staticOrAccessorButNotKeyword) {
        // TWO PROPOSALS PUT AN `accessor` FIELD HERE, and this engine must never
        // reach TC39's semantics from this one: `decorators` and
        // `runtime-types` are mutually exclusive and the Agent refuses the
        // combination. What is shared below is ONLY THE DISAMBIGUATION, which is
        // pure syntax and identical in both - `accessor` is not a reserved word,
        // so it is the modifier only when a property name follows on the SAME
        // LINE, and otherwise it is the member's own name (`accessor = 1`).
        //
        // Testing both features here does not enable either, and every SEMANTIC
        // path stays forked: ClassElementEvaluation's FieldDefinition arm
        // branches on `feature('decorators')` and the runtime-types accessor is
        // built entirely on `[[Fields]]`. Writing the lookahead twice was the
        // alternative and is worse - a rule written twice drifts, and this one
        // is subtle enough that the copy would drift silently.
        const accessorAllowed = surroundingAgent.feature('decorators') || surroundingAgent.feature('runtime-types');
        const accessor = accessorAllowed && this.test('accessor') ? this.parseIdentifierName() : null;
        const next = this.peek();
        if (accessor && !next.hadLineTerminatorBefore && this.tokenIsPropertyName(next.type)) {
          isAccessorField = true;
        } else isAccessorField = false;

        if (accessor) {
          if (isAccessorField) {
            node.accessor = true;
          } else {
            node.accessor = false;
            staticOrAccessorButNotKeyword = accessor;
            this.markNodeStart(node);
          }
        } else node.accessor = false;
      }
    }

    if (!staticOrAccessorButNotKeyword) {
      this.markNodeStart(node);
    }
    let isGenerator = this.eat(Token.MUL);
    let isGetter = false;
    let isSetter = false;
    let isAsync = false;
    if (!isGenerator && !isAccessorField) {
      if (this.test('get') && this.tokenIsPropertyName(this.peekAhead().type)) {
        isGetter = true;
      } else if (this.test('set') && this.tokenIsPropertyName(this.peekAhead().type)) {
        isSetter = true;
      } else if (this.test('async') && !this.peekAhead().hadLineTerminatorBefore) {
        isAsync = true;
      }
    }

    const firstName = staticOrAccessorButNotKeyword || (type === 'property'
      ? this.parsePropertyName()
      : this.parseClassElementName());

    if (!isGenerator && isAsync) {
      isGenerator = this.eat(Token.MUL);
    }

    const isAsyncShorthandProperty = type === 'property'
      && isAsync
      && firstName.type === 'IdentifierName'
      && firstName.name === 'async'
      && !this.test(Token.LPAREN)
      && (this.test(Token.COMMA)
        || this.test(Token.RBRACE)
        || this.test(Token.COLON)
        || this.test(Token.ASSIGN));
    // proposal-runtime-types #sec-class-operators: an ACCESSOR may not declare
    // type parameters. A getter is never written as a call and takes no
    // arguments, so a parameter it declared could be neither supplied nor
    // inferred; a setter could infer one from the assigned value, but
    // parameterizing one half of a property and not the other would leave the
    // two halves of one construct with different rules. A method serves where a
    // parameterized accessor would, and says which type it is applied to at the
    // site rather than deducing it from a value.
    //
    // Refused HERE rather than left to fall off the grammar, so the diagnostic
    // names the rule instead of reporting an unexpected token - the reading
    // that cost a full investigation when a generic METHOD, which is a real
    // gap, was mistaken for a limitation of the call syntax.
    /** PLAN-signature-listings.md phase 2: set where the member has no body. */
    let isAbstractMember = false;
    const isSpecialMethod = isGenerator
      || ((isSetter || isGetter || isAsync) && !this.test(Token.LPAREN) && !isAsyncShorthandProperty);

    if (!isGenerator) {
      if (type === 'property' && this.eat(Token.COLON)) {
        node.PropertyName = firstName as ParseNode.PropertyName; // NOTE: unsound cast
        node.AssignmentExpression = this.parseAssignmentExpression();
        return this.finishNode(node, 'PropertyDefinition');
      }

      if (type === 'class element' && (
        this.test(Token.ASSIGN)
        || this.test(Token.SEMICOLON)
        || this.peek().hadLineTerminatorBefore
        || isAutomaticSemicolon(this.peek().type)
        || (surroundingAgent.feature('runtime-types') && this.test(Token.COLON))
      )) {
        node.accessor = isAccessorField;
        node.ClassElementName = firstName;
        // FieldDefinition : ClassElementName TypeAnnotation? Initializer?
        if (surroundingAgent.feature('runtime-types') && this.test(Token.COLON)) {
          (node as ParseNode.Unfinished<ParseNode.FieldDefinition>).TypeAnnotation = this.parseTypeAnnotation();
        }
        node.Initializer = this.scope.with({ superProperty: true, await: false, yield: false }, () => this.parseInitializerOpt());
        const argumentNode = node.Initializer && ContainsArguments(node.Initializer);
        if (argumentNode) {
          this.addEarlyError(Throw.SyntaxError('Invalid use of arguments'), argumentNode);
        }
        const finished = this.finishNode(node, 'FieldDefinition');
        this.semicolon();
        return finished;
      }

      if (type === 'property' && this.scope.assignmentInfoStack.length > 0 && this.test(Token.ASSIGN)) {
        // NOTE: The next line is unsafe because firstName could be something other than IdentifierName
        node.IdentifierReference = this.repurpose(firstName, 'IdentifierReference');
        node.Initializer = this.parseInitializerOpt();
        const finished = this.finishNode(node, 'CoverInitializedName');
        this.scope.registerObjectLiteralEarlyError(this.addEarlyError(Throw.SyntaxError('Invalid assignment target'), finished));
        return finished;
      }

      if (type === 'property'
          && !isSpecialMethod
          && firstName.type === 'IdentifierName'
          && !this.test(Token.LPAREN)
          // proposal-runtime-types #sec-generics: `{ m<T>() { } }` is a METHOD
          // that declares type parameters, not the shorthand `{ m }`. A
          // shorthand is followed by `,` or `}`, so a `<` here can only begin
          // the parameter list - without this the name was taken as a
          // shorthand and the `<` reported as unexpected.
          && !(surroundingAgent.feature('runtime-types') && this.test(Token.LT))
          && (!isKeywordRaw(firstName.name)
            || (firstName.name === 'yield' && !this.scope.hasYield())
            || (firstName.name === 'await' && !this.scope.hasAwait()))) {
        const IdentifierReference = this.repurpose(firstName, 'IdentifierReference');
        this.validateIdentifierReference(firstName.name, firstName);
        return IdentifierReference;
      }
    }

    if (isSpecialMethod && (!isGenerator || isAsync)) {
      if (type === 'property') {
        node.ClassElementName = this.parsePropertyName();
      } else {
        node.ClassElementName = this.parseClassElementName();
      }
    } else {
      node.ClassElementName = firstName;
    }

    this.scope.with({
      lexical: true,
      variable: true,
      superProperty: true,
      newTarget: true,
      await: isAsync,
      yield: isGenerator,
      classStaticBlock: false,
    }, () => {
      if (isSpecialMethod && (isGetter || isSetter) && this.test(Token.LT)) {
        this.addEarlyError(Throw.SyntaxError('an accessor may not declare type parameters; use a method'), this.peek());
        this.parseTypeParameters();
      }
      if (isSpecialMethod && isGetter) {
        this.expect(Token.LPAREN);
        this.expect(Token.RPAREN);
        node.PropertySetParameterList = null;
        node.UniqueFormalParameters = null;
      } else if (isSpecialMethod && isSetter) {
        this.expect(Token.LPAREN);
        node.PropertySetParameterList = [this.parseFormalParameter()];
        this.expect(Token.RPAREN);
        node.UniqueFormalParameters = null;
      } else {
        // proposal-runtime-types #sec-generics: a METHOD may declare type
        // parameters, `emit<T>(event: T)`, which generics.md writes as the
        // illustration of a type parameter used as a value. They are parsed
        // before the formal parameter list, as a function declaration's are,
        // and applied with `.<...>` at the call or inferred from its arguments.
        //
        // `<` here can only begin type parameters: a method name is never
        // followed by a relational operator in this position.
        if (surroundingAgent.feature('runtime-types') && this.test(Token.LT)) {
          (node as ParseNode.Unfinished<ParseNode.MethodDefinition | ParseNode.AsyncMethod | ParseNode.GeneratorMethod | ParseNode.AsyncGeneratorMethod>).TypeParameters = this.parseTypeParameters();
        }
        node.PropertySetParameterList = null;
        node.UniqueFormalParameters = this.parseUniqueFormalParameters();
      }

      // proposal-runtime-types: MethodDefinition return TypeAnnotation; setters
      // and class constructors excluded.
      //
      // PLAN-constructor-returns.md phase 1 (OQ1-E). A constructor has no
      // return annotation POSITION. #sec-typed-classes: "A constructor declares
      // no return type, since the class is the type a construction yields", and
      // #sec-annotations-on-the-remaining-function-forms calls it "the one
      // method that takes no return annotation". Three clauses IMPLIED the rule
      // and none stated it as an early error, which is the room the engine's
      // over-permission grew in (F121): the annotation parsed, the BODY was
      // checked against it - a rule no clause contains - and the construction
      // site then ignored it, so `let x: C = new C()` succeeded while
      // `let x: Foo = new C()` failed. An annotation enforced in one place and
      // discarded in another teaches a rule that is not true.
      //
      // Refused HERE, beside the setter exclusion, because it is the same rule
      // for the same reason: a form whose result is fixed by what it IS has
      // nothing to declare. Scoped to a CLASS constructor - an object literal's
      // `{ constructor() {} }` is an ordinary method and keeps its annotation,
      // which `type === 'class element'` distinguishes.
      const isClassConstructor = type === 'class element'
        && !isSpecialMethod
        && !(node as { static?: boolean }).static
        && this.classElementNameIsConstructor((node as { ClassElementName?: ParseNode.ClassElementName }).ClassElementName);
      if (surroundingAgent.feature('runtime-types') && isClassConstructor && this.test(Token.COLON)) {
        this.addEarlyError(
          Throw.SyntaxError('A constructor declares no return type; the class is the type a construction yields'),
          this.peek(),
        );
        // Parsed and discarded, so the rest of the class still parses and the
        // reader gets THIS diagnostic rather than a cascade from the `:`.
        this.parseTypeAnnotation(true);
      }
      if (surroundingAgent.feature('runtime-types') && !isSetter && !isClassConstructor && this.test(Token.COLON)) {
        (node as ParseNode.Unfinished<ParseNode.MethodDefinition | ParseNode.AsyncMethod | ParseNode.GeneratorMethod | ParseNode.AsyncGeneratorMethod>).TypeAnnotation = this.parseTypeAnnotation(true);
      }

      // PLAN-where-on-methods.md D2. #sec-type-annotations, as amended: a method
      // takes |WhereClauses| the same way a function declaration does, between
      // the return annotation and the body. The rule needs no restatement -
      // "checked at each specialization once its parameters are bound" - because
      // a generic method specializes as a generic function does.
      //
      // A method's clause may name the parameters of its CLASS as well as its
      // own; both are bound at the specialization the clause is checked at.
      if (surroundingAgent.feature('runtime-types') && this.test('where')) {
        (node as ParseNode.Unfinished<ParseNode.MethodDefinition> & { WhereClauses?: ParseNode.WhereClause[] })
          .WhereClauses = this.parseWhereClauses();
      }

      // PLAN-signature-listings.md phase 2. #sec-abstract-classes: "A member is
      // abstract because it has no body; the `abstract` keyword before it is
      // optional and says the same thing earlier." A `;` here rather than a `{`
      // is that absence, so the member is the abstract one and there is no body
      // to parse.
      //
      // Everything shares this function, which is what makes the change small
      // and the exclusions load-bearing: `get`/`set` reach it and ARE abstract
      // members - an accessor has an override site and its annotation types the
      // implementations. `static`, a constructor, and the async and generator
      // forms reach it too and are NOT: they have nothing for an implementation
      // to supply, so they keep needing a body and say so by their own rules.
      if (surroundingAgent.feature('runtime-types')
          && this.test(Token.SEMICOLON)
          && !node.static
          && !isAsync
          && !isGenerator
          && !this.classElementNameIsConstructor(node.ClassElementName)) {
        this.requireAbstractClass();
        this.semicolon();
        isAbstractMember = true;
      } else if (surroundingAgent.feature('runtime-types') && this.test(Token.SEMICOLON)) {
        // The excluded forms reach here with the same `;` and must say WHY they
        // are not abstract members, or the reader gets `Unexpected token` on a
        // semicolon and learns nothing - which is the diagnostic this whole
        // change exists to remove.
        const which = node.static
          ? 'a static member'
          : isAsync
            ? (isGenerator ? 'an async generator method' : 'an async method')
            : isGenerator
              ? 'a generator method'
              : 'a constructor';
        this.raise(Throw.SyntaxError('$1 cannot be abstract, so it requires a body', Value(which)));
      }

      if (isAbstractMember) {
        return;
      }
      this.scope.with({
        superCall: !isSpecialMethod
                   && !node.static
                   && node.ClassElementName
                   && ((node.ClassElementName.type === 'IdentifierName' && node.ClassElementName.name === 'constructor')
                    || (node.ClassElementName.type === 'StringLiteral' && node.ClassElementName.value === 'constructor'))
                   && this.scope.hasSuperCall(),
      }, () => {
        // PLAN-constructor-returns.md phase 1 (OQ1-E): ask `parseFunctionBody`
        // to collect this constructor's own `return <expr>` statements. The
        // collector is scoped there, not here, so nesting is handled once - see
        // the note at `parseFunctionBody`.
        this.nextBodyIsConstructor = isClassConstructor;
        const body = this.parseFunctionBody(isAsync, isGenerator, false);
        if (isClassConstructor) {
          (node as { ConstructorReturns?: readonly ParseNode.ReturnStatement[] })
            .ConstructorReturns = this.lastConstructorReturns ?? [];
        }
        // Unsafe cast below
        if (!isAsync && !isGenerator) {
          (node as ParseNode.Unfinished<ParseNode.MethodDefinition>).FunctionBody = body as ParseNode.FunctionBody;
        } else if (isAsync && !isGenerator) {
          (node as ParseNode.Unfinished<ParseNode.AsyncMethod>).AsyncBody = body as ParseNode.AsyncBody;
        } else if (!isAsync && isGenerator) {
          (node as ParseNode.Unfinished<ParseNode.GeneratorMethod>).GeneratorBody = body as ParseNode.GeneratorBody;
        } else if (isAsync && isGenerator) {
          (node as ParseNode.Unfinished<ParseNode.AsyncGeneratorMethod>).AsyncGeneratorBody = body as ParseNode.AsyncGeneratorBody;
        }
        if (node.UniqueFormalParameters || node.PropertySetParameterList) {
          this.validateFormalParameters(node.UniqueFormalParameters || node.PropertySetParameterList!, body, true);
        }
      });
    });

    if (isAbstractMember) {
      const abstractNode = node as unknown as ParseNode.Unfinished<ParseNode.AbstractMethodDefinition>;
      abstractNode.static = false;
      // PLAN-abstract-implementation.md phase 2a: which accessor form, where it
      // is one. Both finish as this node type by design; the member registry is
      // kind-filtered, so an abstract getter recorded as a method would be
      // invisible to the walk that looks for getters.
      abstractNode.Accessor = isGetter ? 'get' : isSetter ? 'set' : undefined;
      return this.finishNode(abstractNode, 'AbstractMethodDefinition') as unknown as ParseNode.MethodDefinitionLike;
    }

    let name: ParseNode.MethodDefinitionLike['type'];
    if (isAsync) {
      name = isGenerator ? 'AsyncGeneratorMethod' : 'AsyncMethod';
    } else {
      name = isGenerator ? 'GeneratorMethod' : 'MethodDefinition';
    }
    return this.finishNode(node, name);
  }

  parseDecorators(): ParseNode.Decorator[] | null {
    // Either decorator proposal supplies the grammar; see the Lexer.
    if (!surroundingAgent.feature('decorators') && !surroundingAgent.feature('runtime-types')) {
      return null;
    }
    const Decorators: ParseNode.Decorator[] = [];
    while (true) {
      const decorator = this.parseDecorator();
      if (!decorator) {
        return Decorators.length ? Decorators : null;
      }
      Decorators.push(decorator);
    }
  }

  parseDecorator(): ParseNode.Decorator | undefined {
    if (!this.eat(Token.AT)) {
      return undefined;
    }
    // @ DecoratorParenthesizedExpression : `(` Expression[+In] `)`
    if (this.eat(Token.LPAREN)) {
      const node = this.startNode<ParseNode.Decorator_ParenthesizedExpression>();
      node.subtype = 'ParenthesizedExpression';
      node.ParenthesizedExpression = this.scope.with({ in: true }, () => this.parseExpression());
      this.expect(Token.RPAREN);
      return this.finishNode(node, 'Decorator');
    }

    let result: ParseNode.MemberExpression | ParseNode.IdentifierReference = this.parseIdentifierReference();

    let next = this.peek().type;
    while (next === Token.PERIOD || next === Token.LPAREN) {
      let finished: ParseNode.MemberExpression | ParseNode.CallExpression;
      if (next === Token.PERIOD) {
        const node = this.startNode<ParseNode.MemberExpression>(result);
        this.next();
        node.MemberExpression = result;
        if (this.test(Token.PRIVATE_IDENTIFIER)) {
          node.PrivateIdentifier = this.parsePrivateIdentifier();
          this.scope.checkUndefinedPrivate(node.PrivateIdentifier);
          node.IdentifierName = null;
        } else {
          node.IdentifierName = this.parseIdentifierName();
          node.PrivateIdentifier = null;
        }
        node.Expression = null;
        finished = this.finishNode(node, 'MemberExpression');
      } else if (next === Token.LPAREN) {
        const node = this.startNode<ParseNode.CallExpression>(result);
        const { Arguments } = this.parseArguments();
        node.CallExpression = result;
        node.Arguments = Arguments;
        finished = this.finishNode(node, 'CallExpression');
        const finishedNode = finished;

        const outerNode = this.startNode<ParseNode.Decorator_CallExpression>(finishedNode);
        outerNode.subtype = 'CallExpression';
        outerNode.CallExpression = finishedNode;
        return this.finishNode(outerNode, 'Decorator');
      } else {
        return this.finishNode(this.startNode<ParseNode.Decorator_MemberExpression>(result), 'Decorator');
      }
      // NOTE: unwinds ParseNode.Finish type alias to avoid circularity issues in type checker
      result = finished as ParseNode.MemberExpression;
      next = this.peek().type;
    }
    const outerNode = this.startNode<ParseNode.Decorator_MemberExpression>(result);
    outerNode.subtype = 'MemberExpression';
    outerNode.MemberExpression = result;
    return this.finishNode(outerNode, 'Decorator');
  }
}
