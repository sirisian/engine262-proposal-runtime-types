import { expect, test } from 'vitest';
import type { TypeRecord, SignatureRecord, ParameterRecord, TypeParameterRecord } from '../../../../src/type-system/records.mts';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, isTypeObject, Value,
  InstantiateReturnDependency, RetainCheckedResult, ForwardResultDependency } from '#self';

type Nominal = Extract<TypeRecord, { Kind: 'nominal' }>;
const number: TypeRecord = { Kind: 'primitive', Name: 'number', Arguments: [] };
const string: TypeRecord = { Kind: 'primitive', Name: 'string', Arguments: [] };
const parameter = (Type: TypeRecord = number): ParameterRecord => ({ Name: 'x', Type, Rest: false, Optional: false });
const signature = (Return: TypeRecord, Type: TypeRecord = number): SignatureRecord => ({ Parameters: [parameter(Type)], Return });
const callable = (Signatures: readonly SignatureRecord[]): TypeRecord & { Kind: 'function' } => ({ Kind: 'function', Signatures });
const template = (type: Nominal): Nominal => ({ ...type, Constructor: undefined, DeclarationIdentity: undefined });
function fixture() {
  const agent = new Agent({ features: ['runtime-types'] });
  setSurroundingAgent(agent);
  const realm = new ManagedRealm();
  const record = (source: string): Nominal => {
    const result = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
    if (result.Type !== 'normal' || !isTypeObject(result.Value) || result.Value.TypeRecord.Kind !== 'nominal') throw new Error('Expected class type');
    return result.Value.TypeRecord;
  };
  const first = record('function make(){class C{}return type C;}make();');
  const second = record('make();');
  const other = record('class D{}(type D);');
  return { first, second, other, open: template(first) };
}
function complete(target: TypeRecord & { Kind: 'function' }, source: TypeRecord) {
  const invocation = {};
  RetainCheckedResult(invocation, source);
  return InstantiateReturnDependency(target, ForwardResultDependency(invocation, {})) as TypeRecord & { Kind: 'function' };
}

test('correspondence is independent of signature order and leaves the template unchanged', () => {
  const { first, other, open } = fixture();
  const target = callable([signature(open), signature(template(other), string)]);
  const result = complete(target, callable([signature(other, string), signature(first)]));
  expect((result.Signatures[0].Return as Nominal).Constructor).toBe(first.Constructor);
  expect((result.Signatures[1].Return as Nominal).Constructor).toBe(other.Constructor);
  expect((target.Signatures[0].Return as Nominal).Constructor).toBeUndefined();
});

test.each([false, true])('conflicting activations supply no arbitrary result identity, reversed=%s', (reverse) => {
  const { first, second, open } = fixture();
  const contributions = [signature(first), signature(second)];
  if (reverse) contributions.reverse();
  const result = complete(callable([signature(open)]), callable(contributions));
  expect((result.Signatures[0].Return as Nominal).Constructor).toBeUndefined();
});

test('equivalent matching contributions retain their common identity', () => {
  const { first, open } = fixture();
  const result = complete(callable([signature(open)]), callable([signature(first), signature(first)]));
  expect((result.Signatures[0].Return as Nominal).Constructor).toBe(first.Constructor);
});

test('a completed target is not retargeted from another activation', () => {
  const { first, second } = fixture();
  const result = complete(callable([signature(first)]), callable([signature(second)]));
  expect((result.Signatures[0].Return as Nominal).Constructor).toBe(first.Constructor);
});

test('equal inputs with unrelated nominal results do not establish correspondence', () => {
  const { other, open } = fixture();
  const result = complete(callable([signature(open)]), callable([signature(other)]));
  expect((result.Signatures[0].Return as Nominal).Constructor).toBeUndefined();
});

test.each(['reference', 'rest', 'optional', 'default'])('completion preserves the %s obligation', (mode) => {
  const { first, open } = fixture();
  const base = mode === 'default' ? { ...parameter(), Optional: true, DeclaredDefault: true, Initial: Value(1) } : parameter();
  const changed: ParameterRecord = mode === 'reference' ? { ...base, Ref: true }
    : mode === 'rest' ? { ...base, Rest: true, Type: { Kind: 'array', Element: number, Extent: 'dynamic' } }
      : mode === 'optional' ? { ...base, Optional: true } : { ...base, Initial: Value(2) };
  const target = callable([{ Parameters: [base], Return: open }]);
  const result = complete(target, callable([{ Parameters: [changed], Return: first }]));
  expect((result.Signatures[0].Return as Nominal).Constructor).toBeUndefined();
  expect(result.Signatures[0].Parameters[0]).toEqual(base);
});

test('same-spelled generic binders from different declarations do not correspond', () => {
  const { first, open } = fixture();
  const binder = (): TypeParameterRecord => ({ Name: 'T', Kind: 'type', Variadic: false, Variance: 'invariant', Arity: 0,
    ConstraintNode: null, DefaultNode: null, Declaration: {} as TypeParameterRecord['Declaration'] });
  const result = complete(callable([{ ...signature(open), TypeParameters: [binder()] }]),
    callable([{ ...signature(first), TypeParameters: [binder()] }]));
  expect((result.Signatures[0].Return as Nominal).Constructor).toBeUndefined();
});

test('result identity disambiguates equal-input return overloads', () => {
  const { first, other, open } = fixture();
  const result = complete(callable([signature(open), signature(template(other))]), callable([signature(other), signature(first)]));
  expect((result.Signatures[0].Return as Nominal).Constructor).toBe(first.Constructor);
  expect((result.Signatures[1].Return as Nominal).Constructor).toBe(other.Constructor);
});
