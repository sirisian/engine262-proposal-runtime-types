import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

// #sec-anchored-contributions: excluding a fresh accessor from eager inferred
// object admission applies to its established computed key as well as to a
// literal name, so checking a function's published result against the object
// literal it returns calls none of that literal's getters.

test('a returned literal\'s named getter is not called to check the result', () => {
  expect(evaluated(`let n = 0; const make = (v: uint8) => ({ get x() { n++; return v; }, y: v });
    make((1 := uint8)); String(n);`)).toBe('0');
});

test('a returned literal\'s computed getter is not called either', () => {
  expect(evaluated(`let n = 0; const make = (v: uint8) => ({ get [Symbol.iterator]() { n++; return undefined; }, next() { return { done: true, value: v }; } });
    make((1 := uint8)); String(n);`)).toBe('0');
});

test('a single return statement is the same as a concise body', () => {
  expect(evaluated(`let n = 0; function make(v: uint8) { return { get x() { n++; return v; }, y: v }; }
    make((1 := uint8)); String(n);`)).toBe('0');
});
