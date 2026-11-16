import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

// The members of a window, sorted by what each does to the elements beneath.
// The engine keeps the same table (`WINDOW_MEMBERS_THAT_*`); it is written out
// again here so that a change to either is seen against the other.
const WINDOW_MEMBERS_THAT_READ = [
  'at', 'includes', 'indexOf', 'lastIndexOf', 'find', 'findIndex', 'findLast', 'findLastIndex', 'every', 'some',
  'forEach', 'reduce', 'reduceRight', 'join', 'toString', 'toLocaleString', 'keys', 'values', 'entries',
  'length', 'byteLength', 'byteOffset',
];
const WINDOW_MEMBERS_THAT_COPY = ['slice', 'concat', 'filter', 'map', 'flat', 'flatMap', 'toSorted', 'toReversed', 'toSpliced', 'with'];
const WINDOW_MEMBERS_THAT_NARROW = ['subarray', 'window'];
const WINDOW_MEMBERS_THAT_STORE = ['sort', 'reverse', 'fill', 'copyWithin', 'set'];
const WINDOW_MEMBERS_THAT_EXPOSE = ['buffer'];

/**
 * #sec-readonly-span-type: `ReadonlySpan.<T>` is the read-only window. An
 * array of either extent, a tuple and a `Span` coerce to it, at their own
 * element type or a wider one; nothing is stored through it; and because a
 * window is a value of its own, it carries the element type it was taken at,
 * which is what makes the wider element sound.
 */
const bytes = 'const bytes: [].<uint8> = [1, 2, 3]; ';
const refused = (source: string, rule = 'rt-readonly-store'): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });
};
const through = (body: string): string => `${bytes}function f(xs: ReadonlySpan.<uint8>) { ${body} }`;

test('an array of either extent, a tuple and a Span coerce, at a wider element too', () => {
  expect(evaluated(`${bytes}function count(xs: ReadonlySpan.<uint8 | string>) { return xs.length; } const four: [4].<uint8> = [1, 2, 3, 4]; `
    + "const pair: [uint8, string] = [1, 'a']; String(count(bytes)) + String(count(four)) + String(count(pair));")).toBe('342');
  expect(evaluated(`${bytes}function first(xs: ReadonlySpan.<uint8>): uint8 { return xs[0]; } function lend(xs: Span.<uint8>): uint8 { return first(xs); } String(lend(bytes));`)).toBe('1');
  expect(evaluated('const four: [4].<uint8> = [1, 2, 3, 4]; function f(xs: ReadonlySpan.<uint8, 4>): uint8 { return xs[3]; } String(f(four));')).toBe('4');
  refused(`${bytes}function f(xs: ReadonlySpan.<uint8, 3>) { return 1; } f(bytes);`, 'rt-assignability');
  refused(`${bytes}function f(xs: ReadonlySpan.<string>) { return 1; } f(bytes);`, 'rt-assignability');
});

test('it does not coerce back to an array or to a Span', () => {
  refused(`${bytes}function grow(xs: [].<uint8>) { xs.push(0); } function relay(xs: ReadonlySpan.<uint8>) { grow(xs); }`, 'rt-assignability');
  refused(`${bytes}function fill(xs: Span.<uint8>) { xs.fill(0); } function relay(xs: ReadonlySpan.<uint8>) { fill(xs); }`, 'rt-assignability');
  expect(evaluated(`${bytes}function grow(xs: [].<uint8>) { xs.push(0); return xs.length; } function relay(xs: ReadonlySpan.<uint8>) { return grow([...xs]); } String(relay(bytes)) + String(bytes.length);`)).toBe('43');
});

test('every read works', () => {
  expect(evaluated(`${bytes}function f(xs: ReadonlySpan.<uint8>): string { let t: uint8 = 0; for (const x of xs) t += x; `
    + "return String(t) + '/' + String(xs[0]) + '/' + xs.map((x) => x).join('') + '/' + String(xs.includes(2)) + String(xs.indexOf(3)) + '/' + xs.toSorted((a, b) => (b > a ? 1 : -1)).join(''); } f(bytes);"))
    .toBe('6/1/123/true2/321');
  expect(evaluated(`${bytes}function each(x: Iterable.<uint8>): uint8 { let t: uint8 = 0; for (const e of x) t += e; return t; } function pass(xs: ReadonlySpan.<uint8>): uint8 { return each(xs); } String(pass(bytes));`)).toBe('6');
});

