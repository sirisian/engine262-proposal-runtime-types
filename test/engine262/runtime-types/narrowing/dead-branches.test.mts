import { test, expect } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * #sec-narrowfrom: it is a type error to apply a narrowing form where the test
 * can never succeed or can never fail, since the branch it guards is then dead
 * code. Each test below pairs the programs the rule rejects with the nearest
 * programs it must keep accepting.
 */

const ASSERT_U8 = 'function makeAssert() { return Reflect.makeType({ kind: "function", signatures: [{ '
  + 'parameters: [{ name: "v", type: type any }], narrows: [{ target: "v", type: type uint8 }] }] }); } '
  + 'type A = makeAssert(); '
  + 'const assertU8: A = (v) => { if (typeof v !== "number") throw new TypeError("no"); }; ';
const ASSERT_STRING = 'function makeAssert() { return Reflect.makeType({ kind: "function", signatures: [{ '
  + 'parameters: [{ name: "v", type: type any }], narrows: [{ target: "v", type: type string }] }] }); } '
  + 'type A = makeAssert(); '
  + 'const assertS: A = (v) => { }; ';

test('a test of a member path is judged against the type of the path', () => {
  const C = 'class C { x: uint8 = (0 := uint8); k: "a" | "b" = "a"; } ';
  expectStaticTypeError(`${C} function f(c: C) { if (c.x is string) {} }`);
  expectStaticTypeError(`${C} function f(c: C) { if (typeof c.x === "string") {} }`);
  expectStaticTypeError(`${C} function f(c: C) { if (c.x == null) {} }`);
  expectStaticTypeError(`${C} function f(c: C) { if (c.k === "c") {} }`);
  expectStaticTypeError('class C { k: "a" | "b" = "a"; m() { if (this.k === "c") {} } }');
  // A path that genuinely narrows does so in both branches.
  expect(evaluated('class C { x: uint8 | string = (0 := uint8); } function f(c: C) { if (c.x is uint8) { let n: uint8 = c.x; } else { let s: string = c.x; } } "ok";')).toBe('ok');
});

test('a test of an operand that is not a path is judged, and narrows nothing', () => {
  const h = 'function h(): uint8 { return (1 := uint8); } ';
  expectStaticTypeError(`${h} function f() { if (h() is string) {} }`);
  expectStaticTypeError(`${h} function f() { if (typeof h() === "string") {} }`);
  expectStaticTypeError(`${h} function f() { if (h() == null) {} }`);
  // Two literals compared with each other are a constant, not a test of a value.
  expect(evaluated('if ("a" === "a") {} "ok";')).toBe('ok');
});

test('a test nested in a guard decides the same branch', () => {
  expectStaticTypeError('function f(a: uint8, b: boolean) { if (b && a instanceof string) {} }');
  expectStaticTypeError('function f(a: uint8, b: boolean) { if (b && a instanceof uint8) {} }');
  expectStaticTypeError('function f(a: uint8, b: boolean) { if (b || a instanceof uint8) {} else {} }');
  expectStaticTypeError('function f(a: uint8, b: boolean) { while (b && a is string) {} }');
  expectStaticTypeError('function f(a: uint8, b: boolean, c: boolean) { if (b && (c && a is string)) {} }');
  expectStaticTypeError('function g() {} function f(a: uint8) { if ((g(), a instanceof string)) {} }');
  expectStaticTypeError('function f(a: uint8, b: boolean) { if (b ? a instanceof string : false) {} }');
  expectStaticTypeError('function f(a: uint8) { do {} while (a is string); }');
  expectStaticTypeError('function f(a: uint8) { for (; a is string;) {} }');
  // The right operand is judged inside the narrowing its left operand makes.
  expect(evaluated('class A { x: uint8 = 1; } let v: A | null = new A(); ((v instanceof A) && v.x === 1) ? "yes" : "no";')).toBe('yes');
  // In a value position the right operand is the result, not a branch.
  expect(evaluated('function f(a: uint8, b: boolean) { let r = b && a instanceof uint8; return r; } String(f((1 := uint8), true));')).toBe('true');
});

test('only a verdict that no value can lose is reported', () => {
  // A primitive never becomes an Object, nor the reverse.
  expectStaticTypeError('function f(a: uint8) { if (a is { x: uint8 }) {} }');
  expectStaticTypeError('function f(o: { x: uint8 }) { if (o is uint8) {} }');
  expectStaticTypeError('function f(g: () => uint8) { if (g is string) {} }');
  expectStaticTypeError('function f(t: [uint8, uint8]) { if (t is string) {} }');
  // An enumerator is a value of its underlying type.
  expectStaticTypeError('enum E { A, B } function f(e: E) { if (e is boolean) {} }');
  expectStaticTypeError('enum E { A, B } function f(e: E) { if (e is E) {} }');
  // Membership in an object type or a refinement can be lost after the
  // boundary, so neither operator reports a test of one that cannot fail.
  const pos = 'type Pos = { a: uint8 } where this.a > 0; let p: Pos = { a: (5 := uint8) }; p.a = (0 := uint8); let r = "n"; ';
  expect(evaluated(`${pos} if (p instanceof Pos) { r = "y"; } r;`)).toBe('n');
  expect(evaluated(`${pos} if (p is Pos) { r = "y"; } r;`)).toBe('n');
  expect(evaluated('function f(o: { x: uint8 }) { if (typeof o === "object") {} } "ok";')).toBe('ok');
});

