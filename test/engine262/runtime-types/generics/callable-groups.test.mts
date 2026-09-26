import { expect, test } from 'vitest';
import { evaluated, expectEarlyError, expectThrown } from '../harness.mts';

/**
 * Plan section 3.8, phase 4 step 1: a function's or method's generic list
 * declares an overload contract, so its specialized cases, and bodyless
 * owners, are declarations the checker analyzes as a group. Selecting a case
 * is step 2; until then a call into a group with a case is refused, statically
 * and at run time, rather than dispatched by value.
 */

const P = `function f<T: type>(x: T): string { return 'generic'; }
function f<uint8>(x: uint8): string { return 'uint8'; }`;

test('A1: an owner and its attached case are accepted as declarations', () => {
  expect(evaluated(`${P} 'declared';`)).toBe('declared');
});

test('A24: a call into a group with a case is deferred, statically and at run time', () => {
  // Direct calls select since steps 2 (explicit) and 4 (implicit), and a
  // method's since step 7; a class operator's use stays deferred.
  expect(evaluated(`${P} f((3 := uint8));`)).toBe('uint8');
  expect(evaluated(`class W { m<T: type>(v: T): string { return 'g'; } m<boolean>(v: boolean): string { return 'b'; } }
    new W().m(true);`)).toBe('b');
  // A call the checker cannot see is dispatched at run time (step 4): the
  // owner's inferred binding (number) matches no case, so the owner's body runs.
  expect(evaluated(`${P} const g: any = f; g(3);`)).toBe('generic');
});

test('A5: a standalone capture has no slot domain (D4)', () => {
  expectEarlyError('function g<const T>(x: T): string { return "a"; }', 'StaticTypeError');
});

test('A9 and A10: two accepting owners are an error; no accepting owner leaves the case standalone', () => {
  expectThrown(`function f<T: type>(x: T): string { return 'a'; }
    function f<T: type>(x: T, y: string): string { return 'b'; }
    function f<uint8>(x: uint8): string { return 'c'; }`, 'is accepted by two owners');
  expect(evaluated(`function f<A: type, B: type>(a: A, b: B): string { return 'o'; }
    function f<uint8>(x: uint8): string { return 'c'; } 'ok';`)).toBe('ok');
});

test('A11: a case declared twice is an error', () => {
  expectEarlyError(`function g<uint8>(x: uint8): string { return 'a'; }
    function g<uint8>(x: uint8): string { return 'b'; }`, 'StaticTypeError');
});

test('A17, A17b and A18: a bodyless owner needs an attached case, and is not abstract', () => {
  expect(evaluated(`function read<T: type>(): T; function read<boolean>(): boolean { return true; } 'ok';`)).toBe('ok');
  expect(evaluated(`class R { read<T: type>(): T; read<boolean>(): boolean { return true; } } 'ok';`)).toBe('ok');
  expectThrown('function read<T: type>(): T;', 'is a bodyless owner with no attached case');
});

test('A19, A20 and A21: what may not omit a body, or specialize, is unchanged', () => {
  expectThrown('class R { m(): string; }', 'An abstract method requires an abstract class');
  expectThrown('function r(x: string): string;', 'only an owner, whose generic list declares parameters only, may omit its body');
  expectThrown('class B<uint8> {}', 'specialization is not supported yet');
});

test('A22, A22b, A22c and A23: an attached case is a replacement or an additive overload (Q4)', () => {
  // The same parameter list, a narrower return: a replacement; names are free.
  expect(evaluated(`function f<T: type>(x: T): string { return 'g'; }
    function f<uint8>(y: uint8): 'x' { return 'x'; } 'ok';`)).toBe('ok');
  // The same parameter list, a return that is not a subtype: an incompatible replacement.
  expectThrown(`function f<T: type>(x: T): string { return 'g'; }
    function f<uint8>(x: uint8): number { return 1; }`, 'number is not a subtype of it');
  // Another parameter list: additive, whatever it returns.
  expect(evaluated(`function f<T: type>(x: T): string { return 'g'; }
    function f<uint8>(x: uint8, extra: string): number { return 1; } 'ok';`)).toBe('ok');
});

