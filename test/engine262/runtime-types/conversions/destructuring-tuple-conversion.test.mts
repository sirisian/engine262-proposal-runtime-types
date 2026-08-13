import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// sec-user-defined-conversions: "a conversion to a tuple type is what makes a
// class destructurable". The design shows this exact code under implicit casts,
// and it threw "[object Object] is not iterable".
//
// The cause is NOT a missing contextual type, which an earlier draft of the
// specification and of this work both claimed: a destructuring pattern cannot
// be annotated at all - `const [x]: [number] = a` is a Syntax Error - so there
// is no contextual type to miss. Array destructuring is defined over the
// ITERATION protocol, and the class has no `[Symbol.iterator]`. The conversion
// is consulted where that iteration would otherwise fail.

const A = 'class A { x = 1; y = 2; z = "s"; operator [number, number, string]() { return [this.x, this.y, this.z]; } } ';

test('the design\u2019s own example runs', () => {
  expect(evaluated(`${A}const a = new A(); const [x, y, z] = a; String(x) + "," + String(y) + "," + String(z);`)).toBe('1,2,s');
});

test('every destructuring position', () => {
  // Seven positions failed with the identical error, and they route through two
  // sites - a binding pattern and an assignment pattern. Both are asserted, or
  // `const [x] = a` and `[x] = a` could disagree.
  expect(evaluated(`${A}const a = new A(); let x, y, z; [x, y, z] = a; String(x);`)).toBe('1');
  expect(evaluated(`${A}function f([x, y, z]) { return x; } String(f(new A()));`)).toBe('1');
  expect(evaluated(`${A}const f = ([x]) => x; String(f(new A()));`)).toBe('1');
  expect(evaluated(`${A}let s = ""; for (const [x] of [new A()]) { s = String(x); } s;`)).toBe('1');
  expect(evaluated(`${A}let s = ""; try { throw new A(); } catch ([x]) { s = String(x); } s;`)).toBe('1');
  expect(evaluated(`${A}function f([x] = new A()) { return x; } String(f());`)).toBe('1');
});

test('iteration wins over the conversion', () => {
  // A conversion says how the value CONVERTS, not that it is a sequence. A
  // class declaring both keeps its iterator - the conversion is reached only
  // where iteration would throw, so nothing that works today changes.
  expect(evaluated('class C { *[Symbol.iterator]() { yield 99; } operator [number, number]() { return [1, 2]; } } const [p] = new C(); String(p);')).toBe('99');
});

test('the conversion runs once, not once per binding', () => {
  const counted = 'let n = 0; class M { operator [number, number, number]() { n = n + 1; return [1, 2, 3]; } } '
    + 'const [a, b, c] = new M(); String(n);';
  expect(evaluated(counted)).toBe('1');
});

test('arity follows the ordinary destructuring rules', () => {
  // Fewer names than the tuple takes a prefix; more names than the tuple leaves
  // the extras undefined, as for a short array.
  expect(evaluated(`${A}const [x] = new A(); String(x);`)).toBe('1');
  expect(evaluated(`${A}const [x, y, z, w] = new A(); String(w);`)).toBe('undefined');
});

test('nothing else changes', () => {
  expect(evaluated('const [x, y] = [1, 2]; String(x);')).toBe('1');
  expect(evaluated('const [a, b] = "hi"; a + b;')).toBe('hi');
  expect(evaluated('const [x] = new Set([5]); String(x);')).toBe('5');
  // A class with neither an iterator nor a conversion still throws.
  expectThrown('class N { } const [x] = new N();');
});
