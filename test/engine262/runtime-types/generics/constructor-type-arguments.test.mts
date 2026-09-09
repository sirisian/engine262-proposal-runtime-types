import { test, expect } from 'vitest';
import { evaluated, ok, expectThrown, expectStaticTypeError } from '../harness.mts';

// PLAN-v3 "Type arguments for a construction", the §2 rows as a conformance
// table. Every row that names the class in source reaches the CHECKER, which
// runs first and refuses statically; the same row through `const C = Box` or
// `Reflect.construct` reaches the RUNTIME alone. A row is green only when both
// agree, which is the test §3 says was missing: the checker refused A3 while the
// runtime converted through it, and the disagreement was invisible because no
// test reached the second side.
//
// Measurement discipline (PLAN-v3 §7): a value's `Reflect.typeOf` answers for
// the VALUE, whatever slot it sits in. Rows about a slot read the slot: `String(T)`
// in a body for a binding, `Object.isExtensible` for sealing, a store that must
// be refused for a field's type.

const BOX = 'class Box<T> { v: T; constructor(v: T) { this.v = v; } } ';
const ALIAS = `${BOX} const C = Box; `;

/** The runtime side alone: a throw inside try/catch is a runtime TypeError, not a static one. */
function runtime(source: string): string {
  return evaluated(`${source.replace(/^let r;/, '')}`);
}
function caught(body: string): string {
  return `let r; try { ${body} } catch (e) { r = "runtime: " + e.message; } r;`;
}

// -- 2a. Construction of a generic class -------------------------------------

test('A1/A11/A12: a bare construction yields the specialization, named and aliased', () => {
  expect(evaluated(`${BOX} String(Reflect.typeOf(new Box((1 := uint8))));`)).toBe('Box.<uint.<8>>');
  expect(evaluated(`${ALIAS} String(Reflect.typeOf(new C((1 := uint8))));`)).toBe('Box.<uint.<8>>');
  expect(evaluated(`${BOX} String(Reflect.typeOf(Reflect.construct(Box, [(1 := uint8)])));`)).toBe('Box.<uint.<8>>');
  expect(evaluated(`${BOX} String(Reflect.typeOf(Reflect.construct(Box, [(1 := uint8)], Box)));`)).toBe('Box.<uint.<8>>');
});

test('A2/A4: the explicit spelling is unchanged, and the two spellings intern to one class', () => {
  expect(evaluated(`${BOX} String(Reflect.typeOf(new Box.<uint8>((1 := uint8))));`)).toBe('Box.<uint.<8>>');
  expect(evaluated(`${BOX} const b: Box.<uint8> = new Box.<uint8>((1 := uint8)); "ok";`)).toBe('ok');
  expect(evaluated(`${BOX} String(Object.getPrototypeOf(new Box((1 := uint8))) === Box.<uint8>.prototype);`)).toBe('true');
  expect(evaluated(`${BOX} String(Reflect.typeOf(new Box((1 := uint8))) === Reflect.typeOf(new Box.<uint8>(2)));`)).toBe('true');
  expect(evaluated(`${ALIAS} String(Object.getPrototypeOf(new C((1 := uint8))) === Object.getPrototypeOf(new C((2 := uint8))));`)).toBe('true');
});

test('A3: the annotated binding accepts the bare construction, both sides', () => {
  expect(evaluated(`${BOX} const b: Box.<uint8> = new Box((1 := uint8)); String(Reflect.typeOf(b));`)).toBe('Box.<uint.<8>>');
  expect(evaluated(`${ALIAS} ${caught('const b: Box.<uint8> = new C((1 := uint8)); r = String(Reflect.typeOf(b)) + " " + String(b === b);')}`)).toBe('Box.<uint.<8>> true');
});

test('A6/A7: a mismatched instantiation is refused on both sides, and never converted by copy', () => {
  expectStaticTypeError(`${BOX} const b: Box.<uint16> = new Box.<uint8>(1);`);
  expect(evaluated(`${ALIAS} ${caught('const b0 = new C.<uint16>(1); let b: Box.<uint8> = b0; r = "admitted " + String(b === b0);')}`)).toContain('runtime:');
  expect(evaluated(`${ALIAS} ${caught('const b0 = new C.<string>("s"); let b: Box.<uint8> = b0; r = "admitted";')}`)).toContain('runtime:');
});

