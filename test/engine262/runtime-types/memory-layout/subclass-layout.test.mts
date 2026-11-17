import { test, expect } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown, expectThrownKind } from '../harness.mts';

/**
 * A subclass that declares no fields of its own.
 *
 * `#sec-typed-classes` defines a class as typed "when at least one of its public
 * or private fields, declared or inherited, carries a type annotation". The
 * engine read "its" as "the ones it declares", so `value class X extends V { }` was not
 * typed and got no layout - and, more seriously, its instances stayed EXTENSIBLE
 * while its base's were not, so a subclass weakened a guarantee its base makes
 * and the weaker object passed as the base.
 *
 * The layout is the visible symptom; the substitutability is why it was fixed.
 */

const V = 'value class V { x: float32 = 0; y: float32 = 0; z: float32 = 0; } ';

test('a fieldless subclass has its base\'s layout', () => {
  expect(evaluated(`${V} value class X extends V { } String((type X).hasLayout);`)).toBe('true');
  // The same number, because the subclass adds nothing. A different number here
  // would mean the base's fields had been laid out twice or not at all.
  expect(evaluated(`${V} value class X extends V { } String((type X).byteLength);`)).toBe('12');
  expect(evaluated(`${V} String((type V).byteLength);`)).toBe('12');
});

test('...at depth, through a subclass that DID add a field', () => {
  // Not a one-level rule: the base's own flag is the test, so it composes up a
  // chain without walking it.
  const W = `${V} value class W extends V { w: float32 = 0; } `;
  expect(evaluated(`${W} String((type W).byteLength);`)).toBe('16');
  expect(evaluated(`${W} value class Y extends W { } String((type Y).byteLength);`)).toBe('16');
});

test('its instances are non-extensible, as the base\'s are', () => {
  // The half that is not about layout. A typed class is sealed, and a subclass
  // that inherits typed fields is a typed class.
  expect(evaluated(`${V} String(Object.isExtensible(new V()));`)).toBe('false');
  expect(evaluated(`${V} value class X extends V { } String(Object.isExtensible(new X()));`)).toBe('false');
});

test('a base-typed binding holding the subclass is non-extensible', () => {
  // The violation stated from the caller's side: a `V`-typed binding is
  // documented to hold a sealed instance, and it held an extensible one.
  expect(evaluated(`${V} value class X extends V { } let v: V = new X(); String(Object.isExtensible(v));`)).toBe('false');
  // The direct write is now an EARLY ERROR - #sec-typed-storage's "a property
  // may not be added or removed", enforced at the check rather than left to
  // fail at run time. The run-time behaviour it used to demonstrate is still
  // covered: `Object.isExtensible` above states it directly, and the computed
  // key below reaches the same failure by a spelling the checker cannot judge.
  expectStaticTypeError(`${V} value class X extends V { } let v: V = new X(); v.extra = 1;`);
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
  expectThrownKind(`${V} value class X extends V { } let v: V = new X(); let k = 'extra'; v[k] = 1;`, 'TypeError');
});

test('an array of the subclass has a layout', () => {
  // The propagation: a type with no layout takes every composite over it down
  // with it, so this is what the fix is worth in practice.
  expect(evaluated(`${V} value class X extends V { } String((type [2].<X>).byteLength);`)).toBe('24');
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
  // A class that extends a value class is one (#sec-value-classes), so it cannot add a field with
  // no type; it was a class with no layout, held by reference, over a base held by value.
  expectThrown(`${V} value class U extends V { u; } String((type U).hasLayout);`, 'is a value class, and its field "u" has no type');
  expectThrown(`${V} class U extends V { u; } String((type U).hasLayout);`, 'is written `value class`');
  // ...and a `dynamic` class is never one, on a subclass as on a base: a
  // class over a value class is written `value class`, and `value` does not
  // combine with `dynamic`.
  expectThrown(`${V} dynamic class D extends V { } String((type D).hasLayout);`, 'is written `value class`');
  expectThrown(`${V} value dynamic class D extends V { } String((type D).hasLayout);`, 'cannot be both value and "dynamic"');
  expect(evaluated('dynamic class D { x: float32 = 0; } String((type D).hasLayout);')).toBe('false');
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
const BC = 'value class B { x: uint8; } value class C extends B { y: uint8; } value class Q extends B { get twice(): uint8 { return this.x * 2; } } ';
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
  expect(evaluated(`${BC}${TRY}value class H { t: [B]; } const h = new H(); const cs: [C] = [new C()]; const u: any = cs; attempt(() => { h.t = u; return 'stored'; });`)).toBe('TypeError');
  expect(evaluated(`${BC}${TRY}function f(t: [B]): string { return 'called'; } const cs: [C] = [new C()]; const u: any = cs; attempt(() => f(u));`)).toBe('TypeError');
  // An array, fixed and growable. A growable one was aliased, and then refused a store of a B.
  expect(evaluated(`${BC}${TRY}const one: [1].<C> = [new C()]; const u: any = one; attempt(() => { const arr: [1].<B> = u; return 'bound'; });`)).toBe('TypeError');
  expect(evaluated(`${BC}${TRY}const cs: [].<C> = [new C()]; const u: any = cs; attempt(() => { const arr: [].<B> = u; return 'bound'; });`)).toBe('TypeError');
  expect(evaluated(`${BC}${TRY}value class H { t: [1].<B>; } const h = new H(); const one: [1].<C> = [new C()]; const u: any = one; attempt(() => { h.t = u; return 'stored'; });`)).toBe('TypeError');
  expect(evaluated(`${BC}const cs: [].<C> = [new C()]; const u: any = cs; let m = ''; try { const arr: [].<B> = u; } catch (e) { m = e.message; } m;`)).toBe('[object Array] is not assignable to "[].<B>": its elements are "C", which adds fields to "B"');
  // The class position, which already refused it.
  expect(evaluated(`${BC}${TRY}const u: any = new C(); attempt(() => { const b: B = u; return 'bound'; });`)).toBe('TypeError');
});

