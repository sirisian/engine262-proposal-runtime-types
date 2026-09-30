import { expect, test } from 'vitest';
import { evaluated, expectEarlyError, expectThrown } from '../harness.mts';

/**
 * A CAST'S NAME IS A TYPE, AND FOLLOWS THE HEADER'S RULE. #sec-primitive-operator-blocks: "A cast's name is a
 * type, read as every type is, so where the primitive declares parameters the name supplies them before its
 * metadata: `complex.<T>` names a complex whose component is `T`". The block HEADER `primitive complex<const T:
 * P>` is refused with the spelling to use, and a cast NAME that puts a metadata capture in a component
 * position must be refused too: it would name a complex whose parts are a metadata record, which no value is,
 * so it would never apply, and the program would fail later at an annotation - "`1+2i` is not assignable to
 * `complex.<float64>.<{ phase: 1 }>`" - with no mention of the cast. The first `.<...>` of a primitive that
 * declares parameters is its component list. A bare name there bound by the block's METADATA list is the
 * mistake; a component capture there is not, and a primitive that declares no parameters has no component
 * list.
 */

const P = 'type P = { phase: int32 }; meta P { default = { phase: 0 }; '
  + 'subtype(a: P, b: P): boolean { return a.phase == b.phase; } } ';
const U = 'type U = { unit: int32 }; meta U { default = { unit: 0 }; '
  + 'subtype(a: U, b: U): boolean { return a.unit == b.unit; } } ';

test('a metadata capture in a cast name\'s component position is refused', () => {
  // THE REFUSAL. Reported at the cast, as an early error, whether or not anything
  // ever uses it.
  expectEarlyError(`${P} primitive complex<_><const T: P> { operator complex.<T>() { return this; } }`, 'SyntaxError');
  expectEarlyError(`${U} primitive rational<_><const T: U> { operator rational.<T>() { return this; } }`, 'SyntaxError');
});

test('the error names the spelling to use', () => {
  expectThrown(`${P} primitive complex<_><const T: P> { operator complex.<T>() { return this; } }`,
    '`T` stands in a component of `complex` in this cast\'s name, which is not a metadata position');
  expectThrown(`${P} primitive complex<_><const T: P> { operator complex.<T>() { return this; } }`,
    'primitive complex<const E><const T: P> { operator complex.<E>.<T>() }');
});

test('the documented form is accepted, and the cast applies at every width', () => {
  const block = `${P} primitive complex<const E><const T: P> { operator complex.<E>.<T>() { return this; } } `;
  expect(evaluated(`${block} const c: complex128 = 1 + 2i; const p: complex.<float64>.<{ phase: 1 }> = c; String(p);`))
    .toBe('1+2i');
  expect(evaluated(`${block} const c: complex64 = 1 + 2i; const p: complex.<float32>.<{ phase: 1 }> = c; String(p);`))
    .toBe('1+2i');
});

test('a fixed component is not a capture', () => {
  expect(evaluated(`${P} primitive complex { operator complex.<float64>.<P>() { return this; } } 'declared';`))
    .toBe('declared');
});

test('a primitive with no components has no component list', () => {
  // THE NO-COMPONENTS GUARD. `float32` declares no parameters, so its first `.<...>`
  // is metadata, and a metadata capture there is right.
  expect(evaluated(`${P} primitive float32<const D: P> { operator float32.<D>() { return this; } } 'declared';`))
    .toBe('declared');
});

test('a component capture in a component position is not refused', () => {
  // THE METADATA-ONLY GUARD. `E` is bound by the COMPONENT list, so `complex.<E>` is a
  // complex whose parts are `E` - exactly what is meant.
  expect(evaluated('primitive complex<const E> { operator complex.<E>() { return this; } } \'declared\';'))
    .toBe('declared');
});
