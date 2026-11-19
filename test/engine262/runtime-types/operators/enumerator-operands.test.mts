import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown } from '../harness.mts';

/**
 * An operator reads an enumerator, `E.A`, at its enum's underlying type before running, as it
 * reads a parameter `e: E` and as the run time computes (#sec-enums). The read had no type for
 * it, so `E.A * 300` for `enum E : uint8` was a RangeError when it ran where `e * 300` is refused.
 * The read itself keeps no Static Type (round 4, Q7): `C.One === 3`, `E.A is E`, a `match` over
 * `C.One` and `let x: Late = E.b` for a refinement `Late` of `E` are judged as they were.
 */

const E = 'enum E : uint8 { A = 1, B = 2 } ';

test('an operator judges an enumerator as a value of its enum', () => {
  expectStaticTypeError(`${E}E.A * 300;`);
  expectStaticTypeError(`${E}E.A < 300;`);
  expectStaticTypeError(`${E}function f(n: uint16) { return E.A * n; }`);
  expectStaticTypeError(`${E}function f(s: string) { return E.A * s; }`);
  // A declared type judges the read before running too (Question AV;
  // enumerator-at-declared-type).
  expectStaticTypeError(`${E}const b: boolean = E.A;`);
});

test('the read of an enumerator keeps no Static Type of its own', () => {
  expect(evaluated(`${E}E.A === 3 ? "eq" : "neq";`)).toBe('neq');
  expect(evaluated(`${E}(E.A is E) ? "ok" : "no";`)).toBe('ok');
  expect(evaluated(`${E}String(match (E.B) { when E.B: "b"; });`)).toBe('b');
  expect(evaluated(`${E}type Late = E where this > E.A; let x: Late = E.B; String(x);`)).toBe('2');
});

test('what an enumerator could do before, it still does', () => {
  expect(evaluated(`${E}String(E.A * 2) + " " + String(E.A + E.B);`)).toBe('2 3');
  expect(evaluated(`${E}const x: E = E.A; let n: uint8 = E.B; String(x) + " " + String(n);`)).toBe('1 2');
  expect(evaluated(`${E}String(E.A === 1) + " " + String(E.A === E.B);`)).toBe('true false');
  expect(evaluated(`${E}function f(e: E) { switch (e) { case E.A: return "a"; default: return "o"; } } f(E.A);`)).toBe('a');
  expect(evaluated('enum Color { Red, Green, Blue } Color.Red === 0 && Color.Green === 1 ? "ok" : "no";')).toBe('ok');
  expect(evaluated('enum S : string { A = "a" } const s: string = S.A; s;')).toBe('a');
});

test('an enum declared without an underlying type is over int32', () => {
  // #sec-enums: "an enum declared without one has the underlying type int32", as
  // the run time has it. The checker read `number`, which refused the first two.
  const P = 'enum P { A, B, C = 5 } ';
  expect(evaluated(`${P}function f(e: P, k: int32) { let i: int32 = e; return i * k; } String(f(P.C, 3));`)).toBe('15');
  expect(evaluated(`${P}function f(e: P) { return e + 1; } String(f(P.C));`)).toBe('6');
  expect(evaluated(`${P}const a = [10, 20, 30]; String(a[P.B]) + " " + String(P.C / 2);`)).toBe('20 2');
  // And it is refused where an int32 is.
  for (const body of ['P.B * Math.PI;', 'P.B * 0.5;', 'function f(e: P, n: number) { return e * n; }', 'function f(e: P) { const n: number = e; }',
    'const n: number = P.A;']) {
    expectStaticTypeError(`${P}${body}`);
  }
});

test('an enumerator crossing a boundary unseen is refused where its underlying type is', () => {
  for (const E of ['enum E { A = 1 } ', 'enum E : uint8 { A = 1 } ']) {
    expectThrown(`${E}function f(i) { const n: number = i; return n; } f(E.A);`, 'is not assignable to');
    expect(evaluated(`${E}function f(i) { const n: E = i; return n; } String(f(E.A));`)).toBe('1');
  }
  expect(evaluated('enum E { A = 1 } function f(i) { const n: int32 = i; return n; } String(f(E.A));')).toBe('1');
});
