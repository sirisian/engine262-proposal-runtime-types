import { ObjectValue, Value } from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { Realm } from '../execution-context/Realm.mts';
import type { TypeRecord } from './records.mts';
import { GetTypeObject } from './intern.mts';
import { ResolveBindingDeclaration } from './compile-time-evaluability.mts';
import { intrinsicData, intrinsicSourceIsStable } from './intrinsic-origin.mts';

const originals = new WeakMap<ObjectValue, { constructor: ObjectValue, method: Value }>();

/** Record the initially installed method without changing its mutable descriptor. */
export function RememberArrayCapacity(key: ObjectValue, constructor: ObjectValue, method: Value): void {
  originals.set(key, { constructor, method });
}

/** #sec-array-type-withcapacity: a bounded proof, never a runtime guard. */
export function ProvenArrayCapacityMembers(root: ParseNode, realm: Realm,
  resolve: (node: ParseNode.TypeArgumentsExpression) => TypeRecord | null): ReadonlyMap<ParseNode, TypeRecord> {
  const nodes: ParseNode[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object' || !('type' in value)) return;
    const node = value as ParseNode;
    nodes.push(node);
    for (const [key, child] of Object.entries(node)) {
      if (!['parent', 'location', 'sourceText'].includes(key)) visit(child);
    }
  };
  visit(root);
  const unwrap = (node: ParseNode): ParseNode => node.type === 'ParenthesizedExpression' ? unwrap(node.Expression) : node;
  const scalar = (expression: ParseNode, seen = new Set<ParseNode>()): boolean => {
    const node = unwrap(expression);
    if (seen.has(node)) return false;
    seen.add(node);
    if (['NumericLiteral', 'StringLiteral', 'BooleanLiteral', 'NullLiteral'].includes(node.type)) return true;
    if (node.type === 'UnaryExpression' && ['+', '-'].includes(node.operator)) return node.UnaryExpression.type === 'NumericLiteral';
    if (node.type !== 'IdentifierReference') return false;
    const binding = ResolveBindingDeclaration(node, node.name);
    return binding?.kind === 'const' && !!binding.initializer && scalar(binding.initializer, seen);
  };
  const candidates = new Map<ParseNode, TypeRecord>();
  for (const node of nodes) {
    if (node.type !== 'MemberExpression' || node.IdentifierName?.name !== 'withCapacity'
      || node.parent?.type !== 'CallExpression' || node.parent.CallExpression !== node) continue;
    const receiver = unwrap(node.MemberExpression);
    if (receiver.type !== 'TypeArgumentsExpression' || receiver.Expression.type !== 'ArrayLiteral'
      || receiver.Expression.ElementList.length !== 0 || !node.parent.Arguments.every((argument) => scalar(argument))) continue;
    const type = resolve(receiver);
    if (!type) continue;
    // No entry means this constructor has not been created, so no program has
    // yet obtained its own property. Otherwise inspect only an ordinary data slot.
    const original = originals.get(GetTypeObject(type));
    if (original && intrinsicData(original.constructor, Value('withCapacity')) !== original.method) continue;
    candidates.set(node, type);
  }
  const safe = (node: ParseNode): boolean => candidates.has(node)
    || (node.type === 'CallExpression' && candidates.has(node.CallExpression));
  // Unknown calls may invoke conversions or mutate another constructor's method.
  if (nodes.some((node) => (node.type === 'CallExpression' && !safe(node)) || node.type === 'NewExpression')
    || !intrinsicSourceIsStable(root, realm, safe)) return new Map();
  for (const node of candidates.keys()) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      // A later invocation may occur after another script replaces the method.
      if (/Function|Arrow|Method|Class/.test(parent.type)) {
        candidates.delete(node);
        break;
      }
    }
  }
  return candidates;
}
