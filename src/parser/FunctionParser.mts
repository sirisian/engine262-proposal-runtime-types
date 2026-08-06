import { IsSimpleParameterList } from '../static-semantics/all.mts';
import { type Mutable } from '../utils/language.mts';
import { Throw } from '../host-defined/error-messages.mts';
import { getDeclarations, type ArrowInfo } from './Scope.mts';
import { isReservedWordStrict, Token } from './tokens.mts';
import { IdentifierParser } from './IdentifierParser.mts';
import type { ParseNode, ParseNodesByType } from './ParseNode.mts';
import { surroundingAgent } from '#self';

export enum FunctionKind {
  NORMAL = 0,
  ASYNC = 1,
}

interface ArrowParameterConversions {
  // proposal-runtime-types
  'SingleNameBinding': ParseNode.SingleNameBinding;
  'IdentifierReference': ParseNode.SingleNameBinding;
  'BindingRestElement': ParseNode.BindingRestElement;
  'Elision': ParseNode.Elision;
  'ArrayLiteral': ParseNode.BindingElement;
  'ObjectLiteral': ParseNode.BindingElement;
  'AssignmentExpression': ParseNode.SingleNameBinding | ParseNode.BindingElement;
  'CoverInitializedName': ParseNode.SingleNameBinding;
  'PropertyDefinition': ParseNode.BindingRestProperty | ParseNode.BindingProperty;
  'SpreadElement': ParseNode.BindingRestElement;
  'AssignmentRestElement': ParseNode.BindingRestElement;
}

type ConvertArrowParameterResult<T> =
  T extends keyof ArrowParameterConversions ? ArrowParameterConversions[T] : never;

interface ConciseBodyInfo {
  'ConciseBody': ParseNode.ConciseBodyLike;
  'AsyncConciseBody': ParseNode.AsyncConciseBodyLike;
}

export abstract class FunctionParser extends IdentifierParser {
  /** Declared here because a FORMAL PARAMETER may carry decorators (decorators.md) and the list parser lives further down the hierarchy. */
  protected abstract parseDecorators(): ParseNode.Decorator[] | null;

  abstract parseStatementList(token: string | Token, directives?: readonly string[]): ParseNode.StatementList;

  abstract parseAssignmentExpression(): ParseNode.AssignmentExpressionOrHigher;

  abstract parseBindingElement(options?: { allowTypedInitializer?: boolean, allowOptionalMarker?: boolean, ref?: boolean }): ParseNode.BindingElementLike;

  // proposal-runtime-types: implemented by TypeParser further up the mixin chain.
  abstract parseTypeAnnotation(allowDecorators?: boolean): ParseNode.TypeAnnotation;

  abstract parseTypedInitializer(): ParseNode.TypedInitializer;

  abstract parseTypeParameters(): ParseNode.TypeParameters;

  abstract parseBindingRestElement(): ParseNode.BindingRestElement;