test('A8: the ordinary spelling - an untyped literal - binds from the context, both sides', () => {
  expect(evaluated(`${BOX} const b: Box.<uint8> = new Box(1); String(Reflect.typeOf(b)) + " " + String(Reflect.typeOf(b.v));`)).toBe('Box.<uint.<8>> uint.<8>');
  expect(evaluated(`${ALIAS} ${caught('const b: Box.<uint8> = new C(1); r = String(Reflect.typeOf(b)) + " " + String(Reflect.typeOf(b.v));')}`)).toBe('Box.<uint.<8>> uint.<8>');
  // The argument is checked against the seeded binding, as `new Box.<uint8>("s")` would be.
  expectStaticTypeError(`${BOX} const b: Box.<uint8> = new Box("s");`);
  expect(evaluated(`${ALIAS} ${caught('const b: Box.<uint8> = new C("s"); r = "admitted";')}`)).toContain('runtime:');
});

test('A9: with no context an untyped literal is a Number, as a call gives it', () => {
  expect(evaluated(`${BOX} String(Reflect.typeOf(new Box(1)));`)).toBe('Box.<number>');
  expect(evaluated(`${BOX} String(Reflect.typeOf(new Box("s")));`)).toBe('Box.<string>');
  expect(evaluated(`${ALIAS} String(Reflect.typeOf(new C(1)));`)).toBe('Box.<number>');
});

test('A10: target-typed construction names the specialization', () => {
  expect(evaluated(`${BOX} const b: Box.<uint8> = new.(1); String(Reflect.typeOf(b)) + " " + String(Reflect.typeOf(b.v));`)).toBe('Box.<uint.<8>> uint.<8>');
  expect(evaluated(`${BOX} function f(x: Box.<uint8>): uint8 { return x.v; } String(f(new.(7)));`)).toBe('7');
});

test('contextual positions: return, argument, assignment, field initializer, field store, object literal, union', () => {
  expect(evaluated(`${ALIAS} function mk(): Box.<uint8> { return new C(1); } String(Reflect.typeOf(mk()));`)).toBe('Box.<uint.<8>>');
  expect(evaluated(`${ALIAS} function f(x: Box.<uint8>): uint8 { return x.v; } String(f(new C(1)));`)).toBe('1');
  expect(evaluated(`${ALIAS} let b: Box.<uint8>; b = new C(1); String(Reflect.typeOf(b));`)).toBe('Box.<uint.<8>>');
  expect(evaluated(`${ALIAS} class W { b: Box.<uint8> = new C(1); } String(Reflect.typeOf(new W().b));`)).toBe('Box.<uint.<8>>');
  expect(evaluated(`${ALIAS} class W { b: Box.<uint8>; constructor() { this.b = new C(1); } } String(Reflect.typeOf(new W().b));`)).toBe('Box.<uint.<8>>');
  expect(evaluated(`${ALIAS} const o: { b: Box.<uint8> } = { b: new C(1) }; String(Reflect.typeOf(o.b));`)).toBe('Box.<uint.<8>>');
  expect(evaluated(`${ALIAS} const b: Box.<uint8> | null = new C(1); String(Reflect.typeOf(b));`)).toBe('Box.<uint.<8>>');
  // A nested construction sees the constructor's parameter, not the outer annotation.
  expectStaticTypeError(`${BOX} const b: Box.<uint8> = new Box(new Box(1));`);
});

// -- 2b. Which parameters are reachable --------------------------------------

test('B1: every parameter reached by a formal binds', () => {
  const PAIR = 'class Pair<A, C> { a: A; c: C; constructor(a: A, c: C) { this.a = a; this.c = c; } } ';
  expect(evaluated(`${PAIR} String(Reflect.typeOf(new Pair((1 := uint8), "s")));`)).toBe('Pair.<uint.<8>, string>');
  expect(evaluated(`${PAIR} const p: Pair.<uint8, string> = new Pair(1, "s"); String(Reflect.typeOf(p));`)).toBe('Pair.<uint.<8>, string>');
});

test('B2/Q4: a parameter nothing reaches and no default is the naming error, both sides', () => {
  const K = 'class K<T> { items: [].<T> = []; } ';
  expectStaticTypeError(`${K} new K();`);
  expect(evaluated(`${K} const KC = K; ${caught('new KC(); r = "admitted";')}`)).toContain('is not determined by the arguments and has no default');
  expect(evaluated(`${K} String(Reflect.typeOf(new K.<uint8>().items));`)).toBe('[].<uint.<8>>');
  expect(evaluated(`${K} const k: K.<uint8> = new K(); String(Reflect.typeOf(k.items));`)).toBe('[].<uint.<8>>');
  // The function path agrees: no `any` fallback.
  expectThrown('function f<A, B>(x: A): string { return String(B); } f((1 := uint8));', 'is not determined by the arguments and has no default');
});

