import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown } from '../harness.mts';

/**
 * #sec-static-type-of-an-expression: in checked code a `let` or `var`
 * initialized with a numeric literal takes the one numeric type its relational
 * and equality tests meet, as though annotated with it. Only tests decide; a
 * test against `number`, `bigint`, a literal, a constant, a value generic, a
 * union or a type parameter decides nothing; two types are an error at the
 * declaration; a scope a direct eval or `with` could write infers nothing.
 */
const A = 'let a: [].<uint8> = [1, 2, 3]; let c = 0;';
const N = 'const N: uint64 = 3; let c = 0;';
const counted = (setup: string, loop: string) => evaluated(`${setup} ${loop} { c += 1; if (c > 9) break; } String(c);`);

test('every loop shape against a typed bound runs with a typed counter', () => {
  expect(counted(A, 'for (let i = 0; i < a.length; ++i)')).toBe('3');
  expect(counted(N, 'for (let i = 0; i < N; ++i)')).toBe('3');
  expect(counted(N, 'for (let i = 0; i < N; i++)')).toBe('3');
  expect(counted(N, 'for (let i = 0; i < N; i += 1)')).toBe('3');
  expect(counted(N, 'for (let i = 0; i < N; i = i + 1)')).toBe('3');
  expect(counted(N, 'for (let i = 0; i < N; i += 2)')).toBe('2');
  expect(counted(N, 'for (let i = 0; i <= N; ++i)')).toBe('4');
  expect(counted(N, 'for (let i = 0; N > i; ++i)')).toBe('3');
  expect(evaluated(`${N} let i = 0; while (i < N) { ++i; c += 1; } String(c);`)).toBe('3');
  expect(evaluated(`${N} let i = 0; do { ++i; c += 1; } while (i < N); String(c);`)).toBe('3');
  expect(counted(A, 'for (let i = 0, len := a.length; i < len; ++i)')).toBe('3');
  expect(evaluated(`${A} for (let i = 0; i < a.length; ++i) for (let j = 0; j < a.length; ++j) c += 1; String(c);`)).toBe('9');
  expect(evaluated(`${N} let t = ''; for (let i = 0; i < N; ++i) { t = String(i is uint64); } t;`)).toBe('true');
});

test('the bound decides the type, whatever supplies it', () => {
  expect(evaluated('function count(): uint32 { return 3; } let t = ""; for (let i = 0; i < count(); ++i) { t = String(i is uint32); } t;')).toBe('true');
  expect(evaluated('function f(n: uint64) { let c = 0; for (let i = 0; i < n; ++i) c += 1; return c; } String(f(3));')).toBe('3');
  expect(evaluated('function f(n: uint64 | null) { let c = 0; if (n !== null) { for (let i = 0; i < n; ++i) c += 1; } return c; } String(f(3));')).toBe('3');
  expect(evaluated('const S: int32 = 3; let t = ""; for (let i = 0; i < S; ++i) { t = String(i is int32); } t;')).toBe('true');
  expect(evaluated('const F: float64 = 2.5; let c = 0; for (let i = 0; i < F; i += 1) c += 1; String(c);')).toBe('3');
});

test('equality tests decide too, so an equality loop ends', () => {
  expect(counted(N, 'for (let i = 0; i !== N; ++i)')).toBe('3');
  expect(evaluated('let a: [].<uint8> = [1, 2, 3]; let n = 3; String(a.length === n);')).toBe('true');
  expect(evaluated('let a: [].<uint8> = [1, 2, 3]; let n = Number("3"); String(a.length === n);')).toBe('false');
});

test('a bound that is not one proposal numeric type decides nothing', () => {
  const isNumber = (setup: string, bound: string) => evaluated(`${setup} let t = ''; for (let i = 0; i < ${bound}; ++i) { t = typeof i + ' ' + String(i is number); } t;`);
  expect(isNumber('const u = new Uint8Array(2);', 'u.length')).toBe('number true');
  expect(isNumber('', "'ab'.length")).toBe('number true');
  expect(isNumber('const n = 2;', 'n')).toBe('number true');
  expect(isNumber('const m: number = 2;', 'm')).toBe('number true');
  expect(evaluated('const B: bigint = 2n; let t = ""; for (let i = 0; i < B; ++i) { t = typeof i; } t;')).toBe('number');
  expect(evaluated('function g<M: uint32>() { let c = 0; for (let i = 0; i < M; ++i) c += 1; return c; } String(g.<2>());')).toBe('2');
  expect(evaluated('let a: [].<uint8> = [1, 2]; let t = ""; for (const [i] of a.entries()) { t = typeof i + " " + String(i is uint64); } t;')).toBe('number false');
});