  // FunctionDeclaration :
  //   `function` BindingIdentifier `(` FormalParameters `)` `{` FunctionBody `}`
  //   [+Default] `function` `(` FormalParameters `)` `{` FunctionBody `}`
  // FunctionExpression :
  //   `function` BindingIdentifier? `(` FormalParameters `)` `{` FunctionBody `}`
  // GeneratorDeclaration :
  //   `function` `*` BindingIdentifier `(` FormalParameters `)` `{` GeneratorBody `}`
  //   [+Default] `function` `*` `(` FormalParameters `)` `{` GeneratorBody `}`
  // GeneratorExpression :
  //   `function` BindingIdentifier? `(` FormalParameters `)` `{` GeneratorBody `}`
  // AsyncGeneratorDeclaration :
  //   `async` `function` `*` BindingIdentifier `(` FormalParameters `)` `{` AsyncGeneratorBody `}`
  //   [+Default] `async` `function` `*` `(` FormalParameters `)` `{` AsyncGeneratorBody `}`
  // AsyncGeneratorExpression :
  //   `async` `function` BindingIdentifier? `(` FormalParameters `)` `{` AsyncGeneratorBody `}`
  // AsyncFunctionDeclaration :
  //   `async` `function` BindingIdentifier `(` FormalParameters `)` `{` FunctionBody `}`
  //   [+Default] `async` `function` `(` FormalParameters `)` `{` AsyncBody `}`
  // Async`FunctionExpression :
  //   `async` `function` BindingIdentifier? `(` FormalParameters `)` `{` AsyncBody `}`
  parseFunction(isExpression: boolean, kind: FunctionKind) {
    const isAsync = kind === FunctionKind.ASYNC;
    const node = this.startNode<ParseNode.FunctionLike>();
    if (isAsync) {
      this.expect('async');
    }
    this.expect(Token.FUNCTION);
    const isGenerator = this.eat(Token.MUL);
    const genericNoName = surroundingAgent.feature('runtime-types') && this.test(Token.LT);
    if (!this.test(Token.LPAREN) && !genericNoName) {
      node.BindingIdentifier = this.scope.with({
        await: isExpression ? false : undefined,
        yield: isExpression ? false : undefined,
      }, () => this.parseBindingIdentifier());
      if (!isExpression) {
        this.scope.declare(node.BindingIdentifier, 'function');
      }
    } else if (isExpression === false && !this.scope.isDefault() && !genericNoName) {
      this.unexpected();
    } else {
      node.BindingIdentifier = null;
    }

    // proposal-runtime-types: a function may declare type parameters,
    // `function id<T>(x: T): T`, applied with `.<...>` at the call site. Parsed
    // only under the feature, before the formal parameter list.
    if (surroundingAgent.feature('runtime-types') && this.test(Token.LT)) {
      (node as Mutable<ParseNode.FunctionDeclaration>).TypeParameters = this.parseTypeParameters();
    }

    this.scope.with({
      default: false,
      await: isAsync,
      yield: isGenerator,
      lexical: true,
      variable: true,
      variableFunctions: true,
      parameters: false,
      classStaticBlock: false,
      newTarget: true,
    }, () => {
      this.scope.arrowInfoStack.push(null);

      node.FormalParameters = this.parseFormalParameters();

      // proposal-runtime-types #sec-annotations-on-the-remaining-function-forms
      if (surroundingAgent.feature('runtime-types') && this.test(Token.COLON)) {
        node.TypeAnnotation = this.parseTypeAnnotation(true);
      }

      const body = this.parseFunctionBody(isAsync, isGenerator, false);
      this.setFunctionBodyGeneric(node, body.type, body);

      if (node.BindingIdentifier) {
        if (body.strict && (node.BindingIdentifier.name === 'eval' || node.BindingIdentifier.name === 'arguments' || isReservedWordStrict(node.BindingIdentifier.name))) {
          this.addEarlyError(Throw.SyntaxError('$1 cannot be used as an identifier in strict mode', node.BindingIdentifier.name), node.BindingIdentifier);
        }
        if (isExpression) {
          if (this.scope.hasYield() && node.BindingIdentifier.name === 'yield') {
            this.addEarlyError(Throw.SyntaxError('yield cannot be used as an identifier inside generator functions'), node.BindingIdentifier);
          }
          if (this.scope.hasAwait() && node.BindingIdentifier.name === 'await') {
            this.addEarlyError(Throw.SyntaxError('await cannot be used as an identifier inside async functions'), node.BindingIdentifier);
          }
        }
      }

      this.validateFormalParameters(node.FormalParameters, body);

      this.scope.arrowInfoStack.pop();
    });

    const name = `${isAsync ? 'Async' : ''}${isGenerator ? 'Generator' : 'Function'}${isExpression ? 'Expression' : 'Declaration'}` as const;
    return this.finishNode(node, name);
  }

  private setFunctionBodyGeneric<T extends ParseNode.FunctionBodyLike['type']>(node: { [P in T]?: ParseNodesByType[T] }, type: T, body: ParseNodesByType[T]) {
    node[type] = body;
  }

