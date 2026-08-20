import type { Mutable } from '../utils/language.mts';
import { Token, isAutomaticSemicolon } from './tokens.mts';
import { TypeParser } from './TypeParser.mts';
import { FunctionKind } from './FunctionParser.mts';
import { getDeclarations, type LabelType } from './Scope.mts';
import type { ParseNode } from './ParseNode.mts';
import { surroundingAgent, Throw } from '#self';

export abstract class StatementParser extends TypeParser {
  // proposal-runtime-types: meta-declared type names seen in this parse.
  private declaredMetaTypes?: Set<string>;

  eatSemicolonWithASI() {
    if (this.eat(Token.SEMICOLON)) {
      return true;
    }
    if (this.peek().hadLineTerminatorBefore || isAutomaticSemicolon(this.peek().type)) {
      return true;
    }
    return false;
  }

  semicolon() {
    if (!this.eatSemicolonWithASI()) {
      this.unexpected();
    }
  }

  // StatementList :
  //   StatementListItem
  //   StatementList StatementListItem
  /**
   * @param endToken endToken
   * @param directives directives, this array will be mutated.
   */
  parseStatementList(endToken: string | Token, directives?: string[]): ParseNode.StatementList {
    const statementList: Mutable<ParseNode.StatementList> = [];
    const oldStrict = this.state.strict;
    const directiveData = [];
    while (!this.eat(endToken)) {
      if (directives !== undefined && this.test(Token.STRING)) {
        const token = this.peek();
        const directive = this.source.slice(token.startIndex + 1, token.endIndex - 1);
        if (directive === 'use strict') {
          this.state.strict = true;
          directiveData.forEach((d) => {
            if (/\\([1-9]|0\d)/.test(d.directive)) {
              this.addEarlyError(Throw.SyntaxError('Illegal octal escape'), d.token);
            }
          });
        }
        directives.push(directive);
        directiveData.push({ directive, token });
      } else {
        directives = undefined;
      }

      const stmt = this.parseStatementListItem();
      statementList.push(stmt);
    }

    this.state.strict = oldStrict;

    return statementList;
  }

  // StatementListItem :
  //   Statement
  //   Declaration
  //
  // Declaration :
  //   HoistableDeclaration
  //   ClassDeclaration
  //   LexicalDeclaration
  parseStatementListItem(): ParseNode.StatementListItem {
    switch (this.peek().type) {
      case Token.FUNCTION:
        return this.parseHoistableDeclaration();
      case Token.AT: {
        // proposal-runtime-types decorators.md: `@` no longer implies a class.
        // A decorator list may precede a class, a FUNCTION declaration, or a
        // `let`/`const` binding, so the list is parsed first and the
        // declaration that follows decides which it was.
        if (!surroundingAgent.feature('runtime-types')) {
          return this.parseClassDeclaration(null);
        }
        return this.parseDecoratedStatementListItem();
      }
      case Token.CLASS:
        return this.parseClassDeclaration(null);
      case Token.CONST:
        return this.parseLexicalDeclaration();
      case Token.ENUM:
        // proposal-runtime-types EnumDeclaration; `enum` is reserved, so the
        // gate is additive.
        if (surroundingAgent.feature('runtime-types')) {
          return this.parseEnumDeclaration();
        }
        return this.parseStatement();
      default:
        // proposal-runtime-types (explicit resource management): a `using`
        // declaration, recognized only where the contextual keyword is followed by
        // an identifier on the same line.
        if (this.test('using') && this.startsUsingDeclaration()) {
          return this.parseLexicalDeclaration();
        }
        if (this.test('let')) {
          switch (this.peekAhead().type) {
            case Token.LBRACE:
            case Token.LBRACK:
            case Token.IDENTIFIER:
            case Token.YIELD:
            case Token.AWAIT:
              return this.parseLexicalDeclaration();
            default:
              break;
          }
        }
        if (this.test('async') && this.testAhead(Token.FUNCTION) && !this.peekAhead().hadLineTerminatorBefore) {
          return this.parseHoistableDeclaration();
        }
        if (this.testClassModifierRun()) {
          // proposal-runtime-types ClassDeclaration : ClassModifiers? `class` ...
          return this.parseClassDeclaration(null);
        }
        // proposal-runtime-types: every declaration below is introduced by a
        // CONTEXTUAL keyword, which lexes as an identifier, so the lookahead is
        // meaningful only where the current token is one. Reading ahead
        // unconditionally scans the token AFTER the current one; where the
        // current token opens a template literal that scan runs the lexer over
        // the template's body, and the template scanner - which reads raw source
        // from `this.position` rather than from the token stream - then starts
        // past its own opening backtick. The other lookaheads here are guarded
        // by a `this.test(...)` for the same reason.
        if (surroundingAgent.feature('runtime-types') && this.test(Token.IDENTIFIER)) {
          // Each lookahead pair is a SyntaxError today, so the gates are additive.
          switch (this.peekAhead().type) {
            case Token.IDENTIFIER:
            case Token.YIELD:
            case Token.AWAIT:
              if (this.test('type') && !this.peekAhead().hadLineTerminatorBefore) {
                return this.parseTypeAliasDeclaration();
              }
              if (this.test('interface')) {
                return this.parseInterfaceDeclaration();
              }
              // proposal-runtime-types decorators.md: `partial interface X { ... }`
              // extends an interface someone else declared. The keyword is the
              // same one classes use and it means the same thing - "extend a
              // declaration deliberately" - but on a declaration kind that adds
              // NO INSTANCE STATE, which is what lets it do what a partial class
              // may not: contribute fields. See #sec-metadata-objects.
              if (this.test('partial') && this.testAhead('interface')) {
                this.next();
                return this.parseInterfaceDeclaration(true);
              }
              if (this.test('meta') && !this.peekAhead().hadLineTerminatorBefore) {
                return this.parseMetaDeclaration();
              }
              if (this.test('primitive') && !this.peekAhead().hadLineTerminatorBefore) {
                return this.parsePrimitiveOperatorDeclaration();
              }
              break;
            default:
              break;
          }
        }
        return this.parseStatement();
    }
  }

  // HoistableDeclaration :
  //   FunctionDeclaration
  //   GeneratorDeclaration
  //   AsyncFunctionDeclaration
  //   AsyncGeneratorDeclaration
  parseHoistableDeclaration(): ParseNode.HoistableDeclaration {
    switch (this.peek().type) {
      case Token.FUNCTION:
        return this.parseFunctionDeclaration(FunctionKind.NORMAL);
      default:
        if (this.test('async') && this.testAhead(Token.FUNCTION) && !this.peekAhead().hadLineTerminatorBefore) {
          return this.parseFunctionDeclaration(FunctionKind.ASYNC);
        }
        throw new Error('unreachable');
    }
  }

  // ClassDeclaration :
  //   `class` BindingIdentifier ClassTail
  //   [+Default] `class` ClassTail
  parseClassDeclaration(decoratorsAttachedToClassDeclaration: null | readonly ParseNode.Decorator[]): ParseNode.ClassDeclaration {
    return this.parseClass(decoratorsAttachedToClassDeclaration, false) as ParseNode.ClassDeclaration;
  }

  // TypeAliasDeclaration :
  //   `type` [no LineTerminator here] BindingIdentifier TypeParameters? `=` Type WhereClauses? `;`
  parseTypeAliasDeclaration(): ParseNode.TypeAliasDeclaration {
    const node = this.startNode<ParseNode.TypeAliasDeclaration>();
    this.expect('type');
    node.BindingIdentifier = this.parseBindingIdentifier();
    node.TypeParameters = this.test(Token.LT) ? this.parseTypeParameters() : null;
    this.expect(Token.ASSIGN);
    node.Type = this.parseType();
    const whereClauses = this.parseWhereClauses();
    node.WhereClauses = whereClauses.length > 0 ? whereClauses : null;
    this.semicolon();
    const finished = this.finishNode(node, 'TypeAliasDeclaration');
    this.scope.declare(finished, 'lexical');
    return finished;
  }

  // InterfaceDeclaration :
  //   `interface` BindingIdentifier TypeParameters? `{` InterfaceBody? `}`
  // InterfaceMember :
  //   TypeMember
  //   OperatorDefinition
  parseInterfaceDeclaration(isPartial = false): ParseNode.InterfaceDeclaration {
    const node = this.startNode<ParseNode.InterfaceDeclaration>();
    this.expect('interface');
    node.BindingIdentifier = this.parseBindingIdentifier();
    node.TypeParameters = this.test(Token.LT) ? this.parseTypeParameters() : null;
    this.expect(Token.LBRACE);
    const InterfaceMemberList: ParseNode.InterfaceMember[] = [];
    while (!this.test(Token.RBRACE)) {
      // `operator` and `static` are valid member names, so the operator route
      // needs what follows them to rule the member reading out.
      if (this.test(Token.MUL)
          || (this.test('static') && this.testAhead('operator'))
          || (this.test('operator')
            && !this.testAhead(Token.COLON)
            && !this.testAhead(Token.CONDITIONAL)
            && !this.testAhead(Token.LPAREN))) {
        InterfaceMemberList.push(this.parseOperatorDefinition());
        // An OperatorDefinition carries its own `;` or `}` terminator, so the
        // separator here is optional.
        if (!this.eat(Token.COMMA)) {
          this.eat(Token.SEMICOLON);
        }
        continue;
      }
      InterfaceMemberList.push(this.parseTypeMember());
      if (!this.eat(Token.COMMA) && !this.eat(Token.SEMICOLON)) {
        break;
      }
    }
    this.expect(Token.RBRACE);
    node.InterfaceMemberList = InterfaceMemberList;
    const finished = this.finishNode(node, 'InterfaceDeclaration');
    // A `partial interface` extends a name that is ALREADY declared, so it must not
    // declare it again - the same reason a partial class does not. The
    // difference is only in what each may contribute.
    (finished as { Partial?: boolean }).Partial = isPartial;
    if (!isPartial) {
      this.scope.declare(finished, 'lexical');
    }
    return finished;
  }