test('a pattern test is judged by MatchNarrow and MissNarrow', () => {
  expectStaticTypeError('function f(a: uint8) { if (a is string or boolean) {} }');
  expectStaticTypeError('function f(a: uint8) { if (a is uint8 or string) {} }');
  expectStaticTypeError('function f(u: uint8 | string) { if (u is uint8 or boolean) {} }');
  expectStaticTypeError('function f(a: uint8) { if (a is uint8 or not string) {} }');
  expectStaticTypeError('function f(a: uint8) { if (a is /x/) {} }');
  // Irrefutable patterns can never fail.
  expectStaticTypeError('function f(a: uint8) { if (a is _) {} }');
  expectStaticTypeError('function f(a: uint8) { if (a is let y) { y; } }');
  expectStaticTypeError('function f(a: uint8) { if (a is let y: any) { y; } }');
  expectStaticTypeError('function f(a: uint8) { if (a is let y: uint8) { y; } }');
  // A live `or` and a top-level `not` keep narrowing both branches.
  expect(evaluated('function f(u: uint8 | string | boolean) { if (u is uint8 or string) { } else { let b: boolean = u; } } "ok";')).toBe('ok');
  expect(evaluated('function f(u: uint8 | string) { if (u is not uint8) { let s: string = u; } else { let n: uint8 = u; } } "ok";')).toBe('ok');
  expect(evaluated('function f(a: uint8 | string | boolean) { if (a is uint8 or not string) { } else { let s: string = a; } } "ok";')).toBe('ok');
  // `not` covers the atoms its operand can never match.
  expect(evaluated('function f(x: uint8 | string) { return match (x) { when not uint8: 1; when uint8: 2; }; } String(f((1 := uint8)));')).toBe('2');
});

test('a structural pattern can never match a position that holds no Object', () => {
  expectStaticTypeError('function f(a: uint8) { if (a is [let x]) { x; } }');
  expectStaticTypeError('function f(a: uint8) { if (a is { x: let y }) { y; } }');
  expectStaticTypeError('function f(a: uint8) { return match (a) { when [let x]: 1; default: 3; }; }');
  expectStaticTypeError('function f(a: uint8) { return match (a) { when { x: let y }: 2; default: 3; }; }');
  // An Array's iterator can be replaced, so its length proves nothing.
  expect(evaluated('function f(t: [uint8, uint8]) { if (t is [let x]) { x; } } "ok";')).toBe('ok');
});

test('a match all clause that can match no value of the subject is dead', () => {
  expectStaticTypeError('function f(a: uint8 | string) { return match all (a) { when boolean: 0; when uint8: 1; }; }');
  expectStaticTypeError('function f(a: uint8 | string) { return match all (a) { when boolean or bigint: 0; when _: 1; }; }');
  expect(evaluated('function f(a: uint8 | string) { return match all (a) { when uint8: 0; when _: 1; }; } String(f((1 := uint8)).length);')).toBe('2');
});

test('switch labels are tested in order', () => {
  expectStaticTypeError('function f(a: "a" | "b") { switch (a) { case "c": break; } }');
  expectStaticTypeError('function f(a: "a" | "b") { switch (a) { case "a": break; case "a": break; } }');
  expectStaticTypeError('function f(n: uint8) { switch (n) { case 1: break; case 1: break; } }');
  expectStaticTypeError('function f(n: uint8) { switch (typeof n) { case "string": break; } }');
  expectStaticTypeError('function f(n: uint8) { switch (typeof n) { case "strin": break; } }');
  // A union of literals does not drive exhaustiveness, so its default is live.
  expect(evaluated('function f(a: "a" | "b") { switch (a) { case "a": return 1; case "b": return 2; default: return 3; } } String(f("a"));')).toBe('1');
  expect(evaluated('function f(n: uint8 | string) { switch (typeof n) { case "number": return 1; case "string": return 2; } return 0; } String(f("x"));')).toBe('2');
  expect(evaluated('function f(n: uint8) { switch (n) { case 1: return 1; case 2: return 2; } return 0; } String(f((2 := uint8)));')).toBe('2');
});

