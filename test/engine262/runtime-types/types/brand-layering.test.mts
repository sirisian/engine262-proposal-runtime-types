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

// ---------------------------------------------------------------------------
// C6: the construction boundary — phase 2
// ---------------------------------------------------------------------------

test('C6: a layered type is constructible', () => {
  // `ConvertValue` had no ~intersection~ case, so `EV(x)` fell past every
  // branch. The only intersection handling was in `CheckedConvertValue`, the
  // MEMBERSHIP path - and membership is exactly what a brand's absent
  // `validate` refuses. PLAN-brand.md OQ1, one level up.
  expect(evaluated(`${EV}String(EV('a@b'));`)).toBe('a@b');
});

test('C6: an already-branded value can cross into the layering', () => {
  // C7's mechanism: `EV(Email(x))` rather than a bare value.
  expect(evaluated(`${EV}String(EV(E('a@b')));`)).toBe('a@b');
});

test('C6: the guard holds — a mixed intersection still refuses', () => {
  // An object type and a brand have no single value to cross. Asserted twice,
  // here and above, because widening the crossing rule is the likeliest wrong
  // fix and this is what catches it.
  expectThrown("type O = { a: uint8 }; type V = string.<{ brand: 'V' }>; type OV = O & V; OV('a');");
});

test('C6: an intersection of brands over DIFFERENT bases refuses', () => {
  // The guard's second half: same-base is required, not merely all-parameterized.
  expectThrown("type A = string.<{ brand: 'A' }>; type B = uint8.<{ brand: 'B' }>; type AB = A & B; AB('a');");
});

// ---------------------------------------------------------------------------
// F172: a brand on a base that cannot carry a type
// ---------------------------------------------------------------------------

test('F172: a branded string can be held', () => {
  // Calling a Type Object is the construction boundary, and the static type of
  // that call is the type called. Without it the call typed as its BASE, so
  // every boundary downstream inserted a runtime check that CANNOT pass on a
  // String: a String has nowhere to carry a Type Record, so a branded string is
  // a bare string and `IsOfType(bare, E)` correctly answers false.
  //
  // The runtime check was never wrong and neither was elision - where the
  // checker knows the static type is the target, no check is inserted. Only the
  // static type of the call was missing.
  expect(evaluated(`${E}const v: E = E('a'); String(v);`)).toBe('a');
  expect(evaluated(`${E}function g(): E { return E('a'); } String(g());`)).toBe('a');
});

test('F172: a bare value is still refused where the brand is declared', () => {
  // The guard. A static type that made the brand admit anything would pass the
  // test above and destroy the feature.
  expectThrown(`${E}function f(e: E) { return e; } function h(s: string) { return f(s); } h('a');`);
  expectThrown(`${E}function h(s: string) { const v: E = s; return v; } h('a');`);
});

test('F172: the numeric case is unchanged', () => {
  // A numeric value carries its Type Record, so a `uint32` brand worked
  // throughout and must keep working.
  expect(evaluated("type U = uint32.<{ brand: 'U' }>; function f(u: U) { return u; }"
    + ' String(f(U((7 := uint32))));')).toBe('7');
});

// ---------------------------------------------------------------------------
// F172: a String brand now carries, so it behaves as a numeric one does
// ---------------------------------------------------------------------------

test('F172: a string brand carries its type and can be passed', () => {
  // The crossing STAMPS the value, and it stamped only a typed number - every
  // other value came back unchanged. So a branded String was a bare String,
  // `IsOfType(bare, E)` correctly answered false, and a value from the brand's
  // own constructor could not be passed anywhere.
  //
  // A String has a carrier - `TypedStringValue`, which `carryStringType`
  // already used for a literal string type - so the crossing uses it for a
  // parameterization of `string` too.
  expect(evaluated(`${E}String(Reflect.typeOf(E('a')) === E);`)).toBe('true');
  expect(evaluated(`${E}function f(x: E) { return 1; } String(f(E('a')));`)).toBe('1');
});

test('F172: a string brand still refuses a bare value and does not cross', () => {
  // The guards. A carrier that admitted anything would pass the test above and
  // destroy the feature.
  expectThrown(`${E}function f(x: E) { return 1; } function h(u) { return f(u); } h('a');`);
  expectThrown(`${E}${V}function f(x: V) { return 1; } function h(e: E) { return f(e); } h(E('a'));`);
});

test('F172: the numeric bases are unchanged', () => {
  expect(evaluated("type U = uint32.<{ brand: 'B' }>; function f(x: U) { return 1; }"
    + ' String(f(U((7 := uint32))));')).toBe('1');
  expect(evaluated("type F = float64.<{ brand: 'B' }>; String(Reflect.typeOf(F((1.5 := float64))) === F);")).toBe('true');
});

