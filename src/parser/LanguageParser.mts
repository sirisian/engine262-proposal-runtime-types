import type { Mutable } from '../utils/language.mts';
import { ModuleParser } from './ModuleParser.mts';
import type { ParseNode } from './ParseNode.mts';
import { Token } from './tokens.mts';
import { Throw } from '#self';

export abstract class LanguageParser extends ModuleParser {
  // Script : ScriptBody?
  parseScript(): ParseNode.Script {
    this.skipHashbangComment();
    const node = this.startNode<ParseNode.Script>();
    if (this.eat(Token.EOS)) {
      node.ScriptBody = null;
    } else {
      node.ScriptBody = this.parseScriptBody();
    }
    // proposal-runtime-types #sec-type-names: fixed here, once the whole text is
    // parsed, so a production or a call anywhere in it admits - including one in
    // a branch that never runs, since what a name means may not depend on
    // control flow.
    node.admitsTypeNames = this.state.admitsTypeNames
      || this.state.typeNameReferences.some((ref) => ref.exceptedFromAdmitting !== true);
    Object.defineProperty(node, 'sourceText', {
      configurable: true,
      get: () => this.source,
    });
    return this.finishNode(node, 'Script');
  }

  // ScriptBody : StatementList
  parseScriptBody(): ParseNode.ScriptBody {
    const node = this.startNode<ParseNode.ScriptBody>();
    this.scope.with({
      in: true,
      lexical: true,
      variable: true,
      variableFunctions: true,
    }, () => {
      const directives: string[] = [];
      node.StatementList = this.parseStatementList(Token.EOS, directives);
      node.strict = directives.includes('use strict');
    });
    Object.defineProperty(node, 'sourceText', {
      configurable: true,
      get: () => this.source,
    });
    return this.finishNode(node, 'ScriptBody');
  }

  // Module : ModuleBody?
  parseModule(): ParseNode.Module {
    this.skipHashbangComment();
    return this.scope.with({
      module: true,
      strict: true,
      in: true,
      importMeta: true,
      await: true,
      lexical: true,
      variable: true,
    }, () => {
      const node = this.startNode<ParseNode.Module>();
      if (this.eat(Token.EOS)) {
        node.ModuleBody = null;
      } else {
        node.ModuleBody = this.parseModuleBody();
      }
      this.scope.undefinedExports.forEach((importNode, name) => {
        this.addEarlyError(Throw.SyntaxError('Module undefined export $1', name), importNode);
      });
      node.hasTopLevelAwait = this.state.hasTopLevelAwait;
      node.admitsTypeNames = this.state.admitsTypeNames
      || this.state.typeNameReferences.some((ref) => ref.exceptedFromAdmitting !== true);
      Object.defineProperty(node, 'sourceText', {
        configurable: true,
        get: () => this.source,
      });
      return this.finishNode(node, 'Module');
    });
  }

  // ModuleBody :
  //   ModuleItemList
  parseModuleBody(): ParseNode.ModuleBody {
    const node = this.startNode<ParseNode.ModuleBody>();
    node.ModuleItemList = this.parseModuleItemList();
    Object.defineProperty(node, 'sourceText', {
      configurable: true,
      get: () => this.source,
    });
    return this.finishNode(node, 'ModuleBody');
  }

  // ModuleItemList :
  //   ModuleItem
  //   ModuleItemList ModuleItem
  //
  // ModuleItem :
  //   ImportDeclaration
  //   ExportDeclaration
  //   StatementListItem
  parseModuleItemList(): ParseNode.ModuleItemList {
    const moduleItemList: Mutable<ParseNode.ModuleItemList> = [];
    while (!this.eat(Token.EOS)) {
      switch (this.peek().type) {
        case Token.IMPORT:
          moduleItemList.push(this.parseImportDeclaration());
          break;
        case Token.EXPORT:
          moduleItemList.push(this.parseExportDeclaration(null));
          break;
        case Token.AT: {
          const decorators = this.parseDecorators();
          if (this.peek().type === Token.EXPORT) {
            // A decoration on EACH side of `export` is refused: it is not clear
            // which list decorates the declaration.
            //
            // Checked HERE, while `peek()` is still `export` and `peekAhead()`
            // is the token after it. The rule further down cannot carry this on
            // its own - it reads [[ClassDeclaration]], which is not populated
            // for `@f export @f class C {}`, so the early error removed below
            // was the only thing refusing that shape. Measured against the
            // previous behaviour rather than assumed.
            if (decorators?.length && this.peekAhead().type === Token.AT) {
              this.addEarlyError(Throw.SyntaxError('Decorators cannot appear on both sides of the export keyword'), decorators[0]);
            }
            // ModuleItem: DecoratorList `export` Declaration
            const exports = this.parseExportDeclaration(decorators);
            // `sec-syntax-replacement`: "Every decorable position may be
            // syntax-replaced, including the positions that do not admit value
            // replacement." A DECLARATION is one, whether or not it is
            // exported - so this refused nothing the proposal forbids.
            //
            // It refused a great deal the proposal wants. `@jsx export function
            // View() {...}` is the shape a component macro is written in, and
            // it is the only shape from which a macro can emit a constant BESIDE
            // what it replaces: a decoration inside the export
            // (`export @jsx function`) has its replacement range inside the
            // export, so a constant emitted there would join the export and stop
            // exporting the function.
            //
            // A decoration on EACH side of `export` is still refused, because
            // then it is not clear which list decorates the declaration. The
            // rule below cannot carry that on its own: it reads
            // [[ClassDeclaration]], which is not populated for this shape, so
            // the check removed above was the only thing refusing it. Tested
            // lexically instead, which does not depend on where the inner
            // declaration lands.

            //   It is a Syntax Error if DecoratorList is present, Declaration is a ClassDeclaration, and the DecoratorList of that ClassDeclaration is present.
            // ExportDeclaration : DecoratorList? export default ClassDeclaration
            //   It is a Syntax Error if DecoratorList is present and the DecoratorList of ClassDeclaration is present.
            if (exports.ClassDeclaration && exports.ClassDeclaration.Decorators?.length) {
              this.addEarlyError(Throw.SyntaxError('Decorators cannot appear on both sides of the export keyword'), exports.ClassDeclaration.Decorators[0]);
            }
            moduleItemList.push(exports);
          } else {
            // ModuleItem : DecoratorList StatementListItem
            //
            // This called parseClassDeclaration unconditionally, so at module
            // TOP LEVEL only a class could be decorated - while the same
            // decoration nested inside a function worked for a function, a
            // `let`, a `const`, an enum and a block. `sec-syntax-replacement`
            // says every decorable position may be syntax-replaced, and the
            // statement path already implements that, so it is shared rather
            // than duplicated.
            moduleItemList.push(this.parseDecoratedStatementListItem(decorators ?? undefined));
          }
          break;
        }
        default:
          moduleItemList.push(this.parseStatementListItem());
          break;
      }
    }
    return moduleItemList;
  }
}
