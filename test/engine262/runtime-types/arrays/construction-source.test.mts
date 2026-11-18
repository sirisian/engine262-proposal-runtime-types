import { test, expect } from 'vitest';
import { evaluated, expectThrown, observeScript } from '../harness.mts';

/**
 * The argument of an array type's constructor (#sec-array-and-tuple-types).
 *
 * "The constructor takes one argument, the SOURCE of the elements ... `new A(source)` is the
 * array that `const t: A = [...source]` binds." A construction with no argument is the type's
 * default value.
 *
 * Every argument was dropped before: `new [4].<uint8>(7)`, `new [4].<uint8>(a)` and `new G(a)`
 * for a class over an array each made an array of zeros.
 */

const J = 'function j(a) { let s = ""; for (const e of a) s += String(e) + " "; return s + "(" + String(a.length) + ")"; } ';
const early = (rule: string) => ({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule } });
const G = 'value class G extends [4].<uint8> { sum(): uint32 { let s: uint32 = 0; for (const e of this) s += uint32(e); return s; } } ';

test('the argument is the source of the elements, taken in iteration order', () => {
  expect(evaluated(`${J}j(new [4].<uint8>([1, 2, 3, 4]));`)).toBe('1 2 3 4 (4)');
  expect(evaluated(`${J}const a: [].<uint8> = [1, 2, 3]; j(new [].<uint8>(a));`)).toBe('1 2 3 (3)');
  expect(evaluated(`${J}j(new [].<uint8>(new Set([3, 1, 2])));`)).toBe('3 1 2 (3)');
  expect(evaluated(`${J}function* g() { yield 1; yield 2; } j(new [2].<uint8>(g()));`)).toBe('1 2 (2)');
  expect(evaluated(`${J}j(new [].<string>("abc"));`)).toBe('a b c (3)');
  expect(evaluated(`${J}const t: [uint8, uint8] = [1, 2]; j(new [2].<uint8>(t));`)).toBe('1 2 (2)');
  expect(evaluated(`${J}j(new [].<uint8>(new Uint8Array([7, 8])));`)).toBe('7 8 (2)');
  expect(evaluated('const rows = new [2].<[2].<uint8>>([[1, 2], [3, 4]]); String(rows[1][0]);')).toBe('3');
  // An argument list that is spread is one argument when it holds one.
  expect(evaluated(`${J}const parts = [[1, 2, 3]]; j(new [].<uint8>(...parts));`)).toBe('1 2 3 (3)');
});

test('the array is a copy of its source and never a view of it', () => {
  expect(evaluated(`${J}const a: [].<uint8> = [1, 2, 3]; const b = new [].<uint8>(a); b[0] = 9; b.push(4); String(a === b) + " " + j(a) + j(b);`))
    .toBe('false 1 2 3 (3)9 2 3 4 (4)');
  // A value is copied where it is stored, and a reference is stored as it is.
  expect(evaluated('value class P { x: uint8 = 0; } const p = new P(); const a = new [2].<P>([p, p]); a[0].x = 5; String(p.x) + "," + String(a[0].x) + "," + String(a[1].x);'))
    .toBe('0,5,0');
  expect(evaluated('class R { n: uint8 = 1; } const r = new R(); const a = new [2].<R>([r, r]); String(a[0] === r) + "," + String(a is [2].<R>);')).toBe('true,true');
});

test('no argument, or a nullish one, is the default value of the type', () => {
  expect(evaluated(`${J}j(new [4].<uint8>());`)).toBe('0 0 0 0 (4)');
  // As the seed of a `Set` or a `Map` is read (#sec-collection-construction).
  expect(evaluated(`${J}j(new [4].<uint8>(undefined)) + j(new [2].<uint8>(null));`)).toBe('0 0 0 0 (4)0 0 (2)');
  expect(evaluated(`${J}function f(s) { return new [2].<uint8>(s); } j(f(undefined)) + j(f()) + j(f(null));`)).toBe('0 0 (2)0 0 (2)0 0 (2)');
  expect(evaluated(`${J}j(new [].<uint8>());`)).toBe('(0)');
  // Each element is its own default, as it is for a declaration with no initializer.
  expect(evaluated('value class P { x: uint8 = 0; } const a = new [3].<P>(); a[0].x = 5; String(a[0].x) + "," + String(a[1].x) + "," + String(a[2].x);')).toBe('5,0,0');
  expect(evaluated('const a = new [2].<[2].<uint8>>(); a[0][0] = 5; String(a[0][0]) + "," + String(a[1][0]);')).toBe('5,0');
});