  // EnumDeclaration :
  //   `enum` BindingIdentifier TypeAnnotation? `{` EnumMemberList? `,`? `}`
  // EnumMember :
  //   IdentifierName Initializer?
  parseEnumDeclaration(): ParseNode.EnumDeclaration {
    const node = this.startNode<ParseNode.EnumDeclaration>();
    this.expect(Token.ENUM);
    node.BindingIdentifier = this.parseBindingIdentifier();
    node.TypeAnnotation = this.test(Token.COLON) ? this.parseTypeAnnotation() : null;
    this.expect(Token.LBRACE);
    const EnumMemberList: ParseNode.EnumMember[] = [];
    while (!this.test(Token.RBRACE)) {
      const member = this.startNode<ParseNode.EnumMember>();
      // decorators.md: an ENUMERATOR carries its own decorators, which take the
      // EnumEnumerator context.
      if (this.test(Token.AT)) {
        (member as { Decorators?: readonly ParseNode.Decorator[] | null }).Decorators = this.parseDecorators();
      }
      member.IdentifierName = this.parseIdentifierName();
      member.Initializer = this.parseInitializerOpt();
      EnumMemberList.push(this.finishNode(member, 'EnumMember'));
      if (!this.eat(Token.COMMA)) {
        break;
      }
    }
    this.expect(Token.RBRACE);
    node.EnumMemberList = EnumMemberList;
    const finished = this.finishNode(node, 'EnumDeclaration');
    this.scope.declare(finished, 'lexical');
    return finished;
  }

  // MetaDeclaration :
  //   `meta` [no LineTerminator here] TypeName `{` MetaHookList? `}`
  // MetaHook :
  //   `default` `=` AssignmentExpression `;`
  //   MethodDefinition
  // The table of permitted hook names is a semantics-milestone early error.
  parseMetaDeclaration(): ParseNode.MetaDeclaration {
    const node = this.startNode<ParseNode.MetaDeclaration>();
    this.expect('meta');
    node.TypeName = this.parseTypeName();
    // #sec-meta-hooks: at most one meta declaration per type.
    const typeKey = node.TypeName.IdentifierReference.name + node.TypeName.MemberNames.map((m) => `.${m.name}`).join('');
    if (!this.declaredMetaTypes) {
      this.declaredMetaTypes = new Set();
    }
    if (this.declaredMetaTypes.has(typeKey)) {
      this.addEarlyError(Throw.SyntaxError('Duplicate meta declaration'), node);
    } else {
      this.declaredMetaTypes.add(typeKey);
    }
    this.expect(Token.LBRACE);
    const MetaHookList: ParseNode.MetaHook[] = [];
    while (!this.test(Token.RBRACE)) {
      if (this.test(Token.DEFAULT) && this.testAhead(Token.ASSIGN)) {
        const hook = this.startNode<ParseNode.MetaDefaultHook>();
        this.next();
        this.expect(Token.ASSIGN);
        hook.AssignmentExpression = this.parseAssignmentExpression();
        this.semicolon();
        MetaHookList.push(this.finishNode(hook, 'MetaDefaultHook'));
      } else {
        const hook = this.parseClassElement();
        // The table of permitted hook names; a method hook must use one.
        // #sec-meta-hooks: a method hook must use a name from the table.
        // Missing required hooks and signature checks join a later pass.
        const hookName = (hook as { ClassElementName?: { name?: string } }).ClassElementName?.name;
        const hookArity: Record<string, number> = {
          subtype: 2, validate: 2, narrow: 3, conversionFactor: 2,
          // #table-meta-hooks names seven, and the parser must match it (the
          // plan's C4: `quantize` was undeclarable while its consumer ran on
          // every crossing). `rescale` and `describe` become declarable and
          // stay pinned-unconsumed: rescale's consumer is the operator-block
          // conversion path that does not exist yet, describe's is reflection.
          quantize: 2, rescale: 2, describe: 1,
        };
        if (typeof hookName !== 'string' || !(hookName in hookArity)) {
          this.addEarlyError(Throw.SyntaxError('Invalid meta hook name'), hook);
        } else {
          const params = (hook as { UniqueFormalParameters?: readonly ParseNode.FormalParameter[] }).UniqueFormalParameters;
          if (Array.isArray(params) && params.length !== hookArity[hookName]) {
            this.addEarlyError(Throw.SyntaxError('Meta hook signature does not match the table'), hook);
          }
        }
        MetaHookList.push(hook);
      }
    }
    this.expect(Token.RBRACE);
    node.MetaHookList = MetaHookList;
    return this.finishNode(node, 'MetaDeclaration');
  }

  // PrimitiveOperatorDeclaration :
  //   `primitive` [no LineTerminator here] TypeName TypeParameters? `{` OperatorDefinitionList? `}`
  parsePrimitiveOperatorDeclaration(): ParseNode.PrimitiveOperatorDeclaration {
    const node = this.startNode<ParseNode.PrimitiveOperatorDeclaration>();
    this.expect('primitive');
    node.TypeName = this.parseTypeName();
    node.TypeParameters = this.test(Token.LT) ? this.parseTypeParameters() : null;
    this.expect(Token.LBRACE);
    const OperatorDefinitionList: ParseNode.OperatorDefinition[] = [];
    while (!this.test(Token.RBRACE)) {
      OperatorDefinitionList.push(this.parseOperatorDefinition());
    }
    this.expect(Token.RBRACE);
    node.OperatorDefinitionList = OperatorDefinitionList;
    return this.finishNode(node, 'PrimitiveOperatorDeclaration');
  }

  /**
   * proposal-runtime-types (explicit resource management): `using` is a valid
   * identifier, so it opens a declaration only when an identifier follows it on the
   * same line. A line break between them means the `using` was an expression
   * statement of its own, and a `[` or `{` after it is not a using declaration
   * either, since a resource is bound to a single name rather than destructured.
   */
  startsUsingDeclaration(): boolean {
    // Gated with the rest of this work: with the feature off the engine is the
    // base engine, where `using` is an ordinary identifier and a using
    // declaration is a Syntax Error. Upstream this belongs behind a feature of
    // its own, since explicit resource management is a base-language proposal
    // rather than part of the type system.
    if (!this.feature('runtime-types')) {
      return false;
    }
    const ahead = this.peekAhead();
    return !ahead.hadLineTerminatorBefore
      && (ahead.type === Token.IDENTIFIER || ahead.type === Token.YIELD || ahead.type === Token.AWAIT);
  }

  // LexicalDeclaration : LetOrConst BindingList `;`
  parseLexicalDeclaration(): ParseNode.LexicalDeclarationLike {
    const node = this.startNode<ParseNode.LexicalDeclaration>();
    // proposal-runtime-types (explicit resource management): `using` is a
    // contextual keyword, so it begins a declaration only when the next token is an
    // identifier on the same line; anywhere else it stays an ordinary identifier.
    let letOrConst: ParseNode.LetOrConst;
    if (this.test('using') && this.startsUsingDeclaration()) {
      this.eat('using');
      letOrConst = 'using';
    } else {
      letOrConst = this.eat('let') ? 'let' : this.expect(Token.CONST) && 'const';
    }
    node.LetOrConst = letOrConst;
    node.BindingList = this.parseBindingList();
    this.semicolon();

    this.scope.declare(node.BindingList, 'lexical');
    node.BindingList.forEach((b) => {
      // proposal-runtime-types: a `const` declaration without an initializer
      // remains a Syntax Error whether or not the binding carries a type
      // annotation (spec.emu sec-typed-declarations: "A `const` declaration
      // without an Initializer remains a Syntax Error, whether or not the binding
      // carries a TypeAnnotation"). This is the normative rule; the README prose
      // suggesting a typed const may omit its initializer is superseded here. A
      // typed `let` without an initializer does take the type's default.
      // PLAN-typed-const-default.md phase 2. #sec-typed-bindings: a `const`
      // declaration without an |Initializer| is a Syntax Error "where the
      // binding carries no |TypeAnnotation|" - the annotation is what makes the
      // initializer redundant rather than absent, since `const c: [].<uint8>;`
      // has already said that `c` holds a `uint8` array and therefore an empty
      // one.
      //
      // The clause said the opposite until this landed, and the comment above
      // said so - that the README prose was "superseded here". It was the README
      // that was right: every other typed binding takes its type's default, and
      // a `const` that could not would be the one place an annotation stops
      // carrying that meaning.
      //
      // Nothing else needed changing for the value to arrive: the defaulting
      // path in Evaluate_LexicalBinding sits in the no-initializer branch and
      // does not consult the declaration kind, and immutability is carried by
      // the binding's Const-ness rather than by how it was initialized.
      if (node.LetOrConst === 'const' && !b.Initializer && !b.TypedInitializer && !b.TypeAnnotation) {
        this.addEarlyError(Throw.SyntaxError('Missing initializer in const declaration'), b);
      }
      // proposal-runtime-types (references extension): a ref binding aliases
      // its initializer's storage location, so it cannot be declared without
      // one.
      if (b.Ref === true && !b.Initializer && !b.TypedInitializer) {
        this.addEarlyError(Throw.SyntaxError('Missing initializer in ref declaration'), b);
      }
      // proposal-runtime-types #sec-reference-syntax: a ref binding takes a
      // TypeAnnotation, not a TypedInitializer. `:=` infers a binding's type
      // from a VALUE, and a ref binding's initializer is a LOCATION - the two
      // forms contradict, so `let ref b := e` is refused at parse rather than
      // left to fail at evaluation.
      if (b.Ref === true && b.TypedInitializer) {
        this.addEarlyError(Throw.SyntaxError('A ref binding takes a type annotation, not a typed initializer'), b);
      }
    });

    return this.finishNode(node, 'LexicalDeclaration');
  }

