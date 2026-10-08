import { expect, test, vi } from 'vitest';
import {
  makePrimitive, substituteFreeTypeParameters, substituteTypeParameters, mentionsTypeParameter,
  type SignatureRecord, type TypeParameterRecord, type TypeRecord,
} from '../../../../src/type-system/records.mts';

// Use the built engine's value classes and abstract operations; their source
// modules require the engine's Babel transforms, outside Vitest's source loader.
vi.mock('../../../../src/value.mts', () => import('#self'));
vi.mock('../../../../src/abstract-ops/spec-types.mts', () => import('#self'));

const parameter = (Name: string, Constraint?: TypeRecord): TypeRecord => ({ Kind: 'parameter', Name, Constraint });
const binder = (Parameter: TypeRecord, Constraint?: TypeRecord): TypeParameterRecord => ({
  Name: (Parameter as { Name: string }).Name, Kind: 'type', Variadic: false, Variance: 'invariant', Arity: 0,
  ConstraintNode: null, DefaultNode: null, Declaration: {} as TypeParameterRecord['Declaration'], Parameter, Constraint,
});
const fn = (Return: TypeRecord, TypeParameters: readonly TypeParameterRecord[] = []): TypeRecord & { Kind: 'function' } => ({
  Kind: 'function', Signatures: [{ Parameters: [], Return, TypeParameters }],
});
const signature = (type: TypeRecord | null): SignatureRecord => (type as TypeRecord & { Kind: 'function' }).Signatures[0];
const number = makePrimitive('number');
const string = makePrimitive('string');

test('free substitution preserves a root signature binder, while application binds it', () => {
  const T = parameter('T');
  const source = fn(T, [binder(T)]);
  const bindings = new Map([['T', number]]);
  expect(signature(substituteFreeTypeParameters(source, bindings)).Return).toBe(T);
  expect(signature(substituteTypeParameters(source, bindings)).Return).toBe(number);
  expect(source.Signatures[0].Return).toBe(T);
});

test('removing one binder does not apply a deeper returned signature', () => {
  const T = parameter('T');
  const U = parameter('U');
  const inner = fn(U, [binder(U)]);
  const source = fn(inner, [binder(T)]);
  const result = substituteFreeTypeParameters(source, new Map([['T', number], ['U', string]]));
  expect(signature(signature(result).Return).Return).toBe(U);
});

test('a captured constraint is substituted consistently across binder and result records', () => {
  const T = parameter('T');
  const U = parameter('U', T);
  const declaration = binder(U, T);
  const source = fn(U, [declaration]);
  const result = signature(substituteFreeTypeParameters(source, new Map([['T', number]])));
  const changed = result.TypeParameters![0];
  expect(changed.Declaration).toBe(declaration.Declaration);
  expect(changed.Constraint).toBe(number);
  expect(changed.Parameter).toBe(result.Return);
  expect((result.Return as { Constraint?: TypeRecord }).Constraint).toBe(number);
  expect(declaration.Constraint).toBe(T);
});

test('constraints that appear only in the parameter list are visited', () => {
  const T = parameter('T');
  const U = parameter('U', T);
  const source = fn(number, [binder(U, T)]);
  expect(mentionsTypeParameter(source)).toBe(true);
  expect(signature(substituteFreeTypeParameters(source, new Map([['T', string]]))).TypeParameters![0].Constraint).toBe(string);
});

test('scoped environments do not leak between overload alternatives', () => {
  const T = parameter('T');
  const source: TypeRecord = { Kind: 'function', Signatures: [fn(T, [binder(T)]).Signatures[0], fn(T).Signatures[0]] };
  const result = substituteFreeTypeParameters(source, new Map([['T', number]])) as TypeRecord & { Kind: 'function' };
  expect(result.Signatures[0].Return).toBe(T);
  expect(result.Signatures[1].Return).toBe(number);
});

test('substitution retains recursive reference graphs', () => {
  const T = parameter('T');
  const source = fn(T);
  (source.Signatures as SignatureRecord[]).push({ Parameters: [], Return: { Kind: 'reference', Target: source } });
  const result = substituteFreeTypeParameters(source, new Map([['T', number]])) as TypeRecord & { Kind: 'function' };
  expect(result.Signatures[0].Return).toBe(number);
  expect((result.Signatures[1].Return as { Target: TypeRecord }).Target).toBe(result);
  expect(source.Signatures[0].Return).toBe(T);
});

test('published results, receivers and narrowing contracts use the same scoped substitution', () => {
  const T = parameter('T');
  const U = parameter('U');
  const source: TypeRecord = { Kind: 'function', Signatures: [{ Parameters: [], Return: U, InferredReturn: T,
    ThisType: T, Narrows: [{ Target: 'this', Type: T }], TypeParameters: [binder(U)] }] };
  const result = signature(substituteFreeTypeParameters(source, new Map([['T', number], ['U', string]])));
  expect(result.Return).toBe(U);
  expect(result.InferredReturn).toBe(number);
  expect(result.ThisType).toBe(number);
  expect(result.Narrows![0].Type).toBe(number);
});
