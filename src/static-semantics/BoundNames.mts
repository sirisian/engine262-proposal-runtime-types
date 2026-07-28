import { OutOfRange, isArray } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { JSStringValue, Value } from '../value.mts';
import { StringValue } from './all.mts';

export function BoundNames(node: ParseNode | readonly ParseNode[]): JSStringValue[] {
  if (isArray(node)) {
    const names = [];
    for (const item of node) {
      names.push(...BoundNames(item));
    }
    return names;
  }
  switch (node.type) {
    case 'BindingIdentifier':
      return [StringValue(node)];
    case 'LexicalDeclaration':
      return BoundNames(node.BindingList);
    case 'LexicalBinding':
      if (node.BindingIdentifier) {
        return BoundNames(node.BindingIdentifier);
      }
      return BoundNames(node.BindingPattern!);
    case 'VariableStatement':
      return BoundNames(node.VariableDeclarationList);
    case 'VariableDeclaration':
      if (node.BindingIdentifier) {
        return BoundNames(node.BindingIdentifier);
      }
      return BoundNames(node.BindingPattern!);
    case 'ForDeclaration':
      return BoundNames(node.ForBinding);
    case 'ForBinding':
      if (node.BindingIdentifier) {
        return BoundNames(node.BindingIdentifier);
      }
      return BoundNames(node.BindingPattern!);
    case 'FunctionDeclaration':
    case 'GeneratorDeclaration':
    case 'AsyncFunctionDeclaration':
    case 'AsyncGeneratorDeclaration':
    case 'ClassDeclaration':
      // proposal-runtime-types: a `partial class` re-opens an existing binding
      // and declares no name of its own, so it contributes no bound name and does
      // not collide with the class it extends.
      if ((node as { ClassModifiers?: readonly string[] | null }).ClassModifiers?.includes('partial')) {
        return [];
      }
      if (node.BindingIdentifier) {
        return BoundNames(node.BindingIdentifier);
      }
      return [Value('*default*')];
    // proposal-runtime-types
    case 'InterfaceDeclaration':
      // A `partial interface` EXTENDS a name someone else bound; it does not
      // bind one of its own, so it contributes no bound name and no second
      // binding is created for it during declaration instantiation. Same shape
      // as a partial class, which also declares nothing.
      return (node as { Partial?: boolean }).Partial ? [] : BoundNames(node.BindingIdentifier);
    case 'TypeAliasDeclaration':
    case 'EnumDeclaration':
      return BoundNames(node.BindingIdentifier);
    case 'MetaDeclaration':
    case 'PrimitiveOperatorDeclaration':
      return [];
    case 'ImportDeclaration':
      if (node.ImportedBinding) {
        return BoundNames(node.ImportedBinding);
      }
      return [];
    case 'ImportSpecifier':
      return BoundNames(node.ImportedBinding);
    case 'ExportDeclaration':
      if (node.FromClause || node.NamedExports) {
        return [];
      }
      if (node.VariableStatement) {
        return BoundNames(node.VariableStatement);
      }
      if (node.Declaration) {
        return BoundNames(node.Declaration);
      }
      if (node.HoistableDeclaration) {
        const declarationNames = BoundNames(node.HoistableDeclaration);
        return declarationNames;
      }
      if (node.ClassDeclaration) {
        const declarationNames = BoundNames(node.ClassDeclaration);
        return declarationNames;
      }
      if (node.AssignmentExpression) {
        return [Value('*default*')];
      }
      throw OutOfRange.exhaustive(node);
    case 'SingleNameBinding':
      return BoundNames(node.BindingIdentifier);
    case 'BindingRestElement':
      if (node.BindingIdentifier) {
        return BoundNames(node.BindingIdentifier);
      }
      return BoundNames(node.BindingPattern!);
    case 'BindingRestProperty':
      return BoundNames(node.BindingIdentifier);
    case 'BindingElement':
      return BoundNames(node.BindingPattern);
    case 'BindingProperty':
      return BoundNames(node.BindingElement);
    case 'ObjectBindingPattern': {
      const names = BoundNames(node.BindingPropertyList);
      if (node.BindingRestProperty) {
        names.push(...BoundNames(node.BindingRestProperty));
      }
      return names;
    }
    case 'ArrayBindingPattern': {
      const names = BoundNames(node.BindingElementList);
      if (node.BindingRestElement) {
        names.push(...BoundNames(node.BindingRestElement));
      }
      return names;
    }
    default:
      return [];
  }
}
