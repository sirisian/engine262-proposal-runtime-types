import { test, expect } from 'vitest';
import { evaluated as evaluatedWithoutTemporal } from '../harness.mts';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * Extension coverage - temporal.md, Temporal as a type source.
 *
 * With the temporal feature on, Temporal's classes become nominal class types
 * (membership walks the prototype chain to the class constructor) and Temporal.Unit
 * becomes a string enum. Values flow through typed bindings, annotations, `is`, and
 * dependent record types, and each class's `compare` carries its signature's
 * int32 return. The dimensioned-duration overloads (which need the Dimensions
 * primitive-metadata meta type), the remaining typed method signatures, the
 * from-string cast operators, and the ordering operator sugar are deferred.
 */

// Local harness: Temporal is behind its own feature, so these run with both the
// runtime-types and temporal features on.
function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types', 'temporal'] }));
  return new ManagedRealm().evaluateScriptSkipDebugger(source);
}
function evaluated(source: string): string {
  const c = run(source) as unknown as { Type: string, Value: { stringValue?(): string, numberValue?(): number } };
  expect(c, `expected normal completion for: ${source}`).toMatchObject({ Type: 'normal' });
  const v = c.Value;
  if (v?.stringValue) {
    return v.stringValue();
  }
  if (v?.numberValue) {
    // See harness.mts: a TypedNumberValue is not a NumberValue, so R throws.
    // eslint-disable-next-line @engine262/mathematical-value
    return String(v.numberValue());
  }
  return String(v);
}
function expectThrown(source: string) {
  expect(run(source), `expected throw for: ${source}`).toMatchObject({ Type: 'throw' });
}

// -- Temporal classes are class types ------------------------------------------
test('temporal: an instance is of its class type, and a non-instance is not', () => {
  expect(evaluated('let i = Temporal.Instant.from("2026-07-09T12:00:00Z"); (i is Temporal.Instant) ? "y" : "n";')).toBe('y');
  expect(evaluated('("x" is Temporal.Instant) ? "y" : "n";')).toBe('n');
  // a Duration is not an Instant: the class types are distinct
  expect(evaluated('let d = Temporal.Duration.from("PT1H"); (d is Temporal.Instant) ? "y" : "n";')).toBe('n');
});

test('temporal: a typed binding accepts an instance and rejects a non-instance', () => {
  expect(evaluated('let i = Temporal.Instant.from("2026-07-09T12:00:00Z"); let x: Temporal.Instant = i; x.toString();')).toBe('2026-07-09T12:00:00Z');
  expectThrown('let x: Temporal.Instant = "not an instant"; x;');
});

test('temporal: the other Temporal classes are class types too', () => {
  expect(evaluated('let d = Temporal.Duration.from("PT1H30M"); (d is Temporal.Duration) ? "y" : "n";')).toBe('y');
  expect(evaluated('let p = Temporal.PlainDate.from("2026-07-09"); (p is Temporal.PlainDate) ? "y" : "n";')).toBe('y');
  expect(evaluated('let t = Temporal.PlainTime.from("12:30:00"); (t is Temporal.PlainTime) ? "y" : "n";')).toBe('y');
  expect(evaluated('let dt = Temporal.PlainDateTime.from("2026-07-09T12:30:00"); (dt is Temporal.PlainDateTime) ? "y" : "n";')).toBe('y');
});

test('temporal: a static factory (Temporal.Now) returns a typed instance', () => {
  expect(evaluated('let i = Temporal.Now.instant(); (i is Temporal.Instant) ? "y" : "n";')).toBe('y');
});

// -- Temporal.Unit is a string enum --------------------------------------------
test('temporal: Temporal.Unit members are the unit strings', () => {
  expect(evaluated('Temporal.Unit.Second;')).toBe('second');
  expect(evaluated('Temporal.Unit.Nanosecond;')).toBe('nanosecond');
  expect(evaluated('Temporal.Unit.Hour;')).toBe('hour');
});

