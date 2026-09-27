import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * #sec-primitive-metadata for the primitives represented as OBJECTS: `complex`
 * and `rational` carried their component but not their metadata, so a value
 * that crossed into `complex.<float64>.<{ phase: 1 }>` reported
 * `complex.<float64>`, and a block's metadata capture had nothing to bind
 * from a complex receiver. A crossing now makes a fresh value carrying the
 * parameterization, as a typed number is rewrapped, and leaves the value it
 * was given as it was.
 */

const P = `type P = { phase: int32 };
meta P { default = { phase: 0 }; subtype(a: P, b: P): boolean { return a.phase === b.phase; } }
primitive complex<const E><const T: P> { operator complex.<E>.<T>() { return this; } }
type Ph = complex.<float64>.<{ phase: 1 }>;
`;
const U = `type U = { unit: int32 };
meta U { default = { unit: 0 }; subtype(a: U, b: U): boolean { return true; } }
primitive rational<const W><const T: U> { operator rational.<W>.<T>() { return this; } }
`;

test('a crossing carries the parameterization on a fresh value', () => {
  expect(evaluated(`${P}const c: complex128 = 1 + 2i; const p: Ph = c;
    String(Reflect.typeOf(p)) + ' / ' + String(Reflect.typeOf(c));`)).toBe('complex128.<{ phase: 1 }> / complex128');
  expect(evaluated(`${U}const r: rational64 = 1 / 3; const p: rational.<64>.<{ unit: 1 }> = r;
    String(Reflect.typeOf(p)) + ' / ' + String(Reflect.typeOf(r));`)).toBe('rational64.<{ unit: 1 }> / rational64');
});

test('membership reads the carried metadata', () => {
  expect(evaluated(`${P}const a: Ph = (1 + 2i := complex128); String(a is Ph) + ' ' + String((1 + 2i) is Ph);`)).toBe('true false');
});

test('a block binds its metadata capture from a complex receiver, and stamps the result', () => {
  expect(evaluated(`${P}primitive complex<const E><const T: P> {
      operator +(rhs: complex.<E>.<T>): complex.<E>.<T> { return this + rhs; }
    }
    const a: Ph = (1 + 2i := complex128); const b: Ph = (3 + 4i := complex128);
    const s = a + b; String(s) + ' ' + String(Reflect.typeOf(s));`)).toBe('4+6i complex128.<{ phase: 1 }>');
});

test('a block over a two-list parameterization applies to a receiver carrying its metadata', () => {
  // The operand `complex.<E>.<T>` is a PARAMETERIZED type - the two-list form -
  // which the component matcher does not take apart, so it is a forward
  // computation: the type with the captures substituted. That computation always
  // threw, and the throw was read as a refusal, so the block never applied, even
  // to the receiver it names. The test above passed without it: its `+` computes
  // what the built-in does, and `const s` took its type from the checker. This
  // block's `+` SUBTRACTS, so its applying shows in the value.
  const block = `${P}primitive complex<const E><const T: P> {
      operator +(rhs: complex.<E>.<T>): complex.<E>.<T> { return this - rhs; }
    } `;
  const ab = 'const x: complex128 = complex128(5, 5); const y: complex128 = complex128(1, 1); const a: Ph = x; const b: Ph = y; ';
  expect(evaluated(`${block}${ab}String(a + b);`)).toBe('4+4i');
  // Its result carries the receiver's metadata directly, from the block's return type.
  expect(evaluated(`${block}${ab}String(Reflect.typeOf(a + b));`)).toBe('complex128.<{ phase: 1 }>');
  // THE METADATA GUARD. `T` is bound from the receiver, so an operand of other
  // metadata is not admitted, and the two do not mix.
  expectThrown(`${block}const x: complex128 = complex128(5, 5); const a: Ph = x;
    type Ph2 = complex.<float64>.<{ phase: 2 }>; const z: complex128 = complex128(1, 1); const c: Ph2 = z; a + c;`, 'do not mix');
});

test('a block with a metadata capture does not match a receiver that carries none', () => {
  // #sec-primitive-operator-blocks: "If _subject_ carries no metadata of _M_,
  // return ~no-match~". The checker skipped such a block; the run time applied
  // it, with the component capture `E` bound and the metadata capture `T` not,
  // and resolving its signature threw "T is not defined" - so `complex128 +
  // complex128` failed wherever this block was declared. Unmatched, the
  // built-in operator applies: the block's `+` SUBTRACTS, so its applying would
  // show as -2-2i rather than 4+6i, and the result carries no metadata.
  const block = `${P}primitive complex<const E><const T: P> {
      operator +(rhs: complex.<E>.<T>): complex.<E>.<T> { return this - rhs; }
    } `;
  expect(evaluated(`${block}const x: complex128 = complex128(1, 2); const y: complex128 = complex128(3, 4);
    String(x + y) + ' ' + String(Reflect.typeOf(x + y));`)).toBe('4+6i complex128');
});

test('a block with only component captures still matches a receiver without metadata', () => {
  // THE OVER-BROAD GUARD. Only a METADATA capture needs metadata to bind; a block
  // whose captures are all components - `W` of `uint<const W>` - binds them from
  // the receiver's own arguments, and applies to a plain value.
  expect(evaluated("primitive uint<const W> { operator *(rhs: string): string { return `uint${W}`; } } (3 := uint16) * 'x';"))
    .toBe('uint16');
});

test('a value of a family represented as an object is not a type', () => {
  // Its carried [[TypeRecord]] made `isTypeObject` take it for one, while the
  // same annotation over a `uint8` value was refused.
  expectThrown('const r: rational64 = 1 / 3; let v: r = 2;', '"r" is not a type');
  expectThrown('const d: decimal128 = 1.5; let v: d = 2;', '"d" is not a type');
});
