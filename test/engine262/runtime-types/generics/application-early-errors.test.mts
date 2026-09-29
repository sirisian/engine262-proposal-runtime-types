import { expect, test } from 'vitest';
import { expectThrown, expectStaticTypeError, ok } from '../harness.mts';

// Early errors at the APPLICATION of a generic, as opposed to its declaration
// list. Each refusal below is determinable before the source runs, so by
// #sec-type-errors it is an Early Error; each was once accepted, or refused
// only when evaluation happened to reach it.

// -- a class application runs the whole of BindTypeArguments ------------------
// #sec-bindtypearguments: a value parameter takes a value, converted to its
// domain, at every application site - a type annotation and `new` alike.
const G = 'class G<N: uint8> { n(): uint8 { return N; } } ';

test.each([
  `${G} let a: G.<300> | null = null;`,
  `${G} let b: G.<uint8> | null = null;`,
  `${G} let c: G.<'s'> | null = null;`,
  `${G} new G.<300>();`,
  `${G} function f() { return new G.<uint8>(); }`,
  "enum E { A } enum F { B } class H<V: E> {} let h: H.<F.B> | null = null;",
])('a class value argument outside its domain is refused: %s', expectStaticTypeError);

test.each([
  `${G} const g: G.<3> = new G.<3>(); String(g.n());`,
  'enum E { A, B } class H<V: E> {} let h: H.<E.B> | null = null;',
  `${G} class K<M: uint8> { g(): G.<M> | null { return null; } }`,
  'class D<T: type = uint8, N: uint8 = 4> {} const d: D.<N: 5> = new D.<N: 5>();',
])('a class value argument within its domain is accepted: %s', (source) => expect(ok(source)).toBe(true));

// -- a higher-kinded parameter is applied at its arity --------------------------
// #sec-higher-kinded-parameters: exactly [[Arity]] arguments, positionally, at
// the declaration; after binding, the application is an ordinary one.
const BOX = 'class Box<T: type> {} ';
const STRING_BOX = 'class Box<T: type extends string> {} ';

test.each([
  'function f<W<_>: type>(x: W.<uint8, uint16> | null) {}',
  'function f<W<_>: type>(x: W.<> | null) {}',
  'function f<W<_>: type>(x: W.<T: uint8> | null) {}',
  'class H<W<_>: type> { v: W.<uint8, uint16> | null = null; }',
  'type H<W<_>: type> = W.<uint8, uint16>;',
  `${STRING_BOX} function f<W<_>: type>(x: W.<uint8> | null): void {} f.<Box>(null);`,
  `${STRING_BOX} class H<W<_>: type> { v: W.<uint8> | null = null; } new H.<Box>();`,
  `${STRING_BOX} class H<W<_>: type> { v: W.<uint8> | null = null; } let h: H.<Box> | null = null;`,
  `${STRING_BOX} function f<W<_>: type, U: type>(x: W.<U> | null): void {} f.<Box, uint8>(null);`,
  'class V<N: uint8> {} function f<W<_>: type>(x: W.<300> | null): void {} f.<V>(null);',
])('a higher-kinded application at the wrong arity or binding is refused: %s', expectStaticTypeError);

test.each([
  `${BOX} function f<W<_>: type>(x: W.<uint8> | null): void {} f.<Box>(null);`,
  'class Pair<A: type, B: type> {} function f<W<_, _>: type>(x: W.<uint8, string> | null): void {} f.<Pair>(null);',
  `${STRING_BOX} function f<W<_>: type, U: type>(x: W.<U> | null): void {} f.<Box, string>(null);`,
])('a higher-kinded application at its arity is accepted: %s', (source) => expect(ok(source)).toBe(true));

