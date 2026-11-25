import { expect, test } from 'vitest';
import { evaluated, expectThrown, observeScript } from '../harness.mts';

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
const P = 'value class P { x: float32; y: float32; step(): void { this.x += 1; } } ';
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
  lost('value class In { n: uint8; } value class Out { i: In; k: uint8; } function f(o: Out) { o.i.n = 3; }');
  // In a loop, where the only read is the compound operator's own.
  lost('function scaleAll(out: [3].<float32>, k: float32) { for (let i: uint8 = 0; i < 3; i += 1) out[i] *= k; }');
  // An earlier store that is read is fine; the last one is lost.
  lost(`${P}function f(p: P): float32 { p.x = 1; const r = p.x; p.y = 2; return r; }`);
});

test('a store to a binding copied from a name, a field or an element is refused', () => {
  lost('value class Stack { items: [4].<uint8>; top: uint8; push(x: uint8): void { const items = this.items; items[this.top] = x; this.top += 1; } }');
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
  expect(evaluated('value class Stack { items: [4].<uint8>; top: uint8; push(x: uint8): void { this.items[this.top] = x; this.top += 1; } } const s = new Stack(); s.push(5); String(s.items[0]);')).toBe('5');
});

test('a copy that is used is the program\'s own, and is untouched', () => {
  expect(evaluated(`${P}function f(p: P): float32 { p.x = 1; return p.x; } String(f(new P()));`)).toBe('1');
  expect(evaluated('function f(p: [2].<uint8>): [2].<uint8> { p[0] = 9; return p; } const a: [2].<uint8> = [1, 2]; String(f(a)[0]) + String(a[0]);')).toBe('91');
  // A call of a method that reads what it stores is a read of it.
  expect(evaluated(`${P}function f(p: P): float32 { p.x = 1; p.step(); return p.x; } String(f(new P()));`)).toBe('2');
  expect(evaluated(`${P}function g(q: P): float32 { return q.x; } function f(p: P): float32 { p.x = 4; return g(p); } String(f(new P()));`)).toBe('4');
  // A read in a later turn of a loop follows the store.
  expect(evaluated('function f(c: [2].<uint8>): uint8 { let t: uint8 = 0; for (let i: uint8 = 0; i < 2; i += 1) { t += c[0]; c[0] = 5; } return t; } const a: [2].<uint8> = [1, 2]; String(f(a));')).toBe('6');
});

/**
 * Question BW, BW2': a call, as a statement, of a method of the value class
 * that does nothing but store to the value - its body reads its parameters,
 * its own bindings and fields of `this`, and stores to fields of `this`,
 * directly or through other such methods, on every path - is a store to the
 * copy. Nothing reads the copy afterwards, so the call has no effect at all.
 */
const M = 'value class M { n: uint8 = 0; m: uint8 = 0; bump(): void { this.n = this.n + 1; } set(a: uint8, b: uint8): void { if (a > b) { this.n = a; } else { this.m = b; } } '
  + 'twice(): void { this.bump(); this.bump(); } swap(): void { const t = this.n; this.n = this.m; this.m = t; } total(): uint8 { return this.n + this.m; } '
  + 'logs(): void { console.log(this.n); this.n = 1; } fails(): void { throw new Error("no"); } loops(): void { for (let i: uint8 = 0; i < 2; i += 1) this.n += 1; } '
  + 'elsewhere(o: { v: uint8 }): void { o.v = this.n; } } const ms: [2].<M>; ';
test('a call of a method that only stores to the value, on a copy nothing reads after it, is refused', () => {
  lost(`${M}function f() { const p = ms[0]; p.bump(); }`);
  lost(`${M}function f() { const p = ms[0]; p.set(1, 2); }`);
  lost(`${M}function f() { const p = ms[0]; p.twice(); }`);
  lost(`${M}function f() { const p = ms[0]; p.swap(); }`);
  lost(`${M}function f(p: M) { p.bump(); }`);
  lost(`${M}function f() { for (const p of ms) p.bump(); }`);
  // A store the call then reads is read, and the call is the store that is lost.
  lost(`${M}function f() { const p = ms[0]; p.n = 3; p.bump(); }`);
  lost(`${P}function f(p: P): void { p.x = 1; p.step(); }`);
  expectThrown(`${M}function f() { const p = ms[0]; p.bump(); }`, 'is a copy and nothing reads it after this call, which only stores to it, so the call is lost');
});

