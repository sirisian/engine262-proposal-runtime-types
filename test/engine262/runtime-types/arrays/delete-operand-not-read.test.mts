import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

/**
 * THE OPERAND OF `delete` IS NOT READ - guards for the `forDelete` exemption.
 *
 * #sec-array-defaults-and-stores: "For a union receiver, this storage judgment
 * is established when every reachable alternative on which the deletion executes
 * establishes prohibited storage at the selected key ... The predicate is about
 * deletion, not whether an element read would be in bounds". The declared-member
 * requirement on unions is stated for READING a member.
 *
 * `memberReadType` takes a `forDelete` flag that skips the union declared-member
 * refusal for a `delete` operand and nothing else, so `delete a[2]` on
 * `[uint8] | [].<uint8>` is left to the deletion judgment, which defers because
 * the members disagree.
 *
 * The first test is the R43 case. The rest guard the flag from reaching further
 * than a delete. Measured by making the exemption apply to every read: the READ
 * and STORE tests below then fail, which is the leak this file exists to catch.
 * The all-nullish test pins that a delete still needs an object to delete from,
 * by #sec-object-types-semantics - "reads, stores, updates, deletion and
 * invocation through a member share this receiver judgment".
 */

const U = 'function f(a: [uint8] | [].<uint8>) { ';

test('a delete that no alternative settles is left to the run time', () => {
  expect(ok(`${U}delete a[2]; } let x: [uint8] = [1]; f(x);`)).toBe(true);
});

test('the READ rule on the same union is unchanged', () => {
  // The exemption is for the operand of `delete` only.
  expectStaticTypeError(`${U}return a[2]; }`);
});

test('a STORE through the same member is still judged as a read', () => {
  // A store reads before it writes, and #sec-array-defaults-and-stores' union
  // rule is stated for deletion, not for stores.
  expectStaticTypeError(`${U}a[2] = 1; }`);
});

test('a key that is protected storage in EVERY alternative is still refused', () => {
  // The deletion judgment still decides, and here it establishes prohibited
  // storage on both arms.
  expectStaticTypeError(`${U}delete a[0]; }`);
  expectStaticTypeError('function f(a: [2].<uint8> | [].<uint8>) { delete a[0]; }');
});

test('an all-nullish receiver is still refused under delete', () => {
  // The receiver judgment deletion shares with a read. Losing it was the error
  // in the first version of this fix.
  expectStaticTypeError('function f(x: null) { delete x.a; }');
});

test('a bare computed member in statement position is still judged', () => {
  // The walk that typed every member did so for this case, `a[9];`, and must
  // keep doing so for everything that is not a `delete` operand.
  expectStaticTypeError('let a: [2].<uint8> = [1, 2]; a[9];');
});
