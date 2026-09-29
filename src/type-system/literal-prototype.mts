import { ObjectValue, Value, type SymbolValue, type JSStringValue } from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { Realm } from '../execution-context/Realm.mts';
import { intrinsicData, intrinsicSourceIsStable } from './intrinsic-origin.mts';
import { ResolveBindingDeclaration } from './compile-time-evaluability.mts';

/** #sec-literal-freshness: only established absence can require an own Symbol member. */
export function MissingLiteralSymbol(root: ParseNode, literal: ParseNode.ObjectLiteral, key: SymbolValue, realm: Realm): boolean {
  for (let parent = literal.parent; parent; parent = parent.parent) {
    if (/Function|Arrow|Method|Class/.test(parent.type)) return false;
  }
  if (literal.PropertyDefinitionList.some((entry) => entry.type === 'PropertyDefinition'
      && (entry.PropertyName?.type === 'IdentifierName' && entry.PropertyName.name === '__proto__'
        || entry.PropertyName?.type === 'StringLiteral' && entry.PropertyName.value === '__proto__'))) return false;
  let unstable = false;
  const screen = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(screen);
      return;
    }
    if (!value || typeof value !== 'object' || !('type' in value)) return;
    const node = value as ParseNode;
    if (['CallExpression', 'NewExpression', 'TypedConversionExpression'].includes(node.type)) unstable = true;
    if (node.type === 'LexicalBinding' && node.TypeAnnotation && node.Initializer !== literal) unstable = true;
    if (node.type === 'AssignmentExpression') {
      const target = node.LeftHandSideExpression;
      if (target.type === 'IdentifierReference' && target.name === 'Symbol') unstable = true;
      if (target.type === 'MemberExpression' && (target.IdentifierName?.name === 'Symbol'
          || (target.Expression?.type === 'StringLiteral' && target.Expression.value === 'Symbol'))) unstable = true;
    }
    for (const [name, child] of Object.entries(node)) if (!['parent', 'location', 'sourceText'].includes(name)) screen(child);
  };
  screen(root);
  if (unstable) return false;
  const symbolRead = (node: ParseNode): boolean => node.type === 'MemberExpression'
    && node.MemberExpression.type === 'IdentifierReference' && node.MemberExpression.name === 'Symbol'
    && !ResolveBindingDeclaration(node.MemberExpression, 'Symbol') && !!node.IdentifierName
    && !realm.GlobalEnv.DeclarativeRecord.bindings.has(Value('Symbol'))
    && intrinsicData(realm.GlobalObject, Value('Symbol')) === realm.Intrinsics['%Symbol%']
    && intrinsicData(realm.Intrinsics['%Symbol%'], Value(node.IdentifierName.name)) === key;
  if (!intrinsicSourceIsStable(root, realm, (node) => symbolRead(node)
    || (node.type === 'PropertyName' && !!node.ComputedPropertyName && symbolRead(node.ComputedPropertyName)))) return false;
  return OrdinaryPrototypeLacks(realm.Intrinsics['%Object.prototype%'], key);
}

/** Inspect ordinary prototype descriptors without invoking getters or exotic reads. */
export function OrdinaryPrototypeLacks(prototype: Value, key: JSStringValue | SymbolValue): boolean {
  const seen = new Set<Value>();
  while (prototype instanceof ObjectValue && !seen.has(prototype)) {
    seen.add(prototype);
    if (prototype.Get !== ObjectValue.prototype.Get || prototype.properties.has(key)) return false;
    prototype = (prototype as ObjectValue & { Prototype: Value }).Prototype;
  }
  return prototype === Value.null;
}