test('a value that is not iterable is not a count and not a value to fill with', () => {
  expect(observeScript('new [4].<uint8>(7);')).toMatchObject(early('rt-iterable-required'));
  expectThrown('new [4].<uint8>(7);', 'the argument to the constructor of "[4].<uint.<8>>" is the source of its elements, and a value of "7" is not iterable');
  expect(observeScript('new [].<uint8>(8);')).toMatchObject(early('rt-iterable-required'));
  expect(observeScript('new [].<uint8>(false);')).toMatchObject(early('rt-iterable-required'));
  expect(observeScript('const n: uint32 = 3; new [].<uint8>(n);')).toMatchObject(early('rt-iterable-required'));
  // Where the checker did not see the value, the construction refuses it.
  expectThrown('function f(s) { return new [2].<uint8>(s); } f(7);', 'is the source of its elements, and 7 is not iterable');
  expectThrown('function f(s) { return new [].<uint8>(s); } f(false);', 'and false is not iterable');
  expectThrown('function f(s) { return new [].<uint8>(s); } f({ length: 2, 0: 1, 1: 2 });', 'is not iterable');
  expectThrown('function f(s) { return new [].<uint8>(s); } f(new ArrayBuffer(8));', 'is not iterable');
  // The fill and the count have their own spellings.
  expect(evaluated(`${J}j(new [4].<uint8>().fill(7));`)).toBe('7 7 7 7 (4)');
  expect(evaluated('const a = [].<uint8>.withCapacity(8); String(a.length) + ":" + String(a.capacity);')).toBe('0:8');
});

test('the constructor takes one argument', () => {
  expect(observeScript('new [].<uint8>(1, 2, 3);')).toMatchObject(early('rt-call-argument'));
  expectThrown('new [4].<uint8>(1, 2, 3, 4);', '"[4].<uint.<8>>" takes at most "1" arguments, and "4" were supplied');
});

test('a fixed extent takes exactly that many', () => {
  // A literal is judged as the initializer of a declaration of the type is.
  expect(observeScript('new [4].<uint8>([1, 2, 3]);')).toMatchObject(early('rt-assignability'));
  expectThrown('function f(s) { return new [4].<uint8>(s); } f([1, 2, 3]);', '"[4].<uint.<8>>" has "4" elements, and its source supplied "3"');
  expectThrown('function f(s) { return new [4].<uint8>(s); } f([1, 2, 3, 4, 5]);', 'its source supplied "5"');
  // An extent known only when the program runs is checked then.
  expect(evaluated(`${J}function f(n: uint32) { return new [n].<uint8>([1, 2, 3]); } j(f(3));`)).toBe('1 2 3 (3)');
  expectThrown('function f(n: uint32) { return new [n].<uint8>([1, 2, 3]); } f(2);', 'its source supplied "3"');
});

test('each item is stored as a store to an element is', () => {
  expect(observeScript('new [].<uint8>([1, 2, 300]);')).toMatchObject(early('rt-assignability'));
  expectThrown('function f(s) { return new [].<uint8>(s); } f([1, 2, 300]);', '300 is not in the range of');
  // A value of one value type does not become another.
  expectThrown('const a: [].<uint8> = [1, 2]; new [].<uint16>(a);', 'is not assignable to "uint.<16>"');
});

test('an element type with no default needs the source', () => {
  const R = 'class R { n: uint8 = 1; } ';
  expect(observeScript(`${R}new [3].<R>();`)).toMatchObject(early('rt-missing-default'));
  expectThrown(`${R}new [3].<R>();`, '"[3].<R>" has no default value, so its construction needs the source of its elements');
  expect(observeScript('new [3].<symbol>();')).toMatchObject(early('rt-missing-default'));
  expectThrown(`${R}function mk(C) { return new C(); } mk([2].<R>);`, 'has no default value, so its construction needs the source of its elements');
  expect(evaluated(`${R}const a = new [2].<R>([new R(), new R()]); String(a[0] === a[1]) + "," + String(a[1].n);`)).toBe('false,1');
  // Nothing to fill, so nothing is asked of the element type.
  expect(evaluated(`${R}String(new [].<R>().length) + String(new [0].<R>().length);`)).toBe('00');
  expect(evaluated(`${R}const a = new [3].<R | null>(); String(a[0]);`)).toBe('null');
});

