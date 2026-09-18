import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * ecmascript-types README, Reference Classes: a class declared `reference`,
 * `sealed` or `abstract` is a REFERENCE TYPE. Its instances are held and passed
 * by reference, `===` compares references, a field of its type is a pointer,
 * and it closes a recursive cycle.
 *
 * `sealed` and `abstract` were already specified this way and neither was
 * implemented: a sealed class laid out inline and copied, and `sealed class Node
 * { next: Node; }` was refused as an infinite layout. `reference` is the
 * modifier an open, non-abstract class needs, since sealing itself to become a
 * reference type refuses the extension it exists to offer.
 */

test('the reference modifier parses and its instances alias', () => {
  expect(evaluated(`reference class R { x: uint8 = 1; }
    const a = new R(); const b = a; b.x = 9; String(a.x);`)).toBe('9');
});

test('a value type class still copies', () => {
  expect(evaluated(`class V { x: uint8 = 1; }
    const a = new V(); const b = a; b.x = 9; String(a.x);`)).toBe('1');
});

test('=== compares references for a reference class and fields for a value class', () => {
  expect(evaluated(`reference class R { x: uint8 = 1; }
    class V { x: uint8 = 1; }
    (new R() === new R()) + '/' + (new V() === new V());`)).toBe('false/true');
});

test('a field of a reference type is a pointer', () => {
  expect(evaluated(`reference class R { x: uint8 = 1; }
    class H { r: R | null = null; }
    String(H.byteLength);`)).toBe('8');
});

test('a reference class closes a recursive cycle', () => {
  expect(evaluated(`reference class Node { v: uint32 = 0; next: Node | null = null; }
    const a = new Node(); const b = new Node(); a.next = b;
    String(a.next === b);`)).toBe('true');
});

test('sealed and abstract are reference types too', () => {
  expect(evaluated(`sealed class A { x: uint8 = 1; }
    const a = new A(); const b = a; b.x = 9; String(a.x);`)).toBe('9');
  expect(evaluated(`sealed class Node { v: uint32 = 0; next: Node | null = null; } 'ok';`)).toBe('ok');
});

test('the kind is inherited, so a subclass reached through one aliases', () => {
  // "an abstract class is never a value type and neither is a subclass reached
  // through it". Reading the modifiers of the subclass alone missed this, and a
  // polymorphic field copied the value it was given.
  expect(evaluated(`abstract class S { abstract v(): uint8; }
    class C extends S { x: uint8 = 1; v(): uint8 { return this.x; } }
    class H { s: S | null = null; }
    const src = new C(); const h = new H(); h.s = src; src.x = 7;
    String(h.s?.v());`)).toBe('7');
  expect(evaluated(`reference class Widget { w: uint8 = 1; }
    class Panel extends Widget { extra: uint32 = 42; }
    const a = new Panel(); const b = a; b.extra = 7; String(a.extra);`)).toBe('7');
});

test('a subclass of a value type class keeps copying', () => {
  expect(evaluated(`class Widget { w: uint8 = 1; }
    class Panel extends Widget { extra: uint32 = 42; }
    const a = new Panel(); const b = a; b.extra = 7; String(a.extra);`)).toBe('42');
});

test('a reference class has an identity, so it can be held weakly', () => {
  // The value-type refusal is about having no identity to observe. A reference
  // class has one. The static and runtime gates must agree: `new WeakRef(r)` is
  // checked before the program runs and `weakMap.set(r, v)` while it runs.
  expect(evaluated(`reference class R { x: uint8 = 1; }
    new WeakRef(new R()); new WeakMap().set(new R(), 1); 'held';`)).toBe('held');
});

test('a value type class still cannot be held weakly', () => {
  expectStaticTypeError('class V { x: uint8 = 1; } new WeakRef(new V());');
});

test('an array of a reference type holds references', () => {
  expect(evaluated(`reference class R { x: uint8 = 1; }
    const a: [4].<R|null>;
    a.byteLength + '/' + String(a[0]);`)).toBe('32/null');
});
