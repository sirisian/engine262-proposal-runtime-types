import { expect, test } from 'vitest';
import { ReusableCheckingContext, SnapshotCheckingContext, SameCheckingContext } from '../../../../src/type-system/checking-context.mts';

const number = { Kind: 'primitive', Name: 'number', Arguments: [] };
const string = { Kind: 'primitive', Name: 'string', Arguments: [] };
const syntax = (name = 'T') => ({ type: 'BindingIdentifier', name });

for (const field of ['Declaration', 'DeclarationIdentity', 'Operator', 'DefaultEnvironment']) {
  test(`${field} keeps opaque identity through snapshots and comparisons`, () => {
    const identity = {};
    const original = { [field]: identity, result: number };
    const saved = SnapshotCheckingContext(original);
    expect(saved[field]).toBe(identity);
    expect(SameCheckingContext(saved, original)).toBe(true);
    expect(SameCheckingContext(saved, { ...original, [field]: {} })).toBe(false);
  });
}

test('binder identity, parameter names, defaults and component roles are inputs even with equal output types', () => {
  const declaration = syntax();
  const defaultExpression = { type: 'NumericLiteral', value: 1 };
  const context = { component: 'return', parameters: [{ name: 'value', declaration, type: number, defaultExpression }], result: number };
  const saved = SnapshotCheckingContext(context);
  expect(SameCheckingContext(saved, context)).toBe(true);
  for (const parameter of [
    { ...context.parameters[0], declaration: syntax() },
    { ...context.parameters[0], name: 'other' },
    { ...context.parameters[0], defaultExpression: { ...defaultExpression } },
    { ...context.parameters[0], type: string },
  ]) expect(SameCheckingContext(saved, { ...context, parameters: [parameter] })).toBe(false);
  expect(SameCheckingContext(saved, { ...context, component: 'yield' })).toBe(false);
});

test('mutable generic constraints and substitutions cannot rewrite an input snapshot', () => {
  const binder = syntax();
  const constraints = new Map([[binder, number]]);
  const substitutions = new Map([[binder, number]]);
  const context = { constraints, substitutions, result: number };
  const saved = SnapshotCheckingContext(context);
  expect(SameCheckingContext(saved, context)).toBe(true);
  constraints.set(binder, string);
  expect(SameCheckingContext(saved, context)).toBe(false);
  constraints.set(binder, number);
  substitutions.set(binder, string);
  expect(SameCheckingContext(saved, context)).toBe(false);
  substitutions.set(binder, number);
  expect(SameCheckingContext(saved, context)).toBe(true);
});

test('receivers, contextual alternatives and dependency completion remain distinct from the answer', () => {
  const owner = syntax('owner');
  const receiver = { Kind: 'object', Properties: [{ key: 'value', Type: number }] };
  const context = { owner, receiver, target: { Return: number }, dependency: { completed: false, answer: null }, result: number };
  const saved = SnapshotCheckingContext(context);
  context.dependency.completed = true;
  expect(SameCheckingContext(saved, context)).toBe(false);
  context.dependency.completed = false;
  context.receiver.Properties[0].Type = string;
  expect(SameCheckingContext(saved, context)).toBe(false);
  context.receiver.Properties[0].Type = number;
  context.target.Return = string;
  expect(SameCheckingContext(saved, context)).toBe(false);
});

test('a callable result mutated in place is different from its historical input state', () => {
  const signature = { Parameters: [], Return: null, InferredReturn: number };
  const context = { function: { Kind: 'function', Signatures: [signature] } };
  const saved = SnapshotCheckingContext(context);
  signature.InferredReturn = string;
  expect(SameCheckingContext(saved, context)).toBe(false);
  expect(saved.function.Signatures[0].InferredReturn.Name).toBe('number');
  signature.InferredReturn = number;
  expect(SameCheckingContext(saved, context)).toBe(true);
});

