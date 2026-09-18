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
  // Static now: the constraint keeps the literal, so `300` is judged against
  // `uint8` at compile time rather than converted at the boundary.
  expectThrown('function f<T: uint8>(x: T): T { return x; } f(300);', '"300" is not assignable to "uint.<8>"');
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

test('an UNCONSTRAINED pack widens its elements, as a scalar does', () => {
  // The pack binds a tuple, and its elements follow the scalar rule: an
  // unconstrained parameter widens a literal to its base. Taking the arguments'
  // types unwidened gave `[1, 'a']`, so a builder over the pack produced a
  // return type of literals and a body returning anything else was refused
  // against `"1"`.
  expect(evaluated('function wrap<...Ts>(...xs: Ts): Ts { return xs; } `${Reflect.typeOf(wrap(1, "a"))}`;')).toBe('[].<number | string>');
  // A builder over the pack sees the widened elements, so a body building other
  // values from them still satisfies the declared return.
  expect(evaluated('class Box<T> { v: T; constructor(v: T) { this.v = v; } } '
    + 'function boxesOf(Ts) { return Reflect.makeType({ kind: "tuple", elements: Reflect.getReflection(Ts).elements.map((e) => { const t = e.type; return { type: type Box.<t> }; }) }); } '
    + 'function wrap<...Ts>(...xs: Ts): boxesOf(Ts) { return xs.map((x) => new Box(x)); } `${wrap(1, "a").length}`;')).toBe('2');
});

test('the checker binds from the call\'s context, as the run time does', () => {
  // "A call binds from its context before its arguments." The run time applied
  // that rung and the checker did not, so the two disagreed about what a call
  // in a typed position binds - visible once the checker's bindings are handed
  // over. The seed stands over the arguments because unification joins only
  // among argument contributions.
  expect(evaluated('function f<T>(x: T): T { return x; } const r: uint8 = f(1); `${Reflect.typeOf(r)}`;')).toBe('uint.<8>');
  // A stale or foreign context costs nothing: the argument decides where the
  // position requires nothing of the call.
  expect(evaluated('function f<T>(x: T): T { return x; } function g(): uint8 { f("s"); return (1 := uint8); } `${g()}`;')).toBe('1');
});
