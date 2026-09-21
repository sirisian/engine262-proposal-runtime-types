import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * A RANGE `case` LABEL MATCHES BY CONTAINMENT.
 *
 * #sec-ranges: "A `case` whose label is a range matches where the range contains
 * the discriminant, which is what a `switch` over a float discriminant needs,
 * since a float has no enumerable cases to list. Matching is by containment
 * rather than by `===`".
 *
 * The static disjointness check for `switch` labels compared the discriminant
 * against the label's TYPE by strict equality, so every range label was disjoint
 * from every scalar discriminant: `"float32" and "ClosedOpenRange.<number>" are
 * disjoint`. That refused the form the specification introduces for exactly this
 * case, and the README's own example of it.
 *
 * A range is a NOMINAL record named by `LibraryName`, with its element type first
 * among its arguments - not a primitive with a range name, which is what a first
 * attempt at this fix assumed, and why it matched nothing.
 */
const W = (decl: string, label: string) =>
  `${decl} let r = 'none'; switch (x) { case ${label}: r = 'hit'; break; } r;`;

test('the README example: a range label on a float discriminant', () => {
  expect(evaluated(W('let x: float32 = 1 / 5;', '0..<0.99'))).toBe('hit');
});

test('containment decides the match, not equality', () => {
  expect(evaluated(W('let x: float32 = 2;', '0..<0.99'))).toBe('none');
  expect(evaluated(W('let x: uint8 = 5;', '0..=9'))).toBe('hit');
  expect(evaluated(W('let x: uint8 = 200;', '100..'))).toBe('hit');
});

test('a literal label that cannot adopt the discriminant is disjoint', () => {
  // The check's own comment gives `case "s"` for a `uint8` as what it exists to
  // catch, and it did not: every literal label was exempt so that `case 5` could
  // adopt a `uint32`, and the exemption swallowed literals that can never adopt.
  expectThrown(W('let x: uint8 = 3;', '"s"'), 'are disjoint');
  expectThrown(W('let x: uint8 = 3;', 'true'), 'are disjoint');
});

test('a numeric literal still adopts, and a matching literal still matches', () => {
  expect(evaluated(W('let x: uint32 = 5;', '5'))).toBe('hit');
  expect(evaluated(W("let x: string = 's';", '"s"'))).toBe('hit');
});
