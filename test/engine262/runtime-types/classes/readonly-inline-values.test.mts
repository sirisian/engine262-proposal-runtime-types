import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-readonly-inline-values. `readonly` fixes a member's own storage. A
 * member of a reference type stores a reference, so the object it refers to
 * stays writable. A member of a value type stores the VALUE - a value type
 * class instance, an array of fixed length of a value type, a tuple of value
 * types - so a field or a position of that value is the member's storage, and
 * a store to one is a store to the member: an early error where the checker
 * sees it, and a TypeError when it runs otherwise.
 */
const A = 'class A { a: uint8; bump(): void { this.a += 1; } } ';
const H = `${A}class H { readonly p: A; readonly q: [2].<uint8>; readonly t: [uint8, uint8]; } `;
const refused = (source: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-readonly-store' } });
};
// A store the checker does not see: through a plain object that holds the instance.
const UNSEEN = "const o: any = { h }; let out = ''; const attempt = (f) => { try { f(); out += 'ok,'; } catch (e) { out += e.name + ','; } }; ";

test('a store into the value of a readonly member is an early error', () => {
  refused(`${H}const h: H = new H(); h.p.a = 3;`);
  refused(`${H}const h: H = new H(); h.q[0] = 7;`);
  refused(`${H}const h: H = new H(); h.t[1] = 7;`);
  refused(`${H}const h: H = new H(); h.p.a += 1;`);
  refused(`${H}const h: H = new H(); h.p.a++;`);
  refused(`${H}function f(h: H) { [h.p.a] = [1]; }`);
  // At any depth of values stored inline.
  refused(`${A}class M { p: A; } class H { readonly m: M; } const h: H = new H(); h.m.p.a = 3;`);
  refused(`${A}class H { readonly ps: [2].<A>; } const h: H = new H(); h.ps[1].a = 3;`);
  // A `string` has no layout and is a value type, so an array of them is one.
  refused('class H { readonly names: [2].<string> = ["a", "b"]; } const h: H = new H(); h.names[0] = "z";');
  refused('class H { readonly pair: [string, number] = ["a", 1]; } const h: H = new H(); h.pair[1] = 2;');
  // In a method of the declaring class, through a private name, and a static field.
  refused(`${A}class H { readonly p: A; poke(): void { this.p.a = 3; } }`);
  refused(`${A}class H { readonly #p: A; poke(): void { this.#p.a = 3; } }`);
  refused(`${A}class H { static readonly origin: A = new A(); } const checked: uint8 = 0; H.origin.a = 3;`);
  // Through a view that declares the member readonly.
  refused(`${A}function f(o: { readonly p: A }) { o.p.a = 3; }`);
});

test('the declaring constructor builds the value field by field, and nothing else does', () => {
  expect(evaluated(`${A}class H { readonly p: A; readonly q: [2].<uint8>; constructor() { this.p.a = 4; this.q[1] = 5; } } const h: H = new H(); String(h.p.a) + String(h.q[1]);`)).toBe('45');
  refused(`${A}class H { readonly p: A; } class H2 extends H { constructor() { super(); this.p.a = 5; } }`);
  // Unseen by the checker, a subclass's constructor and a method the constructor calls are refused when they run.
  expect(evaluated(`${A}class H { readonly p: A; } let r = ''; class H2 extends H { constructor() { super(); const self: any = this; try { self.p.a = 5; } catch (e) { r = e.name; } } } new H2(); r;`)).toBe('TypeError');
  expect(evaluated(`${A}let r = ''; class H { readonly p: A; constructor() { this.init(); } init(): void { const self: any = this; try { self.p.a = 5; } catch (e) { r = e.name; } } } new H(); r;`)).toBe('TypeError');
});