test('an enum switch rejects a label and a default that can never be taken', () => {
  expectStaticTypeError('enum E { A, B } function f(e: E) { switch (e) { case E.A: break; case E.A: break; case E.B: break; } }');
  expectStaticTypeError('enum E { A, B } function f(e: E) { switch (e) { case E.A: break; case E.B: break; default: break; } }');
  expect(evaluated('enum E { A, B, C } function f(e: E) { switch (e) { case E.A: return 1; case E.B: return 2; default: return 3; } } String(f(E.C));')).toBe('3');
});

test('a typed catch clause that can never run is rejected', () => {
  expectStaticTypeError('try {} catch (e: Error) {} catch (e: TypeError) {}');
  expectStaticTypeError('try {} catch (e: TypeError) {} catch (e: TypeError) {}');
  expectStaticTypeError('try {} catch (e: any) {} catch (e: TypeError) {}');
  expectStaticTypeError('try {} catch (e: any) {} catch (e) {}');
  expect(evaluated('let r = ""; try { throw new RangeError("x"); } catch (e: TypeError) { r = "t"; } catch (e: RangeError) { r = "r"; } catch (e) { r = "o"; } r;')).toBe('r');
  expect(evaluated('let r = ""; try { throw new TypeError("x"); } catch (e: TypeError) { r = "t"; } catch (e: Error) { r = "e"; } r;')).toBe('t');
  // Dispatch is membership, not conversion.
  expect(evaluated('let r = ""; try { throw new TypeError("x"); } catch (e: string) { r = "s"; } catch (e: TypeError) { r = "t"; } r;')).toBe('t');
});

test('the nullish forms and logical assignment read both ways', () => {
  expectStaticTypeError('function f(a: null) { return a?.x; }');
  expectStaticTypeError('class C { cb: undefined = undefined; } function f(c: C) { return c.cb?.(); }');
  expectStaticTypeError('class C { x: undefined = undefined; } function f(c: C) { c.x ??= undefined; }');
  expectStaticTypeError('function f(v: { x: uint8 } | null) { if (v === null) { v?.x; } }');
  expectStaticTypeError('function f(o: { x: uint8 }) { o ||= { x: (1 := uint8) }; }');
  expectStaticTypeError('function f(z: null) { z &&= null; }');
  expect(evaluated('function f(a: { x: uint8 } | null) { return a?.x; } String(f(null));')).toBe('undefined');
  expect(evaluated('function f(o: { x: uint8 } | null) { o ||= { x: (1 := uint8) }; return 1; } String(f(null));')).toBe('1');
});

test('a void assertion narrows by NarrowTo, and one that can never return is rejected', () => {
  expectStaticTypeError(`${ASSERT_U8} { let s: string = "x"; assertU8(s); }`);
  expect(evaluated(`${ASSERT_STRING} { let s: "a" | "b" = "a"; assertS(s); let t: "a" | "b" = s; } "ok";`)).toBe('ok');
  expect(evaluated(`${ASSERT_U8} { let box: uint8 | string = (5 := uint8); assertU8(box); let n: uint8 = box; } "ok";`)).toBe('ok');
});

test('a discriminant test loses only the members whose discriminant is the literal', () => {
  expectStaticTypeError('type A = { kind: "a", v: uint8 }; type B = { kind: "a", w: string }; function f(x: A | B) { if (x.kind === "a") {} }');
  expectStaticTypeError('type C = { kind: "a" }; type D = { kind: "b" }; function g(o: { s: C | D }) { if (o.s.kind === "c") {} }');
  expectStaticTypeError('type C = { kind: "a" }; type D = { kind: "b" }; class K { s: C | D = { kind: "a" }; m() { if (this.s.kind === "c") {} } }');
  // A member whose discriminant is wider than the literal reaches both branches.
  expect(evaluated('type A = { kind: string, v: uint8 }; type B = { kind: "b", w: string }; function f(x: A | B) { if (x.kind === "a") { let n: uint8 = x.v; } else { return x.kind; } return "t"; } String(f({ kind: "z", v: (1 := uint8) }));')).toBe('z');
  expectStaticTypeError('type A = { kind: string, v: uint8 }; type B = { kind: "b", w: string }; function f(x: A | B) { if (x.kind === "a") { } else { let s: string = x.w; } }');
  expect(evaluated('type A = { kind: "a", v: uint8 }; type B = { kind: "b", v: string }; function f(x: A | B) { if (x.kind === "a") { let n: uint8 = x.v; } else { let s: string = x.v; } } "ok";')).toBe('ok');
  expect(evaluated('type A = { kind: "a", v: uint8 }; type B = { kind: "b", v: string }; function f(x: A | B) { if (!(x.kind === "a")) { let s: string = x.v; } } "ok";')).toBe('ok');
  expect(evaluated('type C = { kind: "a", n: uint8 }; type D = { kind: "b", t: string }; function g(o: { s: C | D }) { if (o.s.kind === "a") { let n: uint8 = o.s.n; } } "ok";')).toBe('ok');
});
