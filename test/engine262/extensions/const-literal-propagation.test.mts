import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../readme/harness.mts';

/**
 * A `const` bound to a compile-time numeric constant behaves as if its
 * initializer were written at each use: `const K = 3.14` is a `float64` in a
 * `float64` position and a `float32` in a `float32` one.
 *
 * Nothing about the binding changes - no type is inferred, `typeof K` is
 * `'number'`, `K === 3.14` holds. What changes is which value a USE produces,
 * which is the question literal propagation already answers one site earlier.
 */

test('a const of a numeric constant takes its context type', () => {
  // The point of the feature: one constant, two types, in one program - and the
  // same two values the inline literal produces.
  expect(evaluated('const K = 3.14; let a: float64 = 2.0; let b: float32 = 2.0; String(Number(K * a)) + "/" + String(Number(K * b));')).toBe('6.28/6.28000020980835');
  expect(evaluated('let a: float64 = 2.0; let b: float32 = 2.0; String(Number(3.14 * a)) + "/" + String(Number(3.14 * b));')).toBe('6.28/6.28000020980835');
  // Computed initializers qualify.
  expect(evaluated('const T = 2 * 3.14; let a: float64 = 2.0; String(Number(T * a));')).toBe('12.56');
  expect(evaluated('const T = (1 + 2) * 3; let n: uint8 = 2; String(Number(T * n));')).toBe('18');
  // Representability decides admissibility, by the rule literals already use.
  expect(evaluated('const C = 3; let n: uint8 = 2; String(Number(C * n));')).toBe('6');
  expectThrown('const C = 999; let n: uint8 = 2; C * n;');
});

test('D3: a reference to a marked const is itself constant', () => {
  // Without this the feature applies exactly one level deep, and
  // `const TAU = 2 * PI` is refused for a reason no user could state.
  expect(evaluated('const A = 3.14; const B = A * 2; let r: float64 = 2.0; String(Number(B * r));')).toBe('12.56');
  expect(evaluated('const A = 3.14; const B = A * 2; let a: float64 = 2.0; let b: float32 = 2.0; String(Number(B * a)) + "/" + String(Number(B * b));')).toBe('12.56/12.5600004196167');
  expect(evaluated('const A = 2; const B = A * 2; const C = B * 2; let n: uint8 = 2; String(Number(C * n));')).toBe('16');
  expect(evaluated('const A = 0.1; const B = A; let b: float32 = 1.0; String(Number(B * b));')).toBe('0.10000000149011612');
  // A chain through a `let` does not qualify, because the `let` does not.
  expectThrown('let A = 3.14; const B = A * 2; let r: float64 = 2.0; B * r;');
});

test('F74: a `let` does not adopt, and shadowing is respected', () => {
  // A mutable binding's type is fixed, or a reassignment has nothing to check
  // against. `let` is the spelling for an ordinary `number` variable.
  expectThrown('let K = 0.1; let a: float32 = 2.0; K * a;');
  // An inner `let` shadows an outer adopting `const` and must not inherit it.
  // The value 0.1 discriminates; 2.0 would not, being exact in both types.
  expectThrown('const K = 3.14; function g(){ let K = 0.1; let a: float32 = 2.0; return K * a; } g();');
  expectThrown('const K = 3.14; { let K = 0.1; let a: float32 = 2.0; K * a; }');
  expectThrown('const K = 0.1; function g(K){ let a: float32 = 2.0; return K * a; } g(0.1);');
  // An inner `const` correctly still adopts.
  expect(evaluated('const K = 3.14; function g(){ const K = 0.1; let a: float32 = 2.0; return Number(K * a); } String(g());')).toBe('0.20000000298023224');
});

test('nothing observable about the binding changes', () => {
  expect(evaluated('const K = 3.14; typeof K;')).toBe('number');
  expect(evaluated('const K = 3.14; String(K === 3.14);')).toBe('true');
  // Untyped code is unchanged: with no contextual type the constant is a number.
  expect(evaluated('const K = 3.14; String(K * 2);')).toBe('6.28');
  // A non-constant initializer does not qualify.
  expectThrown('function f(){ return 3.14; } const K = f(); let a: float64 = 2.0; K * a;');
  // An annotation pins the type, which is how a plain `number` is requested.
  expect(evaluated('const n: number = 5; String((5 := uint8) === n);')).toBe('false');
});

test('every typed position adopts, for a literal and a const alike', () => {
  expect(evaluated('const K = 0.1; function f(): float32 { return K; } String(Number(f()));')).toBe('0.10000000149011612');
  expect(evaluated('const K = 0.1; function f(x: float32): float32 { return x; } String(Number(f(K)));')).toBe('0.10000000149011612');
  expect(evaluated('const K = 0.1; let a: float32 = 0.1; String(a == K);')).toBe('true');
  expect(evaluated('const K = 0.1; let arr: [1].<float32> = [K]; String(Number(arr[0]));')).toBe('0.10000000149011612');
  expect(evaluated('const K = 0.1; let a: float32 = K; String(Number(a));')).toBe('0.10000000149011612');
});
