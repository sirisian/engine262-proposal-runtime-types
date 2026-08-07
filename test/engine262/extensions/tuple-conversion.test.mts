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

// -- a trailing position may carry a default ---------------------------------
test('an unsupplied trailing position takes its default', () => {
  // the design's purpose for the feature: a shorter array satisfies a longer
  // tuple. The default was parsed and discarded, so this was refused outright.
  expect(evaluated("const a: [uint8, string = 'z'] = [1];"
    + " String(a.length) + ',' + String(a[1]);")).toBe('2,z');
  expect(evaluated("const a: [uint8, string = 'z'] = [1, 'x']; String(a[1]);")).toBe('x');
  expect(evaluated("const a: [uint8, string = 'z', uint8 = 7] = [1];"
    + " String(a.length) + ',' + String(a[2]);")).toBe('3,7');
  expect(evaluated("const a: [uint8, string = 'z', uint8 = 7] = [1, 'x']; String(a[2]);")).toBe('7');
  // KNOWN GAP: where the supplied array is short enough that membership already
  // admits it, the conversion's "already of the type" shortcut returns it
  // unchanged and the defaults are not filled. Filling happens wherever the
  // value is NOT already a member, which is every case above.
  // and it works in a return position, which is the design's example
  expect(evaluated("function f(): [uint8, string = 'z'] { return [1]; }"
    + " const r = f(); String(r.length) + ',' + String(r[1]);")).toBe('2,z');
});

test('a defaulted position is optional for membership too', () => {
  // #sec-array-membership: a slot "is optional exactly when its [[Initial]] is
  // not ~none~"
  expect(evaluated("String([(1 := uint8)] is [uint8, string = 'z']);")).toBe('true');
  expect(evaluated("String([(1 := uint8), 'x'] is [uint8, string = 'z']);")).toBe('true');
  // a position WITHOUT a default is still required
  expect(evaluated('String([1] is [number, string]);')).toBe('false');
});

test('the length bounds and the ordering rules are enforced', () => {
  // shorter than the positions that carry no default
  expectThrown("const a: [uint8, string = 'z'] = [];");
  // longer than the positions, with no rest to collect the surplus
  expectThrown("const a: [uint8, string = 'z'] = [1, 'x', 2];");
  // a tuple is positional, so a default anywhere but the tail could never be
  // taken, and one after a rest could never be reached - both stated as type
  // errors and neither enforced before, since the record could not hold a
  // default for anything to compare
  expectThrown("type T = [uint8 = 1, string]; let a: T = [1, 'x'];");
  expectThrown("type T = [...[].<uint8>, string = 'z']; let a: T = [1];");
});

test('a default does not disturb the types around it', () => {
  // a tuple with no default is unchanged
  expect(evaluated("const a: [uint8, string] = [1, 'x']; String(a[0]);")).toBe('1');
  // two spellings of one defaulted tuple are one type
  expect(evaluated("type A = [uint8, string = 'a']; type B = [uint8, string = 'a'];"
    + ' let x: A = [1]; let y: B = [1]; String(Reflect.typeOf(x) === Reflect.typeOf(y));')).toBe('true');
  // and a defaulted tuple still satisfies the array-family bound
  expect(evaluated("function g<T extends []>(v: T): string { return 'ok'; }"
    + " const t: [uint8, string = 'z'] = [1]; g(t);")).toBe('ok');
});