test('tests meeting two types are refused at the declaration', () => {
  expectStaticTypeError('let a: [].<uint8> = [1, 2, 3]; const k: uint32 = 2; for (let i = 0; i < a.length && i < k; ++i) { }');
  // A test against `number` decides nothing, so it meets the decided type as
  // any other mixed comparison does.
  expectStaticTypeError('let a: [].<uint8> = [1, 2, 3]; const m: number = 2; var i = 0; for (; i < a.length; i++) { } for (i = 0; i < m; i++) { }');
});

test('every write must agree with the inferred type', () => {
  const S = 'let a: [].<uint8> = [1, 2, 3]; let i = 0; for (; i < a.length; ++i) { }';
  expectStaticTypeError(`${S} const m: number = 2; i = m;`);
  expectStaticTypeError(`${S} i = 'x';`);
  expectStaticTypeError(`${S} i = -1;`);
  expectStaticTypeError(`${S} i += 0.5;`);
  expectStaticTypeError('let a: [].<uint8> = [1, 2, 3]; let i = 0; const f = () => i < a.length; const g = () => { i = 0.5; };');
  expect(evaluated(`${S} let q: any = 2; i = q; String(i is uint64);`)).toBe('true');
  expectThrown(`${S} let q: any = 'x'; i = q;`, 'conversion source');
});

test('arithmetic and stores decide nothing', () => {
  expectThrown('let a: [].<uint8> = [1, 2, 3]; let sum = 0; for (let i = 0; i < a.length; ++i) { sum += a[i]; }', 'do not mix');
  expect(evaluated('let a: [].<uint8> = [1, 2, 3]; let idx = -1; for (let i = 0; i < a.length; ++i) { if (a[i] === 2) idx = i; } String(idx);')).toBe('1');
  expect(evaluated('let a: [].<uint8> = [1, 2, 3]; let max = 0; for (let i = 0; i < a.length; ++i) { if (a[i] > max) max = a[i]; } String(max) + " " + String(max is uint8);')).toBe('3 true');
  expect(evaluated('let a: [].<uint8> = [1, 2, 3]; let t = ""; for (let i = 0, j = 0; i < a.length; i++, j++) { t = typeof j + " " + String(j is number); } t;')).toBe('number true');
});

test('declaration forms and dynamic scope', () => {
  expect(evaluated('let a: [].<uint8> = [1, 2, 3]; let c = 0; var i = 0; for (; i < a.length; i++) c += 1; String(c) + " " + String(i is uint64);')).toBe('3 true');
  expect(evaluated('let a: [].<uint8> = [1, 2, 3]; let t = ""; for (var i = 0; i < a.length; i++) { t = String(i is uint64); } t;')).toBe('true');
  expect(evaluated('let a: [].<uint8> = [1, 2, 3]; let i = 0; const f = () => i < a.length; String(f()) + " " + String(i is uint64);')).toBe('true true');
  expect(evaluated('let a: [].<uint8> = [1, 2, 3]; let i = 0; eval(""); i = 0.5; String(i);')).toBe('0.5');
  expectStaticTypeError('let a: [].<uint8> = [1, 2, 3]; class C { i = 0; m() { return this.i < a.length; } }');
  expect(evaluated('let a: [].<uint8> = [1, 2, 3]; const i = 0; String(i < a.length);')).toBe('true');
});

test('the counter has its type\'s arithmetic, and the count-down idiom', () => {
  const S = 'let a: [].<uint8> = [1, 2, 3, 4]; let i = 0; while (i < a.length - 1) { ++i; }';
  expect(evaluated(`${S} String(i / 2) + " " + String(i - 5);`)).toBe('1 18446744073709551614');
  expectStaticTypeError(`${S} i + 0.5;`);
  expectStaticTypeError('let a: [].<uint8> = [1, 2, 3]; for (let i := a.length - 1; i >= 0; --i) { }');
  expect(evaluated('let a: [].<uint8> = [1, 2, 3]; let s = ""; for (let i = a.length; i > 0; --i) { s += String(a[i - 1]); } s;')).toBe('321');
});

test('code without types keeps its meaning', () => {
  expect(evaluated('let n = 3; let c = 0; let t = ""; for (let i = 0; i < n; ++i) { c += 1; t = typeof i; } t + c;')).toBe('number3');
});
