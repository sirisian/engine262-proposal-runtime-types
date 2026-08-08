import { test } from 'vitest';
import { expectBuilderTrue } from '../corpus/type-challenges/harness.mts';

/**
 * Spec: #sec-keytypesof (KeyTypesOf) under #sec-type-expressions - `keyof` -
 * and generic type application via the disambiguated `.<T>` syntax.
 *
 * These are the two type operators the type-challenges corpus leans on
 * hardest (KeyTypesOf lives in type-system/runtime.mts); the corpus items at
 * the end are the identities keyof unlocks. All assertions are type
 * identities via interning, checked alias-to-alias with the corpus harness.
 */

// keyof of an object type is the union of its property-key literal types.
test('keyof - object keys', () => {
  expectBuilderTrue(`
    type T = { a: uint8, b: string };
    type K = keyof T;
    type Expected = 'a' | 'b';
    String(K === Expected);
  `);
});

test('keyof - single key interns to the lone literal', () => {
  expectBuilderTrue(`
    type T = { only: uint8 };
    type K = keyof T;
    type Expected = 'only';
    String(K === Expected);
  `);
});

test('keyof - membership: a key value is of the key type', () => {
  expectBuilderTrue(`
    type T = { x: uint8, y: uint8, z: uint8 };
    type K = keyof T;
    String('y' is K);
  `);
  expectBuilderTrue(`
    type T = { a: uint8 };
    type K = keyof T;
    String('z' is K ? false : true);
  `);
});

// keyof of an empty object is never (the empty union).
test('keyof - empty object is never', () => {
  expectBuilderTrue(`
    type T = {};
    type K = keyof T;
    String(K === never);
  `);
});

// keyof of a union is the keys common to every member (spec: intersection of
// key-sets). Keys present in only one member drop out.
test('keyof - union keeps common keys', () => {
  expectBuilderTrue(`
    type A = { a: uint8, shared: string };
    type B = { b: uint8, shared: string };
    type K = keyof (A | B);
    type Expected = 'shared';
    String(K === Expected);
  `);
});

// keyof of an intersection is the union of every member's keys.
test('keyof - intersection unions all keys', () => {
  expectBuilderTrue(`
    type A = { a: uint8 };
    type B = { b: string };
    type K = keyof (A & B);
    type Expected = 'a' | 'b';
    String(K === Expected);
  `);
});

// Generic type application (`.<T>` syntax): applies and interns by structure.
test('generic application - interns by structure', () => {
  expectBuilderTrue(`
    type Box<T> = { value: T };
    type A = Box.<uint8>;
    type B = Box.<uint8>;
    String(A === B);
  `);
  // structurally equal to the manual expansion
  expectBuilderTrue(`
    type Box<T> = { value: T };
    type A = Box.<uint8>;
    type Manual = { value: uint8 };
    String(A === Manual);
  `);
});

test('generic application - distinguishes by argument', () => {
  expectBuilderTrue(`
    type Box<T> = { value: T };
    type A = Box.<uint8>;
    type B = Box.<uint16>;
    String(A === B ? false : true);
  `);
});

test('generic application - identity generic passes its argument through', () => {
  expectBuilderTrue(`
    type Id<T> = T;
    type A = Id.<uint8>;
    String(A === uint8);
  `);
});

test('generic application - nests', () => {
  expectBuilderTrue(`
    type Box<T> = { value: T };
    type A = Box.<Box.<uint8>>;
    type B = Box.<Box.<uint8>>;
    String(A === B);
  `);
});

// keyof composed with generic application - the shape the medium tier uses.
test('keyof o generic application', () => {
  expectBuilderTrue(`
    type Box<T> = { value: T, label: string };
    type K = keyof Box.<uint8>;
    type Expected = 'value' | 'label';
    String(K === Expected);
  `);
});

/*
 * Challenges keyof unlocks (identity ports). The full builder forms of these
 * medium challenges also need the `type` operator, the `readonly` modifier,
 * and the std:types kit helpers (union, keysOf) of #annex-standard-kit; the
 * key-set identity each turns on is assertable with keyof alone.
 */

// 3 - Omit - MyOmit<T, K> drops the K properties. The key-set of the result is
// the key-set of T with K removed. keyof lets that identity be asserted.
test('medium 3 - Omit (key-set identity via keyof)', () => {
  expectBuilderTrue(`
    type Todo = { title: string, description: string, completed: boolean };
    type AllKeys = keyof Todo;
    type Expected = 'title' | 'description' | 'completed';
    String(AllKeys === Expected);
  `);
  // omitting 'description' leaves an object whose keys are 'title' | 'completed'
  expectBuilderTrue(`
    type Omitted = { title: string, completed: boolean };
    type K = keyof Omitted;
    type Expected = 'title' | 'completed';
    String(K === Expected);
  `);
});

// 10 - Tuple to Union - the union of a tuple's element types. The identity it
// establishes (a union of the element literal types) is expressible now; the
// builder form needs the `type` operator and the kit's union()/elementTypes
// (#annex-standard-kit).
test('medium 10 - Tuple to Union (identity)', () => {
  expectBuilderTrue(`
    type Result = 123 | '456' | true;
    type Expected = 123 | '456' | true;
    String(Result === Expected);
  `);
  // a union of one arm is that arm
  expectBuilderTrue(`
    type Result = 123;
    type Expected = 123;
    String(Result === Expected);
  `);
});
