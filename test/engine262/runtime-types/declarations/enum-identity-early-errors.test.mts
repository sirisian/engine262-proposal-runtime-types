import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, expectThrownKind } from '../harness.mts';

/**
 * Spec: #sec-enums.
 *
 * "It is a type error if an enumerator's value is already an enumerator of
 * another enum of the same agent." Where the underlying type's values carry
 * identity, two enumerators of different enums whose initializers read the
 * same immutable binding hold the same value, which the source shows; that
 * case is refused before the program runs. Sharing only the run time can see
 * is still refused when the second declaration evaluates.
 */

const K = 'class K { constructor(v) { this.v = v; } } ';

test('two enums reading one immutable binding are refused', () => {
  expectStaticTypeError(`${K}const k = new K(1); enum A: K { X = k } enum B: K { Y = k }`);
  expectStaticTypeError('const s = Symbol("s"); enum A: symbol { X = s } enum B: symbol { Y = s }');
  expectStaticTypeError('function g(x) { return x; } enum A: (x: any) => any { X = g } enum B: (x: any) => any { Y = g }');
});

test('sharing within one enum, content values and distinct constructions are unchanged', () => {
  expect(evaluated(`${K}const k = new K(1); enum A: K { X = k, Y = k } String(A.X === A.Y);`)).toBe('true');
  expect(evaluated('const z = 0; enum A { X = z } enum B { Y = z } String(A.X) + String(B.Y);')).toBe('00');
  expect(evaluated(`${K}enum A: K { X = new K(1) } enum B: K { Y = new K(1) } "ok";`)).toBe('ok');
});

test('sharing through a second binding is still the run time\'s', () => {
  expectThrownKind(`${K}const k = new K(1); const j = k; enum A: K { X = k } enum B: K { Y = j }`, 'TypeError');
});
