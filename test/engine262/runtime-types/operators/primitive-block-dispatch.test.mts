import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * #sec-primitive-operator-blocks: "at most one definition with a body may
 * match ... where no definition with a body matches, the primitive operation
 * runs". A block declares operators on its primitive for each parameterization
 * its header admits, so dispatch must reach:
 *
 * - a primitive represented as an object, `complex` or `rational`, which was
 *   never looked up, so its blocks parsed and did nothing;
 * - a block over a FAMILY, `primitive uint<const W>`, which was keyed `uint`
 *   while a `uint8` receiver looked up `uint8` only, so it did nothing either;
 *
 * and a component capture of the header is bound from each receiver's own
 * argument, as a metadata capture is bound from its metadata.
 */

test('a block over an object-represented primitive is consulted before its arithmetic', () => {
  expect(evaluated(`primitive complex { operator *(rhs: string): string { return 'custom'; } }
    const c: complex128 = 1 + 2i; String(c * 'x');`)).toBe('custom');
  // An operand the definition does not admit reaches the primitive operation.
  expect(evaluated(`primitive complex { operator *(rhs: string): string { return 'custom'; } }
    const a: complex128 = 1 + 2i; const b: complex128 = 3 + 4i; String(a * b);`)).toBe('-5+10i');
});

test('a block over a family reaches each member, with its component bound', () => {
  expect(evaluated(`primitive uint<const W> { operator *(rhs: string): string { return 'w' + String(W); } }
    String((3 := uint8) * 'x') + ' ' + String((3 := uint16) * 'x');`)).toBe('w8 w16');
  // A position the record leaves out holds the default: rational.<64> is `rational`.
  expect(evaluated(`primitive rational<const W> { operator *(rhs: string): string { return 'r' + String(W); } }
    const r: rational = 1 / 3; String(r * 'x');`)).toBe('r64');
  // A type component: complex128's is float64, complex64's float32.
  expect(evaluated(`primitive complex<const E> { operator +(rhs: complex.<E>): string { return 'same:' + String(E); } }
    const a: complex128 = 1 + 2i; const c: complex128 = 3 + 4i;
    const b: complex64 = 1 + 2i; const d: complex64 = 5 + 6i;
    String(a + c) + ' ' + String(b + d);`)).toBe('same:float64 same:float32');
});

test("plan section 6.1: the exact primitive's block is more specific than the family's, in either order", () => {
  const exact = `primitive uint8 { operator *(rhs: string): string { return 'exact'; } }`;
  const family = `primitive uint<const W> { operator *(rhs: string): string { return 'family'; } }`;
  const run = `String((3 := uint8) * 'x') + ' ' + String((3 := uint16) * 'x');`;
  expect(evaluated(`${exact} ${family} ${run}`)).toBe('exact family');
  expect(evaluated(`${family} ${exact} ${run}`)).toBe('exact family');
});
