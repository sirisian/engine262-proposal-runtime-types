import {
  TV,
  PropName,
  StringValue,
  IsComputedPropertyKey,
  ContainsArguments,
} from '../static-semantics/all.mts';
import type { Mutable } from '../utils/language.mts';
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
import { surroundingAgent, type Feature } from '#self';
import { Throw } from '#self';

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

  protected abstract readonly state: {
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
  parseConditionalExpression(): ParseNode.ConditionalExpressionOrHigher {
    const ShortCircuitExpression = this.parseRangeExpression();
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

  // proposal-runtime-types (ranges.md):
  // RangeExpression :
  //   ShortCircuitExpression? `..` ShortCircuitExpression?
  //   ShortCircuitExpression? `..=` ShortCircuitExpression
  // A range binds tighter than assignment and looser than `||`/`??`, and it is
  // non-associative, so `a..b..c` is a Syntax Error. The end is optional after
  // `..` (the from and full forms) and required after `..=`.
  parseRangeExpression(): ParseNode.RangeExpressionOrHigher {
    if (!this.feature('runtime-types')) {
      return this.parseShortCircuitExpression();
    }
    // The leading-omitted forms `..b`, `..=b`, and `..` begin with the operator.
    if (this.test(Token.DOT_DOT) || this.test(Token.DOT_DOT_EQ)) {
      const node = this.startNode<ParseNode.RangeExpression>();
      return this.finishRangeExpression(node, null);
    }
    const left = this.parseShortCircuitExpression();
    if (this.test(Token.DOT_DOT) || this.test(Token.DOT_DOT_EQ)) {
      const node = this.startNode<ParseNode.RangeExpression>(left);
      return this.finishRangeExpression(node, left);
    }
    return left;
  }

  finishRangeExpression(node: ParseNode.Unfinished<ParseNode.RangeExpression>, start: ParseNode.ShortCircuitExpressionOrHigher | null): ParseNode.RangeExpression {
    const inclusive = this.test(Token.DOT_DOT_EQ);
    this.next(); // consume `..` or `..=`
    node.RangeStart = start;
    node.Inclusive = inclusive;
    if (inclusive) {
      // `..=` always has an end.
      node.RangeEnd = this.parseShortCircuitExpression();
    } else if (this.rangeEndFollows()) {
      node.RangeEnd = this.parseShortCircuitExpression();
    } else {
      node.RangeEnd = null;
    }
    // Non-associative: a second range operator is a Syntax Error.
    if (this.test(Token.DOT_DOT) || this.test(Token.DOT_DOT_EQ)) {
      this.unexpected();
    }
    return this.finishNode(node, 'RangeExpression');
  }

  // A range end is present unless the operator is immediately followed by a token
  // that cannot begin an expression, which is how the from and full forms end.
  rangeEndFollows(): boolean {
    switch (this.peek().type) {
      case Token.RPAREN:
      case Token.RBRACK:
      case Token.RBRACE:
      case Token.SEMICOLON:
      case Token.COMMA:
      case Token.COLON:
      case Token.EOS:
        return false;
      default:
        return true;
    }
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
          node.Type = this.parseType();
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
      // `type(x)` stays a call and `type[x]` a member access, so an operand
      // beginning with `(` or `[` is left to those forms; every other Type-start
      // token is unambiguous after `type` and begins a type operand. Literal
      // types (`type 'a'`, `type true`, `type 42`, `type null`) and object types
      // (`type { x: T }`) are the common forms the corpus uses.
      if (surroundingAgent.feature('runtime-types') && this.test('type') && !this.peekAhead().hadLineTerminatorBefore) {
        switch (this.peekAhead().type) {
          case Token.IDENTIFIER:
          case Token.YIELD:
          case Token.AWAIT:
          case Token.LBRACE:
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
      this.validateAssignmentTarget(node.UnaryExpression);
      return this.finishNode(node, 'UpdateExpression');
    }
    const argument = this.parseLeftHandSideExpression();
    if (!this.peek().hadLineTerminatorBefore) {
      if (this.test(Token.INC) || this.test(Token.DEC)) {
        this.validateAssignmentTarget(argument);
        const node = this.startNode<ParseNode.UpdateExpression>(argument);
        node.operator = this.next().value as ParseNode.UpdateExpression['operator']; // NOTE: unsound cast
        node.LeftHandSideExpression = argument;
        node.UnaryExpression = null;
        return this.finishNode(node, 'UpdateExpression');
      }
    }
    return argument;
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
  parsePrimaryExpression(): ParseNode.PrimaryExpression {
    // proposal-runtime-types: ClassExpression : ClassModifiers? `class` ...
    if (this.testClassModifierRun()) {
      return this.parseClassExpression();
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
          if (this.test(Token.LBRACE)) {
            const literal = this.parseObjectLiteral();
            (literal as { Decorators?: readonly ParseNode.Decorator[] | null }).Decorators = decorators;
            return literal;
          }
          // parseClassExpression takes no decorator list; the class path
          // re-reads them from the token stream, so this only reaches here when
          // the decorators were not followed by an object literal.
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
    if (!this.test(Token.NUMBER) && !this.test(Token.BIGINT)) {
      this.unexpected();
    }
    const token = this.next();
    node.value = token.valueAsNumeric();
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
    return this.parseBracketedDefinition('property');
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
            || this.peekAhead().type === Token.AWAIT)) {
        // proposal-runtime-types (references extension): a `ref` argument
        // passes the operand's storage location rather than its value. `ref` is
        // contextual: `f(ref)` and `f(ref, x)` still pass an identifier named
        // ref, since no operand follows `ref` on the same line.
        const refNode = this.startNode<ParseNode.RefExpression>();
        this.next();
        refNode.Expression = this.parseLeftHandSideExpression();
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
        while (!this.eat(Token.RBRACE)) {
          const m = this.parseClassElement();
          ClassBody.push(m);
          while (this.eat(Token.SEMICOLON)) {
            // nothing
          }
          if (m.type === 'ClassStaticBlock') {
            continue;
          }
          if (m.type === 'OperatorDefinition') {
            // proposal-runtime-types: operators have no ClassElementName and
            // take no part in the name bookkeeping below.
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
        return ClassBody;
      });
    }

    return this.finishNode(node, 'ClassTail');
  }

  parseClassElement(): ParseNode.ClassElement {
    let element;
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
  private parseAbstractMethodDefinition(): ParseNode.AbstractMethodDefinition {
    const node = this.startNode<ParseNode.AbstractMethodDefinition>();
    if (!this.currentClassModifiers || !this.currentClassModifiers.includes('abstract')) {
      this.raise(Throw.SyntaxError('An abstract method requires an abstract class'));
    }
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

  parseTemplateLiteral(tagged = false): ParseNode.TemplateLiteral {
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
    this.scanRegularExpressionBody();
    const body = this.scannedValue as string; // NOTE: unsound cast
    node.RegularExpressionBody = body;
    const flagPosition = this.position;
    this.scanRegularExpressionFlags();
    node.RegularExpressionFlags = this.scannedValue as string; // NOTE: unsound cast
    if (node.RegularExpressionFlags.includes('v') && node.RegularExpressionFlags.includes('u')) {
      this.raise(Throw.SyntaxError('u and v cannot be used together'), flagPosition);
    }
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
        expressions.push(this.finishNode(inner, 'BindingRestElement'));
        this.expect(Token.RPAREN);
        break;
      }
      let annotatedParameter: ParseNode.SingleNameBinding | null = null;
      if (surroundingAgent.feature('runtime-types')
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
        node.PropertySetParameterList = null;
        node.UniqueFormalParameters = this.parseUniqueFormalParameters();
      }

      // proposal-runtime-types: MethodDefinition return TypeAnnotation, setters excluded.
      if (surroundingAgent.feature('runtime-types') && !isSetter && this.test(Token.COLON)) {
        (node as ParseNode.Unfinished<ParseNode.MethodDefinition | ParseNode.AsyncMethod | ParseNode.GeneratorMethod | ParseNode.AsyncGeneratorMethod>).TypeAnnotation = this.parseTypeAnnotation(true);
      }

      this.scope.with({
        superCall: !isSpecialMethod
                   && !node.static
                   && node.ClassElementName
                   && ((node.ClassElementName.type === 'IdentifierName' && node.ClassElementName.name === 'constructor')
                    || (node.ClassElementName.type === 'StringLiteral' && node.ClassElementName.value === 'constructor'))
                   && this.scope.hasSuperCall(),
      }, () => {
        const body = this.parseFunctionBody(isAsync, isGenerator, false);
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
