import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown } from '../harness.mts';

/**
 * #sec-span-coercion: "In `concat` a window is a run of elements, as receiver
 * and as argument: it is spread, and is not taken as one element." A window's
 * `concat` takes elements and runs of its element type, and its copy is an
 * owned array of that type. Its signature had two optional parameters of an
 * element or a dynamic array, so it refused a third argument, an array of
 * fixed extent, a tuple, another window, and an array literal, whose type was
 * `[].<number>` before the union was asked (#sec-contextual-types). An array's
 * `concat` joins its arguments' element types, and is pinned in
 * intrinsic-contracts.test.mts.
 */

const W = 'const a: [].<uint8> = [1]; ';

test('a window joins a literal, a fixed array, a tuple, a window and several arguments', () => {
  expect(evaluated(`${W}function f(w: Span.<uint8>) { return String(w.concat([3])); } f(a);`)).toBe('1,3');
  expect(evaluated(`${W}function f(w: Span.<uint8>, x: [2].<uint8>) { return String(w.concat(x)); } const b: [2].<uint8> = [2, 3]; f(a, b);`)).toBe('1,2,3');
  expect(evaluated(`${W}function f(w: Span.<uint8>, x: [uint8, uint8]) { return String(w.concat(x)); } f(a, [2, 3]);`)).toBe('1,2,3');
  expect(evaluated(`${W}function f(w: Span.<uint8>, x: Span.<uint8>) { return String(w.concat(x)); } f(a, a);`)).toBe('1,1');
  expect(evaluated(`${W}function f(w: Span.<uint8>) { return String(w.concat(4, 5, [6])); } f(a);`)).toBe('1,4,5,6');
  expect(evaluated(`${W}function f(w: Span.<uint8>) { return String(Reflect.typeOf(w.concat([3]))); } f(a);`)).toBe('[].<uint.<8>>');
});

test('a window\'s copy converts each element it takes from an argument, and checks it', () => {
  expectThrown(`${W}function f(w: Span.<uint8>, u: any) { return w.concat(u); } f(a, ["s"]);`, 'a string is not a conversion source for "uint.<8>"');
  expectThrown(`${W}function f(w: Span.<uint8>, u: any) { return w.concat(u); } f(a, 300);`, 'is not in the range of "uint.<8>"');
  // An array's copy joins its arguments' element types instead (intrinsic-contracts.test.mts).
  expect(evaluated(`${W}const u: any = ["s"]; String(a.concat(u));`)).toBe('1,s');
});

test('a foreign element or run is refused at a window\'s argument, as before', () => {
  expectStaticTypeError(`${W}function f(w: Span.<uint8>, s: [].<string>) { return w.concat(s); }`);
  expectStaticTypeError(`${W}function f(w: Span.<uint8>) { return w.concat(["s"]); }`);
  expectStaticTypeError(`${W}function f(w: Span.<uint8>) { return w.concat([300]); }`);
});

test('a value element is copied into an array\'s copy', () => {
  expect(evaluated('value class K { n: uint8 = 0; } const a: [].<K> = [new K()]; const b = a.concat([]); b[0].n = 6; String(a[0].n);')).toBe('0');
});
