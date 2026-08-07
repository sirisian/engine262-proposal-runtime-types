import { test, expect } from 'vitest';
import { evaluated, expectThrown, expectThrownKind } from '../readme/harness.mts';

/**
 * A plain array in a TUPLE position converts position-wise (spec
 * sec-array-and-tuple-types), as one in an array position converts
 * element-wise.
 *
 * Only the array form converted, so a tuple of value types could not be written
 * from a literal at all: `const a: [uint8] = [1]` was refused where `const a:
 * [1].<uint8> = [1]` was accepted, and the design's "a tuple of value types is
 * itself a value type laid out contiguously" had no way to be built. A boundary
 * converts everywhere in this proposal except a `ref` binding, which checks
 * because converting a borrow would rewrite the caller's storage; a tuple
 * literal builds a new array, so there is nothing to protect.
 */

test('a tuple position converts its value', () => {
  expect(evaluated('const a: [uint8] = [1]; String(a[0]);')).toBe('1');
  expect(evaluated('const a: [uint8] = [1]; String(a[0] is uint8);')).toBe('true');
  // each position converts to its own type
  expect(evaluated("const a: [uint8, string] = [1, 'x'];"
    + " String(a[0] is uint8) + ',' + String(a[1]);")).toBe('true,x');
  // a value already of the position's type is unchanged
  expect(evaluated("const a: [number, string] = [1, 'a']; String(a.length);")).toBe('2');
  // and it works in a parameter position
  expect(evaluated("function f(v: [uint8, string]): string { return 'ok'; } f([1, 'x']);")).toBe('ok');
});

test('a rest position converts to the type it collects elements of', () => {
  // a rest's own type is the COLLECTION, so each position converts to its
  // element type rather than to the collection
  expect(evaluated("const a: [uint8, ...[].<string>] = [1, 'x', 'y'];"
    + " String(a[0] is uint8) + ',' + String(a.length);")).toBe('true,3');
});

test('the length and the position types are still enforced', () => {
  expectThrown('const a: [uint8, string] = [1];');
  expectThrown('const a: [uint8] = [1, 2];');
  expectThrown("const a: [uint8] = ['x'];");
  expectThrownKind('function big() { return 300; } const a: [uint8] = [big()];', 'RangeError');
  expectThrown('const a: [uint8] = { 0: 1 };');
});

test('the array form is unaffected, and covariance is now testable', () => {
  expect(evaluated('const a: [4].<uint8> = [1, 2, 3, 4]; String(a.length);')).toBe('4');
  // the spec states a tuple is covariant position-wise; before this fix the
  // source binding could not be constructed to test it
  expect(evaluated('type T1 = [uint8]; type T2 = [uint8 | string];'
    + ' const a: T1 = [1]; const b: T2 = a; String(b.length);')).toBe('1');
  expect(evaluated('type T1 = [uint8, string]; type T2 = [uint8 | number, string];'
    + " const a: T1 = [1, 'x']; const b: T2 = a; String(b.length);")).toBe('2');
  // and it is covariance, not equivalence
  expectThrown('type T1 = [uint8 | string]; type T2 = [uint8]; const a: T1 = [1]; const b: T2 = a;');
});

test('every position a tuple may occupy converts', () => {
  // a return, a field, and a nesting - the boundary is the same one
  expect(evaluated("function f(): [uint8, string] { return [1, 'x']; }"
    + ' const r = f(); String(r[0] is uint8);')).toBe('true');
  expect(evaluated("class C { t: [uint8, string] = [1, 'x']; }"
    + ' String(new C().t[0] is uint8);')).toBe('true');
  expect(evaluated("const a: [[uint8], string] = [[1], 'x']; String(a[0][0] is uint8);")).toBe('true');
  // a tuple position whose type is an ARRAY converts through the array rule
  expect(evaluated("const a: [[].<uint8>, string] = [[1], 'x']; String(a[0][0] is uint8);")).toBe('true');
});
