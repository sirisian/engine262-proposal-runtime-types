import { Value } from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { Realm } from '../execution-context/Realm.mts';
import type { TypeRecord } from './records.mts';
import { intrinsicData, intrinsicSourceIsStable } from './intrinsic-origin.mts';
import { OriginalLibraryFunction } from './library-operation-origin.mts';

export type LibraryBoundary =
  | { kind: 'replacement', callback: ParseNode, match: string, whole: string, position: number }
  | { kind: 'stringConversion' | 'prototype', operand: ParseNode }
  | { kind: 'copy', target: ParseNode, element: TypeRecord, entries: readonly ParseNode[], offset: number };

/** #sec-proved-library-operations: establish selected operations and their reached stages. */
export function ProvenLibraryBoundaries(root: ParseNode, realm: Realm,
  annotationType: (node: ParseNode.TypeAnnotation) => TypeRecord | null,
  inert: (type: TypeRecord | null) => boolean): ReadonlyMap<ParseNode, LibraryBoundary> {
  const nodes: ParseNode[] = [];
  const definitions = new Map<string, ParseNode[]>();
  const mutated = new Set<string>();
  const unwrap = (node: ParseNode): ParseNode => node.type === 'ParenthesizedExpression' ? unwrap(node.Expression) : node;
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== 'object' || !('type' in value)) return;
    const node = value as ParseNode;
    nodes.push(node);
    if (node.type === 'BindingIdentifier' && node.parent) definitions.set(node.name, [...(definitions.get(node.name) ?? []), node.parent]);
    const target = node.type === 'AssignmentExpression' ? unwrap(node.LeftHandSideExpression)
      : node.type === 'UpdateExpression' ? unwrap(node.LeftHandSideExpression ?? node.UnaryExpression!) : null;
    if (target?.type === 'IdentifierReference') mutated.add(target.name);
    for (const [key, child] of Object.entries(node)) if (!['parent', 'location', 'sourceText'].includes(key)) visit(child);
  };
  visit(root);
  const topLevel = (node: ParseNode): boolean => {
    for (let p = node.parent; p; p = p.parent) if (/Function|Arrow|Method|Class/.test(p.type)) return false;
    return true;
  };
  const global = (name: string): boolean => !definitions.has(name) && !mutated.has(name)
    && !realm.GlobalEnv.DeclarativeRecord.bindings.has(Value(name))
    && intrinsicData(realm.GlobalObject, Value(name)) === (realm.Intrinsics as unknown as Record<string, Value>)[`%${name}%`];
  const declaration = (node: ParseNode): ParseNode.LexicalBinding | null => {
    if (node.type !== 'IdentifierReference' || mutated.has(node.name)) return null;
    const defs = definitions.get(node.name);
    const def = defs?.length === 1 ? defs[0] : null;
    return def?.type === 'LexicalBinding' && def.parent?.type === 'LexicalDeclaration'
      && def.parent.LetOrConst === 'const' && topLevel(def) ? def : null;
  };
  const initializer = (expression: ParseNode, seen = new Set<ParseNode>()): ParseNode => {
    const node = unwrap(expression);
    if (seen.has(node) || seen.size >= 256) return node;
    seen.add(node);
    const def = declaration(node);
    return def?.Initializer ? initializer(def.Initializer, seen) : node;
  };
  const symbol = (node: ParseNode): boolean => node.type === 'CallExpression' && node.Arguments.length === 0
    && node.CallExpression.type === 'IdentifierReference' && node.CallExpression.name === 'Symbol' && global('Symbol');
  const scalar = (expression: ParseNode): boolean => {
    const node = initializer(expression);
    return ['NumericLiteral', 'StringLiteral', 'BooleanLiteral', 'NullLiteral', 'BigIntLiteral'].includes(node.type)
      || symbol(node) || (node.type === 'UnaryExpression' && ['+', '-'].includes(node.operator) && node.UnaryExpression.type === 'NumericLiteral')
      || (node.type === 'IdentifierReference' && node.name === 'undefined' && !definitions.has('undefined')
        && intrinsicData(realm.GlobalObject, Value('undefined')) === Value.undefined);
  };
  const keyOf = (node: ParseNode.PropertyDefinition): string | null => {
    const key = node.PropertyName;
    return key?.type === 'IdentifierName' ? key.name
      : key?.type === 'StringLiteral' || key?.type === 'NumericLiteral' ? String(key.value) : null;
  };
  const data = (expression: ParseNode): ParseNode.ObjectLiteral | null => {
    const node = unwrap(expression);
    return node.type === 'ObjectLiteral' && node.PropertyDefinitionList.every((p) => p.type === 'PropertyDefinition'
      && keyOf(p) !== null && keyOf(p) !== '__proto__' && !!p.AssignmentExpression && scalar(p.AssignmentExpression)) ? node : null;
  };
  const array = (expression: ParseNode): ParseNode.ArrayLiteral | null => {
    const node = initializer(expression);
    return node.type === 'ArrayLiteral' && node.ElementList.every((p) => !!p && scalar(p)) ? node : null;
  };
  const list = (expression: ParseNode): readonly ParseNode[] | null => {
    const node = unwrap(expression);
    // Only a fresh source: a prior copy must not change the values this summary reads.
    if (node.type === 'ArrayLiteral') return array(node)?.ElementList ?? null;
    const object = data(node);
    if (!object || object.PropertyDefinitionList.some((p) => (p as ParseNode.PropertyDefinition).TypeAnnotation)) return null;
    const fields = new Map(object.PropertyDefinitionList.map((p) => [keyOf(p as ParseNode.PropertyDefinition), (p as ParseNode.PropertyDefinition).AssignmentExpression!]));
    const length = fields.get('length');
    if (length?.type !== 'NumericLiteral' || typeof length.value !== 'number' || !Number.isInteger(length.value) || length.value < 0 || length.value > 256) return null;
    const result: ParseNode[] = [];
    for (let i = 0; i < length.value; i += 1) {
      const entry = fields.get(String(i));
      if (!entry) return null;
      result.push(entry);
    }
    return result;
  };
  const numeric = (expression: ParseNode): number | null => {
    const node = initializer(expression);
    if (node.type === 'NumericLiteral' && typeof node.value === 'number') return node.value;
    if (node.type === 'StringLiteral') return Number(node.value);
    if (node.type === 'BooleanLiteral') return node.value ? 1 : 0;
    if (node.type === 'NullLiteral') return 0;
    if (node.type === 'IdentifierReference' && node.name === 'undefined' && scalar(node)) return NaN;
    if (node.type === 'UnaryExpression' && node.UnaryExpression.type === 'NumericLiteral'
        && typeof node.UnaryExpression.value === 'number' && ['+', '-'].includes(node.operator)) {
      return (node.operator === '-' ? -1 : 1) * node.UnaryExpression.value;
    }
    return null;
  };
  const toLength = (value: number): number => Number.isNaN(value) ? 0 : Math.min(Math.max(0, Math.trunc(value)), Number.MAX_SAFE_INTEGER);
  const selected = new Set<ParseNode>();
  const typedArray = (expression: ParseNode): { length: number, element: TypeRecord, window: boolean } | null => {
    const node = unwrap(expression);
    const def = declaration(node);
    const source = def?.Initializer && array(def.Initializer);
    const type = def?.TypeAnnotation && annotationType(def.TypeAnnotation);
    if (source && type?.Kind === 'array' && inert(type.Element)
        && (type.Extent === 'dynamic' || type.Extent === source.ElementList.length)) {
      return { length: source.ElementList.length, element: type.Element, window: false };
    }
    if (node.type !== 'CallExpression' || node.CallExpression.type !== 'MemberExpression') return null;
    const member = node.CallExpression;
    if (member.IdentifierName?.name !== 'window' || node.Arguments.length > 2) return null;
    // A single window over fresh owned storage; no borrowed source is inspected.
    const base = declaration(unwrap(member.MemberExpression));
    if (!base) return null;
    const origin = typedArray(member.MemberExpression);
    if (!origin || origin.window || !OriginalLibraryFunction(realm, '%TypedArrayLike.prototype%', 'window')) return null;
    const begin = node.Arguments[0] ? numeric(node.Arguments[0]) : 0;
    const end = node.Arguments[1] ? numeric(node.Arguments[1]) : origin.length;
    if (begin === null || end === null) return null;
    const length = Math.max(0, Math.min(toLength(end), origin.length) - Math.min(toLength(begin), origin.length));
    selected.add(node); selected.add(member);
    return { ...origin, length, window: true };
  };
  const results = new Map<ParseNode, LibraryBoundary>();
  for (const node of nodes) {
    if (node.type !== 'CallExpression' || !topLevel(node) || node.CallExpression.type !== 'MemberExpression') continue;
    const member = node.CallExpression;
    const name = member.IdentifierName?.name ?? (member.Expression?.type === 'StringLiteral' ? member.Expression.value : null);
    const receiver = unwrap(member.MemberExpression);
    const args = node.Arguments;
    let operation: LibraryBoundary | undefined;
    if (receiver.type === 'IdentifierReference' && receiver.name === 'Object' && global('Object')
        && name && ['create', 'setPrototypeOf'].includes(name) && OriginalLibraryFunction(realm, '%Object%', name)) {
      const index = name === 'create' ? 0 : 1;
      if (args.length === index + 1 && args.every((arg) => scalar(arg) || !!data(initializer(arg)))) {
        const target = index === 1 ? initializer(args[0]) : null;
        // RequireObjectCoercible precedes the prototype check in setPrototypeOf.
        if (!target || (target.type !== 'NullLiteral' && !(target.type === 'IdentifierReference' && target.name === 'undefined'))) {
          operation = { kind: 'prototype', operand: args[index] };
        }
      }
    }
    const string = initializer(receiver);
    if (string.type === 'StringLiteral' && name && OriginalLibraryFunction(realm, '%String.prototype%', name)) {
      if (name === 'includes' && args.length >= 1 && args.length <= 2 && args.every(scalar)) {
        operation = { kind: 'stringConversion', operand: args[0] };
      }
      if (['replace', 'replaceAll'].includes(name) && args.length === 2) {
        const search = initializer(args[0]);
        const callback = initializer(args[1]);
        if (search.type === 'StringLiteral' && ['ArrowFunction', 'FunctionExpression'].includes(callback.type)) {
          // A first literal match is enough to establish the same binding
          // obligation for replaceAll; do not expand every repeated match.
          const position = string.value.indexOf(search.value);
          if (position >= 0) operation = { kind: 'replacement', callback: args[1], match: search.value, whole: string.value, position };
          selected.add(node); selected.add(member);
        }
      }
    }
    if (name === 'join' && array(receiver) && args.length === 1 && scalar(args[0])
        && OriginalLibraryFunction(realm, '%Array.prototype%', name)) operation = { kind: 'stringConversion', operand: args[0] };
    if (name === 'set' && args.length >= 1 && args.length <= 2) {
      const target = typedArray(receiver);
      const entries = list(args[0]);
      const offset = args[1] ? numeric(args[1]) : 0;
      if (target && entries && offset !== null
          && OriginalLibraryFunction(realm, target.window ? '%Span.prototype%' : '%TypedArrayLike.prototype%', 'set')) {
        // Range failure happens before any store; it is not an element failure.
        if (toLength(offset) + entries.length <= target.length) {
          operation = { kind: 'copy', target: receiver, element: target.element, entries, offset: toLength(offset) };
        }
        selected.add(node); selected.add(member);
      }
    }
    if (operation) {
      results.set(node, operation);
      selected.add(node);
      selected.add(member);
    }
  }
  const safe = (node: ParseNode): boolean => selected.has(node) || symbol(node);
  const safeAnnotation = (node: ParseNode.TypeAnnotation): boolean => {
    const type = annotationType(node);
    if (inert(type)) return true;
    const binding = node.parent;
    const object = binding?.type === 'LexicalBinding' && binding.Initializer ? data(initializer(binding.Initializer)) : null;
    if (!object || type?.Kind !== 'object' || type.IndexSignatures.length || !type.Properties.every((p) => inert(p.type))) return false;
    const own = new Set(object.PropertyDefinitionList.map((p) => keyOf(p as ParseNode.PropertyDefinition)));
    return type.Properties.every((p) => typeof p.key === 'string' && own.has(p.key));
  };
  if (nodes.some((node) => (node.type === 'TypeAnnotation' && !safeAnnotation(node))
      || (node.type === 'LexicalBinding' && !!node.TypeAnnotation && !!node.Initializer
        && !scalar(node.Initializer) && !array(node.Initializer) && !data(initializer(node.Initializer))
        && !safe(initializer(node.Initializer)))
      || (node.type === 'AssignmentExpression' && unwrap(node.LeftHandSideExpression).type === 'IdentifierReference'
        && !scalar(node.AssignmentExpression))
      || (node.type === 'CallExpression' && !safe(node)) || node.type === 'NewExpression'
      || (node.type === 'AssignmentExpression' && node.LeftHandSideExpression.type === 'MemberExpression'
        && ['Object', 'String', 'Array', 'Symbol'].includes(node.LeftHandSideExpression.IdentifierName?.name
          ?? (node.LeftHandSideExpression.Expression?.type === 'StringLiteral' ? node.LeftHandSideExpression.Expression.value : ''))))
      || !intrinsicSourceIsStable(root, realm, safe)) return new Map();
  return results;
}
