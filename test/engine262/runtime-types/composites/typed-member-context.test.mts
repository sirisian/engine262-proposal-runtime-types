import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * A TYPED OWN PROPERTY GIVES ITS VALUE A CONTEXTUAL TYPE. `{ (v: T): … }`
 * declares the property's type at creation, and that type is the context the
 * value is read at - exactly as a binding, a class field and an array element
 * give theirs.
 *
 * Nothing did. A literal in that position was never read at the member's type,
 * so it kept whatever it would have been without one:
 *
 *   Composite({ (v: rational): 1 / 3 }).v   // 6004799503160661/18014398509481984
 *   Composite({ (v: decimal64): 1.00 }).v   // "1 is not assignable to decimal64"
 *
 * The first is the fraction never folded - Number division, then the exact
 * DYADIC rational of the result. The second is a decimal literal never read
 * from its digits.
 *
 * `float32` and `uint8` members worked throughout, because their literals need
 * no contextual reading; they are the control that this changes nothing for the
 * families that were already right.
 */

test('a rational member folds its fraction exactly', () => {
  expect(evaluated('String(Composite({ (v: rational): 1 / 3 }).v);')).toBe('1/3');
  // Three thirds summing to one is rational.md's own headline claim, and it
  // holds through a composite member now.
  expect(evaluated(`const c = Composite({ (v: rational): 1 / 3 });
    String(c.v + c.v + c.v);`)).toBe('1');
});

test('a decimal member is read from its digits, at every width', () => {
  expect(evaluated('String(Composite({ (v: decimal128): 1.00 }).v);')).toBe('1');
  // decimal64 was refused outright: whatever covered decimal128 was
  // width-specific, and reading the literal at the member's type is not.
  expect(evaluated('String(Composite({ (v: decimal64): 1.00 }).v);')).toBe('1');
});

test('the families that already worked are unchanged', () => {
  expect(evaluated('String(Composite({ (v: float32): 1.5 }).v);')).toBe('1.5');
  expect(evaluated('String(Composite({ (v: uint8): 5 }).v);')).toBe('5');
  expect(evaluated('String(Reflect.typeOf(Composite({ (v: uint8): 5 }).v) === uint8);')).toBe('true');
});

test('an untyped member and an ordinary binding are untouched', () => {
  expect(evaluated('String(Composite({ v: 1.5 }).v);')).toBe('1.5');
  expect(evaluated('const d: decimal128 = 1.00; String(d);')).toBe('1.00');
});
