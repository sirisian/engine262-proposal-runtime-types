import { expect, test } from 'vitest';
import { evaluated, expectEarlyError, expectThrown } from '../harness.mts';

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

test('#sec-primitive-operator-blocks: two blocks at one level declaring one operand is an early error, captures renamed', () => {
  // Blocks with captures were not checked at all, so the one declared first
  // silently won at run time.
  expectEarlyError(`primitive uint<const W> { operator *(rhs: string): string { return 'a'; } }
    primitive uint<const V> { operator *(rhs: string): string { return 'b'; } }`, 'StaticTypeError');
  // An operand naming a capture is the same operand under another capture name...
  expectThrown(`primitive uint<const W> { operator +(rhs: uint.<W>): string { return 'a'; } }
    primitive uint<const V> { operator +(rhs: uint.<V>): string { return 'b'; } }`, 'with an operand of "uint.<V>" is already declared');
  // ...and a block over every float64 conflicts with a metadata block over every float64.
  const D = 'type D = { m: int32 }; meta D { default = { m: 0 }; subtype(a: D, b: D): boolean { return a.m === b.m; } }';
  expectEarlyError(`${D} primitive float64 { operator *(rhs: string): string { return 'a'; } }
    primitive float64<const X: D> { operator *(rhs: string): string { return 'b'; } }`, 'StaticTypeError');
  expectThrown(`${D} primitive float64<const X: D> { operator +(rhs: float64.<X>): float64.<X> { return this + rhs; } }
    primitive float64<const Y: D> { operator +(rhs: float64.<Y>): float64.<Y> { return this + rhs; } }`, 'with an operand of "float64.<Y>"');
});

test('operands that differ are not duplicates', () => {
  // Overloads by operand type.
  expect(evaluated(`primitive uint<const W> { operator *(rhs: string): string { return 'a'; } }
    primitive uint<const V> { operator *(rhs: number): string { return 'b'; } }
    String((3 := uint16) * 'x') + String((3 := uint16) * 2);`)).toBe('ab');
  // The receiver's own metadata is not any float64: `float64.<X>` names a capture, `float64` none.
  const D = 'type D = { m: int32 }; meta D { default = { m: 0 }; subtype(a: D, b: D): boolean { return a.m === b.m; } }';
  expect(evaluated(`${D} primitive float64<const X: D> { operator +(rhs: float64.<X>): float64.<X> { return this + rhs; } }
    primitive float64 { operator +(rhs: float64): string { return 'plain'; } } 'ok';`)).toBe('ok');
  // Different specificity levels are not a conflict: the exact block wins.
  expect(evaluated(`primitive uint8 { operator *(rhs: string): string { return 'e'; } }
    primitive uint<const W> { operator *(rhs: string): string { return 'f'; } } String((3 := uint8) * 'x');`)).toBe('e');
});

test('within one level, the most specific admitting operand is chosen, in either order', () => {
  // The rule the language's function overloads follow: a general and a
  // special definition may stand together, and the special one wins where
  // both admit. Before, the first declared won.
  const general = `primitive float64 { operator *(rhs: string): string { return 'string'; } }`;
  const special = `primitive float64 { operator *(rhs: 'x'): string { return 'x'; } }`;
  const run = `String((2 := float64) * 'x') + ' ' + String((2 := float64) * 'y');`;
  expect(evaluated(`${general} ${special} ${run}`)).toBe('x string');
  expect(evaluated(`${special} ${general} ${run}`)).toBe('x string');
});

test('equal operands at one receiver are ordered as patterns: fixed before capture', () => {
  // At a uint16 receiver `uint.<W>` is `uint.<16>`; the fixed one is more specific.
  const own = `primitive uint<const W> { operator +(rhs: uint.<W>): string { return 'own'; } }`;
  const sixteen = `primitive uint<const V> { operator +(rhs: uint.<16>): string { return 'sixteen'; } }`;
  const run = `String((3 := uint16) + (4 := uint16)) + ' ' + String((3 := uint8) + (4 := uint8));`;
  expect(evaluated(`${own} ${sixteen} ${run}`)).toBe('sixteen own');
  expect(evaluated(`${sixteen} ${own} ${run}`)).toBe('sixteen own');
});

test('overlapping operands neither more specific than the other are ambiguous where both admit', () => {
  const blocks = `primitive float64 { operator *(rhs: 'x' | 'y'): string { return 'xy'; } }
    primitive float64 { operator *(rhs: 'y' | 'z'): string { return 'yz'; } }`;
  expect(evaluated(`${blocks} String((2 := float64) * 'x') + ' ' + String((2 := float64) * 'z');`)).toBe('xy yz');
  expectThrown(`${blocks} (2 := float64) * 'y';`, 'operator * is ambiguous for this operand');
});
