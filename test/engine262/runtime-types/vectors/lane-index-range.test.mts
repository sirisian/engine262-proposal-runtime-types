import { expect, test } from 'vitest';
import { expectThrown, ok } from '../harness.mts';

/**
 * Spec: #sec-vector-types with #sec-type-errors. A vector's lane count is part
 * of its type - `float32x4` is `vector.<float32, 4>` - and the index of
 * `a.lane.<9>()` is a written type ARGUMENT, so both sides are syntax and the
 * run time's "lane 9 is out of range for a vector of 4 lanes" is decidable.
 *
 * It is the array bound rule one type over: `a[9]` on a `[4].<uint8>` has been
 * an Early Error all along.
 */

const dead = (source: string) => `function __never() { ${source} }`;
const A = 'let a: float32x4 = float32x4(1, 2, 3, 4); ';

test('a lane index outside the vector is refused', () => {
  expectThrown(dead(`${A}let q = a.lane.<9>();`), 'out of range');
  // The count is the bound, so the last index is one less.
  expectThrown(dead(`${A}let q = a.lane.<4>();`), 'out of range');
  // A typed PARAMETER carries the same type, and is judged the same way.
  expectThrown(dead('function f(v: float32x4) { let q = v.lane.<9>(); }'), 'out of range');
  // An integer vector is the same rule.
  expectThrown(dead('let b: int32x4 = int32x4(1, 2, 3, 4); let q = b.lane.<7>();'), 'out of range');
});

test('what the rule does not reach', () => {
  expect(ok(dead(`${A}let q = a.lane.<0>();`))).toBe(true);
  expect(ok(dead(`${A}let q = a.lane.<3>();`))).toBe(true);

  // A receiver with no static type is not judged: `const a = float32x4(...)`
  // has none, the const inference covering `new` alone. The run time answers.
  expect(ok(dead('const c = float32x4(1, 2, 3, 4); let q = c.lane.<9>();'))).toBe(true);

  // An ordinary call, and a member read that is not `lane`.
  expect(ok(dead(`${A}let q = a.x;`))).toBe(true);
  expect(ok(dead('function f(v: float32x4) { return v; } let q = f(a);'.replace('let q', `${A}let q`)))).toBe(true);
});
