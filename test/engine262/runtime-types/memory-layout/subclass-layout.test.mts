import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * A subclass that declares no fields of its own.
 *
 * `#sec-typed-classes` defines a class as typed "when at least one of its public
 * or private fields, declared or inherited, carries a type annotation". The
 * engine read "its" as "the ones it declares", so `class X extends V { }` was not
 * typed and got no layout - and, more seriously, its instances stayed EXTENSIBLE
 * while its base's were not, so a subclass weakened a guarantee its base makes
 * and the weaker object passed as the base.
 *
 * The layout is the visible symptom; the substitutability is why it was fixed.
 */

const V = 'class V { x: float32 = 0; y: float32 = 0; z: float32 = 0; } ';

test('a fieldless subclass has its base\'s layout', () => {
  expect(evaluated(`${V} class X extends V { } String((type X).hasLayout);`)).toBe('true');
  // The same number, because the subclass adds nothing. A different number here
  // would mean the base's fields had been laid out twice or not at all.
  expect(evaluated(`${V} class X extends V { } String((type X).byteLength);`)).toBe('12');
  expect(evaluated(`${V} String((type V).byteLength);`)).toBe('12');
});

test('...at depth, through a subclass that DID add a field', () => {
  // Not a one-level rule: the base's own flag is the test, so it composes up a
  // chain without walking it.
  const W = `${V} class W extends V { w: float32 = 0; } `;
  expect(evaluated(`${W} String((type W).byteLength);`)).toBe('16');
  expect(evaluated(`${W} class Y extends W { } String((type Y).byteLength);`)).toBe('16');
});

test('its instances are non-extensible, as the base\'s are', () => {
  // The half that is not about layout. A typed class is sealed, and a subclass
  // that inherits typed fields is a typed class.
  expect(evaluated(`${V} String(Object.isExtensible(new V()));`)).toBe('false');
  expect(evaluated(`${V} class X extends V { } String(Object.isExtensible(new X()));`)).toBe('false');
});

test('a base-typed binding holding the subclass is non-extensible', () => {
  // The violation stated from the caller's side: a `V`-typed binding is
  // documented to hold a sealed instance, and it held an extensible one.
  expect(evaluated(`${V} class X extends V { } let v: V = new X(); String(Object.isExtensible(v));`)).toBe('false');
  expect(evaluated(`${V} class X extends V { } let v: V = new X(); v.extra = 1; String(v.extra);`)).toBe('undefined');
});

test('an array of the subclass has a layout', () => {
  // The propagation: a type with no layout takes every composite over it down
  // with it, so this is what the fix is worth in practice.
  expect(evaluated(`${V} class X extends V { } String((type [2].<X>).byteLength);`)).toBe('24');
});

test('a subclass of an UNTYPED class stays untyped', () => {
  // The narrow rule, chosen over "any subclass of any class": neither of these
  // declares an annotation anywhere, so neither is typed and neither is sealed.
  expect(evaluated('class B { } class C extends B { } String((type C).hasLayout);')).toBe('false');
  expect(evaluated('class B { } class C extends B { } String(Object.isExtensible(new C()));')).toBe('true');
});

test('the disqualifying rules are untouched', () => {
  // An UNTYPED field still has no size, so the class still has no layout - the
  // `#table-layout-qualification` row this fix does not reach.
  expect(evaluated(`${V} class U extends V { u; } String((type U).hasLayout);`)).toBe('false');
  // ...and `dynamic` still disqualifies, on a subclass as on a base.
  expect(evaluated(`${V} class D extends V { dynamic; } String((type D).hasLayout);`)).toBe('false');
});
