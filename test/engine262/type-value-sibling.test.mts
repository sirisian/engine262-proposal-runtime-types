import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent, NumberValue, TypedNumberValue, PrimitiveValue } from '#self';

// R6 (Option A) regression floor: TypedNumberValue is a SIBLING of NumberValue
// under PrimitiveValue, not a subclass. These assertions would fail if the
// class were reverted to `extends NumberValue`. They pin the sibling structure
// at the type level (below) and the observable behaviour it produces (via the
// engine, above the fold).

function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

function evaluated(source: string): string {
  const completion = run(source);
  expect(completion).toMatchObject({ Type: 'normal' });
  return (completion as unknown as { Value: { stringValue(): string } }).Value.stringValue();
}

test('a typed number is NOT an instanceof NumberValue (the sibling invariant)', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  void new ManagedRealm();
  const typed = new TypedNumberValue(5, null);
  expect(typed instanceof NumberValue).toBe(false);
  expect(typed instanceof TypedNumberValue).toBe(true);
  expect(typed instanceof PrimitiveValue).toBe(true);
});

test('typed and plain numbers are distinct primitives, both under PrimitiveValue', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  void new ManagedRealm();
  const plain = NumberValue.unit;               // a real NumberValue
  const typed = new TypedNumberValue(1, null);
  expect(plain instanceof NumberValue).toBe(true);
  expect(plain instanceof TypedNumberValue).toBe(false);
  expect(typed instanceof PrimitiveValue && plain instanceof PrimitiveValue).toBe(true);
});

test('the distinct type tag is observable', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  void new ManagedRealm();
  const typed = new TypedNumberValue(5, null);
  expect(typed.type).toBe('TypedNumber');
  expect(NumberValue.unit.type).toBe('Number');
});

test('identity across the sibling boundary (behavioural, via the engine)', () => {
  // The sibling structure is what makes these correct: a typed number compares
  // distinctly because it is genuinely a different value type.
  expect(evaluated('(5 := uint8) === 5 ? "eq" : "neq";')).toBe('neq');
  expect(evaluated('(5 := uint8) === (5 := uint8) ? "eq" : "neq";')).toBe('eq');
  expect(evaluated('(5 := uint8) === (5 := uint16) ? "eq" : "neq";')).toBe('neq');
});

test('unwrapping a typed number round-trips to a plain Number', () => {
  expect(evaluated('Number(5 := uint8) === 5 ? "ok" : "no";')).toBe('ok');
  expect(evaluated('Reflect.typeOf(Number(5 := uint8)) === (type number) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('typeof (5 := uint8);')).toBe('number');
});

test('arithmetic preserves the value type through the sibling representation', () => {
  expect(evaluated('Reflect.typeOf((5 := uint8) + (3 := uint8)) === uint8 ? "ok" : "no";')).toBe('ok');
  expect(evaluated('(200 := uint8) + (100 := uint8) === (44 := uint8) ? "ok" : "no";')).toBe('ok');
});

// R6 correctness audit: coercion-boundary cases that crashed or misbehaved
// before the audit, because the sibling TypedNumberValue lacks NumberValue's
// methods and several intrinsics did instanceof NumberValue checks. Each is now
// routed through unwrapToNumber. These pin the fixes.

test('typed + BigInt throws a clean TypeError (not a crash)', () => {
  expect(run('(5 := uint8) + 5n;')).toMatchObject({ Type: 'throw' });
  expect(run('5n + (5 := uint8);')).toMatchObject({ Type: 'throw' });
});

test('Number.prototype methods work on a typed receiver (via boxing/unwrap)', () => {
  expect(evaluated('(5 := uint8).toString();')).toBe('5');
  expect(evaluated('(255 := uint8).toString(16);')).toBe('ff');
  expect(evaluated('String((5 := uint8).valueOf());')).toBe('5');
  expect(evaluated('(5 := uint8).toFixed(2);')).toBe('5.00');
  expect(evaluated('(5 := uint8).constructor === Number ? "ok" : "no";')).toBe('ok');
});

test('JSON.stringify serializes a typed number as its value', () => {
  expect(evaluated('JSON.stringify({ x: (5 := uint8) });')).toBe('{"x":5}');
  expect(evaluated('JSON.stringify([(5 := uint8), (10 := uint16)]);')).toBe('[5,10]');
});

test('ToBoolean: a typed zero or NaN is falsy', () => {
  expect(evaluated('Boolean(0 := uint8) ? "t" : "f";')).toBe('f');
  expect(evaluated('Boolean(5 := uint8) ? "t" : "f";')).toBe('t');
  expect(evaluated('(0 := uint8) ? "t" : "f";')).toBe('f');
  expect(evaluated('Boolean(0/0 := float64) ? "t" : "f";')).toBe('f');
});

test('Number.isInteger/isFinite answer for a numeric type, not for a representation', () => {
  // SUPERSEDED BY sec-numeric-predicates. This test used to pin the opposite, on
  // the BigInt precedent: these methods return false for any non-Number, and a
  // typed number is not a Number, so false. The precedent is real and is still
  // what the flag-off engine does (pinned in numeric-predicates.test.mts), but
  // the clause judges it the wrong answer HERE: a predicate whose name promises
  // a question about a value should not quietly answer about a representation,
  // and `Number.isInteger` of an int32 saying false is the hazard it names.
  expect(evaluated('Number.isInteger(5 := uint8) ? "yes" : "no";')).toBe('yes');
  expect(evaluated('Number.isFinite(5 := uint8) ? "yes" : "no";')).toBe('yes');
  // The bigint row goes the same way, and this one is a deliberate divergence
  // from base-language behaviour rather than an extension of it: `5n` is a value
  // of the `bigint` type, which is exact and unbounded, so it is an integer.
  // Flag-off keeps the base-language answer.
  expect(evaluated('Number.isInteger(5n) ? "yes" : "no";')).toBe('yes');
});