test('every store the checker can see is refused where it is written', () => {
  for (const store of ['xs[0] = 1;', 'xs[0] += 1;', 'xs[1]++;', '[xs[0], xs[1]] = [xs[1], xs[0]];', 'xs.length = 0;',
    'xs.sort();', 'xs.reverse();', 'xs.fill(0);', 'xs.copyWithin(0, 1);', 'xs.set([7, 8], 1);', 'const b = xs.buffer;',
    'xs.subarray(1)[0] = 9;', 'xs.window.<2>(1)[0] = 9;', 'xs.forEach((x, i, all) => { all[0] = 9; });']) {
    refused(through(store));
  }
  refused(through('xs.push(1);'), 'rt-undeclared-member');
  refused(through('const s: Span.<uint8> = xs.subarray(1);'), 'rt-assignability');
});

test('a store the checker did not see throws, and the array is untouched', () => {
  const held = `${bytes}const v: ReadonlySpan.<uint8> = bytes; const y: any = v; `;
  expect(evaluated(`${held}try { y[0] = 9; 'wrote'; } catch (e) { e.constructor.name + String(bytes[0]); }`)).toBe('TypeError1');
  expect(evaluated(`${held}[typeof y.sort, typeof y.reverse, typeof y.fill, typeof y.copyWithin, typeof y.set, typeof y.map, typeof y.subarray].join(',');`))
    .toBe('undefined,undefined,undefined,undefined,undefined,function,function');
  expect(evaluated(`${held}const s: any = v.subarray(1); try { s[0] = 9; 'wrote'; } catch (e) { e.constructor.name; }`)).toBe('TypeError');
  expect(evaluated(`${held}try { Reflect.set(y, 0, 9); 'set'; } catch (e) { e.constructor.name + String(bytes[0]); }`)).toBe('TypeError1');
  // A `ref` to an element may be taken; a store through it throws.
  expect(evaluated(`${bytes}function inc(ref x: uint8) { x += 1; } function f(xs: ReadonlySpan.<uint8>) { inc(ref xs[0]); } try { f(bytes); 'stored'; } catch (e) { e.constructor.name + String(bytes[0]); }`))
    .toBe('TypeError1');
});

test('covariance is sound at run time: the window carries the type it was taken at', () => {
  // On the array itself, `includes('s')` through `any` is a TypeError, and a
  // slice keeps the array's element type. Through the widened window neither
  // is so.
  expect(evaluated(`${bytes}function widen(wide: ReadonlySpan.<uint8 | string>): string { const copy = wide.slice(); copy.push('s'); `
    + "return String(wide.includes('s')) + '/' + String(copy.length) + '/' + String(bytes.length); } widen(bytes);")).toBe('false/4/3');
  // A read-only window that carries a narrower type is restated at the wider one.
  expect(evaluated(`${bytes}function wide(xs: ReadonlySpan.<uint8 | string>): string { return String(xs.includes('s')); } function narrow(xs: ReadonlySpan.<uint8>): string { return wide(xs); } narrow(bytes);`)).toBe('false');
});

test('it is a value: the run-time test, liveness, and what it shows of the array beneath', () => {
  expect(evaluated(`${bytes}const v: ReadonlySpan.<uint8> = bytes; const w: Span.<uint8> = bytes; function t(x: any) { return String(x is ReadonlySpan.<uint8>) + String(x is Span.<uint8>); } `
    + "t(v) + '/' + t(w) + '/' + t(bytes);")).toBe('truefalse/falsetrue/falsefalse');
  expect(evaluated(`${bytes}const v: ReadonlySpan.<uint8> = bytes; bytes[0] = 9; const seen = String(v[0]); bytes.push(4); try { String(v[0]); } catch (e) { seen + '/' + e.constructor.name; }`))
    .toBe('9/TypeError');
  expect(evaluated('const u = new Uint8Array([5, 6, 7]); const v = Span.<uint8>(u.buffer); const r: ReadonlySpan.<uint8> = v; const y: any = r; '
    + "try { y[0] = 1; 'wrote'; } catch (e) { String(r[1]) + String(r.includes(7)) + e.constructor.name + String(u[0]); }")).toBe('6trueTypeError5');
});

test('an element stored inline is the storage; an element that is a reference is not', () => {
  const A = 'class A { a: uint8; b: uint8; total(): uint8 { return this.a + this.b; } } const as: [2].<A>; ';
  refused(`${A}function f(xs: ReadonlySpan.<A>) { xs[0].a = 7; }`);
  refused(`${A}function f(xs: ReadonlySpan.<A>) { xs[0].a += 1; }`);
  refused('function f(xs: ReadonlySpan.<[uint8, uint8]>) { xs[0][1] = 5; }');
  expect(evaluated(`${A}function f(xs: ReadonlySpan.<A>): uint8 { return xs[0].a + xs[0].total(); } as[0].a = 2; String(f(as));`)).toBe('4');
  // A copy is the reader's own.
  expect(evaluated(`${A}function f(xs: ReadonlySpan.<A>): uint8 { const c = xs[0]; c.a = 9; return c.a; } String(f(as)) + String(as[0].a);`)).toBe('90');
  // The window holds the reference, not the object it refers to.
  const R = 'class R { x: uint8 = 1; other; } const rs: [].<R> = [new R()]; ';
  expect(evaluated(`${R}function f(xs: ReadonlySpan.<R>) { xs[0].x = 5; } f(rs); String(rs[0].x);`)).toBe('5');
  refused(`${R}function f(xs: ReadonlySpan.<R>) { xs[0] = new R(); }`);
});