  // BindingList :
  //   LexicalBinding
  //   BindingList `,` LexicalBinding
  //
  // LexicalBinding :
  //   BindingIdentifier Initializer?
  //   BindingPattern Initializer
  parseBindingList(): ParseNode.BindingList {
    const bindingList: Mutable<ParseNode.BindingList> = [];
    do {
      // proposal-runtime-types (references extension): `let ref b = a[0]` binds
      // b as an alias to the initializer's storage location rather than to its
      // value. Contextual: claimed only when an identifier follows `ref` on the
      // same line, so `let ref = 1` and a line break after `ref` keep their
      // base meanings.
      let ref = false;
      if (surroundingAgent.feature('runtime-types')
          && this.test('ref')
          && (this.peekAhead().type === Token.IDENTIFIER
            || this.peekAhead().type === Token.YIELD
            || this.peekAhead().type === Token.AWAIT)
          && !this.testAhead('of')
          && !this.peekAhead().hadLineTerminatorBefore) {
        this.next();
        ref = true;
      }
      const node = this.parseBindingElement({ allowTypedInitializer: true, allowOptionalMarker: false, ref });
      bindingList.push(this.repurpose(node, 'LexicalBinding'));
    } while (this.eat(Token.COMMA));
    return bindingList;
  }

  // BindingElement :
  //   SingleNameBinding
  //   BindingPattern Initializer?
  // SingleNameBinding :
  //   BindingIdentifier Initializer?
  parseBindingElement({ allowTypedInitializer = false, allowOptionalMarker = true, ref = false } = {}): ParseNode.BindingElementLike {
    const node = this.startNode<ParseNode.BindingElementLike>();
    if (this.test(Token.LBRACE) || this.test(Token.LBRACK)) {
      node.BindingPattern = this.parseBindingPattern();
    } else {
      node.BindingIdentifier = this.parseBindingIdentifier();
      if (surroundingAgent.feature('runtime-types')) {
        // SingleNameBinding : BindingIdentifier `?`? TypeAnnotation? Initializer?
        // LexicalBinding / VariableDeclaration : BindingIdentifier TypedInitializer
        if (allowOptionalMarker && this.eat(Token.CONDITIONAL)) {
          node.Optional = true;
        }
        if (this.test(Token.COLON)) {
          node.TypeAnnotation = this.parseTypeAnnotation();
        } else if (allowTypedInitializer && this.test(Token.COLON_EQ)) {
          node.TypedInitializer = this.parseTypedInitializer();
        }
      }
    }
    if (ref) {
      node.Ref = true;
    }
    node.Initializer = node.TypedInitializer ? null : this.parseInitializerOpt();
    return this.finishNode(node, node.BindingPattern ? 'BindingElement' : 'SingleNameBinding');
  }

  // BindingPattern:
  //   ObjectBindingPattern
  //   ArrayBindingPattern
  parseBindingPattern(): ParseNode.BindingPattern {
    switch (this.peek().type) {
      case Token.LBRACE:
        return this.parseObjectBindingPattern();
      case Token.LBRACK:
        return this.parseArrayBindingPattern();
      default:
        return this.unexpected();
    }
  }

  // ObjectBindingPattern :
  //   `{` `}`
  //   `{` BindingRestProperty `}`
  //   `{` BindingPropertyList `}`
  //   `{` BindingPropertyList `,` BindingRestProperty? `}`
  parseObjectBindingPattern(): ParseNode.ObjectBindingPattern {
    const node = this.startNode<ParseNode.ObjectBindingPattern>();
    this.expect(Token.LBRACE);
    const BindingPropertyList: Mutable<ParseNode.BindingPropertyList> = [];
    node.BindingPropertyList = BindingPropertyList;
    while (!this.eat(Token.RBRACE)) {
      if (this.test(Token.ELLIPSIS)) {
        node.BindingRestProperty = this.parseBindingRestProperty();
        this.expect(Token.RBRACE);
        break;
      } else {
        BindingPropertyList.push(this.parseBindingProperty());
        if (!this.eat(Token.COMMA)) {
          this.expect(Token.RBRACE);
          break;
        }
      }
    }
    return this.finishNode(node, 'ObjectBindingPattern');
  }

  // BindingProperty :
  //   SingleNameBinding
  //   PropertyName : BindingElement
  parseBindingProperty(): ParseNode.BindingPropertyLike {
    // proposal-runtime-types #sec-typed-destructuring: a member of an object
    // pattern carries its type inside PARENTHESES, `{ (a: uint8) }`. The
    // parentheses are what make the form statable at all: `{ a: uint8 }`
    // already means "bind property `a` to a new name `uint8`", so the
    // annotation cannot follow the colon, and the parenthesized member leaves
    // the rename colon free - `{ (a: uint8): b }` annotates AND renames.
    if (surroundingAgent.feature('runtime-types') && this.test(Token.LPAREN)) {
      return this.parseTypedBindingProperty();
    }
    const node = this.startNode<ParseNode.BindingProperty | ParseNode.SingleNameBinding>();
    const name = this.parsePropertyName();
    if (this.eat(Token.COLON)) {
      node.PropertyName = name;
      node.BindingElement = this.parseBindingElement();
      return this.finishNode(node, 'BindingProperty');
    } else {
      if (name.type !== 'IdentifierName') {
        this.unexpected(name);
      }
      this.validateIdentifierReference(name.name, node);
    }
    node.BindingIdentifier = this.repurpose(name, 'BindingIdentifier');
    if (surroundingAgent.feature('runtime-types')) {
      // SingleNameBinding : BindingIdentifier `?`? TypeAnnotation? Initializer?
      // A bare `:` after the name is the BindingProperty rename handled above.
      if (this.eat(Token.CONDITIONAL)) {
        node.Optional = true;
      }
      if (this.test(Token.COLON)) {
        node.TypeAnnotation = this.parseTypeAnnotation();
      }
    }
    node.Initializer = this.parseInitializerOpt();
    return this.finishNode(node, 'SingleNameBinding');
  }

  /**
   * proposal-runtime-types #sec-typed-destructuring:
   * BindingProperty : `(` `ref`? BindingIdentifier `?`? TypeAnnotation? `)` (`:` BindingElement)? Initializer?
   *
   * The parenthesized member. Without a rename it binds the named property to
   * a binding of the same name at the stated type; with one, the parentheses
   * name the PROPERTY and the binding follows the colon. A `ref` member
   * borrows that property's location on the object being destructured
   * (#sec-reference-syntax), which is why it takes an ordinary argument: the
   * location belongs to the object, not to the caller's variable.
   */
  parseTypedBindingProperty(): ParseNode.BindingPropertyLike {
    const node = this.startNode<ParseNode.BindingProperty | ParseNode.SingleNameBinding>();
    this.expect(Token.LPAREN);
    let ref = false;
    if (this.test('ref')
        && !this.peekAhead().hadLineTerminatorBefore
        && (this.peekAhead().type === Token.IDENTIFIER
          || this.peekAhead().type === Token.YIELD
          || this.peekAhead().type === Token.AWAIT)) {
      this.next();
      ref = true;
    }
    const inner = this.parseBindingIdentifier();
    let optional = false;
    if (this.eat(Token.CONDITIONAL)) {
      optional = true;
    }
    const annotation = this.test(Token.COLON) ? this.parseTypeAnnotation() : undefined;
    this.expect(Token.RPAREN);
    if (this.eat(Token.COLON)) {
      // `{ (a: uint8): b }` - the parenthesized name is the property, and the
      // binding that receives it follows, carrying the stated type.
      node.PropertyName = this.repurpose(inner, 'IdentifierName');
      const element = this.parseBindingElement() as Mutable<ParseNode.BindingElement | ParseNode.SingleNameBinding>;
      if (element.type === 'SingleNameBinding') {
        if (annotation) {
          element.TypeAnnotation = annotation;
        }
        if (optional) {
          element.Optional = true;
        }
        if (ref) {
          element.Ref = true;
        }
      } else if (ref || annotation) {
        this.addEarlyError(Throw.SyntaxError('A typed destructuring member must bind a single name'), element);
      }
      node.BindingElement = element as ParseNode.BindingElement;
      return this.finishNode(node, 'BindingProperty');
    }
    node.BindingIdentifier = inner;
    if (annotation) {
      node.TypeAnnotation = annotation;
    }
    if (optional) {
      node.Optional = true;
    }
    if (ref) {
      node.Ref = true;
    }
    node.Initializer = this.parseInitializerOpt();
    if (ref && node.Initializer) {
      this.addEarlyError(Throw.SyntaxError('A ref member may not have a default value'), node.Initializer);
    }
    // proposal-runtime-types: nor an optional marker. A `ref` member borrows the
    // property's LOCATION, which is there whether or not the property is, so
    // `?` distinguished nothing - `(ref x)` and `(ref x?)` behaved identically.
    if (ref && optional) {
      this.addEarlyError(Throw.SyntaxError('A ref member may not be optional'), node);
    }
    return this.finishNode(node, 'SingleNameBinding');
  }

