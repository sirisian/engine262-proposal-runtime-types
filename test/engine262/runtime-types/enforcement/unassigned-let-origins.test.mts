import { expect, test } from 'vitest';
import { expectStaticTypeError, expectThrownKind, ok } from '../harness.mts';

// #sec-function-types: "a mutable origin is usable only while replacement is
// excluded; assignments, including assignment patterns and captured writes,
// and direct eval withdraw an otherwise unproved origin." The intrinsic proofs
// read their origins by the same rule.

test('an unassigned let establishes an origin', () => {
  expectStaticTypeError('let a: [2].<uint8> = [1, 2]; a.push(3);');
  expectStaticTypeError('let n: uint8 = 1; Promise.all(n);');
});

test('a declaration without an initializer holds a fresh default', () => {
  expectStaticTypeError('const a: [2].<uint8>; a.push(3);');
  expectStaticTypeError('let a: [2].<uint8>; a.push(3);');
});

test('an assignment, a pattern, a for-of target or a direct eval withdraws it', () => {
  expectThrownKind('let a: [2].<uint8> = [1, 2]; a = [3, 4]; a.push(3);', 'TypeError');
  expectThrownKind('let a: [2].<uint8> = [1, 2]; [a] = [[3, 4]]; a.push(3);', 'TypeError');
  expectThrownKind('const b: [2].<uint8> = [3, 4]; let a: [2].<uint8> = [1, 2]; for (a of [b]) {} a.push(3);', 'TypeError');
  expectThrownKind('let a: [2].<uint8> = [1, 2]; function w() { a = [3, 4]; } a.push(3);', 'TypeError');
  expect(ok("let n: uint8 = 1; eval('n = 2'); Promise.all(n);")).toBe(true);
});