  validateFormalParameters(parameters: ParseNode.FormalParameters, body: ParseNode.FunctionBodyLike | ParseNode.ConciseBody | ParseNode.AsyncConciseBody, wantsUnique = false) {
    const isStrict = body.strict;
    const hasStrictDirective = body.directives && body.directives.includes('use strict');
    if (wantsUnique === false && !IsSimpleParameterList(parameters)) {
      wantsUnique = true;
    }

    if (hasStrictDirective) {
      parameters.forEach((p) => {
        // proposal-runtime-types (references extension): a `ref` parameter
        // makes the list non-simple (see IsSimpleParameterList), so it joins
        // defaults and patterns in refusing the directive.
        if (p.type !== 'SingleNameBinding' || p.Initializer || p.Ref === true) {
          this.addEarlyError(Throw.SyntaxError('Non-simple parameter cannot be used with "use strict" directive'), p);
        }
      });
    }

    const names = new Set();
    getDeclarations(parameters)
      .forEach((d) => {
        if (isStrict) {
          if (d.name === 'arguments' || d.name === 'eval') {
            this.addEarlyError(Throw.SyntaxError('$1 cannot be used as an identifier in strict mode', d.name), d.node);
          }
          if (isReservedWordStrict(d.name)) {
            this.addEarlyError(Throw.SyntaxError('$1 cannot be used as an identifier in strict mode', d.name), d.node);
          }
        }
        if (isStrict || wantsUnique) {
          if (names.has(d.name)) {
            this.addEarlyError(Throw.SyntaxError('Identifier has already been declared'), d.node);
          } else {
            names.add(d.name);
          }
        }
      });
  }

  convertArrowParameter<T extends ParseNode>(node: T): ConvertArrowParameterResult<T['type']>;

  convertArrowParameter(node: ParseNode) {
    switch (node.type) {
      case 'IdentifierReference': {
        const BindingIdentifier = this.repurpose(node, 'BindingIdentifier');
        const SingleNameBinding = this.startNode<ParseNode.SingleNameBinding>(node);
        SingleNameBinding.BindingIdentifier = BindingIdentifier;
        SingleNameBinding.Initializer = null;
        this.scope.declare(node, 'parameter');
        return this.finishNode(SingleNameBinding, 'SingleNameBinding');
      }
      case 'BindingRestElement':
        this.scope.declare(node, 'parameter');
        return node;
      case 'SingleNameBinding':
        // proposal-runtime-types: an annotated parameter was already built as a
        // binding inside the cover; it only needs its declaration.
        this.scope.declare(node, 'parameter');
        return node;
      // proposal-runtime-types #sec-reference-syntax: `async (ref a) => {}`
      // reaches the arrow through the call cover, so the head was parsed as
      // Arguments and the ref parameter arrives as a RefExpression argument.
      // Refinement turns it into the ref SingleNameBinding the direct
      // parenthesized cover builds; an operand that is not a plain name has no
      // parameter reading and is refused.
      case 'RefExpression': {
        if (node.Expression.type !== 'IdentifierReference') {
          this.addEarlyError(Throw.SyntaxError('A ref parameter must be a single name'), node);
          return node;
        }
        const BindingIdentifier = this.repurpose(node.Expression, 'BindingIdentifier');
        const SingleNameBinding = this.startNode<ParseNode.SingleNameBinding>(node);
        SingleNameBinding.BindingIdentifier = BindingIdentifier;
        SingleNameBinding.Initializer = null;
        SingleNameBinding.Ref = true;
        this.scope.declare(node.Expression, 'parameter');
        return this.finishNode(SingleNameBinding, 'SingleNameBinding');
      }
      case 'Elision':
        return node;
      case 'ArrayLiteral': {
        const BindingPattern = this.repurpose(node, 'ArrayBindingPattern', (asNew, asOld, asPartial) => {
          const BindingElementList: Mutable<ParseNode.BindingElementList> = [];
          asNew.BindingElementList = BindingElementList;
          for (const [i, p] of asOld.ElementList.entries()) {
            const c = this.convertArrowParameter(p);
            if (c.type === 'BindingRestElement') {
              if (i !== asOld.ElementList.length - 1) {
                this.addEarlyError(Throw.SyntaxError('Rest element must be last element'), c);
              }
              asNew.BindingRestElement = c;
            } else {
              BindingElementList.push(c);
            }
          }
          delete asPartial.ElementList;
        });
        const BindingElement = this.startNode<ParseNode.BindingElement>(node);
        BindingElement.BindingPattern = BindingPattern;
        BindingElement.Initializer = null;
        return this.finishNode(BindingElement, 'BindingElement');
      }
      case 'ObjectLiteral': {
        const BindingPattern = this.repurpose(node, 'ObjectBindingPattern', (asNew, asOld, asPartial) => {
          const BindingPropertyList: Mutable<ParseNode.BindingPropertyList> = [];
          asNew.BindingPropertyList = BindingPropertyList;
          for (const p of asOld.PropertyDefinitionList) {
            const c = this.convertArrowParameter(p);
            if (c.type === 'BindingRestProperty') {
              asNew.BindingRestProperty = c;
            } else {
              BindingPropertyList.push(c);
            }
          }
          delete asPartial.PropertyDefinitionList;
        });
        const BindingElement = this.startNode<ParseNode.BindingElement>(node);
        BindingElement.BindingPattern = BindingPattern;
        BindingElement.Initializer = null;
        return this.finishNode(BindingElement, 'BindingElement');
      }
      case 'AssignmentExpression': {
        const result = this.convertArrowParameter(node.LeftHandSideExpression) as ParseNode.Unfinished<ParseNode.SingleNameBinding | ParseNode.BindingElement>;
        result.Initializer = node.AssignmentExpression;
        return result as ParseNode.SingleNameBinding | ParseNode.BindingElement;
      }
      case 'CoverInitializedName': {
        const SingleNameBinding = this.repurpose(node, 'SingleNameBinding', (asNew, asOld, asPartial) => {
          asNew.BindingIdentifier = this.repurpose(asOld.IdentifierReference, 'BindingIdentifier');
          delete asPartial.IdentifierReference;
        });
        this.scope.declare(SingleNameBinding, 'parameter');
        return SingleNameBinding;
      }
      case 'PropertyDefinition': {
        let BindingProperty: ParseNode.BindingProperty | ParseNode.BindingRestProperty;
        if (node.PropertyName === null) {
          BindingProperty = this.repurpose(node, 'BindingRestProperty', (asNew, asOld, asPartial) => {
            asNew.BindingIdentifier = this.repurpose(asOld.AssignmentExpression, 'BindingIdentifier');
            delete asPartial.AssignmentExpression;
          });
        } else {
          BindingProperty = this.repurpose(node, 'BindingProperty', (asNew, asOld, asPartial) => {
            asNew.BindingElement = this.convertArrowParameter(asOld.AssignmentExpression);
            delete asPartial.AssignmentExpression;
          });
        }
        this.scope.declare(node, 'parameter');
        return BindingProperty;
      }
      case 'SpreadElement':
      case 'AssignmentRestElement': {
        const BindingRestElement = this.repurpose(node, 'BindingRestElement', (asNew, asOld, asPartial) => {
          const { AssignmentExpression } = asOld;
          if (AssignmentExpression.type === 'AssignmentExpression') {
            this.addEarlyError(Throw.SyntaxError('Invalid assignment in rest element'), node);
          } else if (AssignmentExpression.type === 'IdentifierReference') {
            asNew.BindingIdentifier = this.repurpose(AssignmentExpression, 'BindingIdentifier');
          } else {
            asNew.BindingPattern = this.convertArrowParameter(AssignmentExpression).BindingPattern;
          }
          // The cover kept the rest's annotation; the binding is where it lives.
          // A SpreadElement (a call-site spread) has none, hence the read.
          const covered = asOld as { TypeAnnotation?: ParseNode.TypeAnnotation | null };
          if (covered.TypeAnnotation) {
            asNew.TypeAnnotation = covered.TypeAnnotation;
          }
          delete asPartial.AssignmentExpression;
        });
        this.scope.declare(BindingRestElement, 'parameter');
        return BindingRestElement;
      }
      default:
        this.addEarlyError(Throw.SyntaxError('Unexpected token'), node);
        return node;
    }
  }