// -- a class specialization the primary cannot bind ----------------------------
// #sec-specialization-lists: the primary binds first, so a fixed argument it
// cannot bind leaves a list no application reaches; identical lists could never
// be told apart; and a value capture has no `extends` bound (#sec-capture-scope).
test.each([
  'class B<T: type extends string> {} class B<uint8> {}',
  'class B<N: uint8> {} class B<300> {}',
  'class B<N: uint32> {} class B<uint8> {}',
  'class B<T: type extends string> {} partial class B<uint8> { m() {} }',
  'class B<N: uint8> {} partial class B<300> { m() {} }',
  'class B<N: uint32> {} class B<const N extends uint8> {}',
  'class B<N: uint32> {} partial class B<const N extends uint8> { m() {} }',
  'function r<N: uint32>(): void {} function r<const N extends uint8>(): void {}',
  'function s<uint8, const X: uint32 extends uint8>(): void {}',
  'class B<T: type> {} class B<uint8> {} class B<uint8> {}',
  'class P<A: type, C: type> {} class P<const T, T> {} class P<const U, U> {}',
  'class B<T: type, N: uint32 = 4> {} class B<uint32> {} class B<uint32, 4> {}',
])('an unselectable or repeated specialization is refused: %s', expectStaticTypeError);

test('a repeated specialization names both declarations', () => {
  expectThrown('class B<T: type> {} class B<uint8> {} class B<uint8> {}', 'repeats the specialization');
});

test.each([
  'class B<T: type, N: uint32 = 4> {} class B<uint32, 8> {} class B<const T, 16> {} partial class B<_, 32> { m() {} } class B<string> {}',
  'class B<T: type> {} class B<const T extends string> {}',
  'class B<T: type> {} partial class B<uint8> { m() {} } partial class B<uint8> { n() {} }',
  "class B<T: type extends string> {} class B<'a'> {}",
  'class B<N: uint8> {} class B<200> {}',
  'class B<T: type> {} class B<uint8> {} class B<uint16> {}',
  'function r<T: type>(): void {} function r<const T extends string>(): void {}',
  'function s<uint8, const X: type extends string>(): void {}',
])('a selectable, distinct specialization is accepted: %s', (source) => expect(ok(source)).toBe(true));

// -- a bare generic superclass --------------------------------------------------
// #sec-parameterized-types: a heritage clause is a type position, where the
// bare name of a generic binds its defaults and names a parameter without one.
test.each([
  `${BOX} class S extends Box {}`,
  `${BOX} function f() { class S extends Box {} }`,
  `${BOX} const S = class extends Box {};`,
  `${BOX} class S extends (Box) {}`,
  `${BOX} const B = Box; class S extends B {}`,
])('a bare generic superclass missing an argument is refused: %s', expectStaticTypeError);

test.each([
  'class Box<T: type = uint8> {} class S extends Box {}',
  `${BOX} class S extends Box.<uint8> {}`,
  `${BOX} class S<U: type> extends Box.<U> {}`,
  'class Box<T: type> { m() { class S extends Box {} return S; } }',
  'class Tup<...Ts: [].<type>> {} class S extends Tup {}',
])('a complete or self-referring superclass is accepted: %s', (source) => expect(ok(source)).toBe(true));

// -- metadata after a base with no type parameters -----------------------------
// #sec-parameterized-types: after such a base the bracket is a metadata record;
// `.<>` supplies neither arguments nor a record, and a type is not metadata.
const CLAIMED = 'type D = { m: int32 }; meta D { default = { m: 0 }; subtype(a: D, b: D): boolean { return a.m === b.m; } } ';

test.each([
  'let x: uint8.<uint8> = 1;',
  'class P {} let p: P.<uint8> | null = null;',
  'type Q = uint8; let q: Q.<string> = 1;',
  'class P {} let p: P.<{ zz: 1 }> | null = null;',
  'class P {} let p: P.<> | null = null;',
  'let x: float32.<> = 1;',
  'interface I { x: uint8 } let i: I.<uint8> = { x: 1 };',
])('a bracket that is neither arguments nor a metadata record is refused: %s', expectStaticTypeError);

test.each([
  `${CLAIMED} class P {} let p: P.<{ m: 1 }> | null = null;`,
  'meta uint8 { subtype(a, b) { return true; } default = 7; } let y: uint8.<7> = (7 := uint8.<7>); String(y);',
  'const a: uint8.<1, 5> = 3; String(a);',
  'type Grid<T: type = float64> = { v: T }; type T = Grid.<>;',
  `${CLAIMED} let f: float32.<{ m: 1 }> = (1 := float32.<{ m: 1 }>);`,
])('metadata a base accepts, and an empty list on a generic, are accepted: %s', (source) => expect(ok(source)).toBe(true));
