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
    `${C}Math.max(c, 1);`, `${C}c == 3;`,
  ]) {
    expectThrownKind(src, 'TypeError');
  }
});

test('isNaN answers for a complex: true exactly when either component is NaN', () => {
  // The one Number context with a real answer - a complex can be NaN through
  // either part - so, as for a decimal, it answers rather than refusing. This is
  // Python's cmath.isnan and Julia's isnan.
  expect(evaluated(`${C}String(isNaN(c));`)).toBe('false');
  expect(evaluated(`${Z}String(isNaN(z));`)).toBe('false');
  expect(evaluated('String(isNaN(complex(NaN, 0)));')).toBe('true');
  expect(evaluated('String(isNaN(complex(0, NaN)));')).toBe('true');
  expect(evaluated('String(isNaN(complex(NaN, NaN)));')).toBe('true');
  // Infinite is not NaN.
  expect(evaluated('String(isNaN(complex(Infinity, 0)));')).toBe('false');
  // Number.isNaN, which the predicates table pairs with isNaN, answers alike.
  expect(evaluated('String(Number.isNaN(complex(NaN, 0)));')).toBe('true');
  expect(evaluated(`${C}String(Number.isNaN(c));`)).toBe('false');
});

test('isFinite answers for a complex: true exactly when both components are finite', () => {
  // The other classification predicate with a real answer, as Python's
  // cmath.isfinite and Julia's isfinite give it. Number.isFinite, which the
  // predicates table pairs with isFinite, answers alike.
  for (const surface of ['isFinite', 'Number.isFinite']) {
    expect(evaluated(`${C}String(${surface}(c));`)).toBe('true');
    expect(evaluated(`${Z}String(${surface}(z));`)).toBe('true');
    expect(evaluated(`String(${surface}(complex(Infinity, 0)));`)).toBe('false');
    expect(evaluated(`String(${surface}(complex(0, -Infinity)));`)).toBe('false');
    // NaN is not finite, so a NaN component makes the complex not finite.
    expect(evaluated(`String(${surface}(complex(NaN, 0)));`)).toBe('false');
  }
});

test('the integer predicates answer as they do today', () => {
  // They ask about a place on the real line, which a complex does not have; a
  // complex is not a Number, so these non-coercing statics say false.
  expect(evaluated(`${C}String(Number.isInteger(c));`)).toBe('false');
  expect(evaluated(`${C}String(Number.isSafeInteger(c));`)).toBe('false');
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
