import { test, expect } from 'vitest';
import { evaluated, bool, ok, expectThrown } from '../../harness.mts';

/**
 * README feature coverage - arrays and tuples.
 * Sections: Variable-length Typed Arrays, Fixed-length Typed Arrays, Mixing
 * Variable- and Fixed-length Arrays, Any Typed Array, Tuple Types, Array length
 * Type And Operations.
 *
 * Scope note: the proposal's TYPE-level array and tuple features are implemented
 * in the core (the type constructors, interning, fixed-vs-dynamic identity,
 * assignability, tuple spread, and tuple-object intersection), and are what this
 * file verifies. One VALUE-level behavior is also implemented and verified here:
 * a plain array literal in a `[].<T>` position propagates the element type, so
 * each element is converted to T at the binding boundary (README "Typed Array
 * Propagation"). The remaining VALUE-level runtime of typed arrays - the
 * buffer-backed view constructor `[].<T>(buffer)`, `window`, bounds checking,
 * materializing a zero-filled fixed-length array, the delete/push/pop guards, and
 * the `shared` backing - is deferred by the spec to the memory-layout and
 * threading extensions (#table-extension-hooks) and is exercised with those
 * documents, not here.
 */

// -- Variable-length Typed Arrays: [].<T> --------------------------------------
// `.<T>` applies an element type. `[].<T>` is the dynamic array; the same type
// interns to one Type Object.
test('Variable-length arrays: [].<T> resolves and interns', () => {
  expect(bool('type A = [].<uint8>; type B = [].<uint8>; String(A === B);')).toBe(true);
  expect(bool('type A = [].<uint8>; type B = [].<uint16>; String(A === B);')).toBe(false);
  // element type is reflected
  expect(evaluated('type A = [].<uint8>; String(Reflect.getReflection(A).kind);')).toBe('array');
  expect(evaluated('type A = [].<uint8>; String(Reflect.getReflection(A).element === uint8);')).toBe('true');
});

test('Variable-length arrays: element may itself be a union', () => {
  expect(ok('type A = [].<uint8 | null>; typeof A;')).toBe(true);
  expect(bool('type A = [].<uint8 | null>; type B = [].<uint8 | null>; String(A === B);')).toBe(true);
});

// -- Typed Array Propagation ---------------------------------------------------
// A plain array literal in a `[].<T>` position propagates the element type: each
// element is converted to T at the binding boundary, so the elements are typed
// values and their stores wrap.
test('Typed Array Propagation: an array literal takes the element type', () => {
  expect(evaluated('let a: [].<uint8> = [1, 2, 3]; String(a.length);')).toBe('3');
  expect(bool('let a: [].<uint8> = [5]; String(a[0] instanceof uint8);')).toBe(true);
  // the store wraps like the element type: 255 + 1 is 0 in uint8
  expect(evaluated('let a: [].<uint8> = [255]; String(a[0] + (1 := uint8));')).toBe('0');
});

test('Typed Array Propagation: an out-of-range element is rejected', () => {
  expectThrown('let a: [].<uint8> = [300]; String(a.length);');
});

test('Typed Array Propagation: a fixed extent must match the literal length', () => {
  expect(evaluated('let a: [3].<uint8> = [1, 2, 3]; String(a.length);')).toBe('3');
  expectThrown('let a: [3].<uint8> = [1, 2]; String(a.length);');
});

test('Typed Array Propagation: propagation is recursive through nested arrays', () => {
  expect(evaluated('let a: [].<[].<uint8>> = [[1, 2], [3]]; String(a[0][1]);')).toBe('2');
  expect(bool('let a: [].<[].<uint8>> = [[5]]; String(a[0][0] instanceof uint8);')).toBe(true);
});

// -- Fixed-length Typed Arrays: [N].<T> ----------------------------------------
// A fixed-length array carries its extent in its identity; a distinct extent is a
// distinct type, and it is distinct from the dynamic array of the same element.
test('Fixed-length arrays: [N].<T> is distinct by extent and from the dynamic array', () => {
  expect(bool('type A = [4].<uint8>; type B = [4].<uint8>; String(A === B);')).toBe(true);
  expect(bool('type A = [4].<uint8>; type B = [5].<uint8>; String(A === B);')).toBe(false);
  expect(bool('type A = [4].<uint8>; type D = [].<uint8>; String(A === D);')).toBe(false);
});

