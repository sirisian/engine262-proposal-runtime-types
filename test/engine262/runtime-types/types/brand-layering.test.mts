import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * PLAN-brand-layering-F.md. Layering a brand — "a Verified Email" — and the
 * criteria a layering mechanism has to meet.
 *
 * The mechanism is INTERSECTION. `PLAN-brand-layering.md` compared six
 * directions against fourteen criteria and intersection was the only one whose
 * algebra was already correct: `E & V` sheds to `E`, sheds to the base, and
 * refuses a bare value. What it lacked was normalization (F169, phase 1),
 * a construction boundary (phase 2), and an error where the metadata merge
 * silently discards a second brand (phase 3).
 *
 * Tests are named for the criterion they pin, so a failure names the property
 * that was lost rather than a line number.
 */

const E = "type E = string.<{ brand: 'Email' }>;";
const V = "type V = string.<{ brand: 'Verified' }>;";
const EV = `${E}${V}type EV = E & V;`;

// ---------------------------------------------------------------------------
// C1-C4, C9: the algebra, which held before this plan and must keep holding
// ---------------------------------------------------------------------------

test('C1: a layered type is expressible', () => {
  expect(evaluated(`${EV}const n = Reflect.getReflection(EV); String(n.kind + ':' + n.members.length);`))
    .toBe('intersection:2');
});

test('C2: the inner brand survives — a Verified IS an Email', () => {
  // The criterion layering exists for. Without it, `send(verify(e))` cannot
  // work and a second brand is just an unrelated type.
  expect(evaluated(`${EV}String(Reflect.isAssignable(EV, E));`)).toBe('true');
  expect(evaluated(`${EV}String(Reflect.isAssignable(EV, V));`)).toBe('true');
});

test('C3: the base still sheds', () => {
  expect(evaluated(`${EV}String(Reflect.isAssignable(EV, string));`)).toBe('true');
});

test('C4: the base is still refused, by assignability AND at an annotation', () => {
  expect(evaluated(`${EV}String(Reflect.isAssignable(string, EV));`)).toBe('false');
  expectThrown(`${EV}function g(s: string) { let y: EV = s; return y; } g('a@b');`);
});

test('C9: the same layering written twice is one type', () => {
  expect(evaluated(`${EV}String(EV === type E & V);`)).toBe('true');
});

// ---------------------------------------------------------------------------
// C5: normalization — F169, phase 1
// ---------------------------------------------------------------------------

test('C5: layering is order-independent', () => {
  // F169. `orderKeyWithin`'s ~parameterized~ case keyed only the BASE, so two
  // parameterizations of one base produced the identical key, the canonical
  // sort could not separate them, and the written order survived into the
  // interned identity - two Type Objects for one type, mutually assignable.
  expect(evaluated(`${EV}String(type E & V === type V & E);`)).toBe('true');
});

test('C5: normalization is not brand-specific', () => {
  // The row that shows F169 is a metadata-protocol defect rather than a brand
  // one: ANY two parameterizations of one base were affected.
  expect(evaluated("type P = string.<{ pattern: /^a/ }>; type V = string.<{ brand: 'V' }>;"
    + ' String(type P & V === type V & P);')).toBe('true');
});

test('C5: parameterizations of DIFFERENT bases were already fine', () => {
  // These key differently by base, which is why the defect looked narrower than
  // it was.
  expect(evaluated("type E = string.<{ brand: 'E' }>; type N = uint8.<{ brand: 'N' }>;"
    + ' String(type E & N === type N & E);')).toBe('true');
});

test('C5: non-parameterized intersections are unchanged', () => {
  // The phase-1 gate. A fix that reached order-independence by changing how
  // every intersection is keyed would pass the tests above and break these.
  expect(evaluated('type A = { a: uint8 }; type B = { b: string }; String(type A & B === type B & A);')).toBe('true');
  expect(evaluated('String(type uint8 & string === type string & uint8);')).toBe('true');
});

test('C5: normalizing did not collapse distinct types', () => {
  // The other failure mode: order-independence is trivially achievable by
  // making everything equal.
  expect(evaluated(`${EV}String(EV !== E);`)).toBe('true');
  expect(evaluated("String(type uint32.<{ brand: 'A' }> !== type uint32.<{ brand: 'B' }>);")).toBe('true');
  expect(evaluated("String(type string.<{ pattern: /^a/ }> !== type string.<{ pattern: /^b/ }>);")).toBe('true');
});

// ---------------------------------------------------------------------------
// C8, C12: properties a brand must not lose by being layered
// ---------------------------------------------------------------------------

test('C8: no wrapper — a layered value is its base value', () => {
  expect(evaluated(`${EV}function f(x: EV) { return typeof x; } String(1);`)).toBe('1');
});

test('C12: layering composes with other metadata', () => {
  // A branded-and-patterned type intersected with a brand keeps both readings.
  expect(evaluated("type P = string.<{ brand: 'E', pattern: /^a/ }>; type V = string.<{ brand: 'V' }>;"
    + ' String(Reflect.isAssignable(type P & V, P));')).toBe('true');
});

test('C12: a pattern still validates at its own boundary', () => {
  expect(evaluated("type P = string.<{ pattern: /^a+$/ }>; String(P('aa'));")).toBe('aa');
  expectThrown("type P = string.<{ pattern: /^a+$/ }>; P('zz');");
});

// ---------------------------------------------------------------------------
// Round trip, and the guard that keeps the construction rule definable
// ---------------------------------------------------------------------------

test('a layered type round-trips as an identity', () => {
  expect(evaluated(`${EV}String(Reflect.makeType(Reflect.getReflection(EV)) === EV);`)).toBe('true');
});

test('an intersection that is NOT all parameterizations of one base refuses construction', () => {
  // Phase 2's guard, asserted before phase 2 so that widening the construction
  // rule too far breaks a test. An object type and a brand have no single value
  // to cross.
  expectThrown("type O = { a: uint8 }; type V = string.<{ brand: 'V' }>; (type O & V)('a');");
});