  // BindingRestProperty :
  //  `...` BindingIdentifier TypeAnnotation?
  parseBindingRestProperty(): ParseNode.BindingRestProperty {
    const node = this.startNode<ParseNode.BindingRestProperty>();
    this.expect(Token.ELLIPSIS);
    node.BindingIdentifier = this.parseBindingIdentifier();
    // proposal-runtime-types #sec-typed-destructuring: an object rest may state
    // the type of what it COLLECTS, as an array rest already may
    // (`let [a: uint8, ...b: [].<uint8>]`) and as a rest parameter does. The
    // rest is where a payload's unmodelled remainder goes, so leaving it the
    // one untypeable position typed the members an author already understands
    // and not the part they understand least.
    //
    // No parentheses here: they exist for a MEMBER because `{ a: uint8 }`
    // already means a rename, and a rest has no such collision.
    if (surroundingAgent.feature('runtime-types') && this.test(Token.COLON)) {
      (node as ParseNode.Unfinished<ParseNode.BindingRestProperty>).TypeAnnotation = this.parseTypeAnnotation();
    }
    return this.finishNode(node, 'BindingRestProperty');
  }

  // ArrayBindingPattern :
  //   `[` Elision? BindingRestElement `]`
  //   `[` BindingElementList `]`
  //   `[` BindingElementList `,` Elision? BindingRestElement `]`
  parseArrayBindingPattern(): ParseNode.ArrayBindingPattern {
    const node = this.startNode<ParseNode.ArrayBindingPattern>();
    this.expect(Token.LBRACK);
    const BindingElementList: Mutable<ParseNode.BindingElementList> = [];
    node.BindingElementList = BindingElementList;
    while (true) {
      while (this.test(Token.COMMA)) {
        const elision = this.startNode<ParseNode.Elision>();
        this.next();
        BindingElementList.push(this.finishNode(elision, 'Elision'));
      }
      if (this.eat(Token.RBRACK)) {
        break;
      }
      if (this.test(Token.ELLIPSIS)) {
        node.BindingRestElement = this.parseBindingRestElement();
        this.expect(Token.RBRACK);
        break;
      } else {
        BindingElementList.push(this.parseBindingElement());
      }
      if (this.eat(Token.RBRACK)) {
        break;
      }
      this.expect(Token.COMMA);
    }
    return this.finishNode(node, 'ArrayBindingPattern');
  }

  // BindingRestElement :
  //   `...` BindingIdentifier
  //   `...` BindingPattern
  parseBindingRestElement(): ParseNode.BindingRestElement {
    const node = this.startNode<ParseNode.BindingRestElement>();
    this.expect(Token.ELLIPSIS);
    switch (this.peek().type) {
      case Token.LBRACE:
      case Token.LBRACK:
        node.BindingPattern = this.parseBindingPattern();
        break;
      default:
        node.BindingIdentifier = this.parseBindingIdentifier();
        break;
    }
    // proposal-runtime-types: a rest parameter may carry a type annotation, an
    // array type describing its element type (README "Rest Parameters":
    // `...args: [].<uint32>`). The function-type form already admits this; the
    // declaration form does too.
    if (surroundingAgent.feature('runtime-types') && this.test(Token.COLON)) {
      (node as Mutable<ParseNode.BindingRestElement>).TypeAnnotation = this.parseTypeAnnotation();
    }
    return this.finishNode(node, 'BindingRestElement');
  }

  // Initializer : `=` AssignmentExpression
  parseInitializerOpt(): ParseNode.Initializer | null {
    if (this.eat(Token.ASSIGN)) {
      return this.parseAssignmentExpression();
    }
    return null;
  }

  // FunctionDeclaration
  parseFunctionDeclaration(kind: FunctionKind): ParseNode.FunctionDeclarationLike {
    return this.parseFunction(false, kind) as ParseNode.FunctionDeclarationLike;
  }

  /**
   * A decoration and whatever it decorates.
   *
   * proposal-runtime-types decorators.md: `@` no longer implies a class. Shared
   * by the statement path and the MODULE ITEM path - the latter parsed the list
   * and then called parseClassDeclaration unconditionally, so at module top
   * level only a class could be decorated. `sec-syntax-replacement` says every
   * decorable position may be syntax-replaced, and a component macro sits
   * exactly there, so the two paths have to agree.
   */
  parseDecoratedStatementListItem(alreadyParsed?: readonly ParseNode.Decorator[]): ParseNode.StatementListItem {
    // The module-item path consumes the list before it knows whether an `export`
    // follows, so it passes what it already has rather than parsing twice.
    const decorators = alreadyParsed ?? this.parseDecorators();
    // A decoration whose name declared a lexical MODE takes its region whole,
    // scanned by delimiter rather than tokenized as ECMAScript. This has to
    // happen before the ordinary dispatch below, because the region's contents
    // are exactly what that dispatch cannot parse.
    const moded = this.parseModedRegion(decorators);
    if (moded !== undefined) {
      return moded as unknown as ParseNode.StatementListItem;
    }
    const give = <T,>(node: T): T => {
      (node as { Decorators?: readonly ParseNode.Decorator[] | null }).Decorators = decorators;
      return node;
    };
    switch (this.peek().type) {
      case Token.FUNCTION:
        return give(this.parseHoistableDeclaration());
      case Token.CONST:
        return give(this.parseLexicalDeclaration());
      case Token.ENUM:
        // proposal-runtime-types decorators.md: `@f enum Count { ... }`.
        return give(this.parseEnumDeclaration());
      case Token.LBRACE:
        // A decorated BLOCK. The decorators were consumed above, so the block is
        // parsed directly and given them here rather than through parseBlock's
        // own list.
        return give(this.parseBlockInner());
      case Token.CLASS:
        return this.parseClassDeclaration(decorators);
      default: {
        if (this.test('let')) {
          return give(this.parseLexicalDeclaration());
        }
        if (this.test(Token.CLASS)) {
          return this.parseClassDeclaration(decorators);
        }
        // Any other STATEMENT is admitted here and judged by the static
        // semantics, because whether it is legal depends on the decoration's
        // KIND and the grammar does not know that.
        //
        // decoratorreplacement.md 7.7, "two tables, not one": syntax replacement
        // is constrained by GRAMMAR and value replacement by TYPE. A statement
        // has syntax, so a REPLACEMENT decorator may rewrite one - which is what
        // a cfg-style macro over `@m return 1;` needs. A RUNTIME decorator may
        // not: it runs when the declaration it decorates is evaluated, and a
        // statement declares nothing to run at.
        //
        // The marker records that the fallback was taken, so the early error
        // need not re-derive which forms are declarations.
        const stmt = give(this.parseStatement());
        (stmt as { DecoratedStatement?: boolean }).DecoratedStatement = true;
        return stmt;
      }
    }
  }

  // Statement :
  //   ...
  parseStatement(): ParseNode.Statement {
    switch (this.peek().type) {
      case Token.AT: {
        // proposal-runtime-types decorators.md: `if (c) @f { }`,
        // `while (c) @f { }`, `for (...) @f { }` — a loop or conditional BODY
        // is parsed here, so a decorated block needs the case in this dispatch
        // as well as in the statement-list one. Only a block may be decorated
        // in statement position; anything else falls through to the ordinary
        // expression path, which is what refuses `@f x = 1;`.
        if (surroundingAgent.feature('runtime-types')) {
          const decorators = this.parseDecorators();
          if (this.test(Token.LBRACE)) {
            const block = this.parseBlockInner();
            (block as { Decorators?: readonly ParseNode.Decorator[] | null }).Decorators = decorators;
            return block;
          }
          return this.unexpected();
        }
        return this.unexpected();
      }
      case Token.LBRACE:
        return this.parseBlockStatement();
      case Token.VAR:
        return this.parseVariableStatement();
      case Token.SEMICOLON: {
        const node = this.startNode<ParseNode.EmptyStatement>();
        this.next();
        return this.finishNode(node, 'EmptyStatement');
      }
      case Token.IF:
        return this.parseIfStatement();
      case Token.DO:
        return this.parseDoWhileStatement();
      case Token.WHILE:
        return this.parseWhileStatement();
      case Token.FOR:
        return this.parseForStatement();
      case Token.SWITCH:
        return this.parseSwitchStatement();
      case Token.CONTINUE:
      case Token.BREAK:
        return this.parseBreakContinueStatement();
      case Token.RETURN:
        return this.parseReturnStatement();
      case Token.WITH:
        return this.parseWithStatement();
      case Token.THROW:
        return this.parseThrowStatement();
      case Token.TRY:
        return this.parseTryStatement();
      case Token.DEBUGGER:
        return this.parseDebuggerStatement();
      default: {
        // proposal-runtime-types (references extension): `ref b = a[1]` rebinds
        // an existing mutable ref binding to a different storage location.
        // Claimed only for the exact shape `ref` Identifier `=` on one line;
        // anything else (a call `ref(x)`, an assignment `ref = 1`, a lone
        // `ref`) is the ordinary identifier, restored by checkpoint.
        if (surroundingAgent.feature('runtime-types')
            && this.test('ref')
            && (this.peekAhead().type === Token.IDENTIFIER
              || this.peekAhead().type === Token.YIELD
              || this.peekAhead().type === Token.AWAIT)
            && !this.peekAhead().hadLineTerminatorBefore) {
          const node = this.startNode<ParseNode.RefRebindingStatement>();
          const checkpoint = this.getLexerCheckpoint();
          this.next();
          if (this.testAhead(Token.ASSIGN)) {
            node.BindingIdentifier = this.parseBindingIdentifier();
            this.expect(Token.ASSIGN);
            node.Expression = this.parseLeftHandSideExpression();
            this.semicolon();
            return this.finishNode(node, 'RefRebindingStatement');
          }
          this.restoreLexerCheckpoint(checkpoint);
        }
        return this.parseExpressionStatement();
      }
    }
  }

