import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * #sec-store-to-a-copy. Binding, passing and iterating copy a value type class,
 * a fixed-length array of a value type and a tuple of value types, so a store
 * to such a binding that nothing reads afterwards is certain to have no
 * effect. It is the one mistake value semantics invites - the callee's `out`,
 * the cached `this.items`, the loop's `row`, each taken for the original - and
 * it is an early error in checked code, with the spelling that was meant named
 * in the message: the original's path, `const ref`, a `ref` parameter, a
 * window.
 *
 * The rule has no false instance. A binding is judged only where every use of
 * it is a plain store or a read of a primitive, so the second half of this
 * file matters as much as the first.
 */
const P = 'class P { x: float32; y: float32; step(): void { this.x += 1; } } ';
const lost = (source: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-store-to-copy' } });
};

test('a store to a parameter that nothing reads afterwards is refused', () => {
  lost('function scale(out: [3].<float32>, k: float32) { out[0] *= k; out[1] *= k; out[2] *= k; }');
  lost(`${P}function reset(p: P) { p.x = 0; p.y = 0; }`);
  lost('function f(c: [2].<uint8>) { c[0]++; }');
  // A read within the store's own operands precedes the store.
  lost('function flip(p: [float32, float32]) { p[0] = -p[0]; }');
  // A field or position inside a field that is laid out inline.
  lost('class In { n: uint8; } class Out { i: In; k: uint8; } function f(o: Out) { o.i.n = 3; }');
  // In a loop, where the only read is the compound operator's own.
  lost('function scaleAll(out: [3].<float32>, k: float32) { for (let i: uint8 = 0; i < 3; i += 1) out[i] *= k; }');
  // An earlier store that is read is fine; the last one is lost.
  lost(`${P}function f(p: P): float32 { p.x = 1; const r = p.x; p.y = 2; return r; }`);
});

test('a store to a binding copied from a name, a field or an element is refused', () => {
  lost('class Stack { items: [4].<uint8>; top: uint8; push(x: uint8): void { const items = this.items; items[this.top] = x; this.top += 1; } }');
  lost('const entries: [].<[uint8, uint32]> = [[1, 1]]; function bump() { const e = entries[0]; e[1] += 1; }');
  lost(`${P}const ps: [2].<P>; function f() { const first = ps[0]; first.x = 1; }`);
});

test('a store to the binding of a for-of head is refused', () => {
  lost('const m: [2].<[2].<uint8>> = [[1, 2], [3, 4]]; for (const row of m) row[0] = 9;');
  lost(`${P}const ps: [2].<P>; function stepAll() { for (const p of ps) { p.x += 1; } }`);
});

test('each thing the writer may have meant has a spelling, and is accepted', () => {
  expect(evaluated('function scale(ref out: [3].<float32>, k: float32) { out[0] *= k; } const v: [3].<float32> = [1, 2, 3]; scale(ref v, 2); String(v[0]);')).toBe('2');
  expect(evaluated('function scale(out: Span.<float32, 3>, k: float32) { out[0] *= k; } const v: [3].<float32> = [1, 2, 3]; scale(v, 2); String(v[0]);')).toBe('2');
  expect(evaluated('const m: [2].<[2].<uint8>> = [[1, 2], [3, 4]]; function f() { const ref row = m[0]; row[0] = 9; } f(); for (const ref row of m) row[1] = 8; String(m[0][0]) + String(m[1][1]);')).toBe('98');
  expect(evaluated('class Stack { items: [4].<uint8>; top: uint8; push(x: uint8): void { this.items[this.top] = x; this.top += 1; } } const s = new Stack(); s.push(5); String(s.items[0]);')).toBe('5');
});

test('a copy that is used is the program\'s own, and is untouched', () => {
  expect(evaluated(`${P}function f(p: P): float32 { p.x = 1; return p.x; } String(f(new P()));`)).toBe('1');
  expect(evaluated('function f(p: [2].<uint8>): [2].<uint8> { p[0] = 9; return p; } const a: [2].<uint8> = [1, 2]; String(f(a)[0]) + String(a[0]);')).toBe('91');
  expect(evaluated(`${P}function f(p: P): void { p.x = 1; p.step(); } f(new P()); 'ok';`)).toBe('ok');
  expect(evaluated(`${P}function g(q: P): float32 { return q.x; } function f(p: P): float32 { p.x = 4; return g(p); } String(f(new P()));`)).toBe('4');
  // A read in a later turn of a loop follows the store.
  expect(evaluated('function f(c: [2].<uint8>): uint8 { let t: uint8 = 0; for (let i: uint8 = 0; i < 2; i += 1) { t += c[0]; c[0] = 5; } return t; } const a: [2].<uint8> = [1, 2]; String(f(a));')).toBe('6');
});

