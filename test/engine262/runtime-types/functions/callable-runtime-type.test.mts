import { test, expect } from 'vitest';
import { evaluated, ok, expectStaticTypeError } from '../harness.mts';

// PLAN-callable-runtime-type, the §2 rows as a conformance table. A callable's
// runtime type is its signature at EVERY depth (#sec-runtimetypeof, the
// callable step), the function case of membership checks that signature
// (#sec-isoftype), and inference reaches through a callable property as it
// reaches through a callback argument. Rows that must reach the runtime alone
// route the value through an untyped array read (`[v][0]`), which the checker
// does not see through, and read inside try/catch so a static refusal
// (uncatchable) is distinguishable from a runtime one.

function caught(body: string): string {
  return `let r; try { ${body} } catch (e) { r = "runtime: " + e.message; } r;`;
}

// -- 2a. What a callable's type is ------------------------------------------

test('P1/P33: the top level is unchanged', () => {
  expect(evaluated('String(Reflect.typeOf((x: uint8): uint16 => 1));')).toBe('(x: uint.<8>) => uint.<16>');
  expect(evaluated('String(Reflect.typeOf((x) => x));')).toBe('(x: any) => void');
});

test('P2/P3/P5/P26: a callable inside a structure reports its signature, at any depth', () => {
  expect(evaluated('String(Reflect.typeOf({ f: (x: uint8): uint16 => 1 }));')).toBe('{ f: (x: uint.<8>) => uint.<16> }');
  expect(evaluated('String(Reflect.typeOf({ f(x: uint8): uint16 { return 1; } }));')).toBe('{ f: (x: uint.<8>) => uint.<16> }');
  expect(evaluated('String(Reflect.typeOf([(x: uint8) => {}]));')).toBe('[].<(x: uint.<8>) => void>');
  expect(evaluated('String(Reflect.typeOf({ a: { f: (x: uint8) => {} } }));')).toBe('{ a: { f: (x: uint.<8>) => void } }');
  // P23: `{ f: fn }` and `{ f: {} }` are distinct.
  expect(evaluated('String(Reflect.typeOf({ f: (x: uint8) => {} }) === Reflect.typeOf({ f: {} }));')).toBe('false');
  // P20: reflection sees the member as a function.
  expect(evaluated('const r = Reflect.getReflection(Reflect.typeOf({ f: (x: uint8) => {} })); String(Reflect.getReflection(r.properties[0].type).kind);')).toBe('function');
});

test('P21/V10/V11: a built-in, a bound function and a Proxy declare nothing and are the untyped catch-all', () => {
  expect(evaluated('String(Reflect.typeOf({ f: Math.max }));')).toBe('{ f: () => void }');
  expect(evaluated('const f = function (x: uint8): uint8 { return x; }; String(Reflect.typeOf(f.bind(null)));')).toBe('() => void');
  expect(evaluated('const f = (x: uint8): uint8 => x; String(Reflect.typeOf(new Proxy(f, {})));')).toBe('() => void');
});

test('P34/P35/V5: a signature resolves under the frame the function captured', () => {
  expect(evaluated('function mk<T>(x: T) { return (y: T): T => y; } String(Reflect.typeOf(mk((1 := uint8))));')).toBe('(y: uint.<8>) => uint.<8>');
  expect(evaluated('function mk<T>(x: T) { return { f: (y: T): T => y }; } String(Reflect.typeOf(mk((1 := uint8))));')).toBe('{ f: (y: uint.<8>) => uint.<8> }');
  // A generic declaration's method reports over the class's parameters, as its constructor does.
  expect(evaluated('class Box<T> { v: T; m(y: T): T { return y; } constructor(v: T) { this.v = v; } } String(Reflect.typeOf(Box.prototype.m));')).toBe('<T>(y: T) => T');
  expect(evaluated('class Box<T> { v: T; constructor(v: T) { this.v = v; } } String(Reflect.typeOf(Box)) + " | " + String(Reflect.typeOf(Box.<uint8>));')).toBe('<T>(v: T) => Box.<T> | (v: uint.<8>) => Box.<uint.<8>>');
});

