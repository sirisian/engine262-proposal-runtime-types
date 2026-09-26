import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind } from '../harness.mts';

/**
 * A use of a named numeric constant is its initializer, written at the use.
 *
 * #sec-static-type-of-an-expression: a use of an unannotated `const` whose
 * initializer is a compile-time numeric constant expression "produces the value
 * the initializer would have produced had it been written at that position". It
 * is implemented as exactly that: the use types a copy of the constant's
 * initializer - closed over the names visible where it is declared - at the
 * position, and evaluates the copy. Integers, bigint and decimals had this
 * through a store, an exemption and a fold each; rationals and binary floats had
 * none, so `const K = 0.1; rational(K)` was the dyadic value.
 */

const spellings = (decl: string, type: string, name: string) => [
  `${decl} let v: ${type} = ${name}; String(v);`,
  `${decl} String(${type}(${name}));`,
  `${decl} String(${name} := ${type});`,
];

test('every family, every kind of initializer, every spelling', () => {
  const cases: [string, string, string, string][] = [
    ['const K = 9007199254740993;', 'uint64', 'K', '9007199254740993'],
    ['const E = 9007199254740992 + 9007199254740993;', 'uint64', 'E', '18014398509481985'],
    ['const D = 0.1;', 'decimal128', 'D', '0.1'],
    ['const D = 1.50;', 'decimal128', 'D', '1.50'], // the literal's trailing zero kept
    ['const D = 0.1 + 0.2;', 'decimal128', 'D', '0.3'],
    ['const K = 0.1;', 'rational', 'K', '1/10'],
    ['const N = -0.1;', 'rational', 'N', '-1/10'],
    ['const T = 1 / 3;', 'rational', 'T', '1/3'],
    ['const F = 16777217.0000000001;', 'float32', 'F', '16777218'],
    ['const F = -16777217.0000000001;', 'float32', 'F', '-16777218'],
    ['const H = 2049.0000000000001;', 'float16', 'H', '2050'],
  ];
  for (const [decl, type, name, want] of cases) {
    for (const src of spellings(decl, type, name)) expect(evaluated(src), src).toBe(want);
  }
  expect(evaluated('const B = 9007199254740993; let b: bigint = B; String(b);')).toBe('9007199254740993');
  expect(evaluated('const C = 3; let c: complex64 = C; String(c);')).toBe('3+0i');
});

test('names inside the initializer resolve where the constant is declared', () => {
  // A macro would read the inner A and give 10; a constant means the A it saw.
  expect(evaluated('const A = 1; const B = A * 2; let out = ""; { let A = 5; let r: rational = B; out = String(r); } out;')).toBe('2');
  expect(evaluated('const P = 0.5; const Q = P * 2; String(rational(Q));')).toBe('1');
  expect(evaluated('const K = 0.1; let out = ""; { const K = 0.5; let r: rational = K; out = String(r); } out;')).toBe('1/2');
});

test('the binding itself is untouched', () => {
  expect(evaluated('const K = 0.1; rational(K); String(K);')).toBe('0.1');
  expect(evaluated('const K = 0.1; rational(K); String(K * 3);')).toBe('0.30000000000000004');
});

test('in comparisons and arithmetic too', () => {
  expect(evaluated('const K = 0.1; String(rational(1, 10) == K);')).toBe('true');
  expect(evaluated("const D = 0.1; String(decimal128.parse('0.1') === D);")).toBe('true');
  expect(evaluated('const C = 3; String((3 := complex64) == C);')).toBe('true');
  expect(evaluated('const K2 = 0.5; String(rational(1, 2) + K2);')).toBe('1');
});

test('what the rule excludes, and what it keeps refusing', () => {
  // A `let` is a value; an annotation excludes a `const`.
  expect(evaluated('let L = 0.1; String(rational(L));')).toBe('3602879701896397/36028797018963968');
  expect(evaluated('const A2: number = 0.1; String(rational(A2));')).toBe('3602879701896397/36028797018963968');
  expectThrownKind('let L = 0.5; rational(1, 2) == L;', 'TypeError');
  // Judged exactly as the written literal is.
  expectStaticTypeError('const k = 300; let a: uint8 = k;');
  expect(evaluated('const k = 3; let a: uint8 = k; String(a);')).toBe('3');
});
