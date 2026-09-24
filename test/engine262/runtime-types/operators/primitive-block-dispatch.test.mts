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
  // A type component: complex128's is float64, complex64's float32. (An
  // operand of the receiver's own type would redeclare complex addition.)
  expect(evaluated(`primitive complex<const E> { operator *(rhs: string): string { return 'same:' + String(E); } }
    const a: complex128 = 1 + 2i; const b: complex64 = 1 + 2i;
    String(a * 'x') + ' ' + String(b * 'x');`)).toBe('same:float64 same:float32');
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
  expectThrown(`primitive uint<const W> { operator +(rhs: [2].<uint.<W>>): string { return 'a'; } }
    primitive uint<const V> { operator +(rhs: [2].<uint.<V>>): string { return 'b'; } }`, 'with an operand of "[2].<uint.<V>>" is already declared');
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
  // The receiver's own metadata is not one fixed metadata: `float64.<X>` names
  // a capture, `float64.<{ m: 1 }>` none, although the checker resolves an open
  // metadata argument away. (A plain `float64` operand would redeclare addition.)
  const D = 'type D = { m: int32 }; meta D { default = { m: 0 }; subtype(a: D, b: D): boolean { return a.m === b.m; } }';
  expect(evaluated(`${D} primitive float64<const X: D> { operator +(rhs: float64.<X>): float64.<X> { return this + rhs; } }
    primitive float64 { operator +(rhs: float64.<{ m: 1 }>): string { return 'fixed'; } } 'ok';`)).toBe('ok');
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
  // At a receiver carrying { m: 1 } `float64.<X>` is `float64.<{ m: 1 }>`; the
  // fixed one is more specific.
  const D = 'type D = { m: int32 }; meta D { default = { m: 0 }; subtype(a: D, b: D): boolean { return a.m === b.m; } }';
  const own = `primitive float64<const X: D> { operator *(rhs: float64.<X>): string { return 'own'; } }`;
  const fixed = `primitive float64 { operator *(rhs: float64.<{ m: 1 }>): string { return 'fixed'; } }`;
  const run = `String((2 := float64.<{ m: 1 }>) * (3 := float64.<{ m: 1 }>)) + ' ' + String((2 := float64.<{ m: 2 }>) * (3 := float64.<{ m: 2 }>));`;
  expect(evaluated(`${D} ${own} ${fixed} ${run}`)).toBe('fixed own');
  expect(evaluated(`${D} ${fixed} ${own} ${run}`)).toBe('fixed own');
});

test('overlapping operands neither more specific than the other are ambiguous where both admit', () => {
  const blocks = `primitive float64 { operator *(rhs: 'x' | 'y'): string { return 'xy'; } }
    primitive float64 { operator *(rhs: 'y' | 'z'): string { return 'yz'; } }`;
  expect(evaluated(`${blocks} String((2 := float64) * 'x') + ' ' + String((2 := float64) * 'z');`)).toBe('xy yz');
  expectThrown(`${blocks} (2 := float64) * 'y';`, 'operator * is ambiguous for this operand');
});

test('the checker types a block operator across numeric types as the run time dispatches it', () => {
  // The numeric-mixing rule refused `(2 := float64) * (3 := uint8)` even where a
  // block defines `*` for a uint8 operand, which the run time dispatches to.
  // A block operator converts nothing: it is the operation's meaning.
  const block = `primitive float64 { operator *(rhs: uint8): string { return 'u8'; } }`;
  expect(evaluated(`${block} const s: string = (2 := float64) * (3 := uint8); s;`)).toBe('u8');
  // The block's return type is the result type, so a wrong annotation is static.
  expectEarlyError(`${block} const n: float64 = (2 := float64) * (3 := uint8);`, 'StaticTypeError');
  // Where no definition admits the operand, the mixing rule still applies.
  expectThrown(`${block} (2 := float64) * (3 := uint16);`, 'are different numeric types and do not mix');
  expectThrown('(2 := float64) * (3 := uint8);', 'are different numeric types and do not mix');
  // A block declared after its first use counts, as it does at run time.
  expect(evaluated(`const s: string = (2 := float64) * (3 := uint8); ${block} s;`)).toBe('u8');
});

test('the checker chooses among definitions as dispatch does', () => {
  expect(evaluated(`primitive uint8 { operator +(rhs: float64): string { return 'exact'; } }
    primitive uint<const W> { operator +(rhs: float64): string { return 'family'; } }
    const s: string = (3 := uint8) + (2 := float64); s;`)).toBe('exact');
  expectThrown(`primitive float64 { operator *(rhs: 'x' | uint8): string { return 'a'; } }
    primitive float64 { operator *(rhs: uint8 | 'y'): string { return 'b'; } }
    (2 := float64) * (3 := uint8);`, 'is ambiguous for an operand of uint.<8>');
});

test('#sec-operator-declarations: a block may not redeclare an operation its type already defines', () => {
  // "a program cannot redefine uint8 addition" - the block ran instead.
  expectThrown(`primitive uint8 { operator +(rhs: uint8): string { return 'r'; } }`, 'redeclares an operation the type already defines');
  expectThrown(`primitive float64 { operator <(rhs: float64): boolean { return true; } }`, 'redeclares an operation the type already defines');
  // Over a family, an operand of the same family is some member's own pair.
  expectThrown(`primitive uint<const W> { operator +(rhs: uint.<W>): string { return 'r'; } }`, 'redeclares');
  expectThrown(`primitive complex { operator *(rhs: complex): string { return 'r'; } }`, 'redeclares');
  // A parameterization, another type, and another width are not defined by the receiver.
  const D = 'type D = { m: int32 }; meta D { default = { m: 0 }; subtype(a: D, b: D): boolean { return a.m === b.m; } }';
  expect(evaluated(`${D} primitive float64<const X: D> { operator *(rhs: float64.<X>): string { return 'ok'; } } 'ok';`)).toBe('ok');
  expect(evaluated(`primitive uint16 { operator +(rhs: uint8): string { return 'ok'; } } 'ok';`)).toBe('ok');
  expectThrown(`${D} primitive float64<const X: D> { operator *(rhs: float64): string { return 'r'; } }`, 'redeclares');
});

test('a block\'s comparisons are dispatched, as its arithmetic is', () => {
  // The design's tolerance comparisons on a dimensioned float were parsed and
  // never looked up, so the built-in comparison ran.
  const D = 'type D = { m: int32 }; meta D { default = { m: 0 }; subtype(a: D, b: D): boolean { return a.m === b.m; } }';
  const cmp = `primitive float64<const X: D> {
    operator <(rhs: float64.<X>): boolean { return true; }
    operator ==(rhs: float64.<X>): boolean { return true; } }`;
  const a = 'const a = (5 := float64.<{ m: 1 }>); const b = (2 := float64.<{ m: 1 }>);';
  expect(evaluated(`${D} ${cmp} ${a} String(a < b) + ' ' + String(a == b) + ' ' + String(a != b);`)).toBe('true true false');
  // The built-in comparisons are untouched.
  expect(evaluated(`String((5 := float64) < (2 := float64)) + ' ' + String((5 := float64) == (5 := float64));`)).toBe('false true');
  // Across types, the checker and the run time agree.
  expect(evaluated(`primitive float64 { operator <(rhs: uint8): boolean { return true; } } String((5 := float64) < (9 := uint8));`)).toBe('true');
  expectThrown('(5 := float64) < (9 := uint8);', 'are different numeric types and do not mix');
});