test('a binding that is not a copy is not judged', () => {
  // Built in place: a construction.
  expect(evaluated(`${P}function make(): void { const p = new P(); p.x = 1; } make(); 'ok';`)).toBe('ok');
  // Reached by reference: a reference class, a class with no layout, a dynamic array.
  expect(evaluated('reference class R { x: uint8; } function f(r: R) { r.x = 5; } const r = new R(); f(r); String(r.x);')).toBe('5');
  expect(evaluated("class N { name: string; } function f(n: N) { n.name = 'b'; } const n = new N(); f(n); String(n.name);")).toBe('b');
  expect(evaluated('function f(a: [].<uint8>) { a[0] = 9; } const a: [].<uint8> = [1]; f(a); String(a[0]);')).toBe('9');
  // No declared type to judge by.
  expect(evaluated('function f(a) { a[0] = 9; } const a: [2].<uint8> = [1, 2]; f(a); String(a[0]);')).toBe('1');
  expect(evaluated('const a: [2].<uint8> = [1, 2]; function f() { const y: any = a; y[0] = 9; } f(); String(a[0]);')).toBe('1');
  expect(evaluated("function f(a) { const b = a; b.x = 1; } f({ x: 0 }); 'ok';")).toBe('ok');
});

test('a binding with a second name, or one the pass cannot see whole, is not judged', () => {
  expect(evaluated(`${P}function f(p: P): () => float32 { const read = () => p.x; p.x = 7; return read; } String(f(new P())());`)).toBe('7');
  expect(evaluated(`${P}function f(p: P): float32 { const o = { p }; p.x = 6; return o.p.x; } String(f(new P()));`)).toBe('6');
  expect(evaluated('function f(c: [2].<uint8>): uint8 { const ref first = c[0]; c[0] = 4; return first; } const a: [2].<uint8> = [1, 2]; String(f(a));')).toBe('4');
  expect(evaluated('function f(c: [2].<uint8>): uint8 { const w: Span.<uint8> = c; c[0] = 4; return w[0]; } const a: [2].<uint8> = [1, 2]; String(f(a));')).toBe('4');
  expect(evaluated(`${P}function f(p0: P): float32 { let p = p0; p.x = 1; p = new P(); return p.x; } String(f(new P()));`)).toBe('0');
  expect(evaluated(`${P}function f(p: P): float32 { { const p = new P(); p.x = 3; return p.x; } } String(f(new P()));`)).toBe('3');
  // The top level of a script: a later script may read the binding.
  expect(evaluated('const m: [2].<[2].<uint8>> = [[1, 2], [3, 4]]; const r = m[0]; r[0] = 9; String(m[0][0]);')).toBe('1');
});

test('a binding initialized from any expression but a construction holds a copy', () => {
  // Binding copies every value but one a `new` or a literal constructs
  // (#sec-value-type-copying), so the result of a call and of a conditional
  // are copies too, and a store to one that nothing reads is as lost.
  lost(`${P}const ps: [2].<P>; function pick(i: uint8): P { return ps[i]; } function f() { const p: P = pick(0); p.x = 1; }`);
  lost(`${P}const ps: [2].<P>; function f(first: boolean) { const p = first ? ps[0] : ps[1]; p.x = 1; }`);
  lost(`${P}class Q { n: uint8; grow(): void { const self = this; self.n = 5; } }`);
  // Where the binding has no type of its own to judge by, it is not judged.
  expect(evaluated(`${P}const ps: [2].<P>; function pick(i: uint8): P { return ps[i]; } function f() { const p = pick(0); p.x = 1; } f(); String(ps[0].x);`)).toBe('0');
  // A constructor may have kept its `this`, so a constructed value is not judged.
  expect(evaluated(`${P}function make(): void { const p = new P(); p.x = 1; } make(); 'ok';`)).toBe('ok');
});

/**
 * A store to a RESULT. "A function copied what it returned", and a getter is a
 * function, so a store through the result of a call or of a getter is to a
 * copy that nothing names: no read can follow it, and it is lost.
 */
const PS = `${P}const ps: [2].<P>; `;