  // BlockStatement : Block
  parseBlockStatement(): ParseNode.BlockStatement {
    return this.parseBlock();
  }

  // Block : `{` StatementList `}`
  /**
   * proposal-runtime-types decorators.md: a BLOCK carries decorators —
   * `@f { ... }`, `if (c) @f { }`, `while (c) @f { }`, and the rest. The list
   * is parsed here so every block position gets it at once rather than each
   * statement form growing its own.
   *
   * A block reflection carries `label` and, per the design, a `block:
   * Expression` that "is not defined here. Macro AST is out of scope." So only
   * the label and the firing are real; see the stage note in PLAN-decorators.md.
   */
  parseBlock(lexical = true): ParseNode.Block {
    if (surroundingAgent.feature('runtime-types') && this.test(Token.AT)) {
      const decorators = this.parseDecorators();
      const block = this.parseBlockInner(lexical);
      (block as { Decorators?: readonly ParseNode.Decorator[] | null }).Decorators = decorators;
      return block;
    }
    return this.parseBlockInner(lexical);
  }

  parseBlockInner(lexical = true): ParseNode.Block {
    const node = this.startNode<ParseNode.Block>();
    this.expect(Token.LBRACE);
    node.StatementList = this.scope.with({ lexical }, () => this.parseStatementList(Token.RBRACE));
    return this.finishNode(node, 'Block');
  }

  // VariableStatement : `var` VariableDeclarationList `;`
  parseVariableStatement(): ParseNode.VariableStatement {
    const node = this.startNode<ParseNode.VariableStatement>();
    this.expect(Token.VAR);
    node.VariableDeclarationList = this.parseVariableDeclarationList();
    this.semicolon();
    this.scope.declare(node.VariableDeclarationList, 'variable');
    return this.finishNode(node, 'VariableStatement');
  }

  // VariableDeclarationList :
  //   VariableDeclaration
  //   VariableDeclarationList `,` VariableDeclaration
  parseVariableDeclarationList(firstDeclarationRequiresInit = true): ParseNode.VariableDeclarationList {
    const declarationList: Mutable<ParseNode.VariableDeclarationList> = [];
    do {
      const node = this.parseVariableDeclaration(firstDeclarationRequiresInit);
      declarationList.push(node);
    } while (this.eat(Token.COMMA));
    return declarationList;
  }

  // VariableDeclaration :
  //   BindingIdentifier Initializer?
  //   BindingPattern Initializer
  parseVariableDeclaration(firstDeclarationRequiresInit: boolean): ParseNode.VariableDeclaration {
    const node = this.startNode<ParseNode.VariableDeclaration>();
    switch (this.peek().type) {
      case Token.LBRACE:
      case Token.LBRACK:
        node.BindingPattern = this.parseBindingPattern();
        if (firstDeclarationRequiresInit) {
          this.expect(Token.ASSIGN);
          node.Initializer = this.parseAssignmentExpression();
        } else {
          node.Initializer = this.parseInitializerOpt();
        }
        break;
      default:
        node.BindingIdentifier = this.parseBindingIdentifier();
        if (surroundingAgent.feature('runtime-types')) {
          // VariableDeclaration : BindingIdentifier TypeAnnotation? Initializer?
          //                     / BindingIdentifier TypedInitializer
          if (this.test(Token.COLON)) {
            node.TypeAnnotation = this.parseTypeAnnotation();
          } else if (this.test(Token.COLON_EQ)) {
            node.TypedInitializer = this.parseTypedInitializer();
          }
        }
        node.Initializer = node.TypedInitializer ? null : this.parseInitializerOpt();
        break;
    }
    return this.finishNode(node, 'VariableDeclaration');
  }

  // IfStatement :
  //  `if` `(` Expression `)` Statement `else` Statement
  //  `if` `(` Expression `)` Statement [lookahead != `else`]
  /**
   * proposal-runtime-types decorators.md: a block's decorator context is
   * `IfBlock`, `ElseBlock`, `WhileBlock`, `ForBlock` and the rest by the
   * statement that OWNS it - and the block node carried no record of that, so
   * all eight reported the bare `Block`. Marked here, where the owning form is
   * known; the evaluator reads it back. An `else if` marks the inner `if`'s
   * consequent as `ElseIfBlock`, which is the one subkind that is not simply
   * the keyword above it.
   */
  /**
   * Records the label a decorated block was written under.
   *
   * The label may name the block directly - `lbl: { … }` - or the STATEMENT
   * that owns it: `outer: while (c) { … }` labels the loop, and the block is
   * its body. decorators.md gives `WhileBlock` and its siblings a `label`, and
   * the label those forms have is the owning statement's, so it propagates one
   * level into the body. Anything deeper is a different block with a label of
   * its own.
   */
  protected markBlockLabel(statement: unknown, label: string): void {
    if (!surroundingAgent.feature('runtime-types')) {
      return;
    }
    const owned = statement as {
      type?: string,
      Statement?: unknown,
      Statement_a?: unknown,
    };
    // A DECORATED statement is itself the target: the decoration sits on the
    // `while`, so its context is the one that should report the label, not the
    // body block's. Otherwise `lbl: @m while (c) { }` marks the inner block and
    // the macro decorating the loop sees nothing.
    const decorated = (owned as { Decorators?: readonly unknown[] } | undefined)?.Decorators;
    const target = (Array.isArray(decorated) && decorated.length > 0) || owned?.type === 'Block'
      ? owned
      : [owned?.Statement, owned?.Statement_a].find((n) => (n as { type?: string })?.type === 'Block');
    if (target && (target as { BlockLabel?: string }).BlockLabel === undefined) {
      (target as { BlockLabel?: string }).BlockLabel = label;
    }
  }

  protected markBlockKind<T>(statement: T, kind: string, parts?: ParseNode.BlockParts): T {
    if (surroundingAgent.feature('runtime-types')
        && (statement as { type?: string })?.type === 'Block') {
      (statement as { BlockKind?: string }).BlockKind = kind;
      if (parts) {
        // decorators.md gives `IfBlock` a `condition` and `ForBlock` an
        // `initializer`, `condition` and `update` - parts of the OWNING
        // statement, which the block node cannot otherwise reach. Recorded here
        // because this is the one place both are in hand.
        // NON-ENUMERABLE, because these are REFERENCES to nodes that already sit
        // elsewhere in the tree - the condition of the `if`, the binding of the
        // `for`-`of`. A walker that enumerates a node's properties to find its
        // children would otherwise reach each of them twice and report, for
        // instance, two ForBindings for one `for`-`of` head. The block reflection
        // reads this by name and does not enumerate, so nothing it needs is lost.
        Object.defineProperty(statement as object, 'BlockParts', {
          value: parts, writable: true, enumerable: false, configurable: true,
        });
      }
    }
    return statement;
  }

  parseIfStatement(): ParseNode.IfStatement {
    const node = this.startNode<ParseNode.IfStatement>();
    this.expect(Token.IF);
    this.expect(Token.LPAREN);
    node.Expression = this.parseExpression();
    this.expect(Token.RPAREN);
    node.Statement_a = this.markBlockKind(this.parseStatement(), 'IfBlock', { condition: node.Expression });
    if (this.eat(Token.ELSE)) {
      const alternative = this.parseStatement();
      // `else if (...) { }` is an IfStatement in the alternative position; its
      // CONSEQUENT is the ElseIfBlock, and a bare `else { }` is the ElseBlock.
      if ((alternative as { type?: string }).type === 'IfStatement') {
        this.markBlockKind((alternative as unknown as { Statement_a?: unknown }).Statement_a, 'ElseIfBlock');
        node.Statement_b = alternative;
      } else {
        node.Statement_b = this.markBlockKind(alternative, 'ElseBlock');
      }
    }
    return this.finishNode(node, 'IfStatement');
  }

  // `while` `(` Expression `)` Statement
  parseWhileStatement(): ParseNode.WhileStatement {
    const node = this.startNode<ParseNode.WhileStatement>();
    this.expect(Token.WHILE);
    this.expect(Token.LPAREN);
    // proposal-runtime-types #sec-do-expression-early-errors: an unlabelled
    // break or continue inside a `do` in a loop HEAD targets a loop that has
    // not been entered, so the flag marks the head rather than the body.
    this.inIterationHead = true;
    node.Expression = this.parseExpression();
    this.inIterationHead = false;
    this.expect(Token.RPAREN);
    this.scope.with({ label: 'loop' }, () => {
      node.Statement = this.markBlockKind(this.parseStatement(), 'WhileBlock', { condition: node.Expression });
    });
    return this.finishNode(node, 'WhileStatement');
  }

