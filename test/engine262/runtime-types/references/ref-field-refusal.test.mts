import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * A FIELD MAY NOT BE DECLARED `ref`. A reference cannot be stored in a binding that outlives it, a field, an
 * array, or a collection: a reference is a borrow - a storage location and an index - and a field outlives the
 * borrow. So the refusal is right, and so must be its message: `ref r: A;` must not reach the ordinary field
 * path and fail on the identifier after `ref` with "Unexpected token", which says nothing about why and reads as
 * a typo. It is refused by name, before any production accepts it, since there is no spelling that makes the
 * form work and nothing to suggest beyond storing the value or its owner.
 *
 * Unspecified: #sec-reference-values gives a reference no observable identity but the specification does not
 * yet state that a field may not be declared `ref`; these tests pin the refusal.
 */

test('a ref field is refused with its reason', () => {
  expectThrown('class A { x: uint8 = 1; } class H { ref r: A; }',
    'a field may not be declared');
  expectThrown('class A { x: uint8 = 1; } class H { static ref r: A; }',
    'a field may not be declared');
});

test('the spellings that are not a ref field are untouched', () => {
  // An ordinary field of the same type.
  expect(evaluated('class A { x: uint8 = 1; } class H { r: A; } String(new H().r.x);')).toBe('0');
  // A field whose NAME is `ref`, which is an ordinary identifier.
  expect(evaluated('class H { ref: uint8 = 1; } String(new H().ref);')).toBe('1');
});

test('references themselves still work where they may live', () => {
  // A binding, which does not outlive the borrow.
  expect(evaluated(`class A { x: uint8 = 1; } const arr: [1].<A>;
    const ref e = arr[0]; e.x = 5; String(arr[0].x);`)).toBe('5');
  // A parameter, which is the borrow this form is built around.
  expect(evaluated(`class A { x: uint8 = 1; }
    function f(ref a: A): uint8 { return a.x; }
    const arr: [1].<A>; arr[0].x = 3; String(f(ref arr[0]));`)).toBe('3');
});