test('a call that may do more than store to the value, or whose value is read, is the program\'s own', () => {
  // A call made for another effect: output, a throw, a loop that may not end, a store elsewhere.
  for (const call of ['p.logs()', 'p.fails()', 'p.loops()', 'p.elsewhere({ v: 0 })']) {
    expect(evaluated(`${M}function f() { const p = ms[0]; ${call}; } 'ok';`), call).toBe('ok');
  }
  // A method that only reads is not a store.
  expect(evaluated(`${M}function f() { const p = ms[0]; p.total(); } 'ok';`)).toBe('ok');
  // The copy is read afterwards, stored back, or is not a copy.
  expect(evaluated(`${M}function f(): uint8 { const p = ms[0]; p.bump(); return p.n; } String(f());`)).toBe('1');
  expect(evaluated(`${M}function f() { const p = ms[0]; p.bump(); ms[0] = p; } f(); String(ms[0].n);`)).toBe('1');
  expect(evaluated(`${M}function f(ref p: M) { p.bump(); } f(ref ms[0]); String(ms[0].n);`)).toBe('1');
  expect(evaluated(`${M}function f() { ms[0].bump(); } f(); String(ms[0].n);`)).toBe('1');
  expect(evaluated(`${M}function f() { const p = new M(); p.bump(); } f(); 'ok';`)).toBe('ok');
  // A subclass may declare the method again, and run its own.
  expect(evaluated(`${M}value class N extends M { bump(): void { console.log(this.n); } } function f() { const p = ms[0]; p.bump(); } 'ok';`)).toBe('ok');
  // An overload may be the one the call selects, whichever is declared last.
  for (const body of ['step(): void { this.x += 1; } step(n: uint8): void { console.log(n); }', 'step(n: uint8): void { console.log(n); } step(): void { this.x += 1; }']) {
    expect(evaluated(`value class O { x: uint8 = 0; ${body} } function g(os: [].<O>) { const p = os[0]; p.step(1); } 'ok';`), body).toBe('ok');
  }
});

test('a binding that is not a copy is not judged', () => {
  // Built in place: a construction.
  expect(evaluated(`${P}function make(): void { const p = new P(); p.x = 1; } make(); 'ok';`)).toBe('ok');
  // Reached by reference: a reference class, a class that holds a reference, a dynamic array.
  expect(evaluated('class R { x: uint8; } function f(r: R) { r.x = 5; } const r = new R(); f(r); String(r.x);')).toBe('5');
  expect(evaluated("class N { name: string; tags: [].<string> = []; } function f(n: N) { n.name = 'b'; } const n = new N(); f(n); String(n.name);")).toBe('b');
  // A class with a `string` in it and no reference is a value with no layout, and is judged
  // (classes/value-class-without-layout.test.mts).
  expect(observeScript("value class N { name: string; } function f(n: N) { n.name = 'b'; } f(new N());"))
    .toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-store-to-copy' } });
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
  lost(`${P}value class Q { n: uint8; grow(): void { const self = this; self.n = 5; } }`);
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
  lost(`${P}value class Q { p: P; t: [uint8, uint8]; } const q0: Q = new Q(); const mk = (): Q => q0; mk().p.x = 1;`);
  lost(`${P}value class Q { p: P; t: [uint8, uint8]; } const q0: Q = new Q(); const mk = (): Q => q0; mk().t[1] = 1;`);
  lost(`${P}value class Q { p: P; } const q0: Q = new Q(); const mk = (): Q => q0; mk().p = new P();`);
  // A fixed-length array and a tuple are values, and are returned as copies.
  lost('const src: [2].<uint8> = [1, 2]; const both = (): [2].<uint8> => src; both()[0] = 9;');
  lost('const src: [uint8, uint8] = [1, 2]; const both = (): [uint8, uint8] => src; both()[0] = 9;');
});

