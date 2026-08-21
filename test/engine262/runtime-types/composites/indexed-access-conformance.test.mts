import { expect, test } from 'vitest';
import { evaluated, expectError, expectThrownKind } from '../harness.mts';

/**
 * proposal-runtime-types `#sec-indexed-access-types`.
 *
 * `T[K]` was implemented and unspecified: the grammar had no production for it
 * and no clause described it, while the engine had supported it since the commit
 * that added `keyof`. The specification now states it as the kit's `indexed`
 * operation, for the reason `keyof` is stated as KeyTypesOf - one operation with
 * two spellings cannot drift, and two statements of one algorithm have to be kept
 * in step by hand.
 *
 * Each test below is one sentence of that clause.
 */

test('an indexed access denotes the named property\'s type', () => {
  expect(evaluated('type T = { a: uint8 }; type A = T["a"]; String(A === uint8);')).toBe('true');
  expect(evaluated('type T = { a: uint8, b: string }; type B = T["b"]; String(B === string);')).toBe('true');
});

test('an OPTIONAL property admits undefined; a required one does not', () => {
  // Reading an absent property gives `undefined`, so the type of reading one
  // that may be absent is the union with it.
  expect(evaluated('type T = { a?: string }; type A = T["a"]; String(undefined is A);')).toBe('true');
  expect(evaluated('type T = { a?: string }; type A = T["a"]; String("s" is A);')).toBe('true');
  expect(evaluated('type T = { a: string }; type A = T["a"]; String(undefined is A);')).toBe('false');
});

test('it is POSTFIX, so it binds tighter than the prefixes and chains', () => {
  // `keyof T["a"]` is `keyof (T["a"])`, which is why the form has its own level
  // between IntersectionType and PrimaryType.
  expect(evaluated('type T = { a: { b: uint8 } }; type K = keyof T["a"]; String("b" is K);')).toBe('true');
  expect(evaluated('type T = { a: { b: uint8 } }; type A = T["a"]["b"]; String(A === uint8);')).toBe('true');
  // and it composes with union at the outer level
  expect(evaluated('type T = { a: uint8 }; type U = T["a"] | string; String("s" is U);')).toBe('true');
});

test('the three error conditions the clause names', () => {
  // A key that is not a String literal type.
  expectThrownKind('type T = { a: uint8 }; type A = T[number];', 'TypeError');
  // An operand with no properties.
  expectThrownKind('type A = uint8["a"];', 'TypeError');
  // A property that does not exist.
  expectThrownKind('type T = { a: uint8 }; type A = T["missing"];', 'TypeError');
});

test('a deferred key form is an ERROR, not an unspecified corner', () => {
  // The restriction is a floor: a later edition may admit these, and a program
  // that writes one today is told so rather than meeting an implementation's
  // guess.
  expectThrownKind('type T = { a: uint8 }; type A = T[string];', 'TypeError');
  expectThrownKind('type T = [uint8, string]; type A = T[0];', 'TypeError');
});

test('`T[keyof T]` is the union of the property types', () => {
  // The composition the two clauses are most often used through.
  expect(evaluated('type T = { a: uint8, b: uint8 }; type V = T[keyof T]; String(V === uint8);')).toBe('true');
  expect(evaluated('type T = { a: uint8, b: string }; type V = T[keyof T]; String("s" is V);')).toBe('true');
  expect(evaluated('type T = { a: uint8, b: string }; type V = T[keyof T]; String(true is V);')).toBe('false');
});

test('it does not overlap the INDEX ACCESSORS', () => {
  // An index accessor applies at the VALUE level, on a class instance, with a
  // NUMERIC index; a non-numeric index there is an ordinary property read. This
  // syntax is a TYPE position with a String literal key. Different position,
  // different key type - and measured, this form does not reach a class instance
  // type at all, so the two cannot meet in this edition.
  const GRID = 'class Grid { operator [](i: uint8): string { return "cell"; } } ';
  expect(evaluated(`${GRID}const g = new Grid(); String(g[(0 := uint8)]);`)).toBe('cell');
  expectThrownKind(`${GRID}type A = Grid[uint8];`, 'TypeError');
  expectThrownKind(`${GRID}type A = Grid["x"];`, 'TypeError');
});

test('an INTERFACE is reached; a class instance type is not', () => {
  // Worth pinning because it is the boundary the overlap question turns on, and
  // it is not obvious from the clause: an interface and an object type carry
  // properties this form reads, and a class instance type does not.
  expect(evaluated('interface I { n: uint8; } type A = I["n"]; String(A === uint8);')).toBe('true');
  // Early, since the checker reads the annotation before anything runs.
  expectError('class C { n: uint8 = 1; } type A = C["n"];');
});

test('IndexedTypeOf distributes over a union operand and a union key', () => {
  // The two loops of `#sec-indexedtypeof`, which the other tests reach only in
  // their one-arm, one-key form.
  expect(evaluated('type A = { n: uint8 }; type B = { n: uint8 }; type U = A | B; type R = U["n"]; String(R === uint8);')).toBe('true');
  expect(evaluated('type T = { a: uint8, b: string }; type R = T["a" | "b"]; String("s" is R);')).toBe('true');
  expect(evaluated('type T = { a: uint8, b: string }; type R = T["a" | "b"]; String((1 := uint8) is R);')).toBe('true');
});