  // `do` Statement `while` `(` Expression `)` `;`
  parseDoWhileStatement(): ParseNode.DoWhileStatement {
    const node = this.startNode<ParseNode.DoWhileStatement>();
    this.expect(Token.DO);
    node.Statement = this.scope.with({ label: 'loop' }, () => this.parseStatement());
    this.expect(Token.WHILE);
    this.expect(Token.LPAREN);
    node.Expression = this.parseExpression();
    this.expect(Token.RPAREN);
    // Semicolons are completely optional after a do-while, even without a newline
    this.eat(Token.SEMICOLON);
    this.markBlockKind((node as { Statement?: unknown }).Statement, 'DoWhileBlock', { condition: node.Expression });
    return this.finishNode(node, 'DoWhileStatement');
  }

  // `for` `(` [lookahead != `let` `[`] Expression? `;` Expression? `;` Expression? `)` Statement
  // `for` `(` `var` VariableDeclarationList `;` Expression? `;` Expression? `)` Statement
  // `for` `(` LexicalDeclaration Expression? `;` Expression? `)` Statement
  // `for` `(` [lookahead != `let` `[`] LeftHandSideExpression `in` Expression `)` Statement
  // `for` `(` `var` ForBinding `in` Expression `)` Statement
  // `for` `(` ForDeclaration `in` Expression `)` Statement
  // `for` `(` [lookahead != { `let`, `async` `of` }] LeftHandSideExpression `of` AssignmentExpression `)` Statement
  // `for` `(` `var` ForBinding `of` AssignmentExpression `)` Statement
  // `for` `(` ForDeclaration `of` AssignmentExpression `)` Statement
  // `for` `await` `(` [lookahead != `let`] LeftHandSideExpression `of` AssignmentExpression `)` Statement
  // `for` `await` `(` `var` ForBinding `of` AssignmentExpression `)` Statement
  // `for` `await` `(` ForDeclaration `of` AssignmentExpression `)` Statement
  //
  // ForDeclaration : LetOrConst ForBinding
  parseForStatement(): ParseNode.ForStatement | ParseNode.ForInOfStatement {
    return this.scope.with({
      lexical: true,
      label: 'loop',
    }, () => {
      const node = this.startNode<ParseNode.ForStatement | ParseNode.ForInOfStatement>();
      this.expect(Token.FOR);
      const isAwait = this.scope.hasAwait() && this.eat(Token.AWAIT);
      if (isAwait && !this.scope.hasReturn()) {
        this.state.hasTopLevelAwait = true;
      }
      this.expect(Token.LPAREN);
      // The whole of a `for` head, per #sec-do-expression-early-errors: the
      // initializer, the test, and the update are all before the loop is
      // entered, so an unlabelled break in any of them targets nothing yet.
      this.inIterationHead = true;
      if (isAwait && this.test(Token.SEMICOLON)) {
        this.unexpected();
      }
      if (this.eat(Token.SEMICOLON)) {
        if (!this.test(Token.SEMICOLON)) {
          node.Expression_b = this.parseExpression();
        }
        this.expect(Token.SEMICOLON);
        if (!this.test(Token.RPAREN)) {
          node.Expression_c = this.parseExpression();
        }
        // The head ends here; the body is parsed after it.
        this.inIterationHead = false;
        this.expect(Token.RPAREN);
        node.Statement = this.parseStatement();
        this.markBlockKind((node as { Statement?: unknown }).Statement, 'ForBlock', forParts(node));
    return this.finishNode(node, 'ForStatement');
      }
      const isLexicalStart = () => {
        switch (this.peekAhead().type) {
          case Token.LBRACE:
          case Token.LBRACK:
          case Token.IDENTIFIER:
          case Token.YIELD:
          case Token.AWAIT:
            return true;
          default:
            return false;
        }
      };
      if ((this.test('let') || this.test(Token.CONST)) && isLexicalStart()) {
        const inner = this.startNode<ParseNode.LexicalDeclaration | ParseNode.ForDeclaration>();
        if (this.eat('let')) {
          inner.LetOrConst = 'let';
        } else {
          this.expect(Token.CONST);
          inner.LetOrConst = 'const';
        }
        const list = this.parseBindingList();
        this.scope.declare(list, 'lexical');
        if (list.length > 1 || this.test(Token.SEMICOLON)) {
          if (isAwait) {
            this.unexpected();
          }
          if (inner.LetOrConst === 'const') {
            list.forEach((b) => {
              if (!b.Initializer) {
                this.addEarlyError(Throw.SyntaxError('Missing initializer in const declaration'), b);
              }
            });
          }
          // proposal-runtime-types #sec-reference-syntax: a ref binding may not
          // appear in a for statement's initializer. The per-iteration
          // environment copies a head binding BY VALUE into each iteration,
          // which would silently decay the alias to a copy; the form is refused
          // until the per-iteration semantics of a location binding are
          // specified.
          list.forEach((b) => {
            if (b.Ref === true) {
              this.addEarlyError(Throw.SyntaxError('A ref binding may not appear in a for statement initializer'), b);
            }
          });
          inner.BindingList = list;
          node.LexicalDeclaration = this.finishNode(inner, 'LexicalDeclaration');
          this.expect(Token.SEMICOLON);
          if (!this.test(Token.SEMICOLON)) {
            node.Expression_a = this.parseExpression();
          }
          this.expect(Token.SEMICOLON);
          if (!this.test(Token.RPAREN)) {
            node.Expression_b = this.parseExpression();
          }
          // The head ends here; the body is parsed after it.
          this.inIterationHead = false;
          this.expect(Token.RPAREN);
          node.Statement = this.parseStatement();
          this.markBlockKind((node as { Statement?: unknown }).Statement, 'ForBlock', forParts(node));
    return this.finishNode(node, 'ForStatement');
        }
        inner.ForBinding = this.repurpose(list[0], 'ForBinding', (_, oldNode) => {
          if (oldNode.Initializer) {
            this.unexpected(oldNode.Initializer);
          }
        });
        node.ForDeclaration = this.finishNode(inner, 'ForDeclaration');
        getDeclarations(node.ForDeclaration)
          .forEach((d) => {
            if (d.name === 'let') {
              this.addEarlyError(Throw.SyntaxError('Unexpected token let'), d.node);
            }
          });
        if (!isAwait && this.eat(Token.IN)) {
          // proposal-runtime-types #sec-reference-syntax: a ref binding is a
          // borrow of an ELEMENT SLOT, which a for-of over an array supplies
          // and a for-in, which walks property KEYS as strings, does not.
          if (inner.ForBinding.Ref === true) {
            this.addEarlyError(Throw.SyntaxError('A ref binding requires a for-of loop'), inner.ForBinding);
          }
          node.Expression = this.parseExpression();
          // The head ends here; the body is parsed after it.
          this.inIterationHead = false;
          this.expect(Token.RPAREN);
          node.Statement = this.parseStatement();
        this.markBlockKind((node as { Statement?: unknown }).Statement, 'ForInBlock', forInOfParts(node));
    return this.finishNode(node, 'ForInStatement');
        }
        // proposal-runtime-types #sec-reference-syntax: reference iteration is
        // synchronous and index-based; a for await goes through the async
        // iterator protocol, which yields VALUES and has no element slot a
        // borrow could alias.
        if (isAwait && inner.ForBinding.Ref === true) {
          this.addEarlyError(Throw.SyntaxError('A ref binding is not allowed in a for await loop'), inner.ForBinding);
        }
        this.expect('of');
        node.AssignmentExpression = this.parseAssignmentExpression();
        // The head ends here; the body is parsed after it.
        this.inIterationHead = false;
        this.expect(Token.RPAREN);
        node.Statement = this.parseStatement();
        this.markBlockKind((node as { Statement?: unknown }).Statement, 'ForOfBlock', forInOfParts(node));
        return this.finishNode(node, isAwait ? 'ForAwaitStatement' : 'ForOfStatement');
      }
      if (this.eat(Token.VAR)) {
        if (isAwait) {
          node.ForBinding = this.parseForBinding();
          this.expect('of');
          node.AssignmentExpression = this.parseAssignmentExpression();
          // The head ends here; the body is parsed after it.
          this.inIterationHead = false;
          this.expect(Token.RPAREN);
          node.Statement = this.parseStatement();
          return this.finishNode(node, 'ForAwaitStatement');
        }
        const list = this.parseVariableDeclarationList(false);
        if (list.length > 1 || this.test(Token.SEMICOLON)) {
          node.VariableDeclarationList = list;
          this.expect(Token.SEMICOLON);
          if (!this.test(Token.SEMICOLON)) {
            node.Expression_a = this.parseExpression();
          }
          this.expect(Token.SEMICOLON);
          if (!this.test(Token.RPAREN)) {
            node.Expression_b = this.parseExpression();
          }
          // The head ends here; the body is parsed after it.
          this.inIterationHead = false;
          this.expect(Token.RPAREN);
          node.Statement = this.parseStatement();
          this.markBlockKind((node as { Statement?: unknown }).Statement, 'ForBlock', forParts(node));
    return this.finishNode(node, 'ForStatement');
        }
        node.ForBinding = this.repurpose(list[0], 'ForBinding', (_, oldNode) => {
          if (oldNode.Initializer) {
            this.unexpected(oldNode.Initializer);
          }
        });
        if (this.eat('of')) {
          node.AssignmentExpression = this.parseAssignmentExpression();
        } else {
          this.expect(Token.IN);
          node.Expression = this.parseExpression();
        }
        // The head ends here; the body is parsed after it.
        this.inIterationHead = false;
        this.expect(Token.RPAREN);
        node.Statement = this.parseStatement();
        this.markBlockKind((node as { Statement?: unknown }).Statement, node.AssignmentExpression ? 'ForOfBlock' : 'ForInBlock', forInOfParts(node));
        return this.finishNode(node, node.AssignmentExpression ? 'ForOfStatement' : 'ForInStatement');
      }

      this.scope.pushAssignmentInfo('for');
      const expression = this.scope.with({ in: false }, () => this.parseExpression());
      const validateLHS = (n: ParseNode) => {
        if (n.type === 'AssignmentExpression') {
          this.addEarlyError(Throw.SyntaxError('Invalid left-hand side in for-in/of statement'), n);
        } else {
          this.validateAssignmentTarget(n);
        }
      };
      const assignmentInfo = this.scope.popAssignmentInfo();
      if (!isAwait && this.eat(Token.IN)) {
        assignmentInfo.clear();
        validateLHS(expression);
        node.LeftHandSideExpression = expression as ParseNode.LeftHandSideExpression; // NOTE: unsound cast
        node.Expression = this.parseExpression();
        // The head ends here; the body is parsed after it.
        this.inIterationHead = false;
        this.expect(Token.RPAREN);
        node.Statement = this.parseStatement();
        this.markBlockKind((node as { Statement?: unknown }).Statement, 'ForInBlock', forInOfParts(node));
    return this.finishNode(node, 'ForInStatement');
      }
      const isExactlyAsync = expression.type === 'IdentifierReference'
        && !expression.escaped
        && expression.name === 'async';
      if ((!isExactlyAsync || isAwait) && this.eat('of')) {
        assignmentInfo.clear();
        validateLHS(expression);
        node.LeftHandSideExpression = expression as ParseNode.LeftHandSideExpression; // NOTE: unsound cast
        node.AssignmentExpression = this.parseAssignmentExpression();
        // The head ends here; the body is parsed after it.
        this.inIterationHead = false;
        this.expect(Token.RPAREN);
        node.Statement = this.parseStatement();
        this.markBlockKind((node as { Statement?: unknown }).Statement, 'ForOfBlock', forInOfParts(node));
        return this.finishNode(node, isAwait ? 'ForAwaitStatement' : 'ForOfStatement');
      }

      if (isAwait) {
        this.unexpected();
      }

      node.Expression_a = expression;
      this.expect(Token.SEMICOLON);

      if (!this.test(Token.SEMICOLON)) {
        node.Expression_b = this.parseExpression();
      }
      this.expect(Token.SEMICOLON);

      if (!this.test(Token.RPAREN)) {
        node.Expression_c = this.parseExpression();
      }
      // The head ends here; the body is parsed after it.
      this.inIterationHead = false;
      this.expect(Token.RPAREN);

      node.Statement = this.parseStatement();
      this.markBlockKind((node as { Statement?: unknown }).Statement, 'ForBlock', forParts(node));
    return this.finishNode(node, 'ForStatement');
    });
  }

