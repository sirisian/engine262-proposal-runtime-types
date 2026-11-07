import { test, expect } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

// OQ1: a String's `length` is a Number, typed `number`. The run-time value is
// unchanged; a sized integer against it, or stored from it, is refused
// statically and written as a conversion, instead of throwing at run time.

test('a String\'s length is a number', () => {
  expect(ok("const s: string = 'abc'; const n: number = s.length;")).toBe(true);
  expectStaticTypeError("const s: string = 'abc'; const t: string = s.length;");
});

test('a sized integer against it, or stored from it, is a conversion', () => {
  expectStaticTypeError("const s: string = 'abc'; let x: uint64 = s.length;");
  expectStaticTypeError("const s: string = 'abc'; let i: uint64 = 0; i < s.length;");
  expect(evaluated("const s: string = 'abc'; let x: uint64 = (s.length := uint64); String(x);")).toBe('3');
});

test('a Number counter against it is unchanged', () => {
  expect(evaluated("const s: string = 'abc'; let n = 0; for (let i = 0; i < s.length; i++) n++; String(n);")).toBe('3');
});

test('a function\'s length is a number too', () => {
  expectStaticTypeError('function f(a, b) {} const t: string = f.length;');
});