test('temporal: a Temporal.Unit binding accepts a member and a matching string, rejects a misspelling', () => {
  expect(evaluated('let u: Temporal.Unit = Temporal.Unit.Second; u;')).toBe('second');
  expect(evaluated('let u: Temporal.Unit = "second"; u;')).toBe('second');
  expect(evaluated('("hour" is Temporal.Unit) ? "y" : "n";')).toBe('y');
  expectThrown('let u: Temporal.Unit = "secnod"; u;');
});

// -- Identity: a Temporal type is one interned type ----------------------------
test('temporal: a Temporal class names one type, and different classes are different types', () => {
  expect(evaluated('type A = Temporal.Instant; type B = Temporal.Instant; (A === B) ? "same" : "distinct";')).toBe('same');
  expect(evaluated('type A = Temporal.Instant; type B = Temporal.Duration; (A === B) ? "same" : "distinct";')).toBe('distinct');
});

// -- Temporal types in record and dependent record types -----------------------
test('temporal: a record field typed as a Temporal class checks its value', () => {
  expect(evaluated('let i = Temporal.Instant.from("2026-07-09T12:00:00Z"); ({ at: i } is { at: Temporal.Instant }) ? "y" : "n";')).toBe('y');
  expect(evaluated('({ at: "x" } is { at: Temporal.Instant }) ? "y" : "n";')).toBe('n');
});

test('temporal: an interval is a dependent record type over two Temporal.Instant fields', () => {
  // Uses Temporal.Instant.compare rather than the deferred `<` operator sugar.
  const interval = 'type Interval = { start: Temporal.Instant, end: Temporal.Instant } where Temporal.Instant.compare(this.start, this.end) < 0;';
  const a = 'let a = Temporal.Instant.from("2026-01-01T00:00:00Z");';
  const b = 'let b = Temporal.Instant.from("2026-12-31T00:00:00Z");';
  expect(evaluated(`${interval} ${a} ${b} ({ start: a, end: b } is Interval) ? "y" : "n";`)).toBe('y');
  expect(evaluated(`${interval} ${a} ${b} ({ start: b, end: a } is Interval) ? "y" : "n";`)).toBe('n');
});

// -- Reflection ----------------------------------------------------------------
test('temporal: a Temporal class type reflects like any nominal type', () => {
  expect(evaluated('type T = Temporal.Instant; typeof T;')).toBe('object');
  expect(evaluated('type T = Temporal.Instant; Reflect.getReflection(T).kind;')).toBe('primitive');
});

// -- Gating: Temporal is unreachable without the temporal feature --------------
test('temporal: with the temporal feature off, Temporal is not defined', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const c = new ManagedRealm().evaluateScriptSkipDebugger('typeof Temporal;') as unknown as { Type: string, Value: { stringValue?(): string } };
  expect(c.Type).toBe('normal');
  expect(c.Value.stringValue?.()).toBe('undefined');
});

