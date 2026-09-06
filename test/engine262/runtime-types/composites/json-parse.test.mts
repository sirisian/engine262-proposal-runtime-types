import { test, expect } from 'vitest';
import { evaluated, expectThrownKind, expectStaticTypeError } from '../harness.mts';

// ---------------------------------------------------------------------------
// `JSON.parse.<Composite.<T>>(text)` VALIDATES AGAINST T AND INTERNS THE RESULT,
// ALL THE WAY DOWN.
//
// serialization.md: "validates the document against T by the rules above and
// interns the result, so two parses of equal documents are the same object".
// composites.md: "nested composites are trees terminating in non-composite
// leaves"; "a homogeneous `Composite.<[].<T>>` covers the variable-length case".
//
// Only a FLAT shape worked. Four gaps, each measured:
// 1. CompositeFromShape converted a nested member to its declared type and left
//    it a plain object, so two parses of any nested document held different
//    inner objects and never interned. A parsed document has no identity anyone
//    holds, so the JSON path now interns deep. (A DIRECT `Composite({ v: {} })`
//    still keeps the inner object's identity, as composites.md states.)
// 2. `[].<T>` was refused as a shape - "not an object or tuple type".
// 3. Membership: `Composite.<shape>` froze only the shape's own members, so a
//    nested `[].<E>` kept a writable `E` no frozen composite could satisfy; and
//    the relation had no arm for a tuple composite against a tuple or array
//    type. So a parsed composite failed `is` against its own shape.
// 4. The composite path skipped CoerceJSON's range check and ConvertValue
//    WRAPPED: `"retries":300` at a `uint8` interned silently as 44 where the
//    plain `JSON.parse.<T>` refused it. Validation now precedes interning.
// And CoerceJSON had no tuple case at all, so `JSON.parse.<[uint8, string]>`
// was refused on the plain path too.
// ---------------------------------------------------------------------------

const TYPES = 'type E = { host: string, port: uint16 }; type S = { name: string, endpoints: [].<E>, retries: uint8 }; ';
const TEXT = '{"name":"api","endpoints":[{"host":"a","port":443},{"host":"b","port":8443}],"retries":3}';
const parse = (t = TEXT) => `JSON.parse.<Composite.<S>>(${JSON.stringify(t)})`;

test('two parses of equal documents are one object, and so is every nested object and array', () => {
  expect(evaluated(`${TYPES} const a = ${parse()}; const b = ${parse()}; String(a === b);`)).toBe('true');
  expect(evaluated(`${TYPES} const a = ${parse()}; const b = ${parse()}; String(a.endpoints === b.endpoints);`)).toBe('true');
  expect(evaluated(`${TYPES} const a = ${parse()}; const b = ${parse()}; String(a.endpoints[0] === b.endpoints[0]);`)).toBe('true');
  expect(evaluated(`${TYPES} const a = ${parse()}; String(Composite.isComposite(a.endpoints)) + " " + String(Composite.isComposite(a.endpoints[0]));`)).toBe('true true');
  expect(evaluated(`${TYPES} const a = ${parse()}; String(Object.isFrozen(a)) + " " + String(Object.isFrozen(a.endpoints[0]));`)).toBe('true true');
});

test('interning is by content: key order and whitespace do not matter, a change does', () => {
  const reordered = '{ "retries": 3, "endpoints": [ {"port":443,"host":"a"}, {"port":8443,"host":"b"} ], "name": "api" }';
  expect(evaluated(`${TYPES} String(${parse()} === ${parse(reordered)});`)).toBe('true');
  expect(evaluated(`${TYPES} String(${parse()} === ${parse(TEXT.replace('"retries":3', '"retries":4'))});`)).toBe('false');
});

test('the values carry their declared types and the composite satisfies its shape', () => {
  expect(evaluated(`${TYPES} const a = ${parse()}; String(a.endpoints[0].port is uint16);`)).toBe('true');
  expect(evaluated(`${TYPES} const a = ${parse()}; String(a is Composite.<S>);`)).toBe('true');
  expect(evaluated(`${TYPES} const a = ${parse()}; String(a.endpoints is Composite.<[].<E>>);`)).toBe('true');
  expect(evaluated(`${TYPES} const a = ${parse()}; String(a.endpoints[0] is Composite.<E>);`)).toBe('true');
  // ...which is what lets a typed Map find the re-parsed key.
  expect(evaluated(`${TYPES} const m = new Map.<Composite.<S>, uint32>(); m.set(${parse()}, 1); String(m.get(${parse()}));`)).toBe('1');
});

