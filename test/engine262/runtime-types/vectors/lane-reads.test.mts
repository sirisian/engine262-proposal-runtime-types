import { expect, test } from 'vitest';
import { expectThrown, ok, evaluated } from '../harness.mts';

/**
 * Spec: #sec-vector-types. `a.x` reads a lane and answers the LANE TYPE, and a
 * multi-component accessor - `a.xy`, a swizzle - answers a vector of that many
 * lanes.
 *
 * The member arm had no vector case, so every one of these was ~any~: `let s:
 * string = a.x` was accepted on a `float32x4` though the run time answers a
 * `float32`. The accessor set is `componentAccessorIndices`, the run time's own
 * decision about which names are accessors and which lanes they name, so the
 * two cannot disagree about a swizzle's width or about what is a member.
 */

const dead = (source: string) => `function __never() { ${source} }`;
const A = 'let a: float32x4 = float32x4(1, 2, 3, 4); ';

test('a lane read answers the lane type', () => {
  expectThrown(dead(`${A}let s: string = a.x;`), 'not assignable');
  expectThrown(dead(`${A}let s: string = a.w;`), 'not assignable');
  expect(ok(dead(`${A}let f: float32 = a.x;`))).toBe(true);
  // An integer vector answers its own lane type.
  expectThrown(dead('let b: int32x4 = int32x4(1, 2, 3, 4); let s: string = b.y;'), 'not assignable');
});

test('a swizzle answers a vector of that many lanes', () => {
  expectThrown(dead(`${A}let s: string = a.xy;`), 'vector.<float32, 2>');
  // Not the lane type either - two lanes is a vector, not a scalar.
  expectThrown(dead(`${A}let f: float32 = a.xy;`), 'vector.<float32, 2>');
  expect(ok(dead(`${A}let v: float32x4 = a.xyzw;`))).toBe(true);
  // ...and the checker agrees with the run time about the width.
  expect(evaluated(`${A}String(Reflect.typeOf(a.xy));`)).toBe('vector.<float32, 2>');
  expect(evaluated(`${A}String(Reflect.typeOf(a.x));`)).toBe('float32');
});

test('the METHODS are left to the run time', () => {
  // `all`, `any` and `lane` are called - `m.any()` - so a type for the read
  // itself would have to be a function type. Typing them as what they ANSWER
  // made the call look like calling a `boolean`.
  expect(ok('const a = float32x4(1, 2, 3, 4); const b = float32x4(4, 3, 2, 1);'
    + ' const m: boolean32x4 = a < b; String(m.any());')).toBe(true);
  expect(ok(`${A}let q = a.lane.<0>();`)).toBe(true);
});

test('a lane WRITE takes the type the read answers', () => {
  // `a.x = s` for a string was the run time's "a string is not a conversion
  // source for float32", though `a.x` answers `float32` here. One accessor,
  // one type, whichever side of the assignment it is on.
  expectThrown(dead(`${A}let s: string = "x"; a.x = s;`), 'not assignable');
  expectThrown(dead('let b: int32x4 = int32x4(int32(1), int32(2), int32(3), int32(4));'
    + ' let s: string = "x"; b.y = s;'), 'not assignable');
  expect(ok(dead(`${A}let f: float32 = float32(9); a.x = f;`))).toBe(true);

  // A SWIZZLE target is compared too, and every TYPE mismatch into one is
  // decided: a vector of the wrong width, and a vector of the wrong lane type.
  expectThrown(dead(`${A}a.xy = a;`), 'not assignable');
  expectThrown(dead(`${A}a.xyz = a.xy;`), 'not assignable');
  expectThrown(dead(`${A}let b: int32x4 = int32x4(int32(1), int32(2), int32(3), int32(4));`
    + ' a.xy = b.xy;'), 'not assignable');
  expect(ok(dead(`${A}a.xy = a.zw;`))).toBe(true);

  // Assigning a SCALAR to a swizzle is refused by the run time and is NOT a type
  // error: a scalar is assignable to a vector - `a = f` and a `float32x4`
  // parameter given a `float32` are both ordinary, the value being splatted
  // across the lanes - so the type says yes and a rule about swizzle ASSIGNMENT
  // says no. An earlier note here called this a limit of the checker; it is not.
  expect(ok(dead(`${A}let f: float32 = float32(9); a.xy = f;`))).toBe(true);
  expect(ok(dead(`${A}let f: float32 = float32(9); a = f;`))).toBe(true);
});