  // ForBinding :
  //   BindingIdentifier
  //   BindingPattern
  parseForBinding(): ParseNode.ForBinding {
    const node = this.startNode<ParseNode.ForBinding>();
    // proposal-runtime-types #sec-reference-syntax: no ref claim here. This
    // path parses only `var` heads (including `for await (var ...)`), and a
    // ref binding is lexical - `for (const ref p of a)` reaches its claim
    // through parseBindingList. A `var ref p` therefore keeps its base
    // meaning, a binding named ref followed by an unexpected token.
    switch (this.peek().type) {
      case Token.LBRACE:
      case Token.LBRACK:
        node.BindingPattern = this.parseBindingPattern();
        break;
      default:
        node.BindingIdentifier = this.parseBindingIdentifier();
        // ForBinding : BindingIdentifier TypeAnnotation?
        if (surroundingAgent.feature('runtime-types') && this.test(Token.COLON)) {
          node.TypeAnnotation = this.parseTypeAnnotation();
        }
        break;
    }
    return this.finishNode(node, 'ForBinding');
  }


  // SwitchStatement :
  //   `switch` `(` Expression `)` CaseBlock
  parseSwitchStatement(): ParseNode.SwitchStatement {
    const node = this.startNode<ParseNode.SwitchStatement>();
    this.expect(Token.SWITCH);
    this.expect(Token.LPAREN);
    node.Expression = this.parseExpression();
    this.expect(Token.RPAREN);
    this.scope.with({
      lexical: true,
      label: 'switch',
    }, () => {
      node.CaseBlock = this.parseCaseBlock();
    });
    return this.finishNode(node, 'SwitchStatement');
  }

  // CaseBlock :
  //   `{` CaseClauses? `}`
  //   `{` CaseClauses? DefaultClause CaseClauses? `}`
  // CaseClauses :
  //   CaseClause
  //   CaseClauses CauseClause
  // CaseClause :
  //   `case` Expression `:` StatementList?
  // DefaultClause :
  //   `default` `:` StatementList?
  parseCaseBlock(): ParseNode.CaseBlock {
    const node = this.startNode<ParseNode.CaseBlock>();
    let CaseClauses_a: Mutable<ParseNode.CaseClauses> | undefined;
    let CaseClauses_b: Mutable<ParseNode.CaseClauses> | undefined;
    this.expect(Token.LBRACE);
    while (!this.eat(Token.RBRACE)) {
      switch (this.peek().type) {
        case Token.CASE:
        case Token.DEFAULT: {
          const inner = this.startNode<ParseNode.CaseClause | ParseNode.DefaultClause>();
          const t = this.next().type;
          if (t === Token.DEFAULT && node.DefaultClause) {
            this.unexpected();
          }
          if (t === Token.CASE) {
            inner.Expression = this.parseExpression();
          }
          this.expect(Token.COLON);
          let StatementList: Mutable<ParseNode.StatementList> | undefined;
          while (!(this.test(Token.CASE) || this.test(Token.DEFAULT) || this.test(Token.RBRACE))) {
            if (!StatementList) {
              StatementList = [];
              inner.StatementList = StatementList;
            }
            StatementList.push(this.parseStatementListItem());
          }
          if (t === Token.DEFAULT) {
            node.DefaultClause = this.finishNode(inner, 'DefaultClause');
          } else {
            if (node.DefaultClause) {
              if (!CaseClauses_b) {
                CaseClauses_b = [];
                node.CaseClauses_b = CaseClauses_b;
              }
              CaseClauses_b.push(this.finishNode(inner, 'CaseClause'));
            } else {
              if (!CaseClauses_a) {
                CaseClauses_a = [];
                node.CaseClauses_a = CaseClauses_a;
              }
              CaseClauses_a.push(this.finishNode(inner, 'CaseClause'));
            }
          }
          break;
        }
        default:
          this.unexpected();
      }
    }
    return this.finishNode(node, 'CaseBlock');
  }

  // BreakStatement :
  //   `break` `;`
  //   `break` [no LineTerminator here] LabelIdentifier `;`
  //
  // ContinueStatement :
  //   `continue` `;`
  //   `continue` [no LineTerminator here] LabelIdentifier `;`
  parseBreakContinueStatement(): ParseNode.BreakStatement | ParseNode.ContinueStatement {
    const node = this.startNode<ParseNode.BreakStatement | ParseNode.ContinueStatement>();
    const isBreak = this.eat(Token.BREAK);
    if (!isBreak) {
      this.expect(Token.CONTINUE);
    }
    if (this.eat(Token.SEMICOLON)) {
      node.LabelIdentifier = null;
    } else if (this.peek().hadLineTerminatorBefore) {
      node.LabelIdentifier = null;
      this.semicolon();
    } else {
      if (this.test(Token.IDENTIFIER)) {
        node.LabelIdentifier = this.parseLabelIdentifier();
      } else {
        node.LabelIdentifier = null;
      }
      this.semicolon();
    }
    this.verifyBreakContinue(node, isBreak);
    return this.finishNode(node, isBreak ? 'BreakStatement' : 'ContinueStatement');
  }

  verifyBreakContinue(node: ParseNode.Unfinished<ParseNode.BreakStatement | ParseNode.ContinueStatement>, isBreak: boolean) {
    let i = 0;
    for (; i < this.scope.labels.length; i += 1) {
      const label = this.scope.labels[i];
      if (!node.LabelIdentifier || node.LabelIdentifier.name === label.name) {
        if (label.type && (isBreak || label.type === 'loop')) {
          break;
        }
        if (node.LabelIdentifier && isBreak) {
          break;
        }
      }
    }
    if (i === this.scope.labels.length) {
      this.addEarlyError(Throw.SyntaxError('Label $1 not found', node.LabelIdentifier?.name ?? ''), node.LabelIdentifier || node);
    }
  }

  // ReturnStatement :
  //   `return` `;`
  //   `return` [no LineTerminator here] Expression `;`
  parseReturnStatement(): ParseNode.ReturnStatement {
    if (!this.scope.hasReturn()) {
      this.unexpected();
    }
    const node = this.startNode<ParseNode.ReturnStatement>();
    this.expect(Token.RETURN);
    if (this.eatSemicolonWithASI()) {
      node.Expression = null;
    } else if (surroundingAgent.feature('runtime-types')
        && this.test('ref')
        && !this.peekAhead().hadLineTerminatorBefore
        && (this.peekAhead().type === Token.IDENTIFIER
          || this.peekAhead().type === Token.THIS
          || this.peekAhead().type === Token.YIELD
          || this.peekAhead().type === Token.AWAIT)) {
      // proposal-runtime-types (references extension): `return ref x` returns a
      // borrow of the operand's storage location. Contextual: `return ref` and
      // `return ref` followed by a line break keep their base meanings (the
      // identifier, with automatic semicolon insertion).
      const refNode = this.startNode<ParseNode.RefExpression>();
      this.next();
      refNode.Expression = this.parseLeftHandSideExpression();
      node.Expression = this.finishNode(refNode, 'RefExpression');
      this.semicolon();
    } else {
      node.Expression = this.parseExpression();
      this.semicolon();
    }
    return this.finishNode(node, 'ReturnStatement');
  }

