import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * ONE RULE FOR AN INFERRED BINDING, both sides.
 *
 * A binding is the JOIN of what every argument contributes, and the constraint
 * admits a literal that fits it as `sec-literal-propagation` admits one in any
 * other typed position. Before this, a parameter in two positions was fixed by
 * whichever argument came first, so `add(200, 100)` was refused - `100` against
 * the `200` the first argument fixed.
 */

test('two literals to one parameter join and fit the constraint', () => {
  expect(evaluated('function add<T: uint8>(a: T, b: T): T { return a; } `${add(200, 100)}`;')).toBe('200');
  expect(evaluated('function pair<K: "a" | "b">(x: K, y: K): K { return x; } `${pair("a", "b")}`;')).toBe('a');
});

test('a literal that does not fit is still refused, joined or alone', () => {
  // The join admits a union of FITTING literals; it must not admit one that
  // overflows, or the constraint would mean nothing.
  expectThrown('function add<T: uint8>(a: T, b: T): T { return a; } add(200, 300);', 'is not assignable to "uint.<8>"');
  expectThrown('function f<T: uint8>(x: T): T { return x; } f(300);', 'is not in the range of "uint.<8>"');
});

test('a single argument is unchanged', () => {
  expect(evaluated('function f<T: uint8>(x: T): T { return x; } `${f(200)}`;')).toBe('200');
  expect(evaluated('function id<T>(x: T): T { return x; } `${Reflect.typeOf(id(200))}`;')).toBe('number');
});

test('a context seed still wins over an argument', () => {
  // The seed is a different RUNG of the ladder - "a call binds from its context
  // BEFORE its arguments" - and joining with it broke nine tests. Only
  // same-rung contributions join.
  expect(evaluated('function f<T>(x: T): T { return x; } let u: uint8 = f(1 := uint8); `${u}`;')).toBe('1');
});
