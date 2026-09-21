import { expect, test } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

/**
 * Spec: #sec-parsing. "For an integer type AND FOR `BIGINT` its signature is
 * `parse(_string_, _radix_ = 10)`", and "each type also has a `tryParse`
 * function with the same parameters".
 *
 * `bigint.parse` refused with "parse is not defined for bigint" - true of the
 * engine and false of the clause. `TypeProto_parse`'s guard admitted the
 * integer and float families and never listed `bigint`.
 *
 * (The message rendered the receiver as "[Function]", which reads like a
 * constructor binding - the cause of the same symptom in `rational` and
 * `complex`. It is not: `bigint` is a proper type object, and `string.parse`
 * produces the identical message. The formatter renders a type object that
 * way.)
 */

test('a bigint parses exactly', () => {
  expect(evaluated("String(bigint.parse('42'));")).toBe('42');
  expect(evaluated("String(Reflect.typeOf(bigint.parse('42')));")).toBe('bigint');
  expect(evaluated("String(bigint.parse('-42'));")).toBe('-42');
  // The reason a bigint parse exists: digits beyond 2**53, read WITHOUT a
  // round trip through a Number, which would lose the last one.
  expect(evaluated("String(bigint.parse('9007199254740993'));")).toBe('9007199254740993');
  expect(evaluated("String(bigint.parse('123456789012345678901234567890'));"))
    .toBe('123456789012345678901234567890');
});

test('the radix and literal grammar match the integer family', () => {
  expect(evaluated("String(bigint.parse('ff', 16));")).toBe('255');
  expect(evaluated("String(bigint.parse('1_000'));")).toBe('1000');
  expect(evaluated("String(bigint.parse('  42  '));")).toBe('42');
});

test('a bigint has no range failure, only a malformed one', () => {
  // A bigint has no width to overflow, so `parse` has one failure where the
  // sized integers have two.
  expectThrownKind("bigint.parse('zz');", 'SyntaxError');
  expectThrownKind("bigint.parse('');", 'SyntaxError');
  // A fraction is not an integer literal.
  expectThrownKind("bigint.parse('1.5');", 'SyntaxError');
});

test('tryParse answers null for a malformed string', () => {
  expect(evaluated("String(bigint.tryParse('42'));")).toBe('42');
  expect(evaluated("String(bigint.tryParse('zz'));")).toBe('null');
});

test('the other families are unchanged', () => {
  expect(evaluated("String(uint8.parse('42'));")).toBe('42');
  expectThrownKind("uint8.parse('300');", 'RangeError');
  expect(evaluated("String(float16.parse('0.1'));")).toBe('0.0999755859375');
  // A type with no parse still has none.
  expectThrownKind("string.parse('42');", 'TypeError');
});