test('a subclass that adds nothing is stored at a position of its base, and a reference class is unchanged', () => {
  // The VALUE is accepted at a position of the base: an element of a literal, and a spread of one.
  expect(evaluated(`${BC}const bs: [B] = [new Q()]; String(bs[0].x) + String(bs[0] instanceof Q);`)).toBe('0true');
  expect(evaluated(`${BC}const qs: [1].<Q> = [new Q()]; const u: any = qs; const bs: [1].<B> = [...u]; String(bs[0].x);`)).toBe('0');
  expect(evaluated(`${BC}const qs: [Q] = [new Q()]; const bs: [B] = [...qs]; bs[0] = new B(); String(bs[0] instanceof Q) + String(qs[0] instanceof Q);`)).toBe('falsetrue');
  expect(evaluated(`${BC}const b1: [B] = [new B()]; const b2: [B] = b1; b2[0].x = 3; String(b1[0].x) + String(b2[0].x);`)).toBe('03');
  // A tuple of reference classes keeps its covariance: it is one object, and
  // a store through the wider type is checked where it is made.
  expect(evaluated('class B { x: uint8; } class C extends B { y: uint8; } const cs: [C] = [new C()]; const bs: [B] = cs; String(bs[0] instanceof C) + String(bs === cs);')).toBe('truetrue');
});

test('a tuple of value types is not stored at a position of another tuple type', () => {
  // #sec-value-type-copying. A whole `[Q]` is a value laid out as its own positions, and a `[B]`
  // position would hold a copy that refuses a `B`. It does not matter that `Q` adds no storage: the
  // tuple is refused as a `[2].<Q>` is at a `[2].<B>`. The same for a position widened to a union.
  expectStaticTypeError(`${BC}const qs: [Q] = [new Q()]; const bs: [B] = qs;`);
  expectStaticTypeError('const a: [uint8] = [1]; const w: [uint8 | string] = a;');
  expectStaticTypeError('const a: [uint8, uint8] = [1, 2]; const w: [uint8 | null, uint8] = a;');
  expectStaticTypeError('const a: [[uint8]] = [[1]]; const w: [[uint8 | string]] = a;');
  expectStaticTypeError('function g(w: [uint8 | string]) { } function f() { const a: [uint8] = [3]; g(a); }');
  expectStaticTypeError('function g(): [uint8 | string] { const a: [uint8] = [3]; return a; }');
  expectStaticTypeError('class R { x: uint8; } const a: [uint8] = [1]; const w: [uint8 | R] = a;');
  // The type relation is untouched, as it is for a subclass, so a bound still takes the tuple whole.
  expect(evaluated('type T1 = [uint8]; type T2 = [uint8 | string]; String(Reflect.isAssignable(T1, T2)) + String(Reflect.isAssignable(T2, T1));')).toBe('truefalse');
  expect(evaluated('function first<T: type extends [uint8 | string]>(t: T): T { return t; } const a: [uint8] = [3]; const r: [uint8] = first(a); String(r[0]);')).toBe('3');
  // Where the checker did not see it, the position refuses it when it runs.
  expect(evaluated(`${TRY}const a: [uint8] = [3]; const u: any = { a }; attempt(() => { const w: [uint8 | string] = u.a; return 'bound'; });`)).toBe('TypeError');
  expect(evaluated(`${BC}${TRY}const qs: [Q] = [new Q()]; const u: any = { qs }; attempt(() => { const bs: [B] = u.qs; return 'bound'; });`)).toBe('TypeError');
  expect(evaluated(`${TRY}const a: [uint8] = [3]; const xs: [].<[uint8 | string]> = []; const u: any = { a }; attempt(() => { xs.push(u.a); return 'pushed'; });`)).toBe('TypeError');
  // At its own type it is stored, and read as the wider type it still is one.
  expect(evaluated('const a: [uint8] = [3]; const u: any = { a }; const w: [uint8] = u.a; String(w[0]) + String(u.a is [uint8 | string]);')).toBe('3true');
});

