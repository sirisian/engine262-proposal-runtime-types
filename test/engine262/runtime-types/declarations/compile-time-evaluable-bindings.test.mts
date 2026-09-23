import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-iscompiletimeevaluable, #sec-evaluatetotypeobject, and the
 * defaults of #sec-array-and-tuple-types, #sec-object-types, #sec-declared-zero
 * and #sec-enums.
 *
 * A reference to a binding is evaluable only where the binding is "immutable
 * and its initializer is compile-time evaluable" (or a parameter or local of the
 * function under evaluation, a generic parameter, or an earlier enumerator), and
 * a call only where its callee is a function "whose body reads only its
 * parameters, its own local bindings, immutable bindings whose initializers are
 * compile-time evaluable, and other compile-time-evaluable functions".
 *
 * The engine checked only the syntactic floor. `let k = 5; type T = [uint8 =
 * k];` was accepted and snapshotted whatever `k` held when the declaration ran,
 * and a default that called a function assigning module state ran that
 * assignment once, at declaration.
 */

test('a default, declared zero or enumerator may not read a mutable binding', () => {
  expectStaticTypeError('let k = 5; type T = [uint8, uint8 = k];');
  expectStaticTypeError('let k = 5; type O = { a?: uint8 = k };');
  expectStaticTypeError('let zz = 0; class V { x: uint8 = 0; static default = zz; }');
  expectStaticTypeError('let k = 5; enum E { A = k }');
  expectStaticTypeError('var k = 5; type T = [uint8, uint8 = k];');
});

test('nor call a function that is not evaluable, or that the program reassigns', () => {
  expectStaticTypeError('let n = 0; function f() { n = n + 1; return n; } type T = [uint8, uint8 = f()];');
  expectStaticTypeError('function h() { return 1; } h = function () { return 2; }; type T = [uint8 = h()];');
  // Through a const whose own initializer is not evaluable.
  expectStaticTypeError('let n = 1; const c = n; type T = [uint8 = c];');
});

test('a type position may not read a mutable binding', () => {
  expectStaticTypeError('let K = uint8; let x: K = 3;');
  expectStaticTypeError('let k = uint8; function g<T: type = k>(x: T) {}');
  expectStaticTypeError('let N = 4; let a: [N].<uint8>;');
});

test('immutable bindings, evaluable functions, generic parameters and the library are admitted', () => {
  expect(evaluated('const k = 5; type T = [uint8, uint8 = k]; let t: T = [1]; String(t[1]);')).toBe('5');
  expect(evaluated('const K = uint8; let x: K = 3; String(x);')).toBe('3');
  expect(evaluated('function two() { const a = 1; return a + 1; } type T = [uint8, uint8 = two()]; let t: T = [1]; String(t[1]);')).toBe('2');
  // A recursive builder is judged by what it reads.
  expect(evaluated('function fact(n) { return n <= 1 ? 1 : n * fact(n - 1); } type T = [uint8 = fact(4)]; let t: T = []; String(t[0]);')).toBe('24');
  expect(evaluated('const k = 5; enum E { A = k, B = A + 1 } String(E.B);')).toBe('6');
  expect(evaluated('function id<T: type>(x: T): T { let y: T = x; return y; } String(id(3));')).toBe('3');
  expect(evaluated('type T = [uint8 = Math.max(1, 2)]; let t: T = []; String(t[0]);')).toBe('2');
});

test('a const bound to a class names it as a declaration does', () => {
  expect(evaluated('const C = class {}; type T = C; (new C() instanceof T) ? "ok" : "no";')).toBe('ok');
  // A construction in an enumerator is not a class declaration, though the
  // checker's record of the construction points at one.
  expect(evaluated('class K { constructor(v) { this.v = v; } } enum A: K { X = new K(1) } String(A.X.v);')).toBe('1');
});
