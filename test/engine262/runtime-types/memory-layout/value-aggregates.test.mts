import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * A fixed-length array of a value type, and a tuple of value types, are value
 * types. The specification names the first where it lists the value types,
 * and the design says of the second that it "is itself a value type laid out
 * contiguously". The layout table lays a fixed array out inline, and the
 * memory layout document says when that is a layout decision and not a
 * semantic one: "Store copies, read copies, equality is structural, and the
 * value cannot be held weakly. Those four are the complete set of channels
 * through which a heap allocation makes itself known." Every array and tuple
 * was an object reached by reference, so all four were open.
 *
 * #sec-value-type-copying then applies as it does to a value type class:
 * bound, assigned, stored, passed and returned, each copies.
 */
const fixed = 'const a: [2].<uint8> = [1, 2]; ';
const tuple = 'const t: [uint8, uint8] = [1, 2]; ';
const grid = 'const m: [2].<[2].<uint8>> = [[1, 2], [3, 4]]; ';
const pairs = 'const ts: [2].<[uint8, uint8]> = [[1, 2], [3, 4]]; ';

test('binding one copies it', () => {
  expect(evaluated(`${fixed}const b = a; b[0] = 9; String(a[0]) + String(b[0]);`)).toBe('19');
  expect(evaluated(`${tuple}const u = t; u[0] = 9; String(t[0]) + String(u[0]);`)).toBe('19');
  expect(evaluated(`${fixed}let b: [2].<uint8> = [0, 0]; b = a; b[1] = 9; String(a[1]) + String(b[1]);`)).toBe('29');
  // Whether or not a type is written, and through `any`.
  expect(evaluated(`${fixed}const y: any = a; y[0] = 9; String(a[0]) + String(y[0]);`)).toBe('19');
  // A defaulted position is filled, so the tuple still has one length.
  expect(evaluated('const t: [uint8, uint8 = 5] = [1]; const u = t; u[0] = 9; String(t.length) + String(t[1]) + String(t[0]) + String(u[0]);')).toBe('2519');
});

test('a read out of a slot copies, and a store into one copies in', () => {
  expect(evaluated(`${grid}const r = m[0]; r[0] = 9; String(m[0][0]) + String(r[0]);`)).toBe('19');
  expect(evaluated(`${pairs}const c = ts[0]; c[0] = 9; String(ts[0][0]) + String(c[0]);`)).toBe('19');
  // Two slots are never one storage.
  expect(evaluated(`${grid}m[1] = m[0]; m[1][0] = 9; String(m[0][0]) + String(m[1][0]);`)).toBe('19');
  expect(evaluated(`${pairs}ts[1] = ts[0]; ts[1][0] = 9; String(ts[0][0]) + String(ts[1][0]);`)).toBe('19');
  expect(evaluated('class M { q: [2].<uint8>; } const o = new M(); const other: [2].<uint8> = [5, 6]; o.q = other; other[0] = 9; String(o.q[0]);')).toBe('5');
  expect(evaluated('class M { q: [2].<uint8>; } const o = new M(); const q = o.q; q[0] = 9; String(o.q[0]) + String(q[0]);')).toBe('09');
  // A literal at a typed array's annotation stores each element it names.
  expect(evaluated(`${fixed}const m: [1].<[2].<uint8>> = [a]; m[0][0] = 9; String(a[0]);`)).toBe('1');
});

test('passing and returning one copies it', () => {
  expect(evaluated(`${fixed}function f(p: [2].<uint8>): [2].<uint8> { p[0] = 9; return p; } const b = f(a); String(a[0]) + String(b[0]);`)).toBe('19');
  expect(evaluated(`${pairs}function g(): [uint8, uint8] { return ts[0]; } const r = g(); r[0] = 9; String(ts[0][0]) + String(r[0]);`)).toBe('19');
  expect(evaluated(`${pairs}function f(p: [uint8, uint8]) { p[0] = 9; return p[0]; } String(f(ts[0])) + String(ts[0][0]);`)).toBe('91');
  // An untyped function is given a copy too, as it is of a value type class.
  expect(evaluated(`${fixed}function swap(arr, i, j) { const x = arr[i]; arr[i] = arr[j]; arr[j] = x; } swap(a, 0, 1); a.join('');`)).toBe('12');
});

test('a store through a path is in place, and so is a method', () => {
  expect(evaluated(`${grid}m[0][1] = 5; String(m[0][1]);`)).toBe('5');
  expect(evaluated('class M { q: [2].<uint8>; set(i: uint8, v: uint8): void { this.q[i] = v; } } const o = new M(); o.q[0] = 5; o.set(1, 7); String(o.q[0]) + String(o.q[1]);')).toBe('57');
  expect(evaluated("const v: [3].<uint8> = [3, 1, 2]; v.sort(); v.reverse(); v.join('');")).toBe('321');
  expect(evaluated('const hist: [3].<uint32>; function bump(i: uint8) { hist[i] += 1; } bump(1); bump(1); String(hist[1]);')).toBe('2');
});

