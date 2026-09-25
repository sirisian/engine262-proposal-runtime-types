import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind } from '../harness.mts';

/**
 * A typed creation, `Composite.<S>(source)`, CONVERTS each member - CompositeFromShape:
 * "each supplied value is converted to its member's type".
 *
 * Its source is typed at the shape S, as `let c: S = { ... }` types it, so a
 * member's literal is read at the member's type: it was read as a double first,
 * so a decimal member carried the binary value, a rational member the dyadic one,
 * a float32 member rounded twice and a uint64 member lost its last digit. And
 * because each member is converted rather than assigned, it meets the
 * conversion's static rule: a literal 300 at a uint8 member wraps, as
 * `uint8(300)` does, where an annotation refuses it.
 */

const created = (shape: string, member: string) => evaluated(`interface S { v: ${shape} } String(Composite.<S>({ v: ${member} }).v);`);

test('a member literal is read at the member type, in every family', () => {
  expect(created('decimal128', '0.1')).toBe('0.1');
  expect(created('rational', '0.1')).toBe('1/10');
  expect(created('float32', '16777217.0000000001')).toBe('16777218');
  expect(created('uint64', '9007199254740993')).toBe('9007199254740993');
  expect(evaluated('interface O { p: { x: decimal128 } } String(Composite.<O>({ p: { x: 0.1 } }).p.x);')).toBe('0.1');
});

test('a member is converted, not assigned', () => {
  expect(created('uint8', '300')).toBe('44');
  expect(created('uint8', '200 + 100')).toBe('44');
  // A value still converts from what it holds.
  expect(evaluated('interface S { v: decimal128 } let n = 0.1; String(Composite.<S>({ v: n }).v);'))
    .toBe('0.1000000000000000055511151231257827');
  // What cannot convert is still refused - by the creation itself, at run time,
  // as CompositeFromShape raises a member that fails and a required absence.
  expectThrownKind('interface S { v: uint8 } Composite.<S>({ v: "x" });', 'TypeError');
  expectThrownKind('interface S { v: uint8 } Composite.<S>({});', 'TypeError');
  // And an annotation still assigns, refusing before the program runs.
  expectStaticTypeError('interface S { v: uint8 } let s: S = { v: 300 };');
});

test('an array member converts as any array conversion does', () => {
  // An array's element conversion refuses an out-of-range element in every
  // spelling - `[300] := [].<uint8>` too - and a typed creation agrees with it.
  expectThrownKind('([300] := [].<uint8>);', 'RangeError');
  expectThrownKind('interface A { v: [].<uint8> } Composite.<A>({ v: [300] });', 'RangeError');
  expect(evaluated('interface A { v: [].<uint8> } String(Composite.<A>({ v: [3] }).v[0]);')).toBe('3');
});

test('a tuple member is read position by position, and past them at the rest', () => {
  expect(evaluated('interface T { v: [decimal128, uint64] } String(Composite.<T>({ v: [0.1, 9007199254740993] }).v[0]);')).toBe('0.1');
  expect(evaluated('interface T { v: [decimal128, uint64] } String(Composite.<T>({ v: [0.1, 9007199254740993] }).v[1]);')).toBe('9007199254740993');
  expect(evaluated('interface T { v: [uint8, ...[].<rational>] } String(Composite.<T>({ v: [1, 0.1, 0.1] }).v[2]);')).toBe('1/10');
});
