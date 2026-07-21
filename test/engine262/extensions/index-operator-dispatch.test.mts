import { test, expect } from 'vitest';
import { evaluated, runFlagOff } from '../readme/harness.mts';

/**
 * User-defined index operator dispatch (read direction).
 *
 * A class may declare an index operator `operator[](i)`. A numeric index access
 * `m[i]` on an instance of such a class dispatches to that operator, called with
 * the index value, in place of the ordinary property read (README
 * "Multidimensional and Jagged Array Support Via User-defined Index Operators",
 * spec sec-class-operators). The index may be a plain number or a typed numeric
 * value. A non-numeric key, such as a string method name, is left to ordinary
 * property access, so an index-defining class keeps its methods reachable. A class
 * with no index operator is unaffected, and the dispatch is gated on the feature.
 *
 * Deferred and not covered here: the write direction (`set operator[]`), the
 * multi-argument form `m[x, y]` (which needs the comma-index grammar of the ranges
 * extension), and overload resolution among several index operators.
 */

// -- Read dispatch -------------------------------------------------------------
test('a numeric index access dispatches to the class index operator', () => {
  expect(evaluated('class M { operator[](i) { return 42; } } let m = new M(); String(m[0]);')).toBe('42');
});

test('the index value is passed to the operator', () => {
  expect(evaluated('class M { operator[](i) { return i * 10; } } let m = new M(); String(m[5]);')).toBe('50');
});

test('a typed numeric index dispatches as well', () => {
  expect(evaluated('class M { operator[](i: uint32) { return (99 := uint32); } } let m = new M(); String(m[(0 := uint32)]);')).toBe('99');
});

test('the operator body sees this', () => {
  expect(evaluated('class M { constructor() { this.d = [10, 20, 30]; } operator[](i) { return this.d[i]; } } let m = new M(); String(m[2]);')).toBe('30');
});

// -- The operator is inherited -------------------------------------------------
test('an index operator declared on a base class dispatches for a subclass instance', () => {
  expect(evaluated('class B { operator[](i) { return i + 1; } } class D extends B {} let d = new D(); String(d[4]);')).toBe('5');
});

// -- Non-numeric keys fall through ---------------------------------------------
test('a string key reaches an ordinary method, not the index operator', () => {
  expect(evaluated('class M { operator[](i) { return 1; } foo() { return 7; } } let m = new M(); String(m["foo"]());')).toBe('7');
});

test('a computed string key falls through to ordinary property access', () => {
  expect(evaluated('class M { operator[](i) { return 1; } constructor() { this.name = "x"; } } let m = new M(); let k = "name"; m[k];')).toBe('x');
});

// -- Classes without an index operator -----------------------------------------
test('a class with no index operator performs an ordinary numeric property read', () => {
  expect(evaluated('class M { constructor() { this[0] = 99; } } let m = new M(); String(m[0]);')).toBe('99');
});

// -- Feature off ---------------------------------------------------------------
test('with the feature off, a numeric access is an ordinary property read', () => {
  // without the feature there are no index operators; a plain object read is itself
  const c = runFlagOff('let o = { 0: 7 }; String(o[0]);') as { Type: string, Value: { stringValue?(): string } };
  expect(c.Type).toBe('normal');
  expect(c.Value.stringValue?.()).toBe('7');
});
