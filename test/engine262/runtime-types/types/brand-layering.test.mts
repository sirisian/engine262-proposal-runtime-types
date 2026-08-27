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


// ---------------------------------------------------------------------------
// T4: a carrier is chosen by the base's PRIMITIVE, looked through
// ---------------------------------------------------------------------------

test('T4: a brand over a LITERAL base carries', () => {
  // The carrier was chosen by `Base.Kind === 'primitive'`, and a
  // parameterization's base need not be one: `'a'.<{ brand }>` has a ~literal~
  // base. So a branded literal carried nothing and every boundary refused it.
  expect(evaluated("type L = 'a'; type B = L.<{ brand: 'B' }>;"
    + ' String(Reflect.typeOf(B(\'a\')) === B);')).toBe('true');
});

test('T4: a NESTED brand carries its outer layer, not its inner', () => {
  // Two gaps in one: the base of `E.<{ brand: 'N' }>` is ~parameterized~, which
  // the guard also missed; and `carryStringType` returned an already-carrying
  // value unchanged, so a nested crossing left it reporting the INNER type.
  // Re-stamping unless the target is identical fixes the second.
  const N = "type E = string.<{ brand: 'E' }>; type N = E.<{ brand: 'N' }>;";
  expect(evaluated(`${N} String(Reflect.typeOf(N(E('a'))) === N);`)).toBe('true');
  expect(evaluated(`${N} String(Reflect.typeOf(N(E('a'))) === E);`)).toBe('false');
});

test('T4: a plain brand is unchanged', () => {
  expect(evaluated(`${E}String(Reflect.typeOf(E('a')) === E);`)).toBe('true');
  expect(evaluated("type G = bigint.<{ brand: 'G' }>; String(Reflect.typeOf(G(1n)) === G);")).toBe('true');
});


// ---------------------------------------------------------------------------
// F179: the intersection crossing does not produce the INTERSECTION type
// ---------------------------------------------------------------------------

test('F179: a crossing into an intersection yields the INTERSECTION', () => {
  // The arm threaded the value through each member in turn, which was wrong
  // twice over: the value ended up carrying the LAST member's record - so
  // `typeOf(EV(x)) === EV` was false, it was a `V` - and on a base whose values
  // carry their type, member 2 received a value already stamped as member 1 and
  // refused it ("a meta type does not admit converting A to B").
  //
  // A crossing is from a BARE value, and an intersection of parameterizations
  // over one base has one bare form: the base's. So it crosses the base once,
  // consults every member's judgments over the result, and stamps `t`.
  expect(evaluated(`${EV}String(Reflect.typeOf(EV('a@b')) === EV);`)).toBe('true');
  expect(evaluated("type A = uint32.<{ brand: 'A' }>; type B = uint32.<{ brand: 'B' }>; type AB = A & B;"
    + ' String(Reflect.typeOf(AB(A((7 := uint32)))) === AB);')).toBe('true');
});

test('F179: C7 - a brand can be ADDED to an already-branded value', () => {
  // The incremental case every real use has.
  expect(evaluated("type A = uint32.<{ brand: 'A' }>; type B = uint32.<{ brand: 'B' }>; type AB = A & B;"
    + ' String(AB(A((7 := uint32))));')).toBe('7');
});

test('F179: the end-to-end gate runs - send(verify(e))', () => {
  // The program this plan opened with. `verify` takes an Email and returns an
  // Email & Verified; `send` takes an Email; a Verified IS an Email.
  expect(evaluated(`${EV}function verify(e: E): EV { return EV(e); }`
    + " function send(to: E) { return to; } String(send(verify(E('a@b'))));")).toBe('a@b');
});

test('F179: the guards survive the fix', () => {
  // A bare value is still refused, the layering still sheds to each member, a
  // mixed intersection still refuses construction, and a pattern inside an
  // intersection still validates.
  expectThrown(`${EV}function h(s: string) { let y: EV = s; return y; } h('a');`);
  expect(evaluated(`${EV}String(Reflect.isAssignable(EV, E));`)).toBe('true');
  expectThrown("type O = { a: uint8 }; type V = string.<{ brand: 'V' }>; type OV = O & V; OV('a');");
  const PV = "type P = string.<{ pattern: /^a+$/ }>; type V = string.<{ brand: 'V' }>; type PV = P & V;";
  expectThrown(`${PV} PV('zz');`);
  expect(evaluated(`${PV} String(PV('aa'));`)).toBe('aa');
});

test('F179: layering works on every carrying base, not only strings', () => {
  // The matrix in the plan measured a SINGLE brand per base. Layering is a
  // different question and F179 changed it, so it is measured separately: for
  // each carrying base, `A & B` constructs, reports itself, accepts an already-
  // branded value, and sheds to a member.
  const cases: [string, string, string][] = [
    ['uint32', 'uint32', '(7 := uint32)'],
    ['float64', 'float64', '(1.5 := float64)'],
    ['string', 'string', "'a'"],
    ['bigint', 'bigint', '1n'],
    ['object', 'Base', '{ a: (1 := uint8) }'],
    ['array', 'Base2', '[(1 := uint8)]'],
  ];
  for (const [, base, val] of cases) {
    const d = 'type Base = { a: uint8 }; type Base2 = [].<uint8>;'
      + ` type A = ${base}.<{ brand: 'A' }>; type B = ${base}.<{ brand: 'B' }>; type AB = A & B;`;
    expect(evaluated(`${d} String(Reflect.typeOf(AB(${val})) === AB);`)).toBe('true');
    expect(evaluated(`${d} String(AB(A(${val})) !== undefined);`)).toBe('true');
    expect(evaluated(`${d} function f(x: A) { return 1; } String(f(AB(${val})));`)).toBe('1');
  }
});