test('cyclic compiler graphs preserve sharing without equating different leaves', () => {
  type Node = { next?: Node; value: unknown };
  const node: Node = { value: number };
  node.next = node;
  const context = { a: node, b: node };
  const saved = SnapshotCheckingContext(context);
  expect(saved.a).not.toBe(node);
  expect(saved.a).toBe(saved.b);
  expect(saved.a.next).toBe(saved.a);
  expect(ReusableCheckingContext(context)).toBe(true);
  expect(SameCheckingContext(saved, context)).toBe(true);
  node.value = string;
  expect(SameCheckingContext(saved, context)).toBe(false);
});

test('map keys and set members preserve identity while compiler-owned map values are snapshotted', () => {
  const binder = syntax();
  const set = new Set([binder]);
  const context = { map: new Map([[binder, { result: number }]]), set, alias: set };
  const saved = SnapshotCheckingContext(context);
  expect(saved.set).toBe(saved.alias);
  expect(saved.set).not.toBe(set);
  expect(saved.map.has(binder)).toBe(true);
  expect(saved.set.has(binder)).toBe(true);
  expect(ReusableCheckingContext(context)).toBe(true);
  expect(SameCheckingContext(saved, context)).toBe(true);
  expect(SameCheckingContext(saved.map, new Map([[syntax(), { result: number }]]))).toBe(false);
  expect(SameCheckingContext(saved.set, new Set([syntax()]))).toBe(false);
  context.map.get(binder)!.result = string;
  expect(SameCheckingContext(saved, context)).toBe(false);
});

for (const context of [
  { DeclarationIdentity: {} }, { DefaultEnvironment: {} }, new Map([[{}, number]]), new Set([{}]),
]) {
  test('unsupported cross-pass identities remain local', () => {
    expect(ReusableCheckingContext(context)).toBe(false);
  });
}

test('primitive-value policies do not make arbitrary engine objects structurally interchangeable', () => {
  class Primitive {
    readonly value: string;

    constructor(value: string) {
      this.value = value;
    }
  }
  class ObjectValue { }
  const a = new Primitive('a');
  const b = new Primitive('a');
  const accept = (value: object) => value instanceof Primitive ? true : undefined;
  const same = (left: object, right: object) => left instanceof Primitive && right instanceof Primitive
    ? left.value === right.value : undefined;
  expect(ReusableCheckingContext(a)).toBe(false);
  expect(ReusableCheckingContext(a, accept)).toBe(true);
  expect(ReusableCheckingContext(new ObjectValue(), accept)).toBe(false);
  expect(SnapshotCheckingContext(a)).toBe(a);
  expect(SameCheckingContext(a, b)).toBe(false);
  expect(SameCheckingContext(a, b, same)).toBe(true);
  expect(SameCheckingContext(a, new Primitive('b'), same)).toBe(false);
  expect(SameCheckingContext(new ObjectValue(), new ObjectValue(), same)).toBe(false);
});

test('own symbol keys, null prototypes, missing fields and ordered arguments are retained', () => {
  const key = Symbol('key');
  const context = Object.assign(Object.create(null), { [key]: number, arguments: [number, string], optional: undefined });
  const saved = SnapshotCheckingContext(context);
  expect(Object.getPrototypeOf(saved)).toBe(null);
  expect(SameCheckingContext(saved, context)).toBe(true);
  context.arguments.reverse();
  expect(SameCheckingContext(saved, context)).toBe(false);
  context.arguments.reverse();
  delete context.optional;
  expect(SameCheckingContext(saved, context)).toBe(false);
});

test('deep input graphs use explicit worklists for eligibility, snapshots and comparison', () => {
  const build = (): unknown => {
    let value: unknown = number;
    for (let i = 0; i < 16000; i += 1) value = { Kind: 'array', Element: value };
    return value;
  };
  const input = build();
  expect(ReusableCheckingContext(input)).toBe(true);
  const saved = SnapshotCheckingContext(input);
  expect(SameCheckingContext(saved, build())).toBe(true);
});
