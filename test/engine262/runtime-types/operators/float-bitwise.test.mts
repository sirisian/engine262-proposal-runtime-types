import { expect, test } from 'vitest';
import { expectThrown, ok } from '../harness.mts';

/**
 * Spec: #table-family-operations. A binary floating-point type "does not define
 * bitwiseNOT, the shifts, and the bitwise operations, since each would require
 * converting the operand to an integer type."
 *
 * The run time refused them - `(4 := float32) << (1 := float32)` and
 * `~(1.5 := float32)` - but an operand's type is what decides it, so
 * #sec-type-errors makes the judgment determinable wherever that type is
 * written down. Every case below is in a function that is never called.
 */

const dead = (source: string) => `function __never() { ${source} }`;
const D = 'let f: float64 = float64(1); let g: float32 = float32(1); let n: uint8 = uint8(1); ';

test('the bitwise and shift operators are refused on a binary float', () => {
  for (const e of ['f & f', 'f | f', 'f ^ f', 'f << f', 'f >> f', 'f >>> f', 'g | g']) {
    expectThrown(dead(`${D}let q = ${e};`), 'binary floating-point');
  }
  // bitwiseNOT is the unary one.
  expectThrown(dead(`${D}let q = ~f;`), 'binary floating-point');
  expectThrown(dead(`${D}let q = ~g;`), 'binary floating-point');
  // EITHER operand decides it: a float against an integer reaches this rule
  // before the one about mixing numeric types.
  expectThrown(dead(`${D}let q = f | n;`), 'binary floating-point');
  expectThrown(dead(`${D}let q = n | f;`), 'binary floating-point');
});

test('what the rule does not reach', () => {
  // Every family has arithmetic, comparison and negation.
  for (const e of ['f + f', 'f - f', 'f * f', 'f / f', 'f < f', 'f === f', '-f']) {
    expect(ok(dead(`${D}let q = ${e};`))).toBe(true);
  }
  // An INTEGER type defines all of them.
  for (const e of ['n & n', 'n | n', 'n ^ n', 'n << n', 'n >> n', '~n']) {
    expect(ok(dead(`${D}let q = ${e};`))).toBe(true);
  }
  // An untyped operand is not this rule's business.
  expect(ok(dead('let q = 1.5 | 2;'))).toBe(true);
  expect(ok(dead('let a: any = 1.5; let q = a | 2;'))).toBe(true);
});
