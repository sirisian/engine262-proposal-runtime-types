import { test, expect } from 'vitest';
import { evaluated, evaluatedFlagOff, expectThrownKind } from '../readme/harness.mts';

/**
 * proposal-runtime-types (spec, checked and saturating arithmetic, and floored
 * division): the named arithmetic forms.
 *
 * The operators wrap, which is right when a value is a bit pattern and wrong when
 * it is a count. Neither is right always, so the operator takes the case that has
 * to be cheap and these take the rest. They exist only for the integer types,
 * because only there is wrapping the default: a float already saturates to an
 * infinity, and a decimal and a rational already raise.
 *
 * These were specified with a normative table and a worked note from the start,
 * and were entirely unimplemented until an inventory pass compared the operations
 * the specification names against the operations the suite mentions. Nothing
 * caught it because nothing asserted anything about them, which is the condition
 * this file now removes.
 */

const INTEGER_TYPES = ['uint8', 'uint16', 'uint32', 'int8', 'int16', 'int32'];

// -- The clause's own worked example -------------------------------------------
test('named arithmetic: the three answers the clause contrasts', () => {
  // "`a + 1` on a `uint8` holding 255 is 0, `Math.addChecked(a, 1)` throws a
  // RangeError exception, and `Math.addSaturating(a, 1)` is 255."
  expect(evaluated('String(Number((255 := uint8) + (1 := uint8)));')).toBe('0');
  expectThrownKind('Math.addChecked((255 := uint8), (1 := uint8));', 'RangeError');
  expect(evaluated('String(Number(Math.addSaturating((255 := uint8), (1 := uint8))));')).toBe('255');
});

// -- Checked: the exact result, or a RangeError --------------------------------
test('named arithmetic: the checked forms return the exact result where it fits', () => {
  expect(evaluated('String(Number(Math.addChecked((250 := uint8), (5 := uint8))));')).toBe('255');
  expect(evaluated('String(Number(Math.subChecked((5 := uint8), (5 := uint8))));')).toBe('0');
  expect(evaluated('String(Number(Math.mulChecked((3 := uint8), (4 := uint8))));')).toBe('12');
  // division truncates toward zero, as the `/` operator rounds
  expect(evaluated('String(Number(Math.divChecked((7 := int32), (2 := int32))));')).toBe('3');
  expect(evaluated('String(Number(Math.divChecked(((0 - 7) := int32), (2 := int32))));')).toBe('-3');
  // and the result carries the operands' type
  expect(evaluated('(Math.addChecked((1 := uint8), (1 := uint8)) is uint8) ? "yes" : "no";')).toBe('yes');
});

test('named arithmetic: the checked forms raise where the type cannot represent it', () => {
  expectThrownKind('Math.addChecked((255 := uint8), (1 := uint8));', 'RangeError');
  expectThrownKind('Math.subChecked((0 := uint8), (1 := uint8));', 'RangeError');
  expectThrownKind('Math.mulChecked((200 := uint8), (2 := uint8));', 'RangeError');
  // the one overflow a division has: the most negative value divided by -1
  expectThrownKind('Math.divChecked(((0 - 128) := int8), ((0 - 1) := int8));', 'RangeError');
  // the exactness matters at a width a double cannot judge for itself
  expectThrownKind('Math.mulChecked((4294967295 := uint32), (4294967295 := uint32));', 'RangeError');
});

// -- Saturating: the nearest value of the type ---------------------------------
test('named arithmetic: the saturating forms clamp to the type instead', () => {
  // its greatest value when the exact result exceeds it
  expect(evaluated('String(Number(Math.addSaturating((255 := uint8), (10 := uint8))));')).toBe('255');
  expect(evaluated('String(Number(Math.mulSaturating((200 := uint8), (2 := uint8))));')).toBe('255');
  expect(evaluated('String(Number(Math.mulSaturating((4294967295 := uint32), (4294967295 := uint32))));')).toBe('4294967295');
  // its least when the exact result falls below it
  expect(evaluated('String(Number(Math.subSaturating((0 := uint8), (1 := uint8))));')).toBe('0');
  expect(evaluated('String(Number(Math.subSaturating(((0 - 128) := int8), (1 := int8))));')).toBe('-128');
  expect(evaluated('String(Number(Math.divSaturating(((0 - 128) := int8), ((0 - 1) := int8))));')).toBe('127');
  // and where it fits, it is simply the exact result
  expect(evaluated('String(Number(Math.addSaturating((1 := uint8), (1 := uint8))));')).toBe('2');
});

test('named arithmetic: a division by zero raises in BOTH forms', () => {
  // saturation is about a result the type cannot hold; here there is no result
  // at all, so there is nothing for either treatment to act on
  expectThrownKind('Math.divChecked((7 := int32), (0 := int32));', 'RangeError');
  expectThrownKind('Math.divSaturating((7 := int32), (0 := int32));', 'RangeError');
});