test('a store to the result of a method or a getter of a value type class is refused', () => {
  lost(`${P}value class B { p: P; get(): P { return this.p; } } const b: B = new B(); b.get().x = 4;`);
  lost(`${P}value class B { p: P; get inner(): P { return this.p; } } const b: B = new B(); b.inner.x = 4;`);
  lost(`${P}value class B { p: P; get inner(): P { return this.p; } } function f(b: B) { b.inner.x = 4; }`);
  lost(`${P}value class B { p: P; get inner(): P { return this.p; } } const checked: uint8 = 0; const b = new B(); b.inner.x = 4;`);
  // A setter beside the getter does not run: the store is to the getter's result.
  lost(`${P}value class B { p: P; get inner(): P { return this.p; } set inner(v: P) { this.p = v; } } const b: B = new B(); b.inner.x = 4;`);
  // The receiver is reached through storage declared to hold that class.
  lost(`${P}value class B { p: P; get inner(): P { return this.p; } } class E { b: B; } const e: E = new E(); e.b.inner.x = 4;`);
  lost(`${P}value class B { p: P; get inner(): P { return this.p; } } const bs: [].<B> = [new B()]; bs[0].inner.x = 4;`);
  lost(`${P}value class B { p: P; get inner(): P { return this.p; } } const bs: [2].<B>; bs[1].inner.x = 4;`);
  // A static method of a class named where it is called.
  lost(`${PS}class B { static first(): P { return ps[0]; } } B.first().x = 4;`);
});

test('the spelling that was meant is accepted', () => {
  // Bind the result, change it, and store it back.
  expect(evaluated(`${P}value class B { p: P; get inner(): P { return this.p; } set inner(v: P) { this.p = v; } } const b: B = new B(); const v = b.inner; v.x = 4; b.inner = v; String(b.p.x);`)).toBe('4');
  expect(evaluated(`${PS}const pick = (i: uint8): P => ps[i]; const p = pick(0); p.x = 3; ps[0] = p; String(ps[0].x);`)).toBe('3');
  // Store through the field's own path.
  expect(evaluated(`${P}value class B { p: P; get inner(): P { return this.p; } } const b: B = new B(); b.p.x = 4; String(b.inner.x);`)).toBe('4');
  // A reading of a result, and a call on one, are not stores.
  expect(evaluated(`${PS}const pick = (i: uint8): P => ps[i]; String(pick(0).x);`)).toBe('0');
});

test('a result that is not a copy is not judged', () => {
  // A function declared to return `ref` answers a location, and the store reaches it.
  expect(evaluated(`${PS}{ function at0(): ref P { return ref ps[0]; } at0().x = 4; } String(ps[0].x);`)).toBe('4');
  expect(evaluated(`${PS}{ function at0() { return ref ps[0]; } at0().x = 4; } String(ps[0].x);`)).toBe('4');
  expect(evaluated(`${P}value class B { p: P; get inner(): ref P { return ref this.p; } } const b: B = new B(); b.inner.x = 4; String(b.p.x);`)).toBe('4');
  expect(evaluated(`${P}value class B { p: P; at0(): ref P { return ref this.p; } } const b: B = new B(); b.at0().x = 4; String(b.p.x);`)).toBe('4');
  // A built-in may answer the value it was given.
  expect(evaluated('const a: [3].<uint8> = [3, 1, 2]; a.sort()[0] = 9; a.join();')).toBe('9,2,3');
  expect(evaluated(`${P}const holder = { p: new P() }; { const f: () => P = Reflect.get.bind(null, holder, "p"); f().x = 4; } String(holder.p.x);`)).toBe('4');
  expect(evaluated(`${P}const checked: uint8 = 0; const m = new Map(); m.set("k", new P()); m.get("k").x = 9; String(m.get("k").x);`)).toBe('9');
  // A reference class's result is a reference: the store reaches the object.
  expect(evaluated('class R { v: uint8; } const r0: R = new R(); const mk = (): R => r0; mk().v = 7; String(r0.v);')).toBe('7');
  // An accessor field and a plain field are storage, and a path through them is in place.
  expect(evaluated(`${P}value class B { accessor p: P; } const b: B = new B(); b.p.x = 4; String(b.p.x);`)).toBe('4');
  expect(evaluated(`${P}value class B { p: P; } const b: B = new B(); b.p.x = 4; String(b.p.x);`)).toBe('4');
});

/**
 * Question D, D6: a getter or a method of a class held by reference is judged
 * by the class that declares it, as one of a value class is. Along every chain
 * the checker sees a field cannot replace an inherited accessor
 * (member-kinds.test.mts), and an override keeps its result's contract, so
 * what the class declares holds for every value typed as the class. Its
 * instances are sealed with every member declared, so none is given an own
 * property over the member.
 */