test('an unmarked bodyless generic method in an abstract class keeps its abstract reading', () => {
  // simd.md writes abstract members this way; the owner reading is a concrete class's.
  expect(evaluated(`abstract class V<N: uint32> { lane<I: uint32>(): uint32 where I < N; } 'ok';`)).toBe('ok');
});

test('A24 for methods, lifted by step 7: a method call into a group with a case selects', () => {
  const W = `class W { write<T: type>(v: T): string { return 'g'; } write<boolean>(v: boolean): string { return 'b'; } }`;
  expect(evaluated(`${W} new W().write(true);`)).toBe('b');
  expect(evaluated(`${W} const w = new W(); w.write.<boolean>(true) + '|' + w.write('s');`)).toBe('b|g');
  // Value overloads and generic methods without cases are untouched.
  expect(evaluated(`class V { m(v: string): string { return 's'; } m(v: number): string { return 'n'; } }
    new V().m('a') + new V().m(1);`)).toBe('sn');
  expect(evaluated(`class G { m<T: type>(v: T): string { return 'g'; } } new G().m.<uint8>(3);`)).toBe('g');
});

test('an owner with a case in an abstract class is an owner, not an abstract member', () => {
  // Its group has a case, so a concrete subclass has no obligation to implement it.
  expect(evaluated(`abstract class R { read<T: type>(): T; read<boolean>(): boolean { return true; } }
    class S extends R {} 'ok';`)).toBe('ok');
  // Without a case it is abstract, and the obligation holds.
  expectThrown(`abstract class R { read<T: type>(): T; } class S extends R {}`, 'does not implement it');
});

test('two owners with one list are told apart by their parameters in the diagnostic', () => {
  expectThrown(`function f<T: type>(x: T): string { return 'a'; }
    function f<T: type>(x: T, y: string): string { return 'b'; }
    function f<uint8>(x: uint8): string { return 'c'; }`, '`f<T: type>(x: T)` and `f<T: type>(x: T, y: string)`');
});

test('A7 and A8: a written capture domain must match its slot (D9)', () => {
  const owner = `function f<T: type>(x: T): string { return 'g'; }`;
  // `uint`'s width slot has the domain uint32; restating it is accepted, and
  // the case's own parameters see its capture.
  expect(evaluated(`${owner} function f<uint.<const N: uint32>>(x: uint.<N>): string { return 'c'; } 'ok';`)).toBe('ok');
  expect(evaluated(`${owner} function f<uint.<const N>>(x: uint.<N>): string { return 'c'; } 'ok';`)).toBe('ok');
  expectThrown(`${owner} function f<uint.<const N: uint16>>(x: uint.<N>): string { return 'c'; }`,
    'whose domain is `uint.<32>`, and `const N: uint16` restates it as `uint.<16>`');
  // Against an owner's value binder too.
  expectEarlyError(`function f<N: uint32>(): string { return 'g'; } function f<const N: uint16>(): string { return 'c'; }`, 'StaticTypeError');
});

test("A7b: a primitive block's own component captures are checked against their slots (D9)", () => {
  // Accepted before: a written domain was never compared.
  expectThrown('primitive vector<const T, const N: string> {}', '`const N: string` restates it as `string`');
  expectThrown('primitive uint<const W: string> {}', '`const W: string` restates it as `string`');
  expect(evaluated(`primitive vector<const T, const N: uint32> {} primitive uint<const W> {} 'ok';`)).toBe('ok');
  // A metadata position is exempt: `float32.<const D: Dim>` selects the meta type.
  expect(evaluated(`type Dim = { m: int32 };
    meta Dim { default = { m: 0 }; subtype(a: Dim, b: Dim): boolean { return a.m === b.m; } }
    primitive vector<float32.<const D: Dim>, const N: uint32> {} 'ok';`)).toBe('ok');
});

