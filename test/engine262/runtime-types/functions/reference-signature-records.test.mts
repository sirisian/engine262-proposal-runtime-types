import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

// #sec-signature-records: reference mode survives creation and reflection.
test.each([
  '(ref x: uint8): void => { x++; }',
  'function(ref x: uint8): void { x++; }',
])('a reference literal agrees with its written function type: %s', (literal) => {
  const prefix = `type F = (ref x: uint8) => void; const f: F = ${literal}; `;
  expect(evaluated(prefix + 'let n: uint8 = 1; f(ref n); String(n) + "/" + String(Reflect.typeOf(f) === F);')).toBe('2/true');
  expectStaticTypeError(prefix + 'let n: uint8 = 1; f(n);');
  expectStaticTypeError(prefix + 'let n: uint16 = 1; f(ref n);');
});

test('reference mode is retained in function type rest parameters', () => {
  expect(evaluated('type F = (ref ...xs: [uint8, uint8]) => void; '
    + 'const f: F = (ref a: uint8, ref b: uint8): void => { a = 3; b = 4; }; '
    + 'let a: uint8 = 1; let b: uint8 = 2; f(ref a, ref b); String(a) + "/" + String(b);')).toBe('3/4');
});

test('an ordinary reference-typed annotation does not declare a reference parameter', () => {
  expectStaticTypeError('function f(x: ref uint8) {} let n: uint8 = 1; f(ref n);');
  expect(evaluated('function f(x: uint8) { x++; } let n: uint8 = 1; f(ref n); String(n);')).toBe('1');
});