  parseArrowFunction(node: ParseNode.Unfinished<ParseNode.ArrowFunction | ParseNode.AsyncArrowFunction>, { arrowInfo, Arguments }: { arrowInfo?: ArrowInfo, Arguments: ParseNode.CoverParenthesizedExpressionAndArrowParameterList['Arguments'] }, kind: FunctionKind): ParseNode.ArrowFunction | ParseNode.AsyncArrowFunction {
    const isAsync = kind === FunctionKind.ASYNC;
    this.expect(Token.ARROW);
    if (arrowInfo) {
      const beforeArrow = <T extends { location: { startIndex: number } }>(nodes: readonly T[]) => nodes
        .filter((n) => n.location.startIndex < this.currentToken.startIndex);
      beforeArrow(arrowInfo.awaitExpressions).forEach((e) => {
        this.addEarlyError(Throw.SyntaxError('await cannot be used inside parameters of arrow functions'), e);
      });
      beforeArrow(arrowInfo.yieldExpressions).forEach((e) => {
        this.addEarlyError(Throw.SyntaxError('yield cannot be used inside parameters of arrow functions'), e);
      });
      if (isAsync) {
        beforeArrow(arrowInfo.awaitIdentifiers).forEach((e) => {
          this.addEarlyError(Throw.SyntaxError('await cannot be used as an identifier inside parameters of async functions'), e);
        });
      }
    }
    this.scope.with({
      default: false,
      lexical: true,
      variable: true,
    }, () => {
      node.ArrowParameters = this.scope.with({
        parameters: true,
      }, () => Arguments.map((p) => this.convertArrowParameter(p)));
      this.scope.enterArrowBody();
      const body = this.parseConciseBody(isAsync);
      this.scope.exitArrowBody();
      this.validateFormalParameters(node.ArrowParameters, body, true);
      let bodyType: 'ConciseBody' | 'AsyncConciseBody';
      if (body.type === 'FunctionBody') {
        bodyType = 'ConciseBody';
      } else if (body.type === 'AsyncBody') {
        bodyType = 'AsyncConciseBody';
      } else {
        bodyType = body.type;
      }
      this.setConciseBodyGeneric(node, bodyType, body);
    });
    return this.finishNode(node, `${isAsync ? 'Async' : ''}ArrowFunction`);
  }

