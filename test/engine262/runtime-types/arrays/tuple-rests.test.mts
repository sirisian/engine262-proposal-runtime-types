import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * PLAN-rest-parameters.md phase 3: tuples get the matcher.
 *
 * A rest parameter's type IS a tuple or array type, so the two forms have to
 * answer the same way about which run belongs to which rest - which is why
 * #sec-sequenceassignment is defined once and consumed by both. This is the
 * tuple half: membership (#sec-array-membership) and subtyping
 * (#sec-issubtype).
 *
 * Three defects were live here before this phase, none of which needed more
 * than ONE rest to bite:
 *
 * 1. A rest element's [[Type]] is the ARRAY it stands for - `...[].<string>`
 *    holds `[].<string>` - so comparing a single element against it directly
 *    meant NO rest element ever matched anything. Every tuple type with a rest
 *    was uninhabited.
 * 2. The minimum length stopped counting at the first rest, so elements AFTER
 *    one were not required: `[1]` satisfied `[number, ...[].<string>, boolean]`
 *    with the required boolean missing.
 * 3. The position mapping assumed one rest, returning the first one's type for
 *    its own position and every later one.
 */

test('a trailing rest matches the run after the fixed elements', () => {
  // Was false for every input: defect 1 made a rest match nothing.
  expect(evaluated("String([1, 'a', 'b'] is [number, ...[].<string>]);")).toBe('true');
  expect(evaluated("String([1] is [number, ...[].<string>]);")).toBe('true');
  // And still refuses an element the rest cannot take.
  expect(evaluated("String([1, 'a', 2] is [number, ...[].<string>]);")).toBe('false');
});

test('elements AFTER a rest are required', () => {
  // Defect 2: this answered true, with the boolean simply not looked for.
  expect(evaluated("String([1] is [number, ...[].<string>, boolean]);")).toBe('false');
  expect(evaluated("String([1, 'a', true] is [number, ...[].<string>, boolean]);")).toBe('true');
  // The rest may take nothing, which is what makes the middle run optional.
  expect(evaluated("String([1, true] is [number, ...[].<string>, boolean]);")).toBe('true');
});

test('several rests split by their element types', () => {
  expect(evaluated("String([1, 2, 'a'] is [...[].<number>, ...[].<string>]);")).toBe('true');
  // Order matters: the numbers must come first, since the runs are positional.
  expect(evaluated("String(['a', 1] is [...[].<number>, ...[].<string>]);")).toBe('false');
  // Either run may be empty.
  expect(evaluated("String(['a', 'b'] is [...[].<number>, ...[].<string>]);")).toBe('true');
  expect(evaluated("String([1, 2] is [...[].<number>, ...[].<string>]);")).toBe('true');
});

test('a tuple with no rest is unchanged', () => {
  // The exact positional path, which is what every existing tuple takes.
  expect(evaluated("String([1, 'a'] is [number, string]);")).toBe('true');
  expect(evaluated("String([1] is [number, string]);")).toBe('false');
  expect(evaluated("String([1, 'a', 2] is [number, string]);")).toBe('false');
  expect(evaluated("String(['a', 1] is [number, string]);")).toBe('false');
});

test('subtyping relates a fixed tuple to one with a rest', () => {
  // Was false: defect 1 again, from the subtyping side. `tupleTypeAt` returned
  // the rest's array type, so a `number` was asked to be a `[].<number>`.
  expect(evaluated(`
    type S = [number, number];
    type T = [number, ...[].<number>];
    String(Reflect.isAssignable(S, T));
  `)).toBe('true');

  expect(evaluated(`
    type S = [number, number];
    type T = [number, ...[].<string>];
    String(Reflect.isAssignable(S, T));
  `)).toBe('false');

  // The minimum length is what refuses this: T requires a boolean at the end
  // and S can never supply one.
  expect(evaluated(`
    type S = [number];
    type T = [number, ...[].<string>, boolean];
    String(Reflect.isAssignable(S, T));
  `)).toBe('false');
});

test('a target with several rests relates conservatively', () => {
  // #sec-issubtype: where the target has more than one rest its positions are
  // not determined by their index, and the exact relation is inclusion between
  // two regular languages - a product construction a subtyping check cannot
  // afford at every use. The rule requires the element lists to correspond,
  // which is sound and exact whenever they do.
  expect(evaluated(`
    type S = [...[].<number>, ...[].<string>];
    type T = [...[].<number>, ...[].<string>];
    String(Reflect.isAssignable(S, T));
  `)).toBe('true');

  // Refused by the conservative rule rather than by being unrelated: a
  // [number, string] IS one of the sequences the target admits. When an exact
  // inclusion check is ever written this becomes true, and this assertion
  // should be changed rather than read as a requirement.
  expect(evaluated(`
    type S = [number, string];
    type T = [...[].<number>, ...[].<string>];
    String(Reflect.isAssignable(S, T));
  `)).toBe('false');
});

test('tuple identity is unaffected', () => {
  // Interning compares the element list, rests included, and phase 3 changed
  // how tuples are COMPARED without changing what they ARE.
  expect(evaluated(`
    type A = [number, ...[].<string>];
    type B = [number, ...[].<string>];
    String(A === B);
  `)).toBe('true');
  expect(evaluated(`
    type A = [number, ...[].<string>];
    type B = [number, [].<string>];
    String(A === B);
  `)).toBe('false');
});
