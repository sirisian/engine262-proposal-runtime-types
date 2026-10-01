import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

// #sec-sealed-classes: in a `switch` whose discriminant's Static Type is a sealed class,
// each label is an `instanceof` test evaluated in source order. Any other `switch`
// keeps strict equality.

test("selects by instanceof: AAAB", () => {
  expect(evaluated("sealed abstract class S {} class A extends S {} class AA extends A {} class B extends S {} class C {} function f(s: S) { switch (s) { case AA: return 'AA'; case A: return 'A'; case B: return 'B'; } } f(new AA()) + f(new A()) + f(new B());")).toBe("AAAB");
});

test("selects by instanceof: UT", () => {
  expect(evaluated("sealed class T {} class U extends T {} function f(t: T) { switch (t) { case U: return 'U'; } return 'T'; } f(new U()) + f(new T());")).toBe("UT");
});

test("selects by instanceof: ne", () => {
  expect(evaluated("class P {} function f(p: P) { switch (p) { case P: return 'eq'; } return 'ne'; } f(new P());")).toBe("ne");
});