test('A24 through inheritance, lifted by step 7: a base class\'s case group selects through a subclass', () => {
  const W = `class W { write<T: type>(v: T): string { return 'g'; } write<boolean>(v: boolean): string { return 'b'; } }`;
  expect(evaluated(`${W} class X extends W {} new X().write(true);`)).toBe('b');
  expect(evaluated(`${W} class X extends W {} class Y extends X {} new Y().write.<boolean>(true);`)).toBe('b');
  expect(evaluated(`class V { m(v: string): string { return 's'; } } class U extends V {} new U().m('a');`)).toBe('s');
});

test('C6, C7 and C8: nested named patterns, outer binders, and mixed lists (C03)', () => {
  // C6: a nested named application is the same pattern as its positional form.
  expectEarlyError(`function f<T: type>(x: T): string { return 'g'; }
    function f<Map.<K: string, V: uint32>>(x: Map.<string, uint32>): string { return 'a'; }
    function f<Map.<string, uint32>>(x: Map.<string, uint32>): string { return 'b'; }`, 'StaticTypeError');
  // C7: an outer `N: 10` DECLARES N with the domain 10; it does not select.
  expect(evaluated(`function s<N: 10>(): string { return 'a'; } s.<10>();`)).toBe('a');
  // C8: an outer binder beside a positional selector is a mixed standalone case.
  expect(evaluated(`function f<T: uint8, 10>(): string { return 'a'; } 'ok';`)).toBe('ok');
});

test('object-literal methods: the group analysis, and (step 7) their selection', () => {
  const O = `const o = { m<T: type>(x: T): string { return 'g'; }, m<uint8>(x: uint8): string { return 'u'; } };`;
  expect(evaluated(`${O} 'declared';`)).toBe('declared');
  expect(evaluated(`${O} o.m.<uint8>(3) + '|' + o.m((3 := uint8));`)).toBe('u|u');
  // The group is analyzed as a class body's is (Q4 here).
  expectThrown(`const p = { m<T: type>(x: T): string { return 'g'; }, m<uint8>(x: uint8): number { return 1; } };`,
    'number is not a subtype of it');
  // Methods without cases are untouched.
  expect(evaluated(`const q = { m<T: type>(x: T): string { return 'g'; } }; q.m.<uint8>(3);`)).toBe('g');
});

test('only a class method or a function declaration may be a bodyless owner', () => {
  // An object literal's bodyless method is refused as before (TypeScript
  // likewise refuses overload signatures in an object literal).
  expectThrown('const o = { m<T: type>(): T; };', 'An abstract method requires an abstract class');
});

test('class operators: cases are declarations; a use is deferred statically and at run time', () => {
  const V = `class V { x: float64; constructor(x: float64) { this.x = x; }
    operator +.<T: type>(rhs: T): string { return 'g'; }
    operator +.<uint8>(rhs: uint8): string { return 'u'; } }`;
  expect(evaluated(`${V} 'declared';`)).toBe('declared');
  expectEarlyError(`${V} new V(1) + (3 := uint8);`, 'StaticTypeError');
  expectThrown(`${V} new V(1) + (3 := uint8);`, 'selecting a specialized case of `operator +` is not supported yet');
  // A use the checker cannot see selects at run time (step 4): the owner's
  // inferred binding reaches the case, and otherwise the owner's body runs.
  expect(evaluated(`${V} const v: any = new V(1); String(v + (3 := uint8)) + '|' + String(v + 'a');`)).toBe('u|g');
  // The group is analyzed as a function's is (Q4 here).
  expectThrown(`class U { operator +.<T: type>(rhs: T): string { return 'g'; }
    operator +.<uint8>(rhs: uint8): number { return 1; } }`, 'number is not a subtype of it');
  // Operators without cases are untouched.
  expect(evaluated(`class W { x: float64; constructor(x: float64) { this.x = x; }
    operator +(rhs: W): string { return 'plain'; } } String(new W(1) + new W(2));`)).toBe('plain');
});

test("a primitive block's or an interface's operator list holds binders only", () => {
  expectThrown('primitive float64 { operator *.<uint8>(rhs: uint8): string { return "x"; } }', 'specialization is not supported yet');
  expectThrown('interface I { operator +.<uint8>(rhs: uint8): string; }', 'specialization is not supported yet');
});
