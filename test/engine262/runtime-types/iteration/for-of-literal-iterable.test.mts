import { expect, test } from 'vitest';
import { evaluated, expectThrown, ok } from '../harness.mts';

/**
 * Spec: #sec-contextual-types, the `for`-`of` row.
 *
 * > The iterable of a `for`-`of` head whose binding has a TypeAnnotation, where
 * > that iterable is a range literal or an array literal, possibly
 * > parenthesized - the range or array type whose element type is the
 * > annotated type.
 *
 * A `for`-`of` binding "takes the same annotation" as a lexical binding but has
 * no initializer, so no row reached its iterable and a literal there was typed
 * with nothing: `for (const b: uint8 of 0..<256)` read the range as a range of
 * `number` and was refused, naming a type the author never wrote, where
 * `let r: ClosedOpenRange.<uint8> = 0..<256` was accepted.
 *
 * NOT covered, deliberately: an UNANNOTATED loop variable taking its type from a
 * later use. That is whole-function inference; every row of the table is local.
 */

const intoBytes = (loop: string) => `const s = new Set.<uint8>(); ${loop} String(s.size);`;

test('a range literal takes the annotation', () => {
  expect(evaluated(intoBytes('for (const b: uint8 of 0..<256) s.add(b);'))).toBe('256');
  expect(evaluated(intoBytes('for (const i: uint8 of 0..<3) s.add(i);'))).toBe('3');
  expect(evaluated(intoBytes('for (const b: uint8 of 0..=255) s.add(b);'))).toBe('256');
  // Parentheses do not change it.
  expect(evaluated(intoBytes('for (const i: uint8 of (0..<3)) s.add(i);'))).toBe('3');
});

test('an array literal takes the annotation', () => {
  expect(evaluated(intoBytes('for (const c: uint8 of [0x0a, 0x0d, 0x20]) s.add(c);'))).toBe('3');
});

test('a union annotation resolves by the literal ranking', () => {
  expect(ok('for (const x: uint8 | string of 0..<3) {}')).toBe(true);
});

test('a range that does not fit is refused ONCE, naming the element', () => {
  // Rule 1 reports; the assignability check adds nothing, the range's element
  // type being the annotation.
  expectThrown('for (const b: uint8 of 0..<300) {}', '299');
  expectThrown('for (const b: uint8 of 0..=256) {}', '256');
});

test('the loop and an annotated binding cannot disagree', () => {
  // Both go through the same range arm, so they reach the same verdict.
  expect(evaluated(intoBytes('let r: ClosedOpenRange.<uint8> = 0..<256; for (const b of r) s.add(b);'))).toBe('256');
  expectThrown('let r: ClosedRange.<uint8> = 0..=256;', '256');
});

test('an iterable that is not a literal is not retyped', () => {
  // "A contextual type does not reach INTO a call": the call's range stays a
  // range of `number`, and the annotation checks its elements as before.
  expectThrown('function mk(): ClosedOpenRange.<number> { return 0..<3; } for (const i: uint8 of mk()) {}',
    'is not assignable');
  // A binding keeps the type it was given where it was declared.
  expectThrown('const r = 0..<3; for (const i: uint8 of r) {}', 'is not assignable');
  expectThrown('const a: [].<number> = [1, 2]; for (const x: uint8 of a) {}', 'is not assignable');
});

test('what already worked is unchanged', () => {
  expect(ok('for (const i: number of 0..<3) {}')).toBe(true);
  expect(ok('for (const i of 0..<3) {}')).toBe(true);
  expect(evaluated(intoBytes('const a: [].<uint8> = [1, 2]; for (const x: uint8 of a) s.add(x);'))).toBe('2');
});

test('a float loop annotation reaches the float element rule', () => {
  expectThrown('for (const x: float16 of 0..<4000) {}', '2049');
  expect(ok('for (const x: float16 of 0..<2049) {}')).toBe(true);
  expectThrown('for (const x: float32 of 0.5..<1e39) {}', 'overflows');
});