test('a store to the result of a method or a getter of a class held by reference is refused', () => {
  lost(`${P}class B { p: P; get inner(): P { return this.p; } } const b: B = new B(); b.inner.x = 4;`);
  lost(`${P}class B { p: P; at(): P { return this.p; } } const b: B = new B(); b.at().x = 4;`);
  lost(`${P}class B { p: P; get inner(): P { return this.p; } } function f(b: B) { b.inner.x = 4; }`);
  lost(`${P}class B { p: P; get inner(): P { return this.p; } } class H { b: B = new B(); } const h: H = new H(); h.b.inner.x = 4;`);
  // An override keeps the contract, so the base's declaration answers for it.
  lost(`${P}class B { p: P; at(): P { return this.p; } } class D extends B { at(): P { return this.p; } } const b: B = new D(); b.at().x = 4;`);
  lost(`${P}class B { p: P; at(): P { return this.p; } } class D extends B { at: () => P = () => this.p; } const b: B = new D(); b.at().x = 4;`);
  // The refusal names the declaration.
  expect(observeScript(`${P}class Shape { o: P; get origin(): P { return this.o; } } function nudge(s: Shape) { s.origin.x = 1; }`).diagnostic)
    .toMatchObject({ rule: 'rt-store-to-copy' });
});

test('a result whose function is not certain is not judged', () => {
  // A class whose instances are not sealed may be given an own property over the getter, which a store reaches.
  expect(evaluated(`${P}class B { get inner(): P { return new P(); } } const b: B = new B(); const q = new P(); Object.defineProperty(b, "inner", { value: q }); b.inner.x = 4; String(q.x);`)).toBe('4');
  expect(evaluated(`${P}dynamic class B { p: P; get inner(): P { return this.p; } } const b: B = new B(); b.inner.x = 4; String(b.p.x);`)).toBe('0');
  // A field declared `any` may replace the method with a function that answers a location.
  expect(evaluated(`${P}class B { p: P; at(): P { return this.p; } } class D extends B { at: any = function (): ref P { return ref this.p; }; } const b: B = new D(); b.at().x = 4; String(b.p.x);`)).toBe('4');
  // An overload that answers a location may be the one a call selects, whichever is declared last.
  for (const body of ['get(i: uint8): ref P { return ref this.p; } get(): P { return this.p; }', 'get(): P { return this.p; } get(i: uint8): ref P { return ref this.p; }']) {
    expect(evaluated(`${P}class B { p: P; ${body} } function f(b: B): float32 { b.get(0).x = 4; return b.p.x; } String(f(new B()));`), body).toBe('4');
  }
  // A key the checker cannot read may be the member's name, and a field of it replaces the getter.
  expect(evaluated(`${P}class B { p: P; get inner(): P { return this.p; } } function key(): string { return "inner"; } class D extends B { [key()]: P; } function f(b: B): float32 { b.inner.x = 4; return b.inner.x; } String(f(new D()));`)).toBe('4');
  // `this` and a name narrowed to the class are not receivers of the rule.
  expect(evaluated(`${P}class B { p: P; get inner(): P { return this.p; } poke(): void { this.inner.x = 4; } } const b: B = new B(); b.poke(); String(b.p.x);`)).toBe('0');
  expect(evaluated(`${P}class B { p: P; get inner(): P { return this.p; } } function f(v: B | undefined): string { if (v !== undefined) { v.inner.x = 4; } return "ok"; } f(new B());`)).toBe('ok');
  // A function that was assigned to, and one declared at the top level of a script.
  expect(evaluated(`${PS}{ function pick(i: uint8): P { return ps[i]; } pick = () => ps[0]; pick(0).x = 4; } String(ps[0].x);`)).toBe('0');
  expect(evaluated(`${PS}function pick(i: uint8): P { return ps[i]; } pick(0).x = 1; String(ps[0].x);`)).toBe('0');
  // Outside checked code nothing is judged.
  expect(evaluated('value class P { x: uint8; } const ps = [new P()]; const pick = (i) => ps[i]; pick(0).x = 1; String(ps[0].x);')).toBe('0');
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
  expect(evaluated(`${P}value class Q { x: float32; } function poke(g: P | Q): void { g.x = 9; } poke(new P()); 'ok';`)).toBe('ok');
});