// -- Floored division: the other pair ------------------------------------------
test('floored division: the quotient rounds toward negative infinity', () => {
  // where the operator `/` truncates toward zero, this rounds down
  expect(evaluated('String(Number(Math.divFloor((7 := int32), (2 := int32))));')).toBe('3');
  expect(evaluated('String(Number(Math.divFloor(((0 - 7) := int32), (2 := int32))));')).toBe('-4');
  expect(evaluated('String(Number(Math.divFloor((7 := int32), ((0 - 2) := int32))));')).toBe('-4');
  expect(evaluated('String(Number(Math.divFloor(((0 - 7) := int32), ((0 - 2) := int32))));')).toBe('3');
  // the contrast with the operator, which is the reason both exist
  expect(evaluated('String(Number(((0 - 7) := int32) / (2 := int32)));')).toBe('-3');
});

test('floored division: the remainder sign follows the DIVISOR', () => {
  // the `%` of Python and the `mod` of Kotlin and Haskell
  expect(evaluated('String(Number(Math.mod(((0 - 7) := int32), (3 := int32))));')).toBe('2');
  expect(evaluated('String(Number(Math.mod((7 := int32), ((0 - 3) := int32))));')).toBe('-2');
  expect(evaluated('String(Number(Math.mod((7 := int32), (3 := int32))));')).toBe('1');
  // the operator `%` follows the dividend instead, which is why both exist
  expect(evaluated('String(Number(((0 - 7) := int32) % (3 := int32)));')).toBe('-1');
  // for a positive divisor the result is never negative, so an index wraps safely
  expect(evaluated('String(Number(Math.mod(((0 - 1) := int32), (5 := int32))));')).toBe('4');
});

test('floored division: the identity the clause derives holds', () => {
  // divFloor(a, b) * b + mod(a, b) = a, for every sign combination
  expect(evaluated(`
    let ok = true;
    for (const a of [7, -7, 13, -13, 0, 1]) {
      for (const b of [3, -3, 5, -5, 1]) {
        const q = Number(Math.divFloor((a := int32), (b := int32)));
        const r = Number(Math.mod((a := int32), (b := int32)));
        if (q * b + r !== a) { ok = false; }
      }
    }
    String(ok);
  `)).toBe('true');
});

test('floored division: a zero divisor raises in both', () => {
  expectThrownKind('Math.divFloor((7 := int32), (0 := int32));', 'RangeError');
  expectThrownKind('Math.mod((7 := int32), (0 := int32));', 'RangeError');
});

// -- Resolution: one integer type, and no untyped signature --------------------
test('named arithmetic: every form works at every integer width', () => {
  const FORMS = ['addChecked', 'subChecked', 'mulChecked', 'divChecked',
    'addSaturating', 'subSaturating', 'mulSaturating', 'divSaturating',
    'divFloor', 'mod'];
  for (const fn of FORMS) {
    for (const t of INTEGER_TYPES) {
      expect(evaluated(`(Math.${fn}((4 := ${t}), (2 := ${t})) is ${t}) ? "yes" : "no";`), `${fn} at ${t}`).toBe('yes');
    }
  }
});

test('named arithmetic: one type per signature, and no untyped call', () => {
  const FORMS = ['addChecked', 'addSaturating', 'divFloor', 'mod'];
  for (const fn of FORMS) {
    // two typed arguments of different types are viable at no signature
    expectThrownKind(`Math.${fn}((1 := uint8), (1 := uint16));`, 'TypeError');
    // these forms exist for the integer types, so a float has no signature
    expectThrownKind(`Math.${fn}((1 := float32), (1 := float32));`, 'TypeError');
    // and there is no untyped signature: the type is what they work in
    expectThrownKind(`Math.${fn}(1, 2);`, 'TypeError');
    // a literal beside a typed operand is ranked into the type
    expect(evaluated(`(Math.${fn}((4 := uint8), 2) is uint8) ? "yes" : "no";`), `${fn} literal`).toBe('yes');
    // one the type cannot represent matches no signature
    expectThrownKind(`Math.${fn}((4 := uint8), 300);`, 'TypeError');
  }
});

test('named arithmetic: the forms are gated, so flag-off is unchanged', () => {
  for (const fn of ['addChecked', 'addSaturating', 'divFloor', 'mod', 'mulSaturating']) {
    expect(evaluated(`String(typeof Math.${fn});`)).toBe('function');
    expect(evaluatedFlagOff(`String(typeof Math.${fn});`), `${fn} flag-off`).toBe('undefined');
  }
});
