import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind } from '../harness.mts';

/**
 * An explicit conversion of an array or tuple converts each element explicitly.
 *
 * #sec-explicit-conversion: a conversion "truncates, wraps, or rounds as the target
 * requires, and does not fail merely because information is lost", and a literal
 * operand "is converted from its exact value". Typed creation converts an array
 * member "element-wise: each element is converted to the type of the position it
 * occupies". So `[x] := [].<T>` holds what `[x := T]` holds - the value, or the
 * error. The explicit conversion had no array case and fell through to the
 * implicit one, so each element was converted implicitly: 108 of the 330 pairs
 * below refused what the scalar converts, 10 refused with the wrong error, and a
 * literal element was read as a double before any conversion saw it.
 */

const TYPES = ['int8', 'uint8', 'int16', 'uint16', 'int32', 'uint32', 'int64', 'uint64', 'bigint',
  'float16', 'float32', 'float64', 'number', 'float128', 'decimal32', 'decimal64', 'decimal128',
  'rational', 'complex64', 'complex128', 'boolean', 'string'];
const VALUES: readonly [string, string][] = [['300', '300'], ['-1', '-1'], ['1.5', '1.5'], ['0.1', '0.1'],
  ['NaN', 'NaN'], ['Infinity', 'Infinity'], ['-Infinity', '-Infinity'], ['-0', '-0'], ['1e300', '1e300'],
  ['2n**53n+1n', '2n ** 53n + 1n'], ["'5'", "'5'"], ['true', 'true'], ['undefined', 'undefined'], ['null', 'null'],
  ['{}', '({})']];
// The Parsing clause: "a string is deliberately not a conversion source for a
// numeric type ... enforced at the explicit conversion too". Today's SCALAR
// conversion converts a string at `number` and at the decimal types - an open
// question of its own - so an element does not follow it there; it is refused.
const STRING_REFUSED = new Set(['number', 'decimal32', 'decimal64', 'decimal128']);

const outcome = (declaration: string, expression: string) => evaluated(
  `${declaration} let r; try { r = String(${expression}); } catch (e) { r = 'throws ' + e.constructor.name; } r;`,
);

test('element for element, an explicit array conversion holds what the scalar conversion holds', () => {
  for (const type of TYPES) {
    for (const [name, source] of VALUES) {
      const declaration = `let x = ${source};`;
      const array = outcome(declaration, `([x] := [].<${type}>)[0]`);
      if (name === "'5'" && STRING_REFUSED.has(type)) {
        expect(array, `${name} at ${type}`).toBe('throws TypeError');
      } else {
        expect(array, `${name} at ${type}`).toBe(outcome(declaration, `x := ${type}`));
      }
    }
  }
});

test('a literal element converts from its exact value, as a literal operand does', () => {
  const cases: [string, string][] = [
    ['([0.1] := [].<rational>)[0]', '1/10'],
    ['([-0.1] := [].<rational>)[0]', '-1/10'],
    ['([0.1] := [].<decimal128>)[0]', '0.1'],
    ['([0.1] := [].<float128>)[0]', '0.1'],
    ['([16777217.0000000001] := [].<float32>)[0]', '16777218'],
    ['([9007199254740993] := [].<uint64>)[0]', '9007199254740993'],
    ['([200 + 100] := [].<uint8>)[0]', '44'],
    ['([300] := [].<uint8>)[0]', '44'],
    ['(([0.1]) := [].<rational>)[0]', '1/10'],
    ['([[0.1]] := [].<[].<rational>>)[0][0]', '1/10'],
  ];
  for (const [expression, want] of cases) expect(evaluated(`String(${expression});`), expression).toBe(want);
  // A value is not a literal: it converts from what it holds.
  expect(evaluated('let x = 0.1; String(([x] := [].<rational>)[0]);')).toBe('3602879701896397/36028797018963968');
});

test('structure: values are converted, shape is not information', () => {
  expect(evaluated('String([300, 1] := [2].<uint8>);')).toBe('44,1');
  expect(evaluated('String(([[300]] := [].<[].<uint8>>)[0][0]);')).toBe('44');
  expect(evaluated('String([300, 300] := [uint8, ...[].<uint8>]);')).toBe('44,44');
  expect(evaluated('String([300, 0.1] := [uint8, decimal128]);')).toBe('44,0.1');
  // Shape keeps refusing: a fixed extent's length, a tuple's arity, a hole.
  expectThrownKind('[1, 2, 3] := [2].<uint8>;', 'TypeError');
  expectThrownKind('[1, 2] := [uint8];', 'TypeError');
  expectThrownKind('[] := [uint8];', 'TypeError');
  expectThrownKind('[, 1] := [].<uint8>;', 'TypeError');
});

test('a typed array converted to another element type is a copy; to its own, itself', () => {
  expect(evaluated('let a: [].<uint8> = [1, 2]; let b = a := [].<uint16>; String([b, Reflect.typeOf(b), b === a]);'))
    .toBe('1,2,[].<uint.<16>>,false');
  expect(evaluated('let a: [].<uint16> = [300, 5]; let b = a := [].<uint8>; String([b, a, b === a]);')).toBe('44,5,300,5,false');
  expect(evaluated('let a: [].<uint8> = [1]; String((a := [].<uint8>) === a);')).toBe('true');
  // The copy carries its element type, so a later store is still checked.
  expectThrownKind("let b = [300] := [].<uint8>; b[0] = 'x';", 'TypeError');
});

test('a typed creation converts an array member as its object member', () => {
  expect(evaluated('interface A { v: [].<uint8>, w: uint8 } let c = Composite.<A>({ v: [300], w: 300 }); String([c.v[0], c.w]);'))
    .toBe('44,44');
});

test('the implicit conversion is unchanged', () => {
  expectStaticTypeError('let a: [].<uint8> = [300];');
  expectThrownKind('let v = [300]; let a: [].<uint8> = v;', 'RangeError');
  expectStaticTypeError('let a: [].<uint16> = [1]; let b: [].<uint8> = a;');
  expect(evaluated('let n = 0.1; let f: float32 = n; String(f);')).toBe('0.10000000149011612');
  expectThrownKind('let n = 1e300; let f: float32 = n;', 'RangeError');
});
