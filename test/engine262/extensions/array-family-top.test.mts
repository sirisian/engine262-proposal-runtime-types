import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../readme/harness.mts';

/**
 * `[].<any>` is the top of the array family (spec sec-issubtype).
 *
 * Arrays are invariant in their element, so before this an array whose element
 * type was written `any` was a type nothing inhabited - no array is declared
 * that way - and the bound the design writes over the family, `T extends []`,
 * was satisfied by nothing at all. `any` is already the type of which every
 * value is a value; this is that reading carried to the array types.
 *
 * What makes it admissible where a general covariance would not be is that a
 * store to an element is checked against the ARRAY's own element type at run
 * time, so a write through the wider view is refused whatever the static type
 * permitted - the last test below. A language with invariant containers and
 * unchecked elements supplies a wildcard and forbids writing through it.
 */

test('every array and tuple satisfies the array-family bound', () => {
  const G = "function g<T extends []>(v: T): string { return 'ok'; } ";
  expect(evaluated(`${G}const a: [].<number> = [1]; g(a);`)).toBe('ok');
  expect(evaluated(`${G}const a: [4].<uint8> = [1, 2, 3, 4]; g(a);`)).toBe('ok');
  expect(evaluated(`${G}const t: [number, string] = [1, 'a']; g(t);`)).toBe('ok');
  expect(evaluated(`${G}g([1, 'a']);`)).toBe('ok');
  // the other spelling the design documents use
  expect(evaluated("function g<T extends [].<any>>(v: T): string { return 'ok'; }"
    + ' const a: [].<number> = [1]; g(a);')).toBe('ok');
});

test('an ordinary parameter of the top type accepts them too', () => {
  const P = "function p(v: [].<any>): string { return 'ok'; } ";
  expect(evaluated(`${P}const a: [].<number> = [1]; p(a);`)).toBe('ok');
  expect(evaluated(`${P}const a: [4].<uint8> = [1, 2, 3, 4]; p(a);`)).toBe('ok');
  expect(evaluated('const a: [].<uint8> = [1]; const b: [].<any> = a; String(b.length);')).toBe('1');
  // a value that is not an array is still refused
  expectThrown(`${P}p({ a: 1 });`);
});

test('element invariance and the extent rules are unchanged', () => {
  // the rule the clause gives its reason for: a uint8 array is not a number array
  expectThrown('const a: [].<uint8> = [1]; const b: [].<number> = a;');
  // a fixed target still fixes the length, and takes any element type within it
  expect(evaluated('const a: [4].<uint8> = [1, 2, 3, 4]; const b: [4].<any> = a; String(b.length);')).toBe('4');
  expectThrown('const a: [].<uint8> = [1]; const b: [4].<any> = a;');
});

test('a store through the wider view is still checked', () => {
  // this is what takes the place of a wildcard's prohibition on writing
  expect(evaluated('const a: [].<uint8> = [1]; const b: [].<any> = a;'
    + " function big() { return 300; }"
    + " try { b[0] = big(); 'no'; } catch (e) { e.constructor.name; }")).toBe('RangeError');
  // and a value the element type does admit still stores
  expect(evaluated('const a: [].<uint8> = [1]; const b: [].<any> = a;'
    + ' function ok() { return 200; } b[0] = ok(); String(a[0]);')).toBe('200');
});