test('a store to a copy an object pattern binds is refused', () => {
  // #sec-store-to-a-copy: the binding is a copy of the member the pattern reads, and the checker
  // has that member's type.
  const H = `${P}value class H { p: P; } value class O { h: H; } const h: H = new H(); const o: O = new O(); const hs: [].<H> = [new H()]; `;
  lost(`${H}function f() { const { p } = h; p.x = 9; }`);
  lost(`${H}function f() { const { p: q } = h; q.x = 9; }`);
  lost(`${H}function f() { const { h: { p } } = o; p.x = 9; }`);
  lost(`${H}function f() { for (const { p } of hs) { p.x = 9; } }`);
  // It runs as the rule says: the store changes nothing the program reads.
  expect(evaluated(`${H}function f() { const u: any = h; const { p } = u; p.x = 9; } f(); String(h.p.x);`)).toBe('0');
});

test('a pattern\'s binding that is used, defaulted or not a copy is not judged', () => {
  const H = `${P}value class H { p: P; } const h: H = new H(); `;
  expect(evaluated(`${H}function f(): float32 { const { p } = h; p.x = 9; return p.x; } String(f()) + String(h.p.x);`)).toBe('90');
  expect(evaluated(`${H}function f(): P { const { p } = h; p.x = 9; return p; } String(f().x) + String(h.p.x);`)).toBe('90');
  // A default is another source for the value.
  expect(evaluated(`${H}function f() { const { p = new P() } = h; p.x = 9; } f(); String(h.p.x);`)).toBe('0');
  // A rest collects references into a plain object, and the store lands.
  expect(evaluated(`${H}function f() { const { ...rest } = h; rest.p.x = 9; } f(); String(h.p.x);`)).toBe('9');
  // A member of a reference type is a reference.
  expect(evaluated('class R { x: uint8; } class H { r: R = new R(); } const h: H = new H(); function f() { const { r } = h; r.x = 9; } f(); String(h.r.x);')).toBe('9');
  // An array pattern takes its element through the iterator, and no type is established for it:
  // the store is lost, and is not judged.
  expect(evaluated(`${P}const ps: [].<P> = [new P()]; function f() { const [first] = ps; first.x = 9; } f(); String(ps[0].x);`)).toBe('0');
  // The top level of a script is read from outside it.
  expect(evaluated(`${H}const { p } = h; p.x = 9; String(h.p.x);`)).toBe('0');
});

test('a store to a callback\'s parameter typed by a declared function type is refused', () => {
  // The parameter is a copy of its argument whether or not it is annotated, and here the checker
  // has its type from the function type the callback is written for.
  const E = `${P}const ps: [].<P> = [new P()]; function each(xs: [].<P>, g: (p: P) => void) { for (const x of xs) g(x); } `;
  lost(`${E}function f() { each(ps, (p) => { p.x = 9; }); }`);
  lost(`${P}function f() { const g: (p: P) => void = (p) => { p.x = 9; }; g(new P()); }`);
  // With the annotation written, as before.
  lost(`${E}function f() { each(ps, (p: P) => { p.x = 9; }); }`);
  // A callback that reads what it changed is using its copy.
  expect(evaluated(`${P}const ps: [].<P> = [new P()]; function total(xs: [].<P>, g: (p: P) => float32): float32 { let n: float32 = 0; for (const x of xs) n += g(x); return n; } function f() { return total(ps, (p) => { p.x = 9; return p.x; }); } String(f()) + String(ps[0].x);`)).toBe('90');
  // A callback for a `ref` parameter says `ref`, and its store lands.
  expect(evaluated(`${P}const ps: [].<P> = [new P()]; function each(xs: [].<P>, g: (ref p: P) => void) { for (const ref x of xs) g(ref x); } function f() { each(ps, (ref p: P) => { p.x = 9; }); } f(); String(ps[0].x);`)).toBe('9');
  // A built-in's callback is given no type unless the built-in is established, and is not judged.
  expect(evaluated(`${P}const ps: [].<P> = [new P()]; function f() { ps.forEach((p) => { p.x = 9; }); } f(); String(ps[0].x);`)).toBe('0');
});
