import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-type-arguments. "A shift operator inside a type argument list must
 * be PARENTHESIZED, which is only relevant to a value argument, since a shift
 * cannot otherwise appear in a type."
 *
 * The escape had no effect. `noFuseGT` - the lexer counter that splits `>>`
 * into two closers so `Box.<Box.<uint8>>` can close - stayed raised through a
 * |ComputedType|'s argument list, so `B.<N((8 >> 1))>` split its `>>` exactly
 * as the bare form did, leaving the clause's remedy with no way to be written.
 *
 * A LEFT shift was unaffected, `<<` needing no splitting, so only `>>` and
 * `>>>` were unreachable - which is why it stayed hidden.
 *
 * The counter is now suspended inside the parenthesized argument list: a `>`
 * there cannot be closing the type argument list, because the `)` must come
 * first.
 */

// A builder returns a TYPE OBJECT, which is what #sec-computed-types requires:
// "the type the |ComputedType| denotes is the Type Object that
// EvaluateToTypeObject returns for it".
const N = 'function N(x) { return Reflect.typeOf((x := uint32)); } class B<M: uint32> { } ';

test('a right shift reaches a value argument', () => {
  expect(evaluated(`${N}let b: B.<N((8 >> 1))> = new B.<N((8 >> 1))>(); "ok";`)).toBe('ok');
  expect(evaluated(`${N}let b: B.<N((8 >>> 1))> = new B.<N((8 >>> 1))>(); "ok";`)).toBe('ok');
  // Inside the call's own parentheses the bare form is unambiguous too - the
  // `)` closes before any `>` could be a closer.
  expect(evaluated(`${N}let b: B.<N(8 >> 1)> = new B.<N(8 >> 1)>(); "ok";`)).toBe('ok');
});

test('the other operators are unchanged', () => {
  expect(evaluated(`${N}let b: B.<N(1 << 2)> = new B.<N(1 << 2)>(); "ok";`)).toBe('ok');
  expect(evaluated(`${N}let b: B.<N(1 + 3)> = new B.<N(1 + 3)>(); "ok";`)).toBe('ok');
  expect(evaluated(`${N}let b: B.<N(1 < 2 ? 4 : 5)> = new B.<N(1 < 2 ? 4 : 5)>(); "ok";`)).toBe('ok');
  expect(evaluated(`${N}let b: B.<N(4)> = new B.<N(4)>(); "ok";`)).toBe('ok');
});

test('nested type argument lists still close, at any depth', () => {
  // What the splitting exists for, and what suspending it must not break.
  const Box = 'class Box<T> { v: T | null = null; } ';
  expect(evaluated(`${Box}let x: Box.<Box.<uint8>> = new Box.<Box.<uint8>>(); "ok";`)).toBe('ok');
  expect(evaluated(`${Box}let x: Box.<Box.<Box.<uint8>>> = new Box.<Box.<Box.<uint8>>>(); "ok";`)).toBe('ok');
});

test('a shift in ordinary expression position is untouched', () => {
  expect(evaluated('String(8 >> 1);')).toBe('4');
  expect(evaluated('String(8 >>> 1);')).toBe('4');
  expect(evaluated('String(1 << 2);')).toBe('4');
});

test('a computed type still has to denote a type', () => {
  expect(evaluated('function Id() { return uint8; } let x: Id() = (1 := uint8); String(x);')).toBe('1');
  expectStaticTypeError('function Bad() { return 5; } let x: Bad() = 1;');
});
