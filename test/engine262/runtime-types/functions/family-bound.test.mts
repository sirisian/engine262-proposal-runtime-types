import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * proposal-runtime-types, PLAN-function-family-bound.md F136.
 *
 * Every family of this proposal has a BOUND - a type that admits every member
 * of the family and nothing else - and two of the three could be written:
 * `{}` for objects, `[].<any>` for arrays. Functions had none.
 *
 * The blocker was not a missing `Function` type name. `Array`, `Object` and
 * `Function` are all absent from #sec-type-names, and on a rule: a constructor
 * is not a type name where the language already denotes that family another way
 * - the four wrappers because the lowercase name is the type, these three
 * because the family has a structural spelling. Adding `Function` would break
 * that rule AND force a Type Object exception, since a Type Object is callable
 * (`uint8(v)` is a conversion) and `typeof` says deliberately that it is not a
 * function.
 *
 * The blocker was VARIANCE, and narrower than it first looked. `IsAssignable`
 * is bidirectional on `any` - true where either side is `any` - while
 * `IsSubtype` admits `any` only as the TARGET. The signature parameter step
 * called `IsSubtype`, so `any` in a target's parameter position refused every
 * specific source parameter, while the mirror case passed.
 */

test('the function family bound admits every function shape', () => {
  const B = 'type (...a: [].<any>) => any';
  for (const f of [
    'type () => string',
    'type (uint8) => void',
    'type (uint8, string) => uint8',
    'type (...r: [].<uint8>) => void',
  ]) {
    expect(evaluated(`String(Reflect.isAssignable(${f}, ${B}));`), f).toBe('true');
  }
});

test('and admits nothing outside the family', () => {
  const B = 'type (...a: [].<any>) => any';
  for (const t of ['type { a: uint8 }', 'type [].<uint8>', 'uint8', 'type [uint8, string]']) {
    expect(evaluated(`String(Reflect.isAssignable(${t}, ${B}));`), t).toBe('false');
  }
  // A TYPE OBJECT is callable and is still not a function. This is the property
  // a `Function` type name could not have had without an explicit exception:
  // `uint8` has no call signature for the structural bound to match, so it is
  // excluded by the ordinary rule with nothing written.
  expect(evaluated('String(Reflect.isAssignable(uint8, type (...a: [].<any>) => any));')).toBe('false');
});

test('F136: `any` in a parameter position is bidirectional, as it is elsewhere', () => {
  // The defect, and it is owed a fix regardless of bounds: a function could not
  // be passed where an `any`-parameterised signature was declared.
  expect(evaluated('String(Reflect.isAssignable(type (uint8) => void, type (any) => any));')).toBe('true');
  expect(evaluated('String(Reflect.isAssignable(type (uint8, string) => void, type (any, any) => any));')).toBe('true');
  // the mirror already held, which is what made the asymmetry visible
  expect(evaluated('String(Reflect.isAssignable(type (any) => void, type (uint8) => any));')).toBe('true');
  // and `any` is bidirectional at the top level, which is the rule the
  // parameter step was not following
  expect(evaluated('String(Reflect.isAssignable(any, uint8));')).toBe('true');
  expect(evaluated('String(Reflect.isAssignable(uint8, any));')).toBe('true');
});

test('contravariance still refuses what it should', () => {
  // The obvious guard is no guard: `(any) => void -> (uint8) => any` is true
  // TODAY and correctly so, because `uint8` is assignable to `any`. These are
  // the genuine violations.
  expect(evaluated('String(Reflect.isAssignable(type (uint8) => void, type (string) => any));')).toBe('false');
  expect(evaluated('String(Reflect.isAssignable(type (uint8) => void, type (uint8 | string) => any));')).toBe('false');
  // widening a parameter is still fine in the sound direction
  expect(evaluated('String(Reflect.isAssignable(type (uint8 | string) => void, type (uint8) => any));')).toBe('true');
});

test('the bound composes, which a bare top type could not', () => {
  // `(...a: [].<any>) => string` is "any function returning a string". A
  // `Function` name gives only the top and cannot say this.
  expect(evaluated('String(Reflect.isAssignable(type (uint8) => string,'
    + ' type (...a: [].<any>) => string));')).toBe('true');
  expect(evaluated('String(Reflect.isAssignable(type (uint8) => uint8,'
    + ' type (...a: [].<any>) => string));')).toBe('false');
});