  // WithStatement :
  //   `with` `(` Expression `)` Statement
  parseWithStatement(): ParseNode.WithStatement {
    if (this.isStrictMode()) {
      this.addEarlyError(Throw.SyntaxError('with statement cannot be used in strict mode'));
    }
    const node = this.startNode<ParseNode.WithStatement>();
    this.expect(Token.WITH);
    this.expect(Token.LPAREN);
    node.Expression = this.parseExpression();
    this.expect(Token.RPAREN);
    node.Statement = this.parseStatement();
    return this.finishNode(node, 'WithStatement');
  }

  // ThrowStatement :
  //   `throw` [no LineTerminator here] Expression `;`
  parseThrowStatement(): ParseNode.ThrowStatement {
    const node = this.startNode<ParseNode.ThrowStatement>();
    this.expect(Token.THROW);
    if (this.peek().hadLineTerminatorBefore) {
      this.raise(Throw.SyntaxError('Newline after throw statement'), node);
    }
    node.Expression = this.parseExpression();
    this.semicolon();
    return this.finishNode(node, 'ThrowStatement');
  }

  // TryStatement :
  //   `try` Block Catch
  //   `try` Block Finally
  //   `try` Block Catch Finally
  //
  // Catch :
  //   `catch` `(` CatchParameter `)` Block
  //   `catch` Block
  //
  // Finally :
  //   `finally` Block
  //
  // CatchParameter :
  //   BindingIdentifier
  //   BindingPattern
  parseTryStatement(): ParseNode.TryStatement {
    const node = this.startNode<ParseNode.TryStatement>();
    this.expect(Token.TRY);
    node.Block = this.parseBlock();
    // proposal-runtime-types: CatchClauses is a list; the first clause is
    // also stored as `Catch` so flag-off consumers and the placeholder
    // evaluation (which runs the first clause) keep working.
    const CatchClauses: ParseNode.Catch[] = [];
    while (this.eat(Token.CATCH)) {
      this.scope.with({ lexical: true }, () => {
        const clause = this.startNode<ParseNode.Catch>();
        if (this.eat(Token.LPAREN)) {
          switch (this.peek().type) {
            case Token.LBRACE:
            case Token.LBRACK:
              clause.CatchParameter = this.parseBindingPattern();
              break;
            default:
              clause.CatchParameter = this.parseBindingIdentifier();
              break;
          }
          this.scope.declare(clause.CatchParameter, 'lexical-allow-let');
          // Catch : `catch` `(` CatchParameter TypeAnnotation? `)` Block
          if (surroundingAgent.feature('runtime-types') && this.test(Token.COLON)) {
            clause.TypeAnnotation = this.parseTypeAnnotation();
          } else {
            clause.TypeAnnotation = null;
          }
          this.expect(Token.RPAREN);
        } else {
          clause.CatchParameter = null;
          clause.TypeAnnotation = null;
        }
        clause.Block = this.parseBlock(false);
        CatchClauses.push(this.finishNode(clause, 'Catch'));
      });
      if (!surroundingAgent.feature('runtime-types')) {
        break;
      }
    }
    if (CatchClauses.length > 0) {
      node.Catch = CatchClauses[0];
      node.CatchClauses = surroundingAgent.feature('runtime-types') ? CatchClauses : null;
    } else {
      node.Catch = null;
      node.CatchClauses = null;
    }
    if (this.eat(Token.FINALLY)) {
      node.Finally = this.parseBlock();
    } else {
      node.Finally = null;
    }
    if (!node.Catch && !node.Finally) {
      this.raise(Throw.SyntaxError('Missing catch or finally clause in try statement'));
    }
    return this.finishNode(node, 'TryStatement');
  }

  // DebuggerStatement : `debugger` `;`
  parseDebuggerStatement(): ParseNode.DebuggerStatement {
    const node = this.startNode<ParseNode.DebuggerStatement>();
    this.expect(Token.DEBUGGER);
    this.semicolon();
    return this.finishNode(node, 'DebuggerStatement');
  }

  // ExpressionStatement :
  //   [lookahead != `{`, `function`, `async` [no LineTerminator here] `function`, `class`, `let` `[` ] Expression `;`
  parseExpressionStatement(): ParseNode.ExpressionStatement | ParseNode.LabelledStatement {
    switch (this.peek().type) {
      case Token.LBRACE:
      case Token.FUNCTION:
      case Token.CLASS:
        this.unexpected();
        break;
      default:
        if (this.test('async') && this.testAhead(Token.FUNCTION) && !this.peekAhead().hadLineTerminatorBefore) {
          this.unexpected();
        }
        if (this.test('let') && this.testAhead(Token.LBRACK)) {
          this.unexpected();
        }
        break;
    }
    const startToken = this.peek();
    const node = this.startNode<ParseNode.ExpressionStatement | ParseNode.LabelledStatement>();
    const expression = this.parseExpression();
    if (expression.type === 'IdentifierReference' && this.eat(Token.COLON)) {
      const LabelIdentifier = this.repurpose(expression, 'LabelIdentifier');
      node.LabelIdentifier = LabelIdentifier;

      if (this.scope.labels.find((l) => l.name === LabelIdentifier.name)) {
        this.addEarlyError(Throw.SyntaxError('$1 is already declared', node.LabelIdentifier.name), node.LabelIdentifier);
      }
      let type: LabelType | null = null;
      switch (this.peek().type) {
        case Token.SWITCH:
          type = 'switch';
          break;
        case Token.DO:
        case Token.WHILE:
        case Token.FOR:
          type = 'loop';
          break;
        default:
          break;
      }
      if (type !== null && this.scope.labels.length > 0) {
        const last = this.scope.labels[this.scope.labels.length - 1];
        if (last.nextToken === startToken) {
          last.type = type;
        }
      }
      this.scope.labels.push({
        name: node.LabelIdentifier.name,
        type,
        nextToken: type === null ? this.peek() : null,
      });

      // A decoration is handled by `parseStatementListItem`, and a labelled
      // statement takes its item from `parseStatement` - so `lbl: @m while (c)
      // { }` reached the `@` with nothing to consume it and failed with
      // "Unexpected token". Nothing says a labelled decorated statement is
      // illegal, and the block family exists to decorate exactly these forms.
      node.LabelledItem = surroundingAgent.feature('runtime-types') && this.test(Token.AT)
        ? this.parseDecoratedStatementListItem() as ParseNode.LabelledItem
        : this.parseStatement();
      // proposal-runtime-types: decorators.md gives every block reflection a
      // `label`, and it has answered *undefined* since the contexts were built
      // because nothing read it. The label is LEXICAL - it is known here and
      // does not depend on evaluation - so it is recorded the way `BlockKind`
      // and `BlockParts` are, on the block the decoration sits on.
      //
      // `a: b: @g { }` records `b`: the field is singular in the design, and
      // the nearest label is the one immediately attached to the block.
      this.markBlockLabel(node.LabelledItem, node.LabelIdentifier.name);

      this.scope.labels.pop();

      return this.finishNode(node, 'LabelledStatement');
    }
    node.Expression = expression;
    this.semicolon();
    return this.finishNode(node, 'ExpressionStatement');
  }
}

/**
 * proposal-runtime-types #sec-reflection-shape-block: the head clauses a
 * `for (;;)` reflection reports. A clause the head omits is absent from the
 * record and the reflection reports it as *undefined*, which is the same answer
 * by a different route and is what lets a reader walk one shape.
 */
function forParts(node: { LexicalDeclaration?: unknown, VariableDeclarationList?: unknown, Expression_a?: unknown, Expression_b?: unknown, Expression_c?: unknown }): ParseNode.BlockParts {
  // The head's three clauses occupy different slots depending on what the FIRST
  // one is: a declaration takes its own field and the remaining two expressions
  // shift up, where an expression initializer occupies Expression_a and pushes
  // the other two along. Reading them positionally without that gives a `for`
  // reflection an `update` in its `condition`, which is what the first version
  // of this did.
  const declared = (node.LexicalDeclaration ?? node.VariableDeclarationList) as ParseNode.BaseParseNode | undefined;
  if (declared !== undefined) {
    return {
      initializer: declared,
      condition: node.Expression_a as ParseNode.BaseParseNode | undefined,
      update: node.Expression_b as ParseNode.BaseParseNode | undefined,
    };
  }
  return {
    initializer: node.Expression_a as ParseNode.BaseParseNode | undefined,
    condition: node.Expression_b as ParseNode.BaseParseNode | undefined,
    update: node.Expression_c as ParseNode.BaseParseNode | undefined,
  };
}

/** The binding a `for`-`in` or `for`-`of` head introduces. */
function forInOfParts(node: { ForBinding?: unknown, ForDeclaration?: unknown, LeftHandSideExpression?: unknown }): ParseNode.BlockParts {
  return {
    binding: (node.ForBinding ?? node.ForDeclaration ?? node.LeftHandSideExpression) as ParseNode.BaseParseNode | undefined,
  };
}