// -- A built-in's signature carries its value-type return ----------------------
test('temporal: each class comparison returns its signature int32 rather than a plain number', () => {
  // temporal.md and standardlibrary.md: a built-in whose signature gives it a
  // value-type return carries that type on its result. A comparison answers with
  // an int32, so the result satisfies `is int32` while keeping the ordinary
  // negative, zero, positive readings.
  expect(evaluated('let a = Temporal.Instant.fromEpochMilliseconds(0); let b = Temporal.Instant.fromEpochMilliseconds(1); (Temporal.Instant.compare(a, b) is int32) ? "int32" : "plain";')).toBe('int32');
  expect(evaluated('let a = Temporal.Instant.fromEpochMilliseconds(0); let b = Temporal.Instant.fromEpochMilliseconds(1); String(Number(Temporal.Instant.compare(a, b)));')).toBe('-1');
  expect(evaluated('let a = Temporal.Instant.fromEpochMilliseconds(5); String(Number(Temporal.Instant.compare(a, a)));')).toBe('0');
  expect(evaluated('let a = Temporal.Instant.fromEpochMilliseconds(9); let b = Temporal.Instant.fromEpochMilliseconds(1); String(Number(Temporal.Instant.compare(a, b)));')).toBe('1');
  // every class that declares a comparison carries the same return type
  expect(evaluated('let a = Temporal.PlainDate.from("2020-01-01"); let b = Temporal.PlainDate.from("2021-01-01"); (Temporal.PlainDate.compare(a, b) is int32) ? "int32" : "plain";')).toBe('int32');
  expect(evaluated('let a = Temporal.PlainTime.from("01:00"); let b = Temporal.PlainTime.from("02:00"); (Temporal.PlainTime.compare(a, b) is int32) ? "int32" : "plain";')).toBe('int32');
  expect(evaluated('let a = Temporal.PlainDateTime.from("2020-01-01T01:00"); let b = Temporal.PlainDateTime.from("2021-01-01T01:00"); (Temporal.PlainDateTime.compare(a, b) is int32) ? "int32" : "plain";')).toBe('int32');
  expect(evaluated('let a = Temporal.PlainYearMonth.from("2020-01"); let b = Temporal.PlainYearMonth.from("2021-01"); (Temporal.PlainYearMonth.compare(a, b) is int32) ? "int32" : "plain";')).toBe('int32');
  expect(evaluated('let a = Temporal.ZonedDateTime.from("2020-01-01T00:00[UTC]"); let b = Temporal.ZonedDateTime.from("2021-01-01T00:00[UTC]"); (Temporal.ZonedDateTime.compare(a, b) is int32) ? "int32" : "plain";')).toBe('int32');
  // a duration comparison reaches its answer by several routes and each carries
  // the type, including the early equal-durations path
  expect(evaluated('let a = Temporal.Duration.from({ seconds: 1 }); let b = Temporal.Duration.from({ seconds: 2 }); (Temporal.Duration.compare(a, b) is int32) ? "int32" : "plain";')).toBe('int32');
  expect(evaluated('let a = Temporal.Duration.from({ seconds: 1 }); String(Number(Temporal.Duration.compare(a, a)));')).toBe('0');
});

test('temporal: a typed comparison result is still an ordinary comparison answer', () => {
  // the carried type does not change how the answer is used: it orders with the
  // relational operators and serves as a sort comparator
  expect(evaluated('let a = Temporal.Instant.fromEpochMilliseconds(0); let b = Temporal.Instant.fromEpochMilliseconds(1); (Temporal.Instant.compare(a, b) < 0) ? "lt" : "not";')).toBe('lt');
  expect(evaluated('let arr = [Temporal.Instant.fromEpochMilliseconds(2), Temporal.Instant.fromEpochMilliseconds(1)]; arr.sort(Temporal.Instant.compare); String(arr[0].epochMilliseconds);')).toBe('1');
});

test('temporal: with the type system off, a comparison is an ordinary number', () => {
  // the value-type return is part of the type system: with only the temporal
  // feature on, the built-in returns exactly what it always did
  setSurroundingAgent(new Agent({ features: ['temporal'] }));
  const c = new ManagedRealm().evaluateScriptSkipDebugger('let a = Temporal.Instant.fromEpochMilliseconds(0); let b = Temporal.Instant.fromEpochMilliseconds(1); typeof Temporal.Instant.compare(a, b) + ":" + String(Temporal.Instant.compare(a, b));') as unknown as { Type: string, Value: { stringValue?(): string } };
  expect(c.Type).toBe('normal');
  expect(c.Value.stringValue?.()).toBe('number:-1');
});

// -- Temporal is behind its own feature ---------------------------------------

test('temporal: Temporal is a type source only where its feature is on', () => {
  // Everything above runs with `temporal` enabled. With runtime-types alone,
  // the binding does not exist at all - so a program that names a Temporal type
  // is not quietly untyped, it does not resolve.
  expect(evaluated('typeof Temporal;')).toBe('object');
  expect(evaluatedWithoutTemporal('typeof Temporal;')).toBe('undefined');
});

// -- structuredClone: base-engine absence --------------------------------------
