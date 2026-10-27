import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * Spec: #sec-narrowing-flow, #sec-narrowfrom.
 *
 * A class binding that no assignment in the program rebinds holds its
 * constructor, so a test of it is constant; it has no Static Type of its own
 * in test position, so it reached the scalar judgment undecided.
 */

test('a class binding in a test is a constant condition', () => {
  expect(observeScript('let z: uint8 = 1; class C {} if (C) {}')).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-constant-condition', phase: 'static' } });
});

test('a reassigned class binding, and a typed arrow bound by const, keep their judgments', () => {
  expect(evaluated('let z: uint8 = 1; class C {} C = null; if (C) {} "ok";')).toBe('ok');
  expect(observeScript('let z: uint8 = 1; const f = (): uint8 => 1; if (f) {}')).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-constant-condition' } });
});
