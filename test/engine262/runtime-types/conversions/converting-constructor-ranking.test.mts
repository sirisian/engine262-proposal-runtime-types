import { test, expect } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * A conversion through one of several converting constructors (#sec-user-defined-conversions).
 *
 * "Where a class declares several one-parameter constructors, each is a converting constructor
 * and the conversion resolves by the argument's type." The conversion is the construction
 * `new T(v)`, so it is decided as a construction is: by ordinary overload resolution, and for a
 * literal by the literal ranking (#sec-literal-overload-ranking).
 *
 * The checker compared the parameter types as types only, found neither `float32` nor `uint32`
 * the more specific, and reported `let t: MyType = 1` as ambiguous. The same line with the
 * value arriving untyped ran, and selected what `new MyType(1)` selects.
 */

const MyType = 'value class MyType { x: float32; constructor(x: float32) { this.x = x; } constructor(y: uint32) { this.x = float32(y) * 2; } } ';
const Widths = 'value class M { x: float32 = 0; constructor(a: uint8) { this.x = 1; } constructor(b: uint16) { this.x = 2; } } ';
const Exact = 'value class Q { x: float32 = 0; constructor(a: float32) { this.x = 1; } constructor(b: number) { this.x = 2; } } ';

test('a literal selects by the literal ranking, at every boundary', () => {
  expect(evaluated(`${MyType}let t: MyType = 1; String(t.x);`)).toBe('1');
  expect(evaluated(`${MyType}function g(t: MyType) { return t.x; } String(g(1));`)).toBe('1');
  expect(evaluated(`${MyType}function g(): MyType { return 1; } String(g().x);`)).toBe('1');
  expect(evaluated(`${MyType}let t: [3].<MyType> = [1, 1, 1]; String(t[2].x);`)).toBe('1');
  expect(evaluated(`${MyType}let t = new [5].<MyType>().fill(1); String(t[4].x);`)).toBe('1');
  // A wider width before a narrower one, and `number` for a literal that is one.
  expect(evaluated(`${Widths}let t: M = 1; String(t.x);`)).toBe('2');
  expect(evaluated(`${Exact}let q: Q = 1; String(q.x);`)).toBe('2');
});

test('the conversion, the construction and the run time select the same constructor', () => {
  for (const [declarations, name] of [[MyType, 'MyType'], [Widths, 'M'], [Exact, 'Q']] as const) {
    const converted = evaluated(`${declarations}let t: ${name} = 1; String(t.x);`);
    expect(evaluated(`${declarations}String(new ${name}(1).x);`), name).toBe(converted);
    expect(evaluated(`${declarations}function f(v) { let t: ${name} = v; return t.x; } String(f(1));`), name).toBe(converted);
  }
});

test('a typed argument selects by its type, as before', () => {
  expect(evaluated(`${MyType}let u: MyType = uint32(1); String(u.x);`)).toBe('2');
  expect(evaluated(`${MyType}let t: MyType = 1.5; String(t.x);`)).toBe('1.5');
  expect(evaluated('class A { n: uint8 = 0; } class B extends A { m: uint8 = 0; } value class M { x: uint8 = 0; constructor(a: A) { this.x = 1; } constructor(b: B) { this.x = 2; } } let m: M = new B(); String(m.x);'))
    .toBe('2');
});

test('two inbound conversion operators that both apply are still ambiguous, as they are when run', () => {
  const N = 'value class N { x: float32 = 0; operator N(v: float32) { const n = new N(); n.x = 1; return n; } operator N(v: uint32) { const n = new N(); n.x = 2; return n; } } ';
  expect(observeScript(`${N}let t: N = 1;`)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-ambiguous-conversion' } });
  expect(evaluated(`${N}let t: N = 1.5; String(t.x);`)).toBe('1');
});
