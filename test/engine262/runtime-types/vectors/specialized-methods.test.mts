import { expect, test } from 'vitest';
import { evaluated, expectEarlyError, expectThrownKind } from '../harness.mts';

const vector = 'let v: float32x4 = float32x4(1, 2, 3, 4);';

test.each([
  'v.lane.<-1>()', 'v.lane.<1.5>()', 'v.withLane.<4>(1)',
  'v.swizzle.<0, 4>()', 'v.shuffle.<0, 8>(v)',
  'v.withLane.<0>("s")', 'v.shuffle.<0>(int32x4(1, 2, 3, 4))',
  'v["lane"].<4>()', '(v.lane).<4>()',
])('known SIMD specialization rejects %s', (call) => {
  expectEarlyError(`${vector} ${call};`, 'StaticTypeError');
  expectEarlyError(`function unused() { ${vector} ${call}; }`, 'StaticTypeError');
});

test('constant arguments, property spelling, and result types agree', () => {
  expect(evaluated(`${vector} const K = 1; String(v.lane.<K>());`)).toBe('2');
  expect(evaluated(`${vector} String(v["lane"].<1>());`)).toBe('2');
  expect(evaluated(`${vector} String((v.lane).<1>());`)).toBe('2');
  expect(evaluated(`${vector} String((v.lane.<1>)());`)).toBe('2');
  expect(evaluated(`${vector} const out: vector.<float32, 2> = v.swizzle.<3, 0>(); String(out.lane.<0>());`)).toBe('4');
  expectEarlyError(`${vector} const K = 4; v.lane.<K>();`, 'StaticTypeError');
  expectEarlyError(`${vector} const x: string = v.lane.<0>();`, 'StaticTypeError');
});

test('a lane value parameter shadows an outer constant', () => {
  expect(evaluated('const I = 0; function f<I: uint32>(v: float32x4): float32 { return v.lane.<I>(); } String(f.<1>(float32x4(1, 2, 3, 4)));')).toBe('2');
});

test('spread indices use the expanded lane count and bounds', () => {
  expect(evaluated(`${vector} type Pair = [0, 1]; const r: vector.<float32, 2> = v.swizzle.<...Pair>(); String(r.lane.<1>());`)).toBe('2');
  expectEarlyError(`${vector} type Pair = [0, 4]; function unused() { v.swizzle.<...Pair>(); }`, 'StaticTypeError');
  expectThrownKind(`${vector} let unknown: any = v; type Pair = [0, 4]; unknown.swizzle.<...Pair>();`, 'TypeError');
});

test('specialized calls evaluate vector and ordinary receivers once', () => {
  expect(evaluated('let count = 0; function f(): float32x4 { count++; return float32x4(1, 2, 3, 4); } f()["lane"].<1>(); String(count);')).toBe('1');
  for (const call of ['f().lane.<uint8>()', 'f()["lane"].<uint8>()', '(f().lane).<uint8>()', '(f().lane.<uint8>)()']) {
    expect(evaluated(`let count = 0; function f() { count++; return { lane<T>(): number { return 1; } }; } ${call}; String(count);`)).toBe('1');
  }
});

test('dynamic indexing and any receivers keep their runtime checks', () => {
  expectThrownKind(`${vector} v[4];`, 'RangeError');
  expectThrownKind(`${vector} let unknown: any = v; unknown.withLane.<4>(1);`, 'TypeError');
});
