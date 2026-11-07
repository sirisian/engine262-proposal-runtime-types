import { test, expect } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

// #sec-typed-string-properties: a built-in member whose value is always a
// Number at run time is typed `number`, as a String's `length` is. A sized
// integer against it, or stored from it, is written as a conversion; the
// run-time value is unchanged.

test('a Map or Set without type arguments has a number size', () => {
  expect(ok('function f(m: Map) { const n: number = m.size; }')).toBe(true);
  expectStaticTypeError('function f(m: Map) { const t: string = m.size; }');
  expectStaticTypeError('function f(s: Set) { const t: string = s.size; }');
  expectStaticTypeError('function f(m: Map) { let x: uint32 = m.size; }');
  expect(evaluated('function f(m: Map) { return String(m.size); } f(new Map([[1, 2]]));')).toBe('1');
});

test('a Map or Set with type arguments keeps the index type for its size', () => {
  expect(ok('function f(m: Map.<string, uint8>) { const x: uint64 = m.size; }')).toBe(true);
  expectStaticTypeError('function f(m: Map.<string, uint8>) { const t: string = m.size; }');
});

test('an ArrayBuffer\'s byte lengths are numbers', () => {
  expectStaticTypeError('function f(b: ArrayBuffer) { const t: string = b.byteLength; }');
  expectStaticTypeError('function f(b: ArrayBuffer) { const t: string = b.maxByteLength; }');
  expectStaticTypeError('function f(b: ArrayBuffer) { let x: uint32 = b.byteLength; }');
  expect(evaluated('function f(b: ArrayBuffer) { let x: uint32 = (b.byteLength := uint32); return String(x); } f(new ArrayBuffer(8));')).toBe('8');
});

test('a DataView\'s byte length and offset are numbers', () => {
  expectStaticTypeError('function f(d: DataView) { const t: string = d.byteLength; }');
  expectStaticTypeError('function f(d: DataView) { const t: string = d.byteOffset; }');
  expect(evaluated('function f(d: DataView) { return String(d.byteOffset + d.byteLength); } f(new DataView(new ArrayBuffer(8), 2));')).toBe('8');
});

test('a Number counter against them is unchanged', () => {
  expect(evaluated('function f(b: ArrayBuffer) { let n = 0; for (let i = 0; i < b.byteLength; i++) n++; return String(n); } f(new ArrayBuffer(3));')).toBe('3');
});
