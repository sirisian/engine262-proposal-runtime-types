import { expect, test } from 'vitest';
import { expectEarlyError, expectStaticTypeError, ok } from '../harness.mts';

test.each(['string', 'any', '(n: uint8) => uint8', '[].<uint8>', 'shared uint8'])('shared rejects the closed invalid operand %s', (operand) => {
  expectStaticTypeError(`function unused(n: shared (${operand})) {}`);
});

test('the shared operand grammar does not admit a parenthesized ref annotation', () => {
  expectEarlyError('function unused(n: shared (ref uint8)) {}', 'SyntaxError');
});

test('shared operands are checked in aliases and nested declarations', () => {
  expectStaticTypeError('type S = shared string;');
  expectStaticTypeError('function unused() { let n: shared string; }');
  expect(ok('function unused(n: shared uint8) {}')).toBe(true);
  expect(ok('function unused(n: shared [2].<uint8>) {}')).toBe(true);
  expect(ok('class C { n: uint8 = 1; } function unused(n: shared C) {}')).toBe(true);
});