test('P36/V14/V15: a signature resolves when asked, in the function\'s own scope', () => {
  expect(evaluated('function f(x: Later) {} class Later {} String(Reflect.typeOf(f));')).toBe('(x: Later) => void');
  expect(evaluated('function mk() { type L = uint8; return (x: L): L => x; } const g = mk(); String(Reflect.typeOf(g));')).toBe('(x: uint.<8>) => uint.<8>');
  // A same-named alias at the reflecting site does not capture the annotation.
  expect(evaluated('function mk() { type L = uint8; return (x: L): L => x; } const g = mk(); type L = string; String(Reflect.typeOf(g));')).toBe('(x: uint.<8>) => uint.<8>');
});

test('V6/V7/V8: a class constructor inside a structure reports its constructor signature; an enum keeps its names', () => {
  expect(evaluated('class C { static x = 1; constructor(v: uint8) {} } String(Reflect.typeOf({ C }));')).toBe('{ C: (v: uint.<8>) => C }');
  expect(evaluated('class C { static x = 1; constructor(v: uint8) {} } String(Reflect.typeOf(C));')).toBe('(v: uint.<8>) => C');
  // Two classes with identical default constructors are two types.
  expect(evaluated('class C { x: uint8 = 1; } class D { y: string = ""; } String(Reflect.typeOf(C)) + " " + String(Reflect.typeOf(C) !== Reflect.typeOf(D));')).toBe('() => C true');
  expect(evaluated('enum E { A, B } String(Reflect.typeOf({ E }));')).toBe('{ E: { 0: E, 1: E, A: E, B: E } }');
});

test('Q5: a computed-type formal reads any; a failed derivation is the untyped catch-all', () => {
  expect(evaluated('function wrapOf(T) { return T; } const f = (x: wrapOf(uint8)): uint8 => x; String(Reflect.typeOf({ f }));')).toBe('{ f: (x: any) => uint.<8> }');
  expect(evaluated('const g = [function (x: Nope) {}][0]; String(Reflect.typeOf({ g }));')).toBe('{ g: (x: any) => void }');
});

// -- 2b. Inference through a callable ---------------------------------------

test('P7/P15/P17: inference reaches through a callable property, on both sides', () => {
  expect(evaluated('function g<T>(o: { f: (x: T) => void }): string { return String(T); } g({ f: (x: uint8) => {} });')).toBe('uint.<8>');
  expect(evaluated('class W<T> { constructor(o: { f: (x: T) => void }) {} } String(Reflect.typeOf(new W({ f: (x: uint8) => {} })));')).toBe('W.<uint.<8>>');
  expect(evaluated('function g<T>(os: [].<{ f: (x: T) => void }>): string { return String(T); } g([{ f: (x: uint8) => {} }]);')).toBe('uint.<8>');
  // The checker agrees (P9).
  expectStaticTypeError('function g<T>(o: { f: (x: T) => void }): T { throw new Error(); } const r: string = g({ f: (x: uint8) => {} });');
  // P8/P16: the top-level callback, unchanged.
  expect(evaluated('function g<T>(f: (x: T) => void): string { return String(T); } g((x: uint8) => {});')).toBe('uint.<8>');
  // P19: reached but untyped - an unannotated callable - is `any`, for the right reason.
  expect(evaluated('function g<T>(o: { f: (x: T) => void }): string { return String(T); } g({ f: (x) => {} });')).toBe('any');
});

// -- 2c. The boundary -------------------------------------------------------

test('P27/P28: a mismatched callable is refused at a function-typed binding, both sides', () => {
  expectStaticTypeError('function g(x: string): string { return "s"; } const f: (x: uint8) => uint8 = g;');
  expect(evaluated(`const pick = [(x: string) => "s"][0]; ${caught('const f: (x: uint8) => uint8 = pick; r = "admitted";')}`)).toContain('runtime:');
  // A const-bound ARROW at the same binding: the checker admits it (a
  // pre-existing gap - it refuses the `function` declaration above), the
  // runtime now refuses it. Recorded in the plan; the program fails.
  expect(ok('const g = (x: string) => "s"; const f: (x: uint8) => uint8 = g;')).toBe(false);
  // P32/P32b: an untyped callback passes (the named unsoundness); a matching typed one passes.
  expect(evaluated(`const pick = [(x) => x][0]; ${caught('const f: (x: uint8) => uint8 = pick; r = "admitted";')}`)).toBe('admitted');
  expect(evaluated(`const pick = [(x: uint8): uint8 => x][0]; ${caught('const f: (x: uint8) => uint8 = pick; r = "admitted " + String(f(3));')}`)).toBe('admitted 3');
  expect(evaluated('const a: [].<uint8> = [1, 2]; String(a.map((x) => x + 1).length);')).toBe('2');
});