test('the caller\'s array is written through ref, a window, or const ref', () => {
  const v = 'const v: [3].<float32> = [1, 2, 3]; ';
  expect(evaluated(`${v}function scale(ref out: [3].<float32>, k: float32) { out[0] *= k; } scale(ref v, 2); String(v[0]);`)).toBe('2');
  // A window parameter is over the caller's array: nothing is copied into it.
  expect(evaluated(`${v}function scale(out: Span.<float32, 3>, k: float32) { out[0] *= k; } scale(v, 2); String(v[0]);`)).toBe('2');
  expect(evaluated(`${v}function first(xs: ReadonlySpan.<float32>): float32 { v[0] = 7; return xs[0]; } String(first(v));`)).toBe('7');
  expect(evaluated(`${fixed}function swap(arr, i, j) { const x = arr[i]; arr[i] = arr[j]; arr[j] = x; } const w: Span.<uint8> = a; swap(w, 0, 1); a.join('');`)).toBe('21');
  expect(evaluated(`${grid}for (const ref row of m) row[0] = 9; String(m[0][0]) + String(m[1][0]);`)).toBe('99');
  expect(evaluated(`${pairs}const ref e = ts[0]; e[1] += 1; String(ts[0][1]);`)).toBe('3');
  expect(evaluated('class Stack { items: [4].<uint8>; top: uint8; push(x: uint8): void { const ref items = this.items; items[this.top] = x; this.top += 1; } } const s = new Stack(); s.push(5); String(s.items[0]);')).toBe('5');
});

test('equal contents are one value: ===, and one key in a Map or a Set', () => {
  expect(evaluated('const u: [2].<uint8> = [1, 2]; const v: [2].<uint8> = [1, 2]; const w: [2].<uint8> = [1, 3]; String(u === v) + String(u === w);')).toBe('truefalse');
  expect(evaluated('const t: [uint8, uint8] = [1, 2]; const u: [uint8, uint8] = [1, 2]; String(t === u) + String(t == u);')).toBe('truetrue');
  expect(evaluated('const seen = new Set(); const a: [uint8, uint8] = [1, 2]; const b: [uint8, uint8] = [1, 2]; seen.add(a); String(seen.has(b)) + String(seen.size);')).toBe('true1');
  expect(evaluated("const m = new Map(); const k1: [2].<uint8> = [1, 2]; const k2: [2].<uint8> = [1, 2]; m.set(k1, 'v'); String(m.get(k2));")).toBe('v');
  // Distinct types are distinct values, as two classes with one layout are.
  expect(evaluated('const a: [2].<uint8> = [1, 2]; const t: [uint8, uint8] = [1, 2]; const y: any = a; const z: any = t; String(y === z);')).toBe('false');
});

test('one cannot be held weakly', () => {
  expect(observeScript('const a: [2].<uint8> = [1, 2]; new WeakRef(a);')).toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-weak-target' } });
  expect(observeScript('const t: [uint8, uint8] = [1, 2]; new WeakRef(t);')).toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-weak-target' } });
  // Where the checking pass did not see it, the run time refuses it.
  expect(evaluated("const a: [2].<uint8> = [1, 2]; function f(v: any) { return new WeakRef(v); } try { f(a); 'held'; } catch (e) { e.constructor.name; }")).toBe('TypeError');
  expect(evaluated("const g: [].<uint8> = [1]; function f(v: any) { return new WeakRef(v); } f(g); 'held';")).toBe('held');
});

test('a tuple of value types has a layout, and a class holding one is a value type class', () => {
  expect(evaluated('type T = [uint8, uint8]; String(T.byteLength) + String(T.hasLayout);')).toBe('2true');
  expect(evaluated('type T = [uint8, uint32]; String(T.byteLength);')).toBe('8');
  expect(evaluated('class P { p: [uint8, uint8]; n: uint8; } String(P.byteLength); ')).toBe('3');
  expect(evaluated('class P { p: [uint8, uint8]; n: uint8; } const xs: [1].<P>; const c = xs[0]; c.p[0] = 9; c.n = 7; String(xs[0].p[0]) + String(xs[0].n) + String(c.n);')).toBe('007');
  // A copy of a class is whole: the array inside it is copied with it.
  expect(evaluated('class M { q: [2].<uint8>; } const xs: [1].<M>; const c = xs[0]; c.q[0] = 8; String(xs[0].q[0]) + String(c.q[0]);')).toBe('08');
  expect(evaluated('class M { q: [2].<uint8>; } const a = new M(); const b = a; b.q[0] = 8; String(a.q[0]) + String(a === b);')).toBe('0false');
});

test('a copying member gives arrays and tuples of the caller\'s own', () => {
  expect(evaluated(`${grid}const s = m.slice(); s[0][0] = 9; String(m[0][0]) + String(s[0][0]);`)).toBe('19');
  expect(evaluated(`${pairs}const s = ts.slice(); s[0][0] = 9; String(ts[0][0]) + String(s[0][0]);`)).toBe('19');
  // Through a read-only window too: the copy is not read-only.
  expect(evaluated(`${pairs}function f(xs: ReadonlySpan.<[uint8, uint8]>): string { const c = xs[0]; c[0] = 7; const s = xs.slice(); s[1][0] = 8; return String(c[0]) + String(s[1][0]) + String(ts[0][0]) + String(ts[1][0]); } f(ts);`)).toBe('7813');
});

test('what is not a value type is as it was', () => {
  // A dynamic array owns storage reached by reference.
  expect(evaluated('const g: [].<uint8> = [1]; const h = g; h.push(2); String(g.length) + String(g === h);')).toBe('2true');
  // A position that is a reference makes the whole a reference type.
  expect(evaluated('class R { x; } const t: [uint8, R] = [1, new R()]; const u = t; u[0] = 9; String(t[0]);')).toBe('9');
  expect(evaluated('class R { x; } const rs: [2].<R | null> = [null, null]; const q = rs; q[0] = new R(); String(rs[0] !== null);')).toBe('true');
  // A plain object's property holds a reference to one (#sec-value-type-copying).
  expect(evaluated(`${fixed}const o = { a }; o.a[1] = 8; String(a[1]);`)).toBe('8');
});
