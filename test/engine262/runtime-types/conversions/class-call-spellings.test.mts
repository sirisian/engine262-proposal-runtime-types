import { expect, test } from 'vitest';
import { evaluated, expectThrown, observeScript } from '../harness.mts';

/**
 * Question AI, AI1: a call on a typed class with one argument converts the argument whatever spells
 * the class, and `new` of an alias of a class constructs the class.
 *
 * AE1 made `V(x)` the conversion `x := V`. The same type spelled another way behaved otherwise:
 * `type W = V; W({ x: 300 })` threw when run, while `{ x: 300 } := W` converted; `Box.<uint8>(x)`
 * was refused before running, while `{ v: 300 } := Box.<uint8>` converted; `V?.(x)` was refused,
 * while `uint8?.(300)` converted; and `type W = V; new W()` threw "is not a constructor". Every
 * spelling of `uint8` converts the same way, and every spelling of a class now does too. The
 * constructor's own [[Call]] is unchanged, so `V.call(undefined, x)` and `xs.map(V)` still throw.
 */

const V = 'class V { x: uint8 = 0; }';
const BOX = 'class Box<T: type> { v: T; }';

test('a type alias of a typed class converts as the class does', () => {
  expect(evaluated(`${V} type W = V; String(W({ x: 300 }).x) + String(W({ x: 300 }) instanceof V);`)).toBe('44true');
  expect(evaluated(`${V} type W = V; String(({ x: 300 } := W).x);`)).toBe('44');
  expect(evaluated('class M { x: float32; constructor(x: float32) { this.x = x; } } type W = M; String(W(5).x);')).toBe('5');
  // The argument is checked as the operand of `:=` is, and the call has the class's type.
  expect(observeScript(`${V} type W = V; W({ x: 1, z: 2 });`)).toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-explicit-conversion' } });
  expect(observeScript(`${V} type W = V; const s: string = W({ x: 1 });`)).toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-assignability' } });
});

test('an application of a generic typed class converts, and so does an alias of one', () => {
  expect(evaluated(`${BOX} String(Box.<uint8>({ v: 300 }).v);`)).toBe('44');
  expect(evaluated(`${BOX} const B8 = Box.<uint8>; String(B8({ v: 300 }).v);`)).toBe('44');
  expect(evaluated(`${BOX} type B8 = Box.<uint8>; String(B8({ v: 300 }).v) + String(B8({ v: 1 }) instanceof Box);`)).toBe('44true');
  // The alias of an application converts with `:=` too; its record named no constructor.
  expect(evaluated(`${BOX} type B8 = Box.<uint8>; String(({ v: 300 } := B8).v);`)).toBe('44');
  expect(observeScript(`${BOX} const s: string = Box.<uint8>({ v: 1 });`)).toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-assignability' } });
  // The family itself names no one class, and a call on it is refused as before.
  expect(observeScript(`${BOX} Box({ v: 1 });`)).toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-declared-call' } });
});

test('an optional call on a typed class converts', () => {
  expect(evaluated(`${V} String(V?.({ x: 300 }).x);`)).toBe('44');
  expect(evaluated(`${V} const W = V; String(W?.({ x: 300 }).x);`)).toBe('44');
  expect(evaluated(`${V} type W = V; String(W?.({ x: 300 }).x);`)).toBe('44');
  expect(evaluated(`${V} const W: any = V; String(W?.({ x: 300 }).x);`)).toBe('44');
});

test('new of an alias of a class constructs the class', () => {
  expect(evaluated(`${V} type W = V; const w = new W(); String(w.x) + String(w instanceof V);`)).toBe('0true');
  expect(evaluated(`${BOX} type B8 = Box.<uint8>; const b = new B8(); String(b.v) + String(b instanceof Box);`)).toBe('0true');
  expect(evaluated('class C { k = 1; } type W = C; String(new W().k);')).toBe('1');
  expect(observeScript(`${V} type W = V; const s: string = new W();`)).toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-assignability' } });
});

test('the constructor\'s [[Call]] is unchanged', () => {
  expectThrown(`${V} V.call(undefined, { x: 1 });`, 'cannot be invoked without new');
  expectThrown(`${V} [{ x: 1 }].map(V);`, 'cannot be invoked without new');
  expect(observeScript(`${V} V();`)).toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-declared-call' } });
});
