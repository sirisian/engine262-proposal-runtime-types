import { Throw } from '../host-defined/error-messages.mts';
import {
  Token,
  isKeyword,
  isReservedWordStrict,
  isKeywordRaw,
} from './tokens.mts';
import { BaseParser } from './BaseParser.mts';
import type { ParseNode } from './ParseNode.mts';
import { type Locatable } from './Lexer.mts';


/**
 * The closed set of names `#sec-type-names` governs. Syntactic and name-based:
 * scope-first means a program that binds one of these itself is unaffected, since
 * its own binding is found before the type name ever is.
 */
export function isBuiltinTypeNameString(name: unknown): boolean {
  if (typeof name !== 'string') {
    return false;
  }
  if (/^(u?int|float|decimal|complex|boolean)(1|8|16|32|64|128|256)$/.test(name)) {
    return true;
  }
  if (/^(u?int|float|boolean)(8|16|32|64)x(2|4|8|16|32)$/.test(name)) {
    return true;
  }
  return name === 'string' || name === 'number' || name === 'boolean'
    || name === 'bigint' || name === 'symbol' || name === 'object'
    || name === 'any' || name === 'never' || name === 'type';
}

export abstract class IdentifierParser extends BaseParser {
  protected abstract readonly state: {
    typeNameReferences: { exceptedFromAdmitting?: boolean }[];
  };

  // Supplied by TypeParser further down the chain; declared here so a function
  // declaration can take the  clauses #sec-function-declarations gives it.
  protected abstract parseWhereClauses(): ParseNode.WhereClause[];

  // IdentifierName
  parseIdentifierName() {
    const node = this.startNode<ParseNode.IdentifierName>();
    const p = this.peek();
    if (p.type === Token.IDENTIFIER
        || p.type === Token.ESCAPED_KEYWORD
        || isKeyword(p.type)) {
      node.name = this.next().valueAsString();
    } else {
      this.unexpected();
    }
    return this.finishNode(node, 'IdentifierName');
  }

  // BindingIdentifier :
  //   Identifier
  //   `yield`
  //   `await`
  parseBindingIdentifier() {
    const node = this.startNode<ParseNode.BindingIdentifier>();
    const token = this.next();
    switch (token.type) {
      case Token.IDENTIFIER:
        node.name = token.valueAsString();
        break;
      case Token.ESCAPED_KEYWORD:
        node.name = token.valueAsString();
        break;
      case Token.YIELD:
        node.name = 'yield';
        break;
      case Token.AWAIT:
        node.name = 'await';
        break;
      default:
        this.unexpected(token);
    }
    if (node.name === 'await') {
      for (let i = this.scope.arrowInfoStack.length - 1; i >= 0; i -= 1) {
        const arrowInfo = this.scope.arrowInfoStack[i];
        if (!arrowInfo) {
          break;
        }
        if (arrowInfo.isAsync) {
          arrowInfo.awaitIdentifiers.push(node as ParseNode.BindingIdentifier);
          break;
        }
      }
    }
    if (this.isStrictMode() && (node.name === 'eval' || node.name === 'arguments')) {
      this.addEarlyError(Throw.SyntaxError('$1 cannot be used as an identifier in strict mode', node.name), token);
    }
    this.validateIdentifierReference(node.name, token);
    return this.finishNode(node, 'BindingIdentifier');
  }

  // IdentifierReference :
  //   Identifier
  //   [~Yield] `yield`
  //   [~Await] `await`
  parseIdentifierReference() {
    const node = this.startNode<ParseNode.IdentifierReference>();
    const token = this.next();
    node.escaped = token.escaped;
    switch (token.type) {
      case Token.IDENTIFIER:
        node.name = token.valueAsString();
        break;
      case Token.ESCAPED_KEYWORD:
        node.name = token.valueAsString();
        break;
      case Token.YIELD:
        if (this.scope.hasYield()) {
          this.unexpected(token);
        }
        node.name = 'yield';
        break;
      case Token.AWAIT:
        if (this.scope.hasAwait()) {
          this.unexpected(token);
        }
        node.name = 'await';
        break;
      default:
        this.unexpected(token);
    }
    if (node.name === 'await') {
      for (let i = this.scope.arrowInfoStack.length - 1; i >= 0; i -= 1) {
        const arrowInfo = this.scope.arrowInfoStack[i];
        if (!arrowInfo) {
          break;
        }
        if (arrowInfo.isAsync) {
          arrowInfo.awaitIdentifiers.push(node as ParseNode.IdentifierReference);
          break;
        }
      }
    }
    this.validateIdentifierReference(node.name, token);
    const finishedRef = this.finishNode(node, 'IdentifierReference');
    // proposal-runtime-types #sec-type-names: a reference to a built-in type name
    // is a CANDIDATE for admitting. It is not decided here, because the two
    // positions the clause excepts - the operand of `typeof` and the target of an
    // assignment - are only known once their enclosing production is parsed, and
    // they mark the candidate then. The rule is stated as an exception rather
    // than as a list of admitting positions because a list cannot be finished:
    // a call, a member object, an argument, a property value and a comparison
    // operand are the same use of the same name.
    if (isBuiltinTypeNameString(finishedRef.name)) {
      this.state.typeNameReferences.push(finishedRef as { exceptedFromAdmitting?: boolean });
    }
    return finishedRef;
  }

  validateIdentifierReference(name: string, token: Locatable) {
    if (name === 'yield' && (this.scope.hasYield() || this.scope.isModule())) {
      this.addEarlyError(Throw.SyntaxError('yield cannot be used as an identifier inside generator functions or modules'), token);
    }
    if (name === 'await' && (this.scope.hasAwait() || this.scope.isModule())) {
      this.addEarlyError(Throw.SyntaxError('await cannot be used as an identifier inside async functions or modules'), token);
    }
    if (this.isStrictMode() && isReservedWordStrict(name)) {
      this.addEarlyError(Throw.SyntaxError('$1 cannot be used as an identifier in strict mode', name), token);
    }
    if (this.scope.inClassStaticBlock() && name === 'arguments') {
      this.addEarlyError(Throw.SyntaxError('"arguments" cannot be used as an identifier in class static block'), token);
    }
    if (name !== 'yield' && name !== 'await' && isKeywordRaw(name)) {
      this.addEarlyError(Throw.SyntaxError('$1 cannot be used as an identifier', name), token);
    }
  }

  // LabelIdentifier :
  //   Identifier
  //   [~Yield] `yield`
  //   [~Await] `await`
  parseLabelIdentifier() {
    const node = this.parseIdentifierReference();
    return this.repurpose(node, 'LabelIdentifier');
  }

  // PrivateIdentifier ::
  //   `#` IdentifierName
  parsePrivateIdentifier() {
    const node = this.startNode<ParseNode.PrivateIdentifier>();
    node.name = this.expect(Token.PRIVATE_IDENTIFIER).valueAsString();
    return this.finishNode(node, 'PrivateIdentifier');
  }
}
