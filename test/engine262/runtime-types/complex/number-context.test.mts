import { expect, test } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

/**
 * A complex has no Number value. complex.md: "Conversions are explicit in both
 * directions: `complex(x)` lifts a real onto the plane, `.real` projects back
 * off it" - and "silently comparing real parts or magnitudes would hide the
 * mistake".
 *
 * With no `valueOf` of its own, a complex reached ToNumber through its text:
 * "3+0i" parsed as NaN. So every Number context gave a silent wrong answer -
 * `Number(c)` NaN, `isNaN(c)` true for the complex number 3, `c == 3` false.
 * It now refuses, as a `decimal` and a `rational` do.
 */

const C = 'const c = (3 := complex64); ';
const Z = 'const z = (1 := complex64) + (2i := complex64); ';

test('every Number context refuses a complex', () => {
  for (const src of [
    `${C}Number(c);`, `${Z}Number(z);`, `${C}Math.floor(c);`,
    `${C}Math.max(c, 1);`, `${C}c == 3;`, `${C}isNaN(c);`,
  ]) {
    expectThrownKind(src, 'TypeError');
  }
});

test('the explicit way to a real is `.real`', () => {
  expect(evaluated(`${Z}String(z.real);`)).toBe('1');
  expect(evaluated(`${Z}String(z.imaginary);`)).toBe('2');
});

test('text is unchanged - it never reaches valueOf', () => {
  expect(evaluated(`${C}\`\${c}\`;`)).toBe('3+0i');
  expect(evaluated(`${C}String(c);`)).toBe('3+0i');
});

test('complex operators and overloads are unchanged', () => {
  // Unary `+` returns the complex; unary `-` negates both components.
  expect(evaluated(`${C}String(Reflect.typeOf(+c));`)).toBe('complex.<float32>');
  expect(evaluated(`${C}const n = -c; String(n.real) + ' ' + String(Object.is(n.imaginary, -0));`)).toBe('-3 true');
  const sqrt = 'const s = Math.sqrt(complex(-1)); String(s.real) + " " + String(s.imaginary);';
  expect(evaluated(sqrt)).toBe('0 1');
  expect(evaluated(`${C}String(c * 2);`)).toBe('6+0i');
  // Truthiness is ToBoolean, not ToNumber.
  expect(evaluated("complex(NaN, 0) ? 'truthy' : 'falsy';")).toBe('truthy');
});

test('valueOf rejects a receiver that is not a complex', () => {
  expectThrownKind('Object.getPrototypeOf(complex(1)).valueOf.call(5);', 'TypeError');
});

test('decimal and rational are unchanged', () => {
  expectThrownKind("Number(decimal64('1.5'));", 'TypeError');
  expect(evaluated("String(isNaN(decimal64('1.5')));")).toBe('false');
  expectThrownKind('Number(rational(1, 2));', 'TypeError');
});