test('validation happens during the parse, before interning - no silent wrap', () => {
  // `uint8(300)` wraps to 44; the plain typed parse refuses 300 and so must this.
  expectThrownKind(`${TYPES} ${parse('{"name":"api","endpoints":[],"retries":300}')};`, 'TypeError');
  expectThrownKind(`${TYPES} ${parse('{"name":"api","endpoints":[{"host":"x","port":70000}],"retries":1}')};`, 'TypeError');
  expectThrownKind(`${TYPES} ${parse('{"endpoints":[],"retries":1}')};`, 'TypeError');
  expectThrownKind(`${TYPES} ${parse('{"name":"api","endpoints":[],"retries":1,"debug":true}')};`, 'TypeError');
  expect(evaluated(`${TYPES} try { ${parse('{"name":"api","endpoints":[],"retries":300}')}; } catch (e) { e.message; }`)).toContain('at .retries: expected uint8, got 300');
});

test('a top-level tuple or homogeneous array document interns', () => {
  expect(evaluated('type P = [uint8, uint8]; String(JSON.parse.<Composite.<P>>("[3, 4]") === JSON.parse.<Composite.<P>>("[3, 4]"));')).toBe('true');
  expect(evaluated('String(JSON.parse.<Composite.<[].<uint32>>>("[1, 2, 3]") === JSON.parse.<Composite.<[].<uint32>>>("[1, 2, 3]"));')).toBe('true');
  expect(evaluated('const t = JSON.parse.<Composite.<[].<uint32>>>("[1, 2, 3]"); String(t is Composite.<[].<uint32>>) + " " + String(t[1] is uint32);')).toBe('true true');
  // The plain typed parse handles a tuple too - it had no tuple case at all.
  expect(evaluated('const t = JSON.parse.<[uint8, string]>(\'[1, "x"]\'); String(t[0] is uint8) + " " + t[1];')).toBe('true x');
  expectThrownKind('JSON.parse.<[uint8, string]>(\'[1, "x", 3]\');', 'TypeError');
  expectThrownKind('JSON.parse.<[uint8, string]>(\'[1]\');', 'TypeError');
});

test('the shape of Composite.<S> is read as a composite tree, every spelling alike', () => {
  // #sec-composite-types: a structural member of the shape denotes the
  // composite type over it, and the top's members are readonly. This is ONE
  // rule in builtinTypeRecord, so the annotation, the typed creation and the
  // parse target all denote the same type - and the typed creation builds
  // nested composites at that type, interning with the parse of the same data.
  expect(evaluated(`${TYPES} String(type Composite.<S>);`)).toBe('Composite.<{ endpoints: Composite.<[].<Composite.<{ host: string, port: uint.<16> }>>>, name: string, retries: uint.<8> }>');
  expect(evaluated(`${TYPES} const c = Composite.<S>({ name: "api", endpoints: [{ host: "a", port: 443 }, { host: "b", port: 8443 }], retries: 3 }); String(Composite.isComposite(c.endpoints)) + " " + String(Composite.isComposite(c.endpoints[0]));`)).toBe('true true');
  expect(evaluated(`${TYPES} const c = Composite.<S>({ name: "api", endpoints: [{ host: "a", port: 443 }, { host: "b", port: 8443 }], retries: 3 }); String(c === ${parse()});`)).toBe('true');
  expect(evaluated(`${TYPES} const c = Composite.<S>({ name: "api", endpoints: [{ host: "a", port: 443 }, { host: "b", port: 8443 }], retries: 3 }); String(c is Composite.<S>);`)).toBe('true');
});

test('the UNTYPED Composite keeps a nested plain object\'s identity - only a shape says the member is data', () => {
  // composites.md: "Composite({ v: {} }) !== Composite({ v: {} })" - with no
  // shape, the inner object is the caller's, with an identity the caller holds.
  expect(evaluated('String(Composite({ v: {} }) === Composite({ v: {} }));')).toBe('false');
  expect(evaluated('const inner = {}; String(Composite({ v: inner }) === Composite({ v: inner }));')).toBe('true');
});

