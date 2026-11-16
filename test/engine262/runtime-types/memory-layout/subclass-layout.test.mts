import { test, expect } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind } from '../harness.mts';

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
  // The direct write is now an EARLY ERROR - #sec-typed-storage's "a property
  // may not be added or removed", enforced at the check rather than left to
  // fail at run time. The run-time behaviour it used to demonstrate is still
  // covered: `Object.isExtensible` above states it directly, and the computed
  // key below reaches the same failure by a spelling the checker cannot judge.
  expectStaticTypeError(`${V} class X extends V { } let v: V = new X(); v.extra = 1;`);
  // A `let` key rather than a `const`: the checker reads an immutably bound
  // literal as the key it names (`immutablyBound`), so `const k = 'extra'` is
  // judged exactly as `v.extra` is and refused early - which this line once
  // relied on it NOT doing. A `let` may be reassigned and is not folded, so the
  // write reaches the run time, where the seal refuses it.
  //
  // The refusal THROWS. #sec-typed-storage says an add "in sloppy mode ...
  // fails SILENTLY", but this script is not sloppy: its own `let v: V` is a
  // TypeAnnotation, and "Strict Mode for Annotated Code" makes "a Script whose
  // own body contains a TypeAnnotation" strict mode code. In strict code a
  // refused [[Set]] is a TypeError. This line once expected the silent sloppy
  // result, *undefined*, in a script its own annotation made strict.
  expectThrownKind(`${V} class X extends V { } let v: V = new X(); let k = 'extra'; v[k] = 1;`, 'TypeError');
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

/**
 * #sec-issubtype and #sec-array-membership: a subclass that ADDS storage.
 *
 * A position of a value type class is laid out in what holds it. A field, a
 * binding and an array element already refused a subclass that adds storage;
 * a tuple position did not, so a `[C]` was a `[B]`, held a `C`, and refused a
 * store of a `B` only where the store was made. And an array or tuple that
 * reached its target through a name the checking pass does not judge was
 * admitted when it ran, because membership looked at each element and every
 * `C` is a `B`.
 */
const BC = 'class B { x: uint8; } class C extends B { y: uint8; } class Q extends B { get twice(): uint8 { return this.x * 2; } } ';
const TRY = "const attempt = (f) => { try { return f(); } catch (e) { return e.name; } }; ";

test('a tuple of a subclass that adds storage is not a tuple of its base', () => {
  expectStaticTypeError(`${BC}const cs: [C] = [new C()]; const bs: [B] = cs;`);
  expectStaticTypeError(`${BC}const cs: [C, uint8] = [new C(), 1]; const bs: [B, uint8] = cs;`);
  expectStaticTypeError(`${BC}const cs: [[C], uint8] = [[new C()], 1]; const bs: [[B], uint8] = cs;`);
  expectStaticTypeError(`${BC}function f(t: [B]): void { } const cs: [C] = [new C()]; f(cs);`);
  expectStaticTypeError(`${BC}const bs: [B] = [new C()];`);
  // The array and the class position, which already refused it.
  expectStaticTypeError(`${BC}const one: [1].<C> = [new C()]; const arr: [1].<B> = one;`);
  expectStaticTypeError(`${BC}const c: C = new C(); const b: B = c;`);
});

test('...and is refused when it runs, where the checking pass did not see it', () => {
  expect(evaluated(`${BC}${TRY}const cs: [C] = [new C()]; const u: any = cs; attempt(() => { const bs: [B] = u; return 'bound'; });`)).toBe('TypeError');
  expect(evaluated(`${BC}${TRY}class H { t: [B]; } const h = new H(); const cs: [C] = [new C()]; const u: any = cs; attempt(() => { h.t = u; return 'stored'; });`)).toBe('TypeError');
  expect(evaluated(`${BC}${TRY}function f(t: [B]): string { return 'called'; } const cs: [C] = [new C()]; const u: any = cs; attempt(() => f(u));`)).toBe('TypeError');
  // An array, fixed and growable. A growable one was aliased, and then refused a store of a B.
  expect(evaluated(`${BC}${TRY}const one: [1].<C> = [new C()]; const u: any = one; attempt(() => { const arr: [1].<B> = u; return 'bound'; });`)).toBe('TypeError');
  expect(evaluated(`${BC}${TRY}const cs: [].<C> = [new C()]; const u: any = cs; attempt(() => { const arr: [].<B> = u; return 'bound'; });`)).toBe('TypeError');
  expect(evaluated(`${BC}${TRY}class H { t: [1].<B>; } const h = new H(); const one: [1].<C> = [new C()]; const u: any = one; attempt(() => { h.t = u; return 'stored'; });`)).toBe('TypeError');
  expect(evaluated(`${BC}const cs: [].<C> = [new C()]; const u: any = cs; let m = ''; try { const arr: [].<B> = u; } catch (e) { m = e.message; } m;`)).toBe('[object Array] is not assignable to "[].<B>": its elements are "C", which adds fields to "B"');
  // The class position, which already refused it.
  expect(evaluated(`${BC}${TRY}const u: any = new C(); attempt(() => { const b: B = u; return 'bound'; });`)).toBe('TypeError');
});

test('a subclass that adds nothing, the same class, and a reference class are unchanged', () => {
  expect(evaluated(`${BC}const qs: [Q] = [new Q()]; const bs: [B] = qs; String(bs[0].x);`)).toBe('0');
  expect(evaluated(`${BC}const qs: [1].<Q> = [new Q()]; const u: any = qs; const bs: [1].<B> = [...u]; String(bs[0].x);`)).toBe('0');
  expect(evaluated(`${BC}const b1: [B] = [new B()]; const b2: [B] = b1; b2[0].x = 3; String(b1[0].x) + String(b2[0].x);`)).toBe('03');
  // A tuple of reference classes keeps its covariance: it is one object, and
  // a store through the wider type is checked where it is made.
  expect(evaluated('reference class B { x: uint8; } reference class C extends B { y: uint8; } const cs: [C] = [new C()]; const bs: [B] = cs; String(bs[0] instanceof C) + String(bs === cs);')).toBe('truetrue');
  expect(evaluated('const a: [uint8] = [1]; const w: [uint8 | string] = a; String(w[0]);')).toBe('1');
});