test('a store to the result of a function of the program\'s is refused', () => {
  lost(`${PS}const pick = (i: uint8): P => ps[i]; pick(0).x = 1;`);
  lost(`${PS}{ function pick(i: uint8): P { return ps[i]; } pick(0).x = 1; }`);
  lost(`${PS}function main() { function pick(i) { return ps[i]; } pick(0).x = 1; }`);
  lost(`${PS}const pick = function (i: uint8): P { return ps[i]; }; pick(0).x = 1;`);
  // Every form of store, and a path into the result.
  lost(`${PS}const pick = (i: uint8): P => ps[i]; pick(0).x += 1;`);
  lost(`${PS}const pick = (i: uint8): P => ps[i]; pick(0).x++;`);
  lost(`${P}class Q { p: P; t: [uint8, uint8]; } const q0: Q = new Q(); const mk = (): Q => q0; mk().p.x = 1;`);
  lost(`${P}class Q { p: P; t: [uint8, uint8]; } const q0: Q = new Q(); const mk = (): Q => q0; mk().t[1] = 1;`);
  lost(`${P}class Q { p: P; } const q0: Q = new Q(); const mk = (): Q => q0; mk().p = new P();`);
  // A fixed-length array and a tuple are values, and are returned as copies.
  lost('const src: [2].<uint8> = [1, 2]; const both = (): [2].<uint8> => src; both()[0] = 9;');
  lost('const src: [uint8, uint8] = [1, 2]; const both = (): [uint8, uint8] => src; both()[0] = 9;');
});

test('a store to the result of a method or a getter of a value type class is refused', () => {
  lost(`${P}class B { p: P; get(): P { return this.p; } } const b: B = new B(); b.get().x = 4;`);
  lost(`${P}class B { p: P; get inner(): P { return this.p; } } const b: B = new B(); b.inner.x = 4;`);
  lost(`${P}class B { p: P; get inner(): P { return this.p; } } function f(b: B) { b.inner.x = 4; }`);
  lost(`${P}class B { p: P; get inner(): P { return this.p; } } const checked: uint8 = 0; const b = new B(); b.inner.x = 4;`);
  // A setter beside the getter does not run: the store is to the getter's result.
  lost(`${P}class B { p: P; get inner(): P { return this.p; } set inner(v: P) { this.p = v; } } const b: B = new B(); b.inner.x = 4;`);
  // The receiver is reached through storage declared to hold that class.
  lost(`${P}class B { p: P; get inner(): P { return this.p; } } reference class E { b: B; } const e: E = new E(); e.b.inner.x = 4;`);
  lost(`${P}class B { p: P; get inner(): P { return this.p; } } const bs: [].<B> = [new B()]; bs[0].inner.x = 4;`);
  lost(`${P}class B { p: P; get inner(): P { return this.p; } } const bs: [2].<B>; bs[1].inner.x = 4;`);
  // A static method of a class named where it is called.
  lost(`${PS}class B { static first(): P { return ps[0]; } } B.first().x = 4;`);
});

test('the spelling that was meant is accepted', () => {
  // Bind the result, change it, and store it back.
  expect(evaluated(`${P}class B { p: P; get inner(): P { return this.p; } set inner(v: P) { this.p = v; } } const b: B = new B(); const v = b.inner; v.x = 4; b.inner = v; String(b.p.x);`)).toBe('4');
  expect(evaluated(`${PS}const pick = (i: uint8): P => ps[i]; const p = pick(0); p.x = 3; ps[0] = p; String(ps[0].x);`)).toBe('3');
  // Store through the field's own path.
  expect(evaluated(`${P}class B { p: P; get inner(): P { return this.p; } } const b: B = new B(); b.p.x = 4; String(b.inner.x);`)).toBe('4');
  // A reading of a result, and a call on one, are not stores.
  expect(evaluated(`${PS}const pick = (i: uint8): P => ps[i]; String(pick(0).x);`)).toBe('0');
});

test('a result that is not a copy is not judged', () => {
  // A function declared to return `ref` answers a location, and the store reaches it.
  expect(evaluated(`${PS}{ function at0(): ref P { return ref ps[0]; } at0().x = 4; } String(ps[0].x);`)).toBe('4');
  expect(evaluated(`${PS}{ function at0() { return ref ps[0]; } at0().x = 4; } String(ps[0].x);`)).toBe('4');
  expect(evaluated(`${P}class B { p: P; get inner(): ref P { return ref this.p; } } const b: B = new B(); b.inner.x = 4; String(b.p.x);`)).toBe('4');
  expect(evaluated(`${P}class B { p: P; at0(): ref P { return ref this.p; } } const b: B = new B(); b.at0().x = 4; String(b.p.x);`)).toBe('4');
  // A built-in may answer the value it was given.
  expect(evaluated('const a: [3].<uint8> = [3, 1, 2]; a.sort()[0] = 9; a.join();')).toBe('9,2,3');
  expect(evaluated(`${P}const holder = { p: new P() }; { const f: () => P = Reflect.get.bind(null, holder, "p"); f().x = 4; } String(holder.p.x);`)).toBe('4');
  expect(evaluated(`${P}const checked: uint8 = 0; const m = new Map(); m.set("k", new P()); m.get("k").x = 9; String(m.get("k").x);`)).toBe('9');
  // A reference class's result is a reference: the store reaches the object.
  expect(evaluated('reference class R { v: uint8; } const r0: R = new R(); const mk = (): R => r0; mk().v = 7; String(r0.v);')).toBe('7');
  // An accessor field and a plain field are storage, and a path through them is in place.
  expect(evaluated(`${P}class B { accessor p: P; } const b: B = new B(); b.p.x = 4; String(b.p.x);`)).toBe('4');
  expect(evaluated(`${P}class B { p: P; } const b: B = new B(); b.p.x = 4; String(b.p.x);`)).toBe('4');
});