test('the widening of a tuple of value types is written', () => {
  // A spread builds a new tuple at the type it is bound at.
  expect(evaluated("const a: [uint8] = [3]; const w: [uint8 | string] = [...a]; w[0] = 's'; String(w[0]) + String(a[0]);")).toBe('s3');
  // `a := T` gives a value OF the type written, at every depth, for a tuple and for an array of fixed length.
  expect(evaluated("const a: [uint8, [uint8]] = [3, [4]]; const w = a := [uint8 | string, [uint8 | null]]; w[0] = 's'; w[1][0] = null; String(w[0]) + String(w[1][0]) + String(a[0]) + String(a[1][0]);")).toBe('snull34');
  expect(evaluated('const fx: [2].<uint8> = [1, 2]; const wf = fx := [2].<uint8 | null>; wf[0] = null; String(wf[0]) + String(fx[0]);')).toBe('null1');
  // The result is another value: a tuple of another type is not the tuple it was made from.
  expect(evaluated('const a: [uint8] = [3]; const w = a := [uint8 | string]; const u: any = { w, a }; String(u.w === u.a) + String(u.w[0] === u.a[0]);')).toBe('falsetrue');
});

test('an array of fixed length of a value type is of its own type when it runs too', () => {
  // The checker holds an array invariant in its element. Run, membership looked at each element
  // and admitted a `[2].<uint8>` at a `[2].<uint8 | string]`, which then refused the string.
  expect(evaluated(`${TRY}const a: [2].<uint8> = [1, 2]; const u: any = { a }; attempt(() => { const w: [2].<uint8 | string> = u.a; return 'bound'; });`)).toBe('TypeError');
  expect(evaluated(`${TRY}const a: [2].<uint8> = [1, 2]; const u: any = { a }; attempt(() => { const w: [uint8, uint8] = u.a; return 'bound'; });`)).toBe('TypeError');
  expect(evaluated('const a: [2].<uint8> = [1, 2]; const u: any = { a }; const w: [2].<uint8> = u.a; const top: [2].<any> = u.a; String(w[1]) + String(top[1]);')).toBe('22');
  // An untyped array carries no type, and takes the one it is bound at.
  expect(evaluated("const u: any = [1, 2]; const x: [2].<uint8 | string> = u; x[0] = 't'; String(x[0]);")).toBe('t');
});

test('an array or tuple built element by element refuses each element that adds storage', () => {
  // A literal, a spread among its elements, and an untyped array each store
  // their elements, and each store is the one `arr[0] = c` makes.
  const CS = `${BC}${TRY}const cs: [].<C> = [new C()]; `;
  expect(evaluated(`${CS}attempt(() => { const bs: [].<B> = [...cs]; return 'bound'; });`)).toBe('TypeError');
  expect(evaluated(`${CS}attempt(() => { const bs: [1].<B> = [...cs]; return 'bound'; });`)).toBe('TypeError');
  expect(evaluated(`${CS}attempt(() => { const bs: [B] = [...cs]; return 'bound'; });`)).toBe('TypeError');
  expect(evaluated(`${CS}const u: any = new C(); attempt(() => { const bs: [].<B> = [u]; return 'bound'; });`)).toBe('TypeError');
  expect(evaluated(`${CS}const u: any = [new C()]; attempt(() => { const bs: [].<B> = u; return 'bound'; });`)).toBe('TypeError');
  expect(evaluated(`${CS}const b0: [].<B> = [new B()]; const r = b0.concat(cs); attempt(() => { const typed: [].<B> = r; return 'bound'; });`)).toBe('TypeError');
  expectStaticTypeError(`${BC}const c: C = new C(); const bs: [].<B> = [c];`);
  // The same forms with the base itself, and with a subclass that adds nothing.
  expect(evaluated(`${BC}const b1: [].<B> = [new B()]; const b2: [].<B> = [...b1, new B()]; String(b2.length);`)).toBe('2');
  expect(evaluated(`${BC}const qs: [].<Q> = [new Q()]; const bs: [].<B> = [...qs]; String(bs.length);`)).toBe('1');
});