  private setConciseBodyGeneric<T extends 'ConciseBody' | 'AsyncConciseBody'>(node: { [P in T]?: ConciseBodyInfo[T] }, type: T, body: ConciseBodyInfo[T]) {
    node[type] = body;
  }

  parseConciseBody(isAsync: boolean): ParseNode.ConciseBody | ParseNode.FunctionBody | ParseNode.AsyncConciseBody | ParseNode.AsyncBody {
    if (this.test(Token.LBRACE)) {
      return this.parseFunctionBody(isAsync, false, true) as ParseNode.FunctionBody | ParseNode.AsyncBody;
    }
    const asyncBody = this.startNode<ParseNode.ConciseBody | ParseNode.AsyncConciseBody>();
    const exprBody = this.startNode<ParseNode.ExpressionBody>();
    this.scope.with({ await: isAsync }, () => {
      exprBody.AssignmentExpression = this.parseAssignmentExpression();
    });
    asyncBody.ExpressionBody = this.finishNode(exprBody, 'ExpressionBody');
    return this.finishNode(asyncBody, `${isAsync ? 'Async' : ''}ConciseBody`);
  }

  // FormalParameter : `ref`? BindingElement
  // proposal-runtime-types: `ref` is contextual, consumed only when what
  // follows can begin a BindingElement, so a parameter named `ref` still works.
  parseFormalParameter(): ParseNode.FormalParameter {
    // proposal-runtime-types decorators.md: `d(@f a: uint32)` — a parameter
    // carries its own decorators, which take the ClassMethodParameter,
    // ClassSetterParameter, ClassOperatorParameter, or FunctionParameter
    // context depending on what declares the parameter list.
    let parameterDecorators: readonly ParseNode.Decorator[] | null = null;
    if (surroundingAgent.feature('runtime-types') && this.test(Token.AT)) {
      parameterDecorators = this.parseDecorators();
    }
    if (parameterDecorators) {
      const withDecorators = this.parseFormalParameterInner();
      (withDecorators as { Decorators?: readonly ParseNode.Decorator[] | null }).Decorators = parameterDecorators;
      return withDecorators;
    }
    return this.parseFormalParameterInner();
  }

  parseFormalParameterInner(): ParseNode.FormalParameter {
    // proposal-runtime-types #sec-reference-syntax: a ref parameter is a
    // SingleNameBinding - the borrow binds ONE name to ONE location, so a
    // BindingPattern after `ref` is not claimed and keeps its base meaning (a
    // parameter named ref followed by an unexpected token). Destructuring a
    // borrow is the pattern's own `{ (ref a) }` member form, which is a
    // deferred extension. The claim is same-line, as at every other site.
    if (surroundingAgent.feature('runtime-types') && this.test('ref')
        && !this.peekAhead().hadLineTerminatorBefore) {
      switch (this.peekAhead().type) {
        case Token.IDENTIFIER:
        case Token.YIELD:
        case Token.AWAIT: {
          this.next();
          const node = this.parseBindingElement({ ref: true });
          // A ref parameter may not carry a default. A default runs when the
          // caller supplies NO argument, and a value built by the callee has
          // no caller-side location to borrow, so the combination can never
          // bind; it is refused at parse rather than at the first defaulted
          // call.
          if (node.Initializer) {
            this.addEarlyError(Throw.SyntaxError('A ref parameter may not have a default value'), node.Initializer);
          }
          // proposal-runtime-types: nor an OPTIONAL marker, for the same
          // reason. `?` says the argument may be omitted, and a `ref`
          // parameter binds a LOCATION that an omitted argument does not
          // supply - so the pairing promised something no call could honour
          // and failed at every one of them, with a message about a missing
          // `ref` argument that never mentioned the `?`. The combination
          // exists only because `?` comes from SingleNameBinding and `ref`
          // from FormalParameter and neither production knows of the other.
          if ((node as { Optional?: boolean }).Optional === true) {
            this.addEarlyError(Throw.SyntaxError('A ref parameter may not be optional'), node);
          }
          return node;
        }
        default:
          break;
      }
    }
    return this.parseBindingElement();
  }