test('a readonly member of a reference type fixes the reference, and no more', () => {
  expect(evaluated('reference class R { x: uint8; } class H { readonly r: R = new R(); readonly xs: [].<uint8> = [1]; } const h: H = new H(); h.r.x = 5; h.xs[0] = 6; h.xs.push(7); String(h.r.x) + String(h.xs[0]) + String(h.xs.length);')).toBe('562');
  expect(evaluated('reference class R { x: uint8; } class H { readonly r: R = new R(); readonly xs: [].<uint8> = [1]; } const h = new H(); const o: any = { h }; o.h.r.x = 5; o.h.xs[0] = 6; o.h.xs.push(7); String(h.r.x) + String(h.xs[0]) + String(h.xs.length);')).toBe('562');
  // A tuple with a reference position is a reference type.
  expect(evaluated('reference class R { x: uint8; } class H { readonly t: [uint8, R] = [1, new R()]; } const h: H = new H(); h.t[0] = 5; h.t[1].x = 6; String(h.t[0]) + String(h.t[1].x);')).toBe('56');
  // A class with a reference field is not a value type, so a member of it holds a reference.
  expect(evaluated('reference class R { x: uint8; } class M { r: R = new R(); n: uint8; } class H { readonly m: M = new M(); } const h: H = new H(); h.m.n = 3; h.m.r.x = 5; String(h.m.n) + String(h.m.r.x);')).toBe('35');
  // The walk stops at the first reference inside a value.
  expect(evaluated('reference class R { x: uint8; } class M { r: R = new R(); } class H { readonly m: M = new M(); } const h: H = new H(); h.m.r.x = 5; String(h.m.r.x);')).toBe('5');
});

test('a store the checker does not see is refused when it runs', () => {
  expect(evaluated(`${H}const h = new H(); const k = new H(); ${UNSEEN}attempt(() => { o.h.p.a = 3; }); attempt(() => { o.h.q[0] = 7; }); attempt(() => { o.h.t[1] = 7; }); out + String(h.p.a) + String(h.q[0]) + String(h.t[1]) + ',' + String(h === k);`)).toBe('TypeError,TypeError,TypeError,000,true');
  // A method of the value that stores to `this`.
  expect(evaluated(`${H}const h = new H(); ${UNSEEN}attempt(() => { o.h.p.bump(); }); out + String(h.p.a);`)).toBe('TypeError,0');
  expect(observeScript(`${H}const h: H = new H(); h.p.bump();`)).toMatchObject({ bodyEntered: true, errorClass: 'TypeError' });
  // The array members that store in place.
  expect(evaluated(`${H}const h = new H(); ${UNSEEN}attempt(() => { o.h.q.sort(); }); attempt(() => { o.h.q.fill(9); }); attempt(() => { o.h.q.reverse(); }); out + h.q.join('');`)).toBe('TypeError,TypeError,TypeError,00');
  // A window over the member's array, and a `ref` to a field of its value.
  expect(evaluated(`${H}const h = new H(); ${UNSEEN}const w: Span.<uint8> = o.h.q; attempt(() => { w[0] = 9; }); out + String(h.q[0]);`)).toBe('TypeError,0');
  expect(evaluated('class H { readonly q: [2].<uint8>; } function fill(out: Span.<uint8>): void { out[0] = 1; } const h: H = new H(); let r = ""; try { fill(h.q); r = "stored"; } catch (e) { r = e.name; } r + String(h.q[0]);')).toBe('TypeError0');
  expect(evaluated(`${H}const h = new H(); const o: any = { h }; function f(): string { const ref r = o.h.p.a; try { r = 5; return 'stored'; } catch (e) { return e.name; } } f() + String(h.p.a);`)).toBe('TypeError0');
  // Replacing the member is refused as it always was.
  expect(evaluated(`${H}const h = new H(); ${UNSEEN}attempt(() => { o.h.p = new A(); }); out;`)).toBe('TypeError,');
  expect(evaluated(`${H}const h = new H(); const o: any = { h }; let m = ''; try { o.h.p.a = 3; } catch (e) { m = e.message; } m;`)).toBe('this value is stored in a readonly field and is read-only, so "a" cannot be stored to');
});

test('a frozen instance does not change', () => {
  const B = `${A}class B { p: A; q: [2].<uint8>; t: [uint8, uint8]; } `;
  expect(evaluated(`${B}const h = new B(); ${UNSEEN}attempt(() => { o.h.p.a = 1; }); Object.freeze(h); attempt(() => { o.h.p.a = 4; }); attempt(() => { o.h.q[0] = 5; }); attempt(() => { o.h.t[0] = 6; }); attempt(() => { o.h.p.bump(); }); out + String(h.p.a) + String(h.q[0]) + String(h.t[0]);`)).toBe('ok,TypeError,TypeError,TypeError,TypeError,100');
  expect(evaluated(`${B}const h = new B(); const k = new B(); Object.freeze(h); const o: any = { h }; try { o.h.p.a = 4; } catch {} String(h === k);`)).toBe('true');
  expect(evaluated(`${B}const h = new B(); Object.freeze(h); const o: any = { h }; let m = ''; try { o.h.p.a = 3; } catch (e) { m = e.message; } m;`)).toBe('this value is stored in a frozen object and is read-only, so "a" cannot be stored to');
  // A frozen instance's reference members refer to objects that stay writable.
  expect(evaluated('reference class R { x: uint8; } class B { n: uint8; r: R = new R(); } const b = new B(); Object.freeze(b); b.r.x = 5; String(b.r.x);')).toBe('5');
});