test('a read-only window of the base is not taken over an array of a subclass that adds storage', () => {
  expectStaticTypeError(`${BC}const cs: [].<C> = [new C()]; const w: ReadonlySpan.<B> = cs;`);
  expectStaticTypeError(`${BC}function total(xs: ReadonlySpan.<B>): uint8 { return xs[0].x; } function g() { const cs: [].<C> = [new C()]; return total(cs); }`);
  expectStaticTypeError(`${BC}const cs: [].<C> = [new C()]; const w: Span.<B> = cs;`);
  // A subclass that adds nothing, the base, a reference class and a primitive widen as before.
  expect(evaluated(`${BC}const qs: [].<Q> = [new Q()]; const w: ReadonlySpan.<B> = qs; String(w[0].x);`)).toBe('0');
  expect(evaluated(`${BC}const bs: [].<B> = [new B()]; const t: [B, B] = [new B(), new B()]; const w1: ReadonlySpan.<B> = bs; const w2: ReadonlySpan.<B> = t; String(w1.length) + String(w2.length);`)).toBe('12');
  expect(evaluated('class A { n: uint8; } class D extends A { t: uint8; } const ds: [].<D> = [new D()]; const w: ReadonlySpan.<A> = ds; String(w[0].n);')).toBe('0');
  expect(evaluated('const a: [].<uint8> = [1]; const w: ReadonlySpan.<uint8 | string> = a; String(w[0]);')).toBe('1');
});

test('a bound takes a value whole, whatever its layout', () => {
  // #sec-value-type-copying: "a bound `T extends Base` carries the whole value". The inferred type
  // argument was judged against the bound as a value stored at a position of it, and refused.
  expect(evaluated(`${BC}function id<T: type extends B>(v: T): T { return v; } const c: C = id(new C()); const d: C = id.<C>(new C()); String(c instanceof C) + String(d instanceof C);`)).toBe('truetrue');
  expect(evaluated(`${BC}function id<T: type extends [B]>(v: T): T { return v; } const qs: [Q] = [new Q()]; const r: [Q] = id(qs); String(r[0].twice);`)).toBe('0');
  // The position rule is untouched: a `C` is still not stored where a `B` is declared.
  expectStaticTypeError(`${BC}function take(b: B) { } take(new C());`);
});

test('a subclass that declares no field is a value as its base is', () => {
  // #sec-typed-classes: "typed when at least one of its public or private fields, DECLARED OR
  // INHERITED, carries a type annotation", and a value type class when every field is of a value
  // type. `class Q extends B` with a getter and no field was given a layout and no value
  // semantics: a binding of one was another name for it.
  const QE = 'value class B { x: uint8; } value class Q extends B { get twice(): uint8 { return this.x * 2; } } value class E extends B { } ';
  expect(evaluated(`${QE}function f() { const q = new Q(); const c = q; c.x = 4; return String(q.x) + String(c.x) + String(c.twice) + String(c instanceof Q); } f();`)).toBe('048true');
  expect(evaluated(`${QE}function g(e: E) { e.x = 4; return e.x; } function f() { const e = new E(); return String(g(e)) + String(e.x); } f();`)).toBe('40');
  expect(evaluated(`${QE}function f() { const qs: [2].<Q> = [new Q(), new Q()]; const cs = qs; cs[0].x = 4; return String(qs[0].x) + String(cs[0].x); } f();`)).toBe('04');
  // Equal by value, as two of the base are.
  expect(evaluated(`${QE}function f() { const a = new E(); const b = new E(); const u: any = { a, b }; return String(u.a === u.b) + String(new Set([a]).has(b)); } f();`)).toBe('truetrue');
  // A default of it has the base's fields.
  expect(evaluated(`${QE}function f() { let e: E; return String(e.x) + String(e instanceof E) + String(E.byteLength); } f();`)).toBe('0true1');
});

test('a subclass of a class with no layout has none, and keeps every field', () => {
  // #table-layout-qualification. A `string` field has no size, so the base has no layout; the
  // absent base layout read as "no base", and the subclass was laid out as its own fields alone.
  // A copy, which walks the layout, then had those and none of the base's.
  const SB = "value class B { x: uint8 = 7; s: string = 'ok'; } value class S extends B { y: uint8 = 1; } value class E extends B { } ";
  expect(evaluated(`${SB}String(B.hasLayout) + String(S.hasLayout) + String(E.hasLayout);`)).toBe('falsefalsefalse');
  expect(evaluated(`${SB}function f() { const b = new S(); const c = b; return String(c.x) + c.s + String(c.y); } f();`)).toBe('7ok1');
  expect(evaluated(`${SB}function f() { const e = new E(); const c = e; const u: any = c; return String(u.x) + u.s; } f();`)).toBe('7ok');
  expect(evaluated(`${SB}function g(c: S) { return String(c.x) + c.s + String(c.y); } g(new S());`)).toBe('7ok1');
  // The control: a base that is laid out gives its subclass its fields.
  expect(evaluated('value class N { x: uint8 = 7; } value class P extends N { y: uint8 = 1; } value class M extends N { } [N.byteLength, P.byteLength, M.byteLength].join();')).toBe('1,2,1');
});