test('B3: a value parameter binds the literal, converted to its constraint', () => {
  const G = 'class G<N: uint32> { b: [N].<uint8>; constructor(n: N) {} } ';
  expect(evaluated(`${G} String(Reflect.typeOf(new G((4 := uint32))));`)).toBe('G.<4>');
  expect(evaluated(`${G} const g = new G(4); String(Reflect.typeOf(g)) + " " + g.b.length;`)).toBe('G.<4> 4');
  expect(evaluated(`${G} const g: G.<4> = new G(4); String(Reflect.typeOf(g));`)).toBe('G.<4>');
  // The explicit spelling's formal accepts the same plain literal (the Base fix).
  expect(evaluated(`${G} String(Reflect.typeOf(new G.<4>(4)));`)).toBe('G.<4>');
});

test('B5/B6: inference beats a default; a default fills what nothing reaches', () => {
  const A = 'class A<T = uint8> { a: T; constructor(a: T) { this.a = a; } } ';
  expect(evaluated(`${A} String(Reflect.typeOf(new A(5)));`)).toBe('A.<number>');
  expect(evaluated(`${A} String(Reflect.typeOf(new A("s")));`)).toBe('A.<string>');
  expect(evaluated(`${A} const AC = A; String(Reflect.typeOf(new AC(5)));`)).toBe('A.<number>');
  expect(evaluated('class D<T = uint8> { m() { return String(T); } } new D().m();')).toBe('uint.<8>');
  expect(evaluated('function f<A, B = string>(x: A): string { return String(B); } f((1 := uint8));')).toBe('string');
});

// -- 2e/Q7-a. Defaults and the bare name in type position ---------------------

test('E4/E5/E6: `A`, `A.<>` and a trailing default are one type, both sides', () => {
  const A = 'class A<T = uint8> { a: T; constructor(a: T) { this.a = a; } } ';
  expect(evaluated(`${A} const x: A.<> = new A(5); String(Reflect.typeOf(x));`)).toBe('A.<uint.<8>>');
  expect(evaluated(`${A} const x: A = new A.<>(5); String(Reflect.typeOf(x));`)).toBe('A.<uint.<8>>');
  expect(evaluated(`${A} let x: A; String(Reflect.typeOf(x)) + " " + String(Reflect.typeOf(x.a));`)).toBe('A.<uint.<8>> uint.<8>');
  expect(evaluated(`${A} String(type A) + " " + String(type A.<>) + " " + String((type A) === (type A.<>));`)).toBe('A.<uint.<8>> A.<uint.<8>> true');
  const GRID = 'class Grid<Rows: uint32 = 4, Cols: uint32 = 4> {} ';
  expect(evaluated(`${GRID} String(type Grid.<8>) + " " + String(Reflect.typeOf(new Grid.<8>())) + " " + String(type Grid);`)).toBe('Grid.<8, 4> Grid.<8, 4> Grid.<4, 4>');
  expect(evaluated(`${GRID} let g: Grid.<8, 4> = new Grid.<8>(); let h: Grid = new Grid(); String(Reflect.typeOf(h));`)).toBe('Grid.<4, 4>');
});

test('A5/F2/Q7-a: a bare name where a parameter has no default is the naming error', () => {
  expectStaticTypeError(`${BOX} const b: Box = new Box((1 := uint8));`);
  expectStaticTypeError(`${BOX} function f(x: Box) {}`);
  expectThrown(`${BOX} String(type Box);`, 'has no argument and no default');
  expectThrown(`${BOX} class S extends Box {}`, 'is not determined by the arguments and has no default');
  // With defaults, the heritage is the defaulted specialization.
  expect(evaluated('class A<T = uint8> { a: T; constructor(a: T) { this.a = a; } } class S extends A {} const s = new S(3); String(Reflect.typeOf(s.a)) + " " + String(s instanceof A.<uint8>);')).toBe('uint.<8> true');
  // A bare name as a type ARGUMENT is a declaration (a kinded position), untouched.
  expect(evaluated(`${BOX} class B<W<_>> {} String(type B.<Box>);`)).toBe('B.<Box>');
});

