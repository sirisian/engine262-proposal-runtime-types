import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * complex.md: "The transcendental `Math` functions are overloaded for `complex`
 * and return a `complex`, so the same name does the real thing on a real and the
 * complex thing on a complex - `Math.sqrt` of a `complex` reaches the
 * negative-argument answer a real `Math.sqrt` cannot."
 *
 * `abs`, `conj`, and `arg` already had complex branches; `sqrt`, `exp`, `log`,
 * `sin`, `cos`, and `tan` answered NaN, since ToNumber of a complex is NaN.
 *
 * Where the mathematics is transcendental these assert a TOLERANCE: `-1 +
 * 1.22e-16i` is the right answer to Euler's identity in floating point, and an
 * exact string comparison would read as a failure.
 */

const parts = (expr: string) => `const z = ${expr}; String(z.real) + "," + String(z.imaginary);`;

test('complex Math: the document\'s own examples', () => {
  expect(evaluated(parts('Math.sqrt(complex(-1, 0))'))).toBe('0,1');
  expect(evaluated('const z = Math.exp(complex(0, Math.PI));'
    + ' String(z.real) + "," + String(Math.abs(z.imaginary) < 1e-15);')).toBe('-1,true');
  // the real overload is unchanged and still cannot reach it
  expect(evaluated('String(Math.sqrt(-1));')).toBe('NaN');
});

test('complex Math: sqrt is EXACT on the axes', () => {
  // the half-angle form rather than `exp(log(z)/2)`, which gives 6.12e-17 for
  // the real part of sqrt(-1) where the direct formula gives exactly zero
  expect(evaluated('const z = Math.sqrt(complex(-1, 0)); String(z.real === 0 && z.imaginary === 1);')).toBe('true');
  expect(evaluated(parts('Math.sqrt(complex(-4, 0))'))).toBe('0,2');
  expect(evaluated(parts('Math.sqrt(complex(4, 0))'))).toBe('2,0');
  expect(evaluated(parts('Math.sqrt(complex(0, 2))'))).toBe('1,1');
  // and it is a square root: squaring returns the argument
  expect(evaluated('const s = Math.sqrt(complex(3, 4)); const b = s * s;'
    + ' String(Math.abs(b.real - 3) < 1e-12) + "," + String(Math.abs(b.imaginary - 4) < 1e-12);')).toBe('true,true');
});

test('complex Math: exp and log invert one another', () => {
  expect(evaluated(parts('Math.exp(complex(1, 0))'))).toBe('2.718281828459045,0');
  expect(evaluated('const z = Math.log(Math.exp(complex(0.5, 0.25)));'
    + ' String(Math.abs(z.real - 0.5) < 1e-12) + "," + String(Math.abs(z.imaginary - 0.25) < 1e-12);'))
    .toBe('true,true');
  // the principal logarithm: log|z| with the argument as the imaginary part, so
  // log(-1) is ip - the answer a real log cannot give
  expect(evaluated('const z = Math.log(complex(-1, 0));'
    + ' String(z.real) + "," + String(z.imaginary === Math.PI);')).toBe('0,true');
});

test('complex Math: the trigonometric identities hold', () => {
  expect(evaluated(parts('Math.sin(complex(0, 0))'))).toBe('0,0');
  expect(evaluated('const z = complex(0.3, 0.4); const s = Math.sin(z); const c = Math.cos(z);'
    + ' const t = s * s + c * c;'
    + ' String(Math.abs(t.real - 1) < 1e-12) + "," + String(Math.abs(t.imaginary) < 1e-12);')).toBe('true,true');
  // tan is formed through sin and cos, so the quotient agrees by construction
  expect(evaluated('const z = complex(0.3, 0.4); const t = Math.tan(z); const q = Math.sin(z) / Math.cos(z);'
    + ' String(Math.abs(t.real - q.real) < 1e-12);')).toBe('true');
});

test('complex Math: the real overloads are untouched', () => {
  expect(evaluated('String(Math.sqrt(4)) + "," + String(Math.exp(0)) + "," + String(Math.sin(0));')).toBe('2,1,0');
  expect(evaluated('String(Math.log(1)) + "," + String(Math.cos(0)) + "," + String(Math.tan(0));')).toBe('0,1,0');
  // and the three that already worked still do
  expect(evaluated('String(Math.abs(complex(3, 4))) + "," + String(Math.conj(complex(3, 4)));')).toBe('5,3-4i');
});