// ---------------------------------------------------------------------------
// F183: a dead OPERAND is not the same defect as a constant ANSWER
// ---------------------------------------------------------------------------

test('F183: a logical operator whose right operand can never evaluate is dead code', () => {
  // `??` was reported for this and `||`/`&&` were not, though they are the same
  // shape whenever the left operand's type settles the test. Decidable only
  // where truthiness is a property of the TYPE - a literal, or a union of
  // literals that agree.
  expectThrown('type T = 5; function f(d: T) { return d || (9 := uint8); } f((5 := T));');
  expectThrown('type Z = 0; function f(d: Z) { return d && (9 := uint8); } f((0 := Z));');
  expectThrown('type T = 1 | 2; function f(d: T) { return d || (9 := uint8); } f((1 := T));');
});

test('F183: a reachable operand is left alone', () => {
  // `uint8` settles nothing - 0 is falsy and every other value is not - and a
  // union whose members disagree settles nothing either. `5 && x` reaches its
  // right operand precisely because 5 is truthy.
  expect(evaluated('function f(d: uint8) { return d || (9 := uint8); }'
    + ' String(f((1 := uint8)));')).toBe('1');
  expect(evaluated('type T = 5; function f(d: T) { return d && (9 := uint8); }'
    + ' String(f((5 := T)));')).toBe('9');
  expect(evaluated('type T = 0 | 1; function f(d: T) { return d || (9 := uint8); }'
    + ' String(f((1 := T)));')).toBe('1');
});

test('F183: a constant ANSWER in a value position stays legitimate', () => {
  // The distinction this rule turns on. An impossible `instanceof` has no
  // unreachable operand - it is a question with a constant answer, and the
  // corpus writes exactly this to demonstrate the operator.
  expect(evaluated('let a: uint8 = 0; String(a instanceof uint8);')).toBe('true');
  expect(evaluated('let a: uint8 = 0; String(a instanceof uint16);')).toBe('false');
  expect(evaluated('function f(a: uint8) { const x = typeof a === "string"; return x; }'
    + ' String(f((1 := uint8)));')).toBe('false');
});

// ---------------------------------------------------------------------------
// symbol: a carrier where boolean cannot have one
// ---------------------------------------------------------------------------

test('a symbol brand carries, passes, and refuses a bare value', () => {
  // `boolean` and `symbol` were filed together as "primitives whose values
  // cannot carry a Type Record". Only one of them cannot.
  //
  // `Value.true` and `Value.false` are SINGLETONS and the engine compares
  // against them by identity at 288 sites, so a carrier - necessarily a
  // different object - fails every one, and a branded `true` came out falsy
  // (F177). A Symbol has neither problem: every `Symbol()` is already a fresh
  // object, and the engine compares symbols by identity in ONE place.
  const S = "type S = symbol.<{ brand: 'S' }>;";
  expect(evaluated(`${S} const v = S(Symbol('a')); String(Reflect.typeOf(v) === S);`)).toBe('true');
  expect(evaluated(`${S} function f(x: S) { return 1; } String(f(S(Symbol('a'))));`)).toBe('1');
  expectThrown(`${S} function f(x: S) { return 1; } function h(u) { return f(u); } h(Symbol('a'));`);
  expectThrown(`${S} type T = symbol.<{ brand: 'T' }>;`
    + " function f(x: T) { return 1; } function h(s: S) { return f(s); } h(S(Symbol('a')));");
});

test('a branded symbol is still a symbol', () => {
  // The guards. A carrier that changed what a Symbol IS would pass the tests
  // above and break the language - which is exactly what happened to `boolean`.
  const S = "type S = symbol.<{ brand: 'S' }>;";
  expect(evaluated(`${S} const v = S(Symbol('a')); String(typeof v);`)).toBe('symbol');
  expect(evaluated(`${S} const v = S(Symbol('hi')); String(v.description);`)).toBe('hi');
  expect(evaluated(`${S} const k = S(Symbol('k')); const o = {}; o[k] = (1 := uint8); String(o[k]);`)).toBe('1');
  expect(evaluated(`${S} const k = S(Symbol('k')); String(k === k);`)).toBe('true');
  expect(evaluated(`${S} String(S(Symbol('x')) === S(Symbol('x')));`)).toBe('false');
});

test('boolean brands work, and a branded boolean is still a boolean', () => {
  // F177 ruled this out: `Value.true` and `Value.false` are singletons and a
  // carrier is a different object, so a branded `true` came out FALSY.
  //
  // Fixed at the funnels rather than by avoiding a carrier. `ToBoolean` now
  // normalizes to the singleton - observably identical for a plain Boolean, and
  // the right reading besides, since it asks only for truth. `ToString` and
  // `SameValueNonNumber` read `booleanValue()` instead of comparing objects.
  const B = "type B = boolean.<{ brand: 'B' }>;";
  expect(evaluated(`${B} function f(x: B) { return 1; } String(f(B(true)));`)).toBe('1');
  expectThrown(`${B} function f(x: B) { return 1; } function h(u) { return f(u); } h(true);`);
  // The guards - each one a way the carrier could break the language.
  expect(evaluated(`${B} String(B(true) ? 'yes' : 'no');`)).toBe('yes');
  expect(evaluated(`${B} String(B(false) ? 'yes' : 'no');`)).toBe('no');
  expect(evaluated(`${B} String(typeof B(true));`)).toBe('boolean');
  expect(evaluated(`${B} String(B(true) === true);`)).toBe('true');
  expect(evaluated(`${B} String(B(true));`)).toBe('true');
  expect(evaluated(`${B} String(B(true) && 'and');`)).toBe('and');
});
