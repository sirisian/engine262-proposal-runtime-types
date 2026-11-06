import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * #sec-arithmetic-never-promotes: the literal rule reaches the original
 * `Object.is`, so a numeric literal argument takes the other argument's
 * numeric type, as a literal operand of `===` does, statically where that
 * type is known and at run time where only the value is. Values of two
 * numeric types stay distinct; a binding adopts nothing; a literal the type
 * cannot represent is the same value as nothing of it.
 */
const rows: readonly [string, string, string][] = [
  ['uint8', '5', 'uint8'], ['int8', '-5', 'int8'], ['uint16', '5', 'uint16'], ['int32', '5', 'int32'], ['uint32', '5', 'uint32'],
  ['int64', '5', 'int64'], ['float32', '0.5', 'float32'], ['float16', '0.5', 'float16'], ['float64', '0.5', 'float64'], ['decimal128', '1.0', 'decimal128'],
];

test('Object.is agrees with === for a literal beside every numeric type', () => {
  for (const [type, literal, constructor] of rows) {
    const setup = `let v: ${type} = ${literal};`;
    expect(evaluated(`${setup} String(v === ${literal});`), type).toBe('true');
    expect(evaluated(`${setup} String(Object.is(v, ${literal}));`), type).toBe('true');
    expect(evaluated(`${setup} String(Object.is(${literal}, v));`), type).toBe('true');
    expect(evaluated(`${setup} String(Object.is(v, ${constructor}(${literal})));`), type).toBe('true');
  }
});

test('a float literal rounds into its peer, and both zeros stay distinct', () => {
  expect(evaluated('let f: float32 = 0.1; String(Object.is(f, 0.1));')).toBe('true');
  expect(evaluated('let z: float64 = -0; String(Object.is(z, -0)) + " " + String(Object.is(z, 0));')).toBe('true false');
  expect(evaluated('let n: float32 = 0 / 0; String(Object.is(n, n)) + " " + String(n === n);')).toBe('true false');
});

test('a decimal literal adopts its exact value, its exponent included', () => {
  expect(evaluated('let d: decimal128 = 1.0; String(Object.is(d, 1.0)) + " " + String(Object.is(d, 1.00)) + " " + String(d === 1.00);')).toBe('true false true');
});

test('a binding adopts nothing, and values of two numeric types stay distinct', () => {
  expect(evaluated('let v: uint8 = 5; function g(p, q) { return Object.is(p, q); } String(g(v, 5));')).toBe('false');
  expect(evaluated('let v: uint8 = 5; let w: uint16 = 5; function g(p, q) { return Object.is(p, q); } String(g(v, w));')).toBe('false');
  expect(evaluated('let v: uint8 = 5; const o = (i) => Object.is(i, 5); String(o(v));')).toBe('true');
});

test('collections are unchanged: an argument to a collection method has no peer operand', () => {
  // An array literal searches at its element type (#sec-array-literal-static-type),
  // while an untyped Set's argument has no peer.
  expect(evaluated('let v: uint8 = 5; String([v].includes(5)) + " " + String(new Set([v]).has(5));')).toBe('true false');
  expect(evaluated('let a: [].<uint8> = [5]; String(a.includes(5));')).toBe('true');
});

test('tests and clauses agree with the run time', () => {
  expect(evaluated('let v: uint8 = 5; let r = 0; if (Object.is(v, 5)) { r = 1; } String(r);')).toBe('1');
  expectStaticTypeError('let v: uint8 = 5; if (Object.is(v, 300)) { }');
  expectStaticTypeError('let v: uint8 = 5; let y: int8 = 5; if (Object.is(v, y)) { }');
  expect(evaluated('function f(x: uint8) where Object.is(x, 5) { return x; } String(f(5));')).toBe('5');
  expect(evaluated('function h(y: float64) where Object.is(y, -0) { return 1 / y; } let z: float64 = 0; String(h(-z));')).toBe('-Infinity');
});
