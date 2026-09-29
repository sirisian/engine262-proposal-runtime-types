import { expect, test } from 'vitest';
import { expectEarlyError, expectStaticTypeError, ok } from '../harness.mts';

test.each(['string', 'any', '(n: uint8) => uint8', '[].<uint8>', 'shared uint8'])('shared rejects the closed invalid operand %s', (operand) => {
  expectStaticTypeError(`function unused(n: shared (${operand})) {}`);
});

test('a shared operand that is a parenthesized ref annotation is the type error the clause names', () => {
  // `ref` PrimaryType is a ReferenceType and a ParenthesizedType is a
  // PrimaryType, so `shared (ref uint8)` parses and #sec-threading's "It is a
  // type error to declare `shared ref T`" is what refuses it. The cover used
  // to reject `(ref uint8)` outright (early-error survey 1, Gap 3).
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
