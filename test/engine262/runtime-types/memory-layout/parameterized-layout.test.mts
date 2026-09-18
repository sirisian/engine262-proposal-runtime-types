import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrown } from '../harness.mts';

/**
 * proposal-runtime-types #sec-memory-layout: a parameterization refines which
 * values its base admits and does not change how one is represented, so it has
 * its base's layout - the reading the enum row already takes.
 *
 * These pin the brand case, which is the one the design documents reach for:
 * `brand(uint32, 'NodeIndex')` reported no layout, so a field of a branded type
 * took its containing class's layout away and `[1024].<Node>` would not
 * allocate - while typeprogramming.md recommends the pattern and states that
 * "an array of them has the base's footprint".
 */
const BRAND = `function brand(T: type, tag: string): type {
  return Reflect.makeType({ kind: 'parameterized', base: T, metadata: { brand: tag } });
}
`;

test('a branded scalar reports its base layout', () => {
  expect(evaluated(`${BRAND}type N = brand(uint32, 'N');
    [N.hasLayout, N.byteLength, N.bitLength, N.alignment].join(',');`)).toBe('true,4,32,4');
});

test('a branded field costs what the base costs', () => {
  expect(evaluated(`${BRAND}type N = brand(uint32, 'N');
    class Branded { key: uint32 = 0; l: N = N(0); r: N = N(0); }
    class Plain { key: uint32 = 0; l: uint32 = 0; r: uint32 = 0; }
    Branded.byteLength + '/' + Plain.byteLength;`)).toBe('12/12');
});

test('a branded field is placed at the base type alignment', () => {
  expect(evaluated(`${BRAND}type N = brand(uint32, 'N');
    class C { a: uint8 = 0; b: N = N(0); }
    [Reflect.getReflection.<Reflect.ClassFieldLayout, C>('b').offset,
     C.byteLength, C.alignment].join(',');`)).toBe('4,8,4');
});

test('an array of a branded scalar has the base footprint', () => {
  expect(evaluated(`${BRAND}type N = brand(uint32, 'N');
    const a: [4].<N> = [N(0), N(1), N(2), N(3)];
    String(a.byteLength);`)).toBe('16');
});

test('a parameterization of a base with no layout still has none', () => {
  expect(evaluated(`${BRAND}String(brand(string, 'S').hasLayout);`)).toBe('false');
});

test('a brand over a value type class carries that class layout', () => {
  expect(evaluated(`${BRAND}class C { x: uint8 = 1; }
    type BC = brand(C, 'w');
    BC.hasLayout + '/' + BC.byteLength;`)).toBe('true/1');
});

test('a layout does not make a brand assignable to its base peers', () => {
  // The representation is shared; the types are not. Guards the distinctness
  // the pattern exists for against a fix aimed only at the size. The refusal is
  // static, so it is asserted as one rather than caught in the script.
  expectStaticTypeError(`${BRAND}type N = brand(uint32, 'N');
    type E = brand(uint32, 'E');
    function f(x: N): uint32 { return x; }
    f(E(1));`);
});

test('a raw base value is still refused where a brand is wanted', () => {
  // A literal reaches the construction boundary rather than the static
  // judgement, so this is refused at the call rather than before the program
  // runs - unlike the cross-brand case above, which is decided statically.
  expectThrown(`${BRAND}type N = brand(uint32, 'N');
    function f(x: N): uint32 { return x; }
    f(7);`, 'is not assignable to');
});