test('H6/Q7: `Box.<any>` is the family, on both sides', () => {
  expect(evaluated(`${BOX} const b: Box.<any> = new Box.<uint8>(1); String(Reflect.typeOf(b));`)).toBe('Box.<uint.<8>>');
  expect(evaluated(`${ALIAS} ${caught('const b: Box.<any> = new C.<uint8>(1); r = String(Reflect.typeOf(b));')}`)).toBe('Box.<uint.<8>>');
  expect(evaluated(`${BOX} String(new Box.<uint8>(1) is Box.<any>);`)).toBe('true');
  expect(evaluated(`${BOX} let bs: [].<Box.<any>> = [new Box(1), new Box("s")]; String(Reflect.typeOf(bs)) + " " + bs.length;`)).toBe('[].<Box.<any>> 2');
  // The wider view is read-only in effect: a store is checked against the instance's own field type.
  expect(evaluated(`${BOX} const b: Box.<any> = new Box.<uint8>(1); ${caught('b.v = "s"; r = "admitted";')}`)).toContain('runtime:');
});

// -- 2f. Identity, membership, inheritance -----------------------------------

test('G1/G2/Q5: new.target is the specialization for both spellings; a foreign newTarget is refused', () => {
  const B2 = 'let t; class B2<T> { v: T; constructor(v: T) { t = new.target; this.v = v; } } ';
  expect(evaluated(`${B2} new B2.<uint8>(1); String(t === B2.<uint8>);`)).toBe('true');
  expect(evaluated(`${B2} new B2((1 := uint8)); String(t === B2.<uint8>) + " " + String(t === B2);`)).toBe('true false');
  expect(evaluated(`${BOX} ${caught('Reflect.construct(Box, [(1 := uint8)], class Unrelated {}); r = "admitted";')}`)).toContain('is a generic class');
  // A subclass of a specialization arrives with itself as newTarget and is untouched.
  expect(evaluated(`${BOX} class S extends Box.<uint8> {} const s = new S(1); String(Reflect.typeOf(s.v)) + " " + String(s instanceof S);`)).toBe('uint.<8> true');
});

test('H1: the field is typed, not merely holding a typed value', () => {
  expect(evaluated(`${ALIAS} const b = new C((1 := uint8)); ${caught('b.v = "s"; r = "admitted";')}`)).toContain('runtime:');
  expect(evaluated(`${ALIAS} const b = new C((1 := uint8)); String(Object.isExtensible(b));`)).toBe('false');
});

test('H2/H3/H4/Q7-i: the declaration is the family for instanceof', () => {
  expect(evaluated(`${BOX} String(new Box((1 := uint8)) instanceof Box);`)).toBe('true');
  expect(evaluated(`${BOX} String(new Box.<uint8>(1) instanceof Box);`)).toBe('true');
  expect(evaluated(`${BOX} String(new Box.<uint8>(1) instanceof Box.<uint8>) + " " + String(new Box.<uint8>(1) instanceof Box.<uint16>);`)).toBe('true false');
  expect(evaluated(`${BOX} class S extends Box.<uint8> {} String(new S(1) instanceof Box);`)).toBe('true');
  expect(evaluated(`${BOX} class Other {} String(new Other() instanceof Box) + " " + String(({}) instanceof Box);`)).toBe('false false');
});

// -- 2c. The function path, for comparison ----------------------------------

test('C3: a generic body constructs the specialization over its own parameter', () => {
  expect(evaluated(`${BOX} function w<T>(x: T): Box.<T> { return new Box(x); } String(Reflect.typeOf(w((1 := uint8))));`)).toBe('Box.<uint.<8>>');
  expect(evaluated(`${BOX} class W<T> { b: Box.<T>; constructor(x: T) { this.b = new Box(x); } } String(Reflect.typeOf(new W.<uint8>(1).b));`)).toBe('Box.<uint.<8>>');
});

test('the kinded explicit argument binds (previously an unbound `any`)', () => {
  expect(evaluated('type Identity<T> = T; function m<W<_>>() { return String(W); } m.<Identity>();')).toBe('Identity');
  expect(evaluated('type Identity<T> = T; class C { m<W<_>>() { return String(W); } } String(new C().m.<Identity>());')).toBe('Identity');
  expect(ok('type Identity<T> = T; function g<W<_>, T>(x: W.<T>): void {} g(1);')).toBe(false);
});

test('conformance: the checker and the runtime agree row by row', () => {
  // The rows above pair a named and an aliased spelling; this asserts the pairing
  // itself for the headline row, so a future change that splits the two sides
  // fails here by name.
  const named = evaluated(`${BOX} const b: Box.<uint8> = new Box(1); String(Reflect.typeOf(b));`);
  const aliased = evaluated(`${ALIAS} ${caught('const b: Box.<uint8> = new C(1); r = String(Reflect.typeOf(b));')}`);
  expect(named).toBe(aliased);
  expect(runtime(`${ALIAS} String(Reflect.typeOf(new C(1)));`)).toBe(evaluated(`${BOX} String(Reflect.typeOf(new Box(1)));`));
});