test('a copy of the value is the reader\'s own, and reading is unchanged', () => {
  expect(evaluated(`${H}const h: H = new H(); const c = h.p; c.a = 9; String(c.a) + String(h.p.a);`)).toBe('90');
  expect(evaluated(`${H}const h: H = new H(); const q: [2].<uint8> = h.q; q[0] = 9; String(q[0]) + String(h.q[0]);`)).toBe('90');
  // A copy of the holder has the holder's readonly members.
  expect(evaluated(`${H}const h = new H(); const c = h; const oc: any = { c }; let r = ''; try { oc.c.p.a = 3; } catch (e) { r = e.name; } r + String(c.p.a);`)).toBe('TypeError0');
  // Equality, iteration, the copying methods and what the value is.
  expect(evaluated(`${H}const h = new H(); const k = new H(); const o: any = { h }; String(o.h.p === k.p) + String(o.h.q === k.q) + String(h === k);`)).toBe('truetruetrue');
  expect(evaluated('class H { readonly q: [2].<uint8>; constructor() { this.q[0] = 4; this.q[1] = 3; } } const h: H = new H(); let s: uint8 = 0; for (const x of h.q) s += x; String(s) + [...h.q].join("") + h.q.map((x) => x + 1).join("") + h.q.toSorted().join("") + String(h.q.length);')).toBe('74354342');
  expect(evaluated('class H { readonly q: [2].<uint8>; } const h = new H(); String(Array.isArray(h.q)) + JSON.stringify(h.q) + String(h.q instanceof Array);')).toBe('true[0,0]true');
  // A read-only window is the way to pass the member's array on.
  expect(evaluated('class H { readonly q: [2].<uint8>; constructor() { this.q[0] = 4; this.q[1] = 3; } } function sum(xs: ReadonlySpan.<uint8>): uint8 { return xs[0] + xs[1]; } const h: H = new H(); String(sum(h.q));')).toBe('7');
});

test('a readonly member of an interface is judged through that view', () => {
  const V = `${A}interface V { readonly p: A; } reference class H implements V { p: A; } `;
  refused(`${V}const h: H = new H(); const v: V = h; v.p.a = 3;`);
  refused(`${V}const h: H = new H(); const v: V = h; v.p = new A();`);
  // The class declares the member writable, so its own type stores, and so
  // does a name the checking pass does not judge: the view is a property of
  // the type the store is written through, as for the member itself.
  expect(evaluated(`${V}const h: H = new H(); const v: V = h; h.p.a = 3; String(v.p.a);`)).toBe('3');
  expect(evaluated(`${V}const h: H = new H(); const v: V = h; const u: any = v; u.p.a = 3; String(h.p.a);`)).toBe('3');
  // A member that holds a reference is fixed, and the object is not.
  expect(evaluated('reference class R { x: uint8; } interface V { readonly r: R; } reference class H implements V { r: R = new R(); } const h: H = new H(); const v: V = h; v.r.x = 3; String(h.r.x);')).toBe('3');
});

test('a member that is not a readonly field is not this rule\'s', () => {
  expect(evaluated(`${A}class H { p: A; } const h: H = new H(); h.p.a = 3; String(h.p.a);`)).toBe('3');
  // A getter with no setter is not storage: a store through one is a store to
  // a result (#sec-store-to-a-copy), and in a reference class a subclass may
  // declare the member a field, which the store reaches.
  expect(evaluated('class Point { x: int32; y: int32; } reference class Shape { o: Point; get origin(): Point { return this.o; } } reference class Sprite extends Shape { origin: Point; } function nudge(shape: Shape) { shape.origin.x = 1; } const a: Shape = new Shape(); const b: Shape = new Sprite(); nudge(a); nudge(b); String(a.origin.x) + String(b.origin.x);')).toBe('01');
  // An accessor field is not judged.
  expect(evaluated(`${A}class H { accessor p: A; } const h: H = new H(); h.p.a = 4; String(h.p.a);`)).toBe('4');
});
