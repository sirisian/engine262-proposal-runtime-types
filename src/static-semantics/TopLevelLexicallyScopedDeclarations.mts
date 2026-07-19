import { isArray } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';

export function TopLevelLexicallyScopedDeclarations(node: ParseNode | readonly ParseNode[]): LexicallyScopedDeclaration[] {
  if (isArray(node)) {
    const declarations = [];
    for (const item of node) {
      declarations.push(...TopLevelLexicallyScopedDeclarations(item));
    }
    return declarations;
  }
  switch (node.type) {
    case 'ClassDeclaration':
    case 'LexicalDeclaration':
    // proposal-runtime-types
    case 'TypeAliasDeclaration':
    case 'InterfaceDeclaration':
    case 'EnumDeclaration':
    case 'MetaDeclaration':
    case 'PrimitiveOperatorDeclaration':
      return [node];
    default:
      return [];
  }
}

export type LexicallyScopedDeclaration =
  | ParseNode.ClassDeclaration
  | ParseNode.LexicalDeclaration
  // proposal-runtime-types
  | ParseNode.TypeAliasDeclaration
  | ParseNode.InterfaceDeclaration
  | ParseNode.EnumDeclaration
  | ParseNode.MetaDeclaration
  | ParseNode.PrimitiveOperatorDeclaration;