test('P11/P12/P12b/P13/P24: a mismatched callable MEMBER is refused, and `is` answers false', () => {
  expectStaticTypeError('const o: { f: (x: uint8) => uint8 } = { f: (x: string) => "s" };');
  expect(evaluated(`const v = { f: (x: string) => "s" }; const pick = [v][0]; ${caught('const o: { f: (x: uint8) => uint8 } = pick; r = "admitted";')}`)).toContain('runtime:');
  expect(evaluated(`interface I { f(x: uint8): uint8; } const v = { f: (x: string) => "s" }; const pick = [v][0]; ${caught('const o: I = pick; r = "admitted";')}`)).toContain('runtime:');
  expect(evaluated('String(({ f: (x: string) => "s" }) is { f: (x: uint8) => uint8 });')).toBe('false');
  expect(evaluated('String(({ f: (a: uint8, b: uint8) => 1 }) is { f: () => uint8 });')).toBe('false');
  expect(evaluated('String(({ f: (x: uint8): uint8 => x }) is { f: (x: uint8) => uint8 });')).toBe('true');
});

test('this-adoption at the boundary: a non-arrow function at a this-typed member adopts it; an arrow cannot', () => {
  // #sec-this-adoption: an interface's method member carries a [[ThisType]];
  // a plain function stored there IS called with that `this`, so it adopts
  // it at the check, as the checker adopts it for a literal or a reference.
  // An arrow has no `this` of its own and is refused - statically where the
  // checker sees it (P-d), and at run time where it does not.
  const BUS = 'interface Bus { on(name: string): void; } ';
  expect(evaluated(`${BUS} let b: Bus = { on(name: string): void {} }; "ok";`)).toBe('ok');
  expect(evaluated(`${BUS} function on(name: string): void {} const pick = [{ on }][0]; ${caught('const b: Bus = pick; r = "admitted";')}`)).toBe('admitted');
  expect(ok(`${BUS} let b: Bus = { on: (name: string): void => {} };`)).toBe(false);
  expect(evaluated(`${BUS} const v = { on: (name: string): void => {} }; const pick = [v][0]; ${caught('const b: Bus = pick; r = "admitted";')}`)).toContain('runtime:');
});

test('a rest typed by a fixed tuple is positional in the relation', () => {
  // Found by the boundary check: a pack bound from two arguments reads as
  // `[uint32, float32]`, and a positional callback must be assignable to it.
  expect(evaluated('String(Reflect.isAssignable(type (x: uint32, y: float32) => void, type (...xs: [uint32, float32]) => void));')).toBe('true');
  expect(evaluated('function apply2<...Cs>(cb: (ref ...xs: Cs) => void, ref ...xs: Cs): void { cb(...xs); } let a: uint32 = 1; let f: float32 = 2; apply2((ref x: uint32, ref y: float32) => { x = 2; y = 3; }, ref a, ref f); String(a) + "/" + String(f);')).toBe('2/3');
});

test('the catch-all stays [[Untyped]] and a written any signature does not (V1-V4)', () => {
  expect(evaluated('String(Reflect.isAssignable(Reflect.typeOf((x) => x), type (x: uint8) => uint8));')).toBe('true');
  expect(evaluated('String(Reflect.isAssignable(Reflect.typeOf((x: string) => "s"), type (x: uint8) => uint8));')).toBe('false');
  expect(evaluated('String(Reflect.isAssignable(Reflect.typeOf((x: uint8) => x), type (x: uint8) => uint8));')).toBe('true');
  expect(evaluated('String(Reflect.isAssignable(type (x: any) => any, type (x: uint8) => uint8));')).toBe('false');
});