  parseFormalParameters(): ParseNode.FormalParameters {
    this.expect(Token.LPAREN);
    if (this.eat(Token.RPAREN)) {
      return [];
    }
    const params: Mutable<ParseNode.FormalParameters> = [];
    this.scope.with({ parameters: true }, () => {
      while (true) {
        // proposal-runtime-types decorators.md: a parameter carries its own
        // decorators, and a rest parameter IS a parameter. They were read
        // inside parseFormalParameter, which a rest never reaches, so
        // `@d ...a: [].<number>` was a Syntax Error while `@d a: number` was
        // not - a gap that predates the rest positions of this phase. Reading
        // them here serves both, since a decorator list is arbitrarily long and
        // cannot be looked past to see which follows.
        let pendingDecorators: readonly ParseNode.Decorator[] | null = null;
        if (surroundingAgent.feature('runtime-types') && this.test(Token.AT)) {
          pendingDecorators = this.parseDecorators();
        }
        if (this.test(Token.ELLIPSIS)) {
          const element = this.parseBindingRestElement();
          if (pendingDecorators) {
            (element as { Decorators?: readonly ParseNode.Decorator[] | null }).Decorators = pendingDecorators;
          }
          this.scope.declare(element, 'parameter');
          params.push(element);
          // proposal-runtime-types #sec-type-annotations, PLAN-rest-parameters.md
          // phase 1b: a rest is an ORDINARY element of the parameter list. It
          // may be followed by further parameters and a list may hold several,
          // which is what the design's `f(a: string, ...args: [].<uint32>,
          // ...args2: [].<string>, callback: () => void)` needs. Which run each
          // rest takes is decided by the types (phase 2's assignment).
          //
          // With the feature OFF the base language's rule stands exactly: a
          // rest ends the list, and anything after it is a Syntax Error.
          if (!surroundingAgent.feature('runtime-types')) {
            this.expect(Token.RPAREN);
            break;
          }
        } else {
          const formal = this.parseFormalParameter();
          if (pendingDecorators) {
            (formal as { Decorators?: readonly ParseNode.Decorator[] | null }).Decorators = pendingDecorators;
          }
          this.scope.declare(formal, 'parameter');
          params.push(formal);
        }
        if (this.eat(Token.RPAREN)) {
          break;
        }
        this.expect(Token.COMMA);
        if (this.eat(Token.RPAREN)) {
          break;
        }
      }
    });
    return params;
  }

  parseUniqueFormalParameters(): ParseNode.UniqueFormalParameters {
    return this.parseFormalParameters();
  }

  parseFunctionBody(isAsync: boolean, isGenerator: boolean, isArrow: boolean): ParseNode.FunctionBodyLike {
    const node = this.startNode<ParseNode.FunctionBodyLike>();
    this.expect(Token.LBRACE);
    this.scope.with({
      newTarget: isArrow ? undefined : true,
      return: true,
      await: isAsync,
      yield: isGenerator,
      label: 'boundary',
    }, () => {
      node.directives = [];
      node.FunctionStatementList = this.parseStatementList(Token.RBRACE, node.directives);
      node.strict = node.strict || node.directives.includes('use strict');
    });
    let name: ParseNode.FunctionBodyLike['type'];
    if (isAsync) {
      name = isGenerator ? 'AsyncGeneratorBody' : 'AsyncBody';
    } else {
      name = isGenerator ? 'GeneratorBody' : 'FunctionBody';
    }
    return this.finishNode(node, name);
  }
}