test('Fixed-length arrays: a fixed-length array is assignable to the dynamic array', () => {
  // README instanceof example: arr: [4].<uint8> satisfies [].<uint8>
  expect(bool('type F = [4].<uint8>; type D = [].<uint8>; String(Reflect.isAssignable(F, D));')).toBe(true);
  // but not the reverse (dynamic is not a fixed length)
  expect(bool('type F = [4].<uint8>; type D = [].<uint8>; String(Reflect.isAssignable(D, F));')).toBe(false);
});

// -- Any Typed Array: [] -------------------------------------------------------
// `[]` alone is the array of `any`; `[].<any>` is the same type spelled out.
test('Any Typed Array: [] is [].<any>', () => {
  expect(bool('type A = []; type B = [].<any>; String(A === B);')).toBe(true);
});

// -- Tuple Types: [T1, T2, ...] ------------------------------------------------
// A tuple is a fixed count of possibly-different types. It is distinct from an
// array of one type, interns by its element list, and reflects its elements.
test('Tuple Types: a tuple is a fixed sequence of typed positions', () => {
  expect(evaluated('type T = [uint32, string, boolean]; String(Reflect.getReflection(T).kind);')).toBe('tuple');
  expect(evaluated('type T = [uint32, string, boolean]; String(Reflect.getReflection(T).elements.length);')).toBe('3');
  expect(bool('type T = [uint32, string]; type U = [uint32, string]; String(T === U);')).toBe(true);
  // order matters
  expect(bool('type T = [uint32, string]; type U = [string, uint32]; String(T === U);')).toBe(false);
  // a tuple of one type is not the same as the fixed-length array of that type
  expect(bool('type T = [uint8, uint8]; type A = [2].<uint8>; String(T === A);')).toBe(false);
});

test('Tuple Types: element types are recovered by reflection in order', () => {
  expect(evaluated('type T = [uint32, string]; String(Reflect.getReflection(T).elements[0].type === uint32);')).toBe('true');
  expect(evaluated('type T = [uint32, string]; String(Reflect.getReflection(T).elements[1].type === string);')).toBe('true');
});

// -- Tuple spread --------------------------------------------------------------
// A tuple may spread another tuple or an array type, at the front or the back,
// which expresses a variable head or tail.
test('Tuple spread: a tuple may spread an array type at the back', () => {
  expect(evaluated('type Row = [uint32, ...[].<float32>]; String(Reflect.getReflection(Row).kind);')).toBe('tuple');
  expect(ok('type Row = [uint32, ...[].<float32>]; typeof Row;')).toBe(true);
  // interns consistently
  expect(bool('type A = [uint32, ...[].<float32>]; type B = [uint32, ...[].<float32>]; String(A === B);')).toBe(true);
});

// -- Tuple/array-object intersection -------------------------------------------
// Intersecting a tuple or array with an object type produces an array-like value
// that also carries named properties (the shape of a regex match result).
test('Tuple-object intersection: [..] & { named } resolves', () => {
  expect(evaluated('type Match = [string, ...[].<string>] & { index: uint32, input: string }; String(Reflect.getReflection(Match).kind);')).toBe('intersection');
  expect(ok('type Match = [string, ...[].<string>] & { index: uint32, input: string }; typeof Match;')).toBe(true);
});

// -- Array default value (type-level via DefaultValueOf's nullable case) --------
// A nullable array type has the default null (DefaultValueOf's union rule). The
// non-null array's zero value (empty or zero-filled) is materialized by the
// memory-layout extension and is not asserted here.
test('Arrays: a nullable array binding defaults to null', () => {
  expect(evaluated('let a: [].<uint8> | null; String(a === null);')).toBe('true');
  expect(evaluated('let a: [4].<uint8> | null; String(a === null);')).toBe('true');
});