test('a tuple composite is of the variable-length array SHAPE when every element is of the element type', () => {
  // `Composite.<[].<E>>` is a composite shape - frozen on both sides, so the
  // clause's argument against tuple-to-array subtyping ("an ~array~ type
  // describes a mutable container") does not arise between two composite
  // shapes - and a tuple composite is of it when every element is an E.
  expect(evaluated('const t = JSON.parse.<Composite.<[].<uint8>>>("[1, 2]"); String(t is Composite.<[].<uint8>>) + " " + String(t is Composite.<[uint8, uint8]>);')).toBe('true true');
  expect(evaluated('const t = JSON.parse.<Composite.<[].<uint8>>>("[1, 2]"); String(t is Composite.<[].<string>>);')).toBe('false');
  expect(evaluated('const t = JSON.parse.<Composite.<[].<uint8>>>("[1, 2]"); String(t is Composite.<[uint8]>);')).toBe('false');
});

test('a bare Composite target states no shape and is refused', () => {
  expectThrownKind('JSON.parse.<Composite>(\'{"a":1}\');', 'TypeError');
});

// ---------------------------------------------------------------------------
// A COMPOSITE IS A SUBTYPE OF NO ARRAY TYPE - AND THE CHECKER CAN NOW SEE IT.
//
// "it is a subtype of no ~array~ type, because an ~array~ type describes a
// mutable container and every mutating operation on a composite throws". The
// relation said so, but `const t = Composite.<[uint8, uint8]>([1, 2]); let a:
// [].<uint8> = t;` passed the checker, because a `const` recorded its
// initializer's type only for a `new` - and the typed creation, which writes
// its type at the call exactly as a construction does, was ~any~ to it. The run
// time then admitted the exotic array structurally, and the function's first
// `push` threw where the binding itself was the error.
// ---------------------------------------------------------------------------

test('the typed creation has a Static Type, and a const binding keeps it', () => {
  expectStaticTypeError('let a: [].<uint8> = Composite.<[uint8, uint8]>([1, 2]);');
  expectStaticTypeError('const t = Composite.<[uint8, uint8]>([1, 2]); let a: [].<uint8> = t;');
  expectStaticTypeError('const t = Composite.<[uint8, uint8]>([1, 2]); let s: string = t;');
  // ...a tuple type, which the clause allows, and its own type, are fine.
  expect(evaluated('const t = Composite.<[uint8, uint8]>([1, 2]); let u: [uint8, uint8] = t; String(u === t);')).toBe('true');
  expect(evaluated('const t = Composite.<[uint8, uint8]>([1, 2]); let c: Composite.<[uint8, uint8]> = t; String(c === t);')).toBe('true');
  // A `let` is not fixed by its initializer - it may be reassigned.
  expect(evaluated('let t = Composite.<[uint8, uint8]>([1, 2]); t = 5; String(t);')).toBe('5');
});

test('JSON.parse.<T> has the Static Type T, and a const binding keeps it', () => {
  expectStaticTypeError('let s: string = JSON.parse.<uint8>("1");');
  expectStaticTypeError('const j = JSON.parse.<uint8>("1"); let s: string = j;');
  expectStaticTypeError('const c = JSON.parse.<Composite.<[uint8, uint8]>>("[1,2]"); let a: [].<uint8> = c;');
  expect(evaluated('const j = JSON.parse.<uint8>("1"); let u: uint8 = j; String(u is uint8);')).toBe('true');
  expect(evaluated('type P = { x: uint8 }; const p = JSON.parse.<P>(\'{"x":1}\'); let q: P = p; String(q.x);')).toBe('1');
});

test('at run time a composite is not OF an array type, and reaching one is converted as an array-like', () => {
  // `is` says what the subtyping rule says.
  expect(evaluated('const t = Composite.<[uint8, uint8]>([1, 2]); String(t is [].<uint8>) + " " + String(t is [uint8, uint8]);')).toBe('false true');
  // Where the checker cannot see the type, the boundary builds a NEW array of
  // the type from the array-like, as it does for any array-like source; the
  // composite is neither bound nor modified.
  expect(evaluated('function f(x) { let a: [].<uint8> = x; return String(a === x) + " " + String(Composite.isComposite(a)); } f(Composite.<[uint8, uint8]>([1, 2]));')).toBe('false false');
  expect(evaluated('function f(x) { let a: [].<uint8> = x; a.push(3); return String(a.length) + " " + String(x.length); } f(Composite.<[uint8, uint8]>([1, 2]));')).toBe('3 2');
  // A plain array is unaffected.
  expect(evaluated('const a: [].<uint8> = [1, 2]; String(a is [].<uint8>);')).toBe('true');
});
