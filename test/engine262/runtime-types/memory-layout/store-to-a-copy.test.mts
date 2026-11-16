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
  // Built in place: a construction and a call's result.
  expect(evaluated(`${P}function make(): void { const p = new P(); p.x = 1; } make(); 'ok';`)).toBe('ok');
  expect(evaluated(`${P}const ps: [2].<P>; function f(): void { const p = ps.at(0); if (p !== undefined) p.x = 9; } f(); String(ps[0].x);`)).toBe('0');
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
