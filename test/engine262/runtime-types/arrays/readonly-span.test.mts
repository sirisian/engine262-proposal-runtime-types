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