test('between Span and ReadonlySpan an array or a Span selects Span', () => {
  expect(evaluated(`${bytes}function f(xs: Span.<uint8>): string { return 'span'; } function f(xs: ReadonlySpan.<uint8>): string { return 'readonly'; } `
    + "const w: Span.<uint8> = bytes; const r: ReadonlySpan.<uint8> = bytes; f(bytes) + '/' + f(w) + '/' + f(r);")).toBe('span/span/readonly');
});

test('the table sorts every member of the array prototype', () => {
  // A member added to arrays fails this until someone says which it is; a
  // read-only window has only what the table gives it.
  const sorted = [...WINDOW_MEMBERS_THAT_READ, ...WINDOW_MEMBERS_THAT_COPY, ...WINDOW_MEMBERS_THAT_NARROW, ...WINDOW_MEMBERS_THAT_STORE, ...WINDOW_MEMBERS_THAT_EXPOSE];
  const notOnAWindow = ['constructor', 'push', 'pop', 'shift', 'unshift', 'splice', 'capacity', 'reserve', 'shrinkToFit'];
  const names = JSON.parse(evaluated('const a: [].<uint8> = [1]; JSON.stringify(Object.getOwnPropertyNames(Object.getPrototypeOf(a)).concat(Object.getOwnPropertyNames(Array.prototype)));') as string) as string[];
  expect([...new Set(names)].filter((name) => !sorted.includes(name) && !notOnAWindow.includes(name))).toEqual([]);
  const has = JSON.parse(evaluated(`${bytes}const v: ReadonlySpan.<uint8> = bytes; JSON.stringify(Object.getOwnPropertyNames(Object.getPrototypeOf(v)).sort());`) as string) as string[];
  expect(has).toEqual([...WINDOW_MEMBERS_THAT_READ, ...WINDOW_MEMBERS_THAT_COPY, ...WINDOW_MEMBERS_THAT_NARROW].sort());
});

/**
 * #sec-readonly-span-type: an element stored inline is read-only wherever it
 * goes until it is copied. #sec-value-type-copying lets a reference to one be
 * held - a plain object's property and a plain array's element "hold a
 * REFERENCE" - and a method's `this` and a `ref` are the element too. None of
 * those is a store the checking pass can see from the window, so each is
 * refused when it runs: the window hands out a read-only handle onto the
 * element, which is live, and of which a copy is the reader's own.
 */
const A = 'class A { a: uint8; b: uint8; #p: uint8; bump(): void { this.a += 1; } poke(): void { this.#p += 1; } total(): uint8 { return this.a + this.b + this.#p; } } const as: [2].<A>; ';

test('a method that reads runs on an inline element, and one that stores throws', () => {
  expect(evaluated(`${A}function f(xs: ReadonlySpan.<A>): uint8 { return xs[0].total(); } as[0].a = 2; as[0].b = 3; String(f(as));`)).toBe('5');
  expect(evaluated(`${A}function f(xs: ReadonlySpan.<A>): string { try { xs[0].bump(); return 'bumped'; } catch (e) { return e.constructor.name; } } f(as) + String(as[0].a);`)).toBe('TypeError0');
  // A private field is a field of the element.
  expect(evaluated(`${A}function f(xs: ReadonlySpan.<A>): string { try { xs[0].poke(); return 'poked'; } catch (e) { return e.constructor.name; } } f(as) + String(as[0].total());`)).toBe('TypeError0');
  // A value type nested inline inside the element.
  expect(evaluated('class In { n: uint8; } class Out { i: In; grow(): void { this.i.n += 1; } } const os: [1].<Out>; '
    + "function f(xs: ReadonlySpan.<Out>): string { try { xs[0].grow(); return 'grew'; } catch (e) { return e.constructor.name + String(os[0].i.n); } } f(os);")).toBe('TypeError0');
});

