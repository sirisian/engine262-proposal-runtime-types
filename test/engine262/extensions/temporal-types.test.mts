import { test, expect } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * Extension coverage - temporal.md, Temporal as a type source.
 *
 * With the temporal feature on, Temporal's classes become nominal class types
 * (membership walks the prototype chain to the class constructor) and Temporal.Unit
 * becomes a string enum. Values flow through typed bindings, annotations, `is`, and
 * dependent record types. The dimensioned-duration overloads (which need the
 * Dimensions primitive-metadata meta type), the typed method signatures, the
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
  if (v?.stringValue) { return v.stringValue(); }
  if (v?.numberValue) { return String(v.numberValue()); }
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
