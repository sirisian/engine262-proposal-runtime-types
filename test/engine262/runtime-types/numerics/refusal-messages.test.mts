import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent, EnsureCompletion, Get, Value, X, type ObjectValue } from '#self';

/** The message of a run-time error, for the cases whose wording is tested. */
function thrownMessage(source: string): string {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const c = EnsureCompletion(realm.evaluateScriptSkipDebugger(source));
  expect(c.Type, `expected a throw for: ${source}`).toBe('throw');
  const pop = realm.pushTopContext();
  try {
    return (X(Get(c.Value as ObjectValue, Value('message'))) as { stringValue(): string }).stringValue();
  } finally {
    pop?.();
  }
}

test('a complex, rational or decimal in a message is written as its value', () => {
  // These are objects, and printed as [object Object].
  expect(thrownMessage('float64(3 := complex64);')).toBe('3+0i is not assignable to "float64"');
  expect(thrownMessage("decimal64.parse('1.5') := uint8;")).toBe('1.5 (decimal) is not assignable to "uint.<8>"');
});

test('the two-argument rational constructor names why a bigint is refused', () => {
  // rational.md: the parts are `int.<N>`, and "a value of another integer type
  // is converted explicitly". A bigint is an integer, so "must be an integer"
  // misstated the reason.
  expect(thrownMessage('rational(5n, 1);')).toBe('5n is not assignable to "int.<64>"');
  expect(thrownMessage('rational(1, 5n);')).toBe('5n is not assignable to "int.<64>"');
  // A non-integral Number is still told it is not an integer.
  expect(thrownMessage('rational(1.5, 2);')).toBe('a rational numerator must be an integer');
  // The one-argument CONVERSION takes a bigint (the F10 plan's B1): its value
  // over 1, and a RangeError naming the type where it does not fit.
  expect(thrownMessage('rational(2n ** 70n);')).toBe('"1180591620717411303424/1" is not in the range of "rational"');
});