test('a reference to an inline element is live and read-only, and a ref to it stores nothing', () => {
  expect(evaluated(`${A}function f(xs: ReadonlySpan.<A>): string { const o = { e: xs[0] }; as[0].a = 7; let r = String(o.e.a); `
    + "try { o.e.a = 9; r += 'wrote'; } catch (e) { r += e.constructor.name; } return r + String(as[0].a); } f(as);")).toBe('7TypeError7');
  expect(evaluated(`${A}function f(xs: ReadonlySpan.<A>): string { const all = [...xs]; try { all[0].a = 9; return 'wrote'; } catch (e) { return e.constructor.name + String(as[0].a); } } f(as);`)).toBe('TypeError0');
  expect(evaluated(`${A}function set(ref v: A) { v.a = 4; } function f(xs: ReadonlySpan.<A>): string { try { set(ref xs[1]); return 'set'; } catch (e) { return e.constructor.name + String(as[1].a); } } f(as);`))
    .toBe('TypeError0');
  expect(evaluated(`${A}const v: ReadonlySpan.<A> = as; const y: any = v; try { y[0].a = 9; 'wrote'; } catch (e) { e.constructor.name + String(as[0].a); }`)).toBe('TypeError0');
  // It is still an A, and one handle stands for one element.
  expect(evaluated(`${A}function f(xs: ReadonlySpan.<A>): string { const o = { e: xs[0] }; const y: any = o.e; return String(y is A) + String(o.e === xs[0]); } f(as);`)).toBe('truetrue');
});

test('a copy of an inline element is the reader\'s own', () => {
  expect(evaluated(`${A}function f(xs: ReadonlySpan.<A>): string { const c = xs[0]; c.a = 9; c.bump(); return String(c.a) + String(as[0].a); } f(as);`)).toBe('100');
  expect(evaluated(`${A}function f(xs: ReadonlySpan.<A>): string { const s = xs.slice(); s[0].a = 9; const p = xs.at(1); let q: uint8 = 0; if (p !== undefined) { p.a = 8; q = p.a; } return String(s[0].a) + String(as[0].a) + String(as[1].a) + String(q); } f(as);`)).toBe('9008');
  // The callback's parameter is a copy as the loop's variable is. Each is read after it is stored
  // to, which is what makes the store one the program meant (#sec-store-to-a-copy); a store that
  // nothing reads is refused, and the callback's is now that it has its type from the window.
  expect(evaluated(`${A}function f(xs: ReadonlySpan.<A>): string { let n: uint8 = 0; xs.forEach((e) => { e.a = 9; n += e.a; }); let t: uint8 = 0; for (const e of xs) { e.a = 3; t += e.a; } return String(n) + String(t) + String(as[0].a); } f(as);`)).toBe('1860');
  expect(observeScript(`${A}function f(xs: ReadonlySpan.<A>) { xs.forEach((e) => { e.a = 9; }); }`)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-store-to-copy' } });
});

test('the array that owns the elements, a Span, and a reference element are unaffected', () => {
  expect(evaluated(`${A}function f(xs: ReadonlySpan.<A>): uint8 { return xs[0].a; } as[0].a = 5; as[0].bump(); String(f(as));`)).toBe('6');
  expect(evaluated(`${A}function f(xs: Span.<A>): uint8 { xs[0].bump(); xs[0].a += 1; return xs[0].a; } String(f(as));`)).toBe('2');
  expect(evaluated('class R { x: uint8 = 1; other; inc(): void { this.x += 1; } } const rs: [].<R> = [new R()]; function f(xs: ReadonlySpan.<R>): uint8 { xs[0].inc(); return xs[0].x; } String(f(rs));')).toBe('2');
});

test('a tuple stored inline is read-only through the window too', () => {
  const T = 'const ts: [2].<[uint8, uint8]> = [[1, 2], [3, 4]]; ';
  expect(evaluated(`${T}const v: ReadonlySpan.<[uint8, uint8]> = ts; const y: any = v; try { y[0][1] = 9; 'wrote'; } catch (e) { e.constructor.name + String(ts[0][1]); }`)).toBe('TypeError2');
  expect(evaluated(`${T}function f(xs: ReadonlySpan.<[uint8, uint8]>): string { const [a, b] = xs[1]; return String(a) + String(b) + String(xs[0][0]) + String(xs[0].length); } f(ts);`)).toBe('3412');
  expect(evaluated(`${T}function f(xs: ReadonlySpan.<[uint8, uint8]>): string { const o = { t: xs[0] }; ts[0][0] = 8; let r = String(o.t[0]); `
    + "try { o.t[0] = 5; r += 'wrote'; } catch (e) { r += e.constructor.name; } return r + String(ts[0][0]); } f(ts);")).toBe('8TypeError8');
  expect(evaluated(`${T}function f(xs: Span.<[uint8, uint8]>): uint8 { xs[0][1] = 9; return xs[0][1]; } String(f(ts)) + String(ts[0][1]);`)).toBe('99');
});
