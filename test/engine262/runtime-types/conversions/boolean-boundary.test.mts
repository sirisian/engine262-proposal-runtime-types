import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * Spec: #sec-primitiveconvert, #sec-requiretype.
 *
 * The `boolean` type takes a Boolean. A value of any other type is refused at a
 * boundary, and a program that means the truthiness writes `Boolean(v)` or
 * `!!v`.
 *
 * This reverses a documented rule. The earlier one converted, reasoning that
 * ToBoolean is total, that every value has a defined truthiness, and that
 * `if (v)` is the language's own idiom. What that overlooks is that a boundary
 * is a STORE and not a question: `if (v)` interrogates a value in place, while
 * an annotation mints a durable answer that no longer carries what it was made
 * from. Totality is then the disqualification rather than the recommendation,
 * by this specification's own rule for the numeric targets - a conversion that
 * "could not fail at all" lets "a missing field become a NaN that surfaces far
 * from the annotation that admitted it". At a `boolean` target that reached
 * twice: a missing field became *false*, and the string `'false'` became
 * *true*.
 *
 * A CAST is unaffected. `v := boolean` is an instruction the program wrote, as
 * `v := number` is, and instructions are not boundaries.
 */

function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

function expectThrows(source: string) {
  expect(run(source)).toMatchObject({ Type: 'throw' });
}

/** The completion value of _source_, as a string. */
function value(source: string): string {
  const completion = run(source) as unknown as { Type: string, Value: { stringValue(): string } };
  if (completion.Type !== 'normal') {
    throw new Error(`expected a normal completion, got ${completion.Type}`);
  }
  return completion.Value.stringValue();
}

test('a boolean boundary refuses the two classic coercions', () => {
  // A missing field laundered into a legitimate-looking answer...
  expectThrows('function g() { return undefined; } const b: boolean = g();');
  expectThrows('function g() { return null; } const b: boolean = g();');
  // ...and its opposite: the configuration string that reads as its negation.
  expectThrows('function g() { return "false"; } const b: boolean = g();');
});

test('a boolean boundary refuses every other source too', () => {
  expectThrows('function g() { return 1; } const b: boolean = g();');
  expectThrows('function g() { return 0; } const b: boolean = g();');
  expectThrows('function g() { return ""; } const b: boolean = g();');
  expectThrows('function g() { return {}; } const b: boolean = g();');
  // Including through a typed shape, which is where a JSON-shaped value lands.
  expectThrows('function g() { return { enabled: 1 }; } const o: { enabled: boolean } = g();');
});

test('a Boolean crosses, and so does anything already typed as one', () => {
  expect(value('function g() { return true; } const b: boolean = g(); `${b}`;')).toBe('true');
  expect(value('function g() { return false; } const b: boolean = g(); `${b}`;')).toBe('false');
  expect(value('function g() { return { enabled: true }; } const o: { enabled: boolean } = g(); `${o.enabled}`;')).toBe('true');
  // A comparison is a Boolean by #sec-operator-results, so it crosses.
  expect(value('let x: uint32 = 5; const b: boolean = x < 10; `${b}`;')).toBe('true');
});

test('the truthiness is available, written', () => {
  expect(value('function g() { return 1; } const b: boolean = Boolean(g()); `${b}`;')).toBe('true');
  expect(value('function g() { return ""; } const b: boolean = !!g(); `${b}`;')).toBe('false');
});

test('a cast is an instruction and still converts', () => {
  // The same distinction `:= number` draws: a cast wraps and truncates where an
  // annotated binding throws.
  expect(value('function g() { return 1; } const b: boolean = (g() := boolean); `${b}`;')).toBe('true');
  expect(value('function g() { return {}; } const b: boolean = (g() := boolean); `${b}`;')).toBe('true');
  expect(value('function g() { return undefined; } const b: boolean = (g() := boolean); `${b}`;')).toBe('false');
});

test('the string boundary is unchanged', () => {
  // B.ii affirmed: the canonical-text rule keeps its sources. Only `boolean`
  // moved.
  expect(value('function g() { return 42; } const s: string = g(); s;')).toBe('42');
  expect(value('function g() { return true; } const s: string = g(); s;')).toBe('true');
  expectThrows('function g() { return undefined; } const s: string = g();');
});

test('boolean1 is an integer type and is not affected', () => {
  // `boolean1` is a one-bit integer, not the `boolean` type, and its family's
  // rules are the integer ones.
  expect(value('function g() { return 1; } const b: boolean1 = g(); `${b}`;')).toBe('1');
});
