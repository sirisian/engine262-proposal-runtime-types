import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * #sec-optional-values: an optional's discriminant is a declared byte EXCEPT
 * where the payload's own declaration excludes a pattern, in which case that
 * pattern IS the discriminant and the optional is the width of the payload.
 *
 * This is the DECLARED half of the niche and deliberately not the inferred one.
 * Rust infers from whatever values a payload happens not to use; that would make
 * `byteLength` depend on a hole in some nested field's range, so adding an enum
 * member could resize a structure declared elsewhere. A `bounds` range is
 * written in the type and checked at every boundary the value crosses, which is
 * what makes the excluded pattern genuinely unreachable. Rust guarantees the
 * same half through `NonZeroU32` rather than through inference.
 *
 * The convergence with an index pool is the point: a pool reserving a sentinel
 * has always been declaring a niche, and writing it as `bounds` tells the
 * compiler what the constant told only the reader.
 */
const NumberBounds = `
type NumberBounds = { bounds?: Range, nonZero?: boolean };
function excludesZero(c) { return c.nonZero === true || (c.bounds !== undefined && !c.bounds.contains(0)); }
meta NumberBounds {
  default = {};
  subtype(sub, sup) {
    if (excludesZero(sup) && !excludesZero(sub)) return false;
    if (sup.bounds === undefined) return true;
    if (sub.bounds === undefined) return false;
    return sup.bounds.contains(sub.bounds);
  }
  validate(value, constraint) {
    if (constraint.nonZero === true && Number(value) === 0) return false;
    return constraint.bounds === undefined || constraint.bounds.contains(Number(value));
  }
}
`;

test('a sentinel-excluding bound costs the optional nothing', () => {
  expect(evaluated(`${NumberBounds}
    type NodeIndex = uint32.<{ bounds: 0..=4294967294 }>;
    class Node { left: NodeIndex | null = null; right: NodeIndex | null = null; }
    class Plain { left: uint32 | null = null; }
    Node.byteLength + '/' + Plain.byteLength;`)).toBe('8/8');
});

test('an open bound declares a niche wherever it sits', () => {
  expect(evaluated(`${NumberBounds}
    type Pos = uint32.<{ bounds: 0<.. }>;
    class N { a: Pos | null = null; }
    String(N.byteLength);`)).toBe('4');
});

test('a range excluding nothing declares no niche', () => {
  // A full range, and a closed range reaching both of the base's own extremes.
  expect(evaluated(`${NumberBounds}
    type Any32 = uint32.<{ bounds: .. }>;
    class N { a: Any32 | null = null; }
    String(N.byteLength);`)).toBe('8');
  expect(evaluated(`${NumberBounds}
    type Full = uint8.<{ bounds: 0..=255 }>;
    class N { a: Full | null = null; }
    String(N.byteLength);`)).toBe('2');
});

test('a float base declares no niche', () => {
  // No next representable value to reason about without stepping into rounding,
  // and the pool index the niche exists for is an integer.
  expect(evaluated(`${NumberBounds}
    type F = float32.<{ bounds: 0..=1 }>;
    class N { a: F | null = null; }
    String(N.byteLength);`)).toBe('8');
});

test('a pool of niched optionals allocates, reads null, and is plain data', () => {
  expect(evaluated(`${NumberBounds}
    type NodeIndex = uint32.<{ bounds: 0..=4294967294 }>;
    class Node { left: NodeIndex | null = null; right: NodeIndex | null = null; }
    const nodes: [1024].<Node>;
    nodes.byteLength + '/' + String(nodes[0].left) + '/' + Node.isPlainData;`)).toBe('8192/null/true');
});

test('a scalar optional is inline whether or not it is niched', () => {
  // `uint8 | null` and `uint32 | null` had no layout at all while `A | null`
  // had one; the payload is now whichever member is not the nullish one.
  expect(evaluated(`class B { a: uint8 | null = null; }
    class C { a: uint32 | null = null; }
    B.byteLength + '/' + C.byteLength;`)).toBe('2/8');
});

test('the class and reference cases are untouched', () => {
  expect(evaluated(`class A { x: uint8 = 1; } class B { a: A | null = null; }
    reference class R { x: uint8 = 1; } class H { r: R | null = null; }
    B.byteLength + '/' + H.byteLength;`)).toBe('2/8');
});