// ---------------------------------------------------------------------------
// OQ4-A: a brand needs somewhere to live
// ---------------------------------------------------------------------------

test('an object or array base carries a brand', () => {
  // OQ4-A refused these, on two arguments that both fail. An object's runtime
  // type is DERIVED from its shape - true - but that is not the same as having
  // nowhere to store one: an array's [[TypedElement]] and a tuple's record
  // already travel on the object, because "only a mark on the object itself can
  // refuse a store that the narrow view forbids". A brand is the same kind of
  // mark.
  //
  // The second argument - that an object is mutable, so a stamped brand
  // outlives what it was granted for - confuses a brand with a pattern. A brand
  // asserts PROVENANCE; a pattern asserts a predicate and re-validates. A class
  // instance is nominal and mutable and nobody calls that unsound.
  const B = "type Base = { a: uint8 }; type T = Base.<{ brand: 'B' }>;";
  expect(evaluated(`${B} String(Reflect.getReflection(T).kind);`)).toBe('parameterized');
  expect(evaluated(`${B} String(Reflect.typeOf(T({ a: (1 := uint8) })) === T);`)).toBe('true');
  expect(evaluated(`${B} function f(x: T) { return 1; } String(f(T({ a: (1 := uint8) })));`)).toBe('1');
  const A = "type Base = [].<uint8>; type T = Base.<{ brand: 'B' }>;";
  expect(evaluated(`${A} String(Reflect.typeOf(T([(1 := uint8)])) === T);`)).toBe('true');
});

test('an object brand refuses a bare value and does not cross', () => {
  const B = "type Base = { a: uint8 }; type T = Base.<{ brand: 'B' }>;";
  expectThrown(`${B} function f(x: T) { return 1; } function h(u: Base) { return f(u); } h({ a: (1 := uint8) });`);
  expectThrown(`${B} type U = Base.<{ brand: 'U' }>;`
    + ' function f(x: U) { return 1; } function h(v: T) { return f(v); } h(T({ a: (1 := uint8) }));');
});

test('a branded object keeps its brand across a mutation', () => {
  // Asserted as CORRECT, not as a hazard. A brand records where a value came
  // from; mutating a field does not change that, exactly as mutating a class
  // instance's field does not stop it being an instance.
  const B = "type Base = { a: uint8 }; type T = Base.<{ brand: 'B' }>;";
  expect(evaluated(`${B} const v = T({ a: (1 := uint8) }); v.a = (99 := uint8);`
    + ' String(Reflect.typeOf(v) === T);')).toBe('true');
});

test('OQ4-A: other metadata on an object base is unaffected', () => {
  // The refusal is about `brand` specifically, not about parameterizing an
  // object: a judgment that VALIDATES re-runs at each boundary and so needs
  // nothing carried on the value.
  expect(evaluated("type Base = { a: uint8 }; type P = Base.<{ pattern: /^a/ }>; String(1);")).toBe('1');
});

test('OQ4-A: brands on carrying bases are unaffected', () => {
  expect(evaluated(`${E}function f(x: E) { return 1; } String(f(E('a')));`)).toBe('1');
  expect(evaluated("type U = uint32.<{ brand: 'B' }>; String(Reflect.typeOf(U((7 := uint32))) === U);")).toBe('true');
});

test('F176: a bigint brand carries, as a string brand does', () => {
  // `TypedBigIntValue` existed and `RuntimeTypeOf` already recognised it; the
  // crossing was not using it. The same one-line gap as F172, one base over.
  const G = "type G = bigint.<{ brand: 'G' }>;";
  expect(evaluated(`${G} String(Reflect.typeOf(G(1n)) === G);`)).toBe('true');
  expect(evaluated(`${G} function f(x: G) { return 1; } String(f(G(1n)));`)).toBe('1');
  expectThrown(`${G} function f(x: G) { return 1; } function h(u) { return f(u); } h(1n);`);
  expectThrown(`${G} type H = bigint.<{ brand: 'H' }>;`
    + ' function f(x: H) { return 1; } function h(g: G) { return f(g); } h(G(1n));');
});

test('boolean is the one base a brand cannot yet carry on', () => {
  // Recorded as the state, not asserted as correct. `boolean` has no
  // `TypedBooleanValue`, so it is the only primitive left where the crossing
  // produces something the receiving boundary cannot recognise.
  expect(evaluated("type B = boolean.<{ brand: 'B' }>; String(B(true));")).toBe('true');
  expectThrown("type B = boolean.<{ brand: 'B' }>; function f(x: B) { return 1; } f(B(true));");
});
