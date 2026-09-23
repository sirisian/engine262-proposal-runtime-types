import { expect, test } from 'vitest';
import { evaluated, evaluatedSequence, expectStaticTypeError } from '../harness.mts';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * Spec: #sec-operator-declarations.
 *
 * "A `primitive` block adds to a global operator table; two definitions for one
 * pair of types is a type error at the second declaration."
 *
 * Both halves were missing. The table was keyed by operator text alone, so a
 * second definition REPLACED the first whatever its operand type: a repeated
 * pair silently changed the meaning of every later expression, and two
 * different pairs - the design's `2 * v` for two vector classes - lost the
 * first, whose operand then fell through to the primitive operation and
 * produced NaN.
 */

test('a repeated pair is refused at the second declaration', () => {
  expectStaticTypeError('primitive uint8 { operator+(rhs: string): string { return "a"; } } '
    + 'primitive uint8 { operator+(rhs: string): string { return "b"; } }');
  // Within one block as well as across two.
  expectStaticTypeError('primitive uint8 { operator+(rhs: string): string { return "a"; } '
    + 'operator+(rhs: string): string { return "b"; } }');
});

test('the second declaration may be in a later source text', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const first = realm.evaluateScriptSkipDebugger('primitive uint8 { operator+(rhs: string): string { return "a"; } }');
  expect((first as { Type: string }).Type).toBe('normal');
  const second = realm.evaluateScriptSkipDebugger('primitive uint8 { operator+(rhs: string): string { return "b"; } }');
  expect((second as { Type: string }).Type).toBe('throw');
});

test('different pairs for one operator coexist and each dispatches', () => {
  const classes = 'class A { x: float64 = 1; } class B { x: float64 = 2; } ';
  expect(evaluated(`${classes} primitive number { operator*(rhs: A): string { return "A"; } `
    + 'operator*(rhs: B): string { return "B"; } } String(2 * new A()) + String(2 * new B());')).toBe('AB');
  expect(evaluated(`${classes} primitive number { operator*(rhs: A): string { return "A"; } } `
    + 'primitive number { operator*(rhs: B): string { return "B"; } } String(2 * new A()) + String(2 * new B());')).toBe('AB');
  expect(evaluatedSequence([
    `${classes} primitive number { operator*(rhs: A): string { return "A"; } } "one";`,
    'primitive number { operator*(rhs: B): string { return "B"; } } String(2 * new A()) + String(2 * new B());',
  ])).toBe('AB');
});

test('a different receiver or arity is a different pair', () => {
  expect(evaluated('primitive uint8 { operator+(rhs: string): string { return "a"; } } '
    + 'primitive uint16 { operator+(rhs: string): string { return "b"; } } "ok";')).toBe('ok');
  expect(evaluated('class V { x: float64 = 1; } '
    + 'primitive number { operator-(rhs: V): string { return "b"; } operator-(): number { return 0; } } "ok";')).toBe('ok');
});