test('a class over an array type has that constructor where it declares none', () => {
  expect(evaluated(`${G}const a: [4].<uint8> = [1, 2, 3, 4]; const g = new G(a); String(g.sum()) + "," + String(g is G) + "," + String(Reflect.typeOf(g) === (type G));`))
    .toBe('10,true,true');
  expect(evaluated(`${G}String(new G([1, 2, 3, 4]).sum()) + "," + String(new G().sum());`)).toBe('10,0');
  expect(observeScript(`${G}new G(7);`)).toMatchObject(early('rt-iterable-required'));
  expect(observeScript(`${G}new G(1, 2, 3, 4);`)).toMatchObject(early('rt-call-argument'));
  expect(observeScript(`${G}new G([1, 2, 3]);`)).toMatchObject(early('rt-assignability'));
  // Through a base that declares none either, and for an array that grows.
  expect(evaluated('class A extends [].<uint8> { } class B extends A { } String(new B([1, 2, 3]).length) + "," + String(new B(new Set([4])).length);')).toBe('3,1');
  expect(observeScript('class A extends [].<uint8> { } class B extends A { } new B(7);')).toMatchObject(early('rt-iterable-required'));
  expect(evaluated('class Stack<T: type> extends [].<T> { } const s = new Stack.<uint8>([1, 2, 3]); String(s.length) + "," + String(s[2]);')).toBe('3,3');
  expect(evaluated('value class Grid<W: uint32, H: uint32> extends [W * H].<uint8> { } const src: [4].<uint8> = [1, 2, 3, 4]; String(new Grid.<2, 2>(src)[3]);')).toBe('4');
  expectThrown('value class Grid<W: uint32, H: uint32> extends [W * H].<uint8> { } const src: [4].<uint8> = [1, 2, 3, 4]; new Grid.<2, 3>(src);',
    '"[6].<uint.<8>>" has "6" elements, and its source supplied "4"');
  // The class is still nominal: its elements reach it through its constructor.
  expect(observeScript(`${G}const a: [4].<uint8> = [1, 2, 3, 4]; const g: G = a;`)).toMatchObject(early('rt-assignability'));
});

test('a class that declares a constructor has its own parameters, and passes a source to super', () => {
  expect(evaluated('value class G extends [4].<uint8> { constructor(a: [4].<uint8>) { super(a); } } const a: [4].<uint8> = [1, 2, 3, 4]; String(new G(a)[2]);')).toBe('3');
  expect(evaluated('value class G extends [4].<uint8> { constructor(v: uint8) { super(); this.fill(v); } } String(new G(7)[2]);')).toBe('7');
  expect(observeScript('value class G extends [4].<uint8> { constructor(v: uint8) { super(v); } }')).toMatchObject(early('rt-iterable-required'));
  expect(observeScript('class A extends [].<uint8> { constructor(a: [].<uint8>, b: [].<uint8>) { super(a, b); } }')).toMatchObject(early('rt-call-argument'));
});

test('the target-typed form is the same construction', () => {
  expect(evaluated('let a: [4].<uint8> = new.(); String(a.join(","));')).toBe('0,0,0,0');
  expect(evaluated('let a: [4].<uint8> = new.([1, 2, 3, 4]); String(a.join(","));')).toBe('1,2,3,4');
  expect(evaluated('const s = new Set([1, 2]); let a: [].<uint8> = new.(s); String(a.length);')).toBe('2');
  expect(observeScript('let a: [4].<uint8> = new.(7);')).toMatchObject(early('rt-iterable-required'));
  expect(observeScript('let a: [4].<uint8> = new.(1, 2, 3, 4);')).toMatchObject(early('rt-call-argument'));
  expect(evaluated(`${G}let g: G = new.([1, 2, 3, 4]); String(g.sum());`)).toBe('10');
});

test('the call form without new is still refused', () => {
  expectThrown('[4].<uint8>();', 'requires new');
  expectThrown('const a: [4].<uint8> = [1, 2, 3, 4]; [4].<uint8>(a);', 'a view is constructed as');
});
