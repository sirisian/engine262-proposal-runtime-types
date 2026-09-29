import { expect, test } from 'vitest';
import { expectEarlyError, expectStaticTypeError, ok } from '../harness.mts';

/**
 * Spec: #sec-threading-shared-modifier. The operand of `shared` must be a value
 * type, must not itself be `shared`, and must not be a `ref`. A resolved violation
 * is a type error before the source runs, in an unused signature as much as in a
 * used one.
 */
test.each(['string', 'any', '(n: uint8) => uint8', '[].<uint8>', 'shared uint8'])('shared rejects the closed invalid operand %s', (operand) => {
  expectStaticTypeError(`function unused(n: shared (${operand})) {}`);
});

test('a shared operand that is a parenthesized ref annotation is the type error the clause names', () => {
  // `ref` PrimaryType is a ReferenceType and a ParenthesizedType is a PrimaryType,
  // so `shared (ref uint8)` parses. #sec-threading-shared-modifier then refuses it:
  // it is a type error if the operand is ~reference~, since `ref` denotes a
  // location rather than a value. The parenthesized and unparenthesized spellings
  // are refused alike.
  expectEarlyError('function unused(n: shared (ref uint8)) {}', 'StaticTypeError');
  expectEarlyError('function unused(n: shared ref uint8) {}', 'StaticTypeError');
});

test('shared operands are checked in aliases and nested declarations', () => {
  expectStaticTypeError('type S = shared string;');
  expectStaticTypeError('function unused() { let n: shared string; }');
  expect(ok('function unused(n: shared uint8) {}')).toBe(true);
  expect(ok('function unused(n: shared [2].<uint8>) {}')).toBe(true);
  expect(ok('class C { n: uint8 = 1; } function unused(n: shared C) {}')).toBe(true);
});