test('a result whose function is not certain is not judged', () => {
  // A subclass of a reference class may declare the member a field, which a store reaches.
  expect(evaluated(`${P}reference class B { p: P; get inner(): P { return this.p; } } reference class C extends B { inner: P; } const c: B = new C(); c.inner.x = 4; String(c.inner.x);`)).toBe('4');
  expect(evaluated(`${P}reference class B { p: P; get inner(): P { return this.p; } } const b: B = new B(); b.inner.x = 4; String(b.p.x);`)).toBe('0');
  // `this` may be of a subclass too.
  expect(evaluated(`${P}class B { p: P; get inner(): P { return this.p; } poke(): void { this.inner.x = 4; } } class C extends B { inner: P; } const c: C = new C(); c.poke(); String(c.inner.x);`)).toBe('4');
  // A name narrowed to the class may hold a subclass's value.
  expect(evaluated(`${P}class B { p: P; get inner(): P { return this.p; } } class C extends B { inner: P; } function f(v: B | C): string { if (v instanceof B) { v.inner.x = 4; } return String(v.inner.x); } f(new C());`)).toBe('4');
  // A function that was assigned to, and one declared at the top level of a script.
  expect(evaluated(`${PS}{ function pick(i: uint8): P { return ps[i]; } pick = () => ps[0]; pick(0).x = 4; } String(ps[0].x);`)).toBe('0');
  expect(evaluated(`${PS}function pick(i: uint8): P { return ps[i]; } pick(0).x = 1; String(ps[0].x);`)).toBe('0');
  // Outside checked code nothing is judged.
  expect(evaluated('class P { x: uint8; } const ps = [new P()]; const pick = (i) => ps[i]; pick(0).x = 1; String(ps[0].x);')).toBe('0');
});

/**
 * A binding of `P | undefined`: what a typed `Map`'s `get`, and `at` and
 * `find`, answer. The path form `m.get(k).x = 9` is already refused, because
 * the result may be `undefined`; the form that is written binds and narrows,
 * and the binding holds a copy as a binding of `P` does.
 */
test('a store to a binding of a value type or undefined is refused', () => {
  lost(`${P}const m = new Map.<string, P>(); function f() { const g = m.get("k"); if (g !== undefined) g.x = 9; }`);
  lost(`${PS}function f() { const g = ps.at(0); if (g !== undefined) { g.x = 9; } }`);
  lost(`${PS}function f() { const g = ps.at(0); if (g) g.x = 9; }`);
  lost(`${PS}function f() { const g = ps.find((p) => p.x === 0); if (g != null) g.x = 9; }`);
  lost(`${PS}function f() { const g = ps.at(0); if (g === undefined) return; g.x = 9; }`);
  lost(`${PS}function f() { const g = ps.at(0); if (!g) return; g.x = 9; }`);
  lost(`${P}function poke(g: P | undefined): void { if (g !== undefined) g.x = 9; }`);
  lost(`${P}function poke(g: P | null): void { if (g !== null) g.x = 9; }`);
});

test('a binding of a value type or undefined that is used is not judged', () => {
  // Stored back: the copy was the program's own.
  expect(evaluated(`${P}const m = new Map.<string, P>(); m.set("k", new P()); function f() { const g = m.get("k"); if (g !== undefined) { g.x = 9; m.set("k", g); } } f(); const r = m.get("k"); String(r !== undefined ? r.x : -1);`)).toBe('9');
  expect(evaluated(`${PS}function f(): string { const g = ps.at(0); if (g) { g.x = 9; return String(g.x); } return 'none'; } f();`)).toBe('9');
  // Compared with another value: its fields are read.
  expect(evaluated(`${PS}const q: P = new P(); function f() { const g = ps.at(0); if (g !== undefined) g.x = 9; return g === q; } String(f());`)).toBe('false');
  // `const ref` is the element itself.
  expect(evaluated(`${PS}function f() { const ref g = ps[0]; g.x = 9; } f(); String(ps[0].x);`)).toBe('9');
  // A union of two value types is not one copy type, and is not judged.
  expect(evaluated(`${P}class Q { x: float32; } function poke(g: P | Q): void { g.x = 9; } poke(new P()); 'ok';`)).toBe('ok');
});
