// Rung one: a variadic parameter is BOUND FROM A CALL'S ARGUMENTS wherever a
// scalar parameter is
// (spec.emu #sec-variadic-parameters, #sec-inference-through-results) - through
// a rest parameter typed by it, a whole-tuple parameter, a written tuple
// pattern - with explicit arguments binding by the shared assignment.
import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

test('a bare type pack binds the tuple of a rest parameter\'s arguments (G1)', () => {
  expect(evaluated('function count<...Ts>(...xs: Ts): uint32 { return xs.length; } String(count(1, "a", true));')).toBe('3');
  expect(evaluated('function count<...Ts>(...xs: Ts): uint32 { return xs.length; } String(count());')).toBe('0');
});

test('a bounded type pack binds and its bound refuses (G2)', () => {
  expect(evaluated('function only<...Ts extends [].<string>>(...xs: Ts): uint32 { return xs.length; } String(only("a", "b"));')).toBe('2');
  expectThrown('function only<...Ts extends [].<string>>(...xs: Ts): uint32 { return xs.length; } only("a", 1);', 'not assignable');
});

test('a VALUE pack binds from constant arguments and reads in the body (G3, the join idiom)', () => {
  expect(evaluated('function j<...Ps: [].<string>>(sep: string, ...parts: Ps): uint32 { return Ps.length; } String(j("-", "a", "b"));')).toBe('2');
  expect(evaluated('function j<...Ps: [].<string>>(sep: string, ...parts: Ps): string { return Ps[1]; } j("-", "a", "b");')).toBe('b');
});

test('a whole-tuple parameter binds a pack from one tuple (G4)', () => {
  expect(evaluated('function w<...Ts>(t: Ts): uint32 { return t.length; } String(w([1, "a"]));')).toBe('2');
});

test('a written tuple pattern binds a pack by the assignment rule (G5, nested)', () => {
  expect(evaluated('function pairUp<T, ...Rest>(p: [T, ...Rest]): uint32 { return p.length; } String(pairUp([1, "a", true]));')).toBe('3');
});

test('explicit type arguments bind a pack, and the arguments are checked against its elements (G6)', () => {
  expect(evaluated('function count<...Ts>(...xs: Ts): uint32 { return xs.length; } String(count.<uint8, string>(1, "a"));')).toBe('2');
  expectThrown('function count<...Ts>(...xs: Ts): uint32 { return xs.length; } count.<uint8, string>("a", 1);', 'not assignable');
  expect(evaluated('type Two = [uint8, string]; function count<...Ts>(...xs: Ts): uint32 { return xs.length; } String(count.<...Two>(1, "a"));')).toBe('2');
});

test('a scalar parameter over an array rest keeps its element binding (regression guard)', () => {
  expect(evaluated('function all<T>(...xs: [].<T>): uint32 { return xs.length; } String(all(1, 2, 3));')).toBe('3');
});
