import { expect, test } from 'vitest';
import { evaluated, expectEarlyError } from '../harness.mts';

/**
 * Spec: #sec-type-parameters-static-semantics-early-errors.
 *
 * "It is a Syntax Error if this TypeParameters is not a parameter list and
 * it belongs to ... the declaration of a variable, a constructor, an
 * accessor, or an enumeration." A constructor reached the method branch,
 * which may declare a case, so `constructor<uint8>()` parsed and was
 * silently a method case of a member that has no family to specialize. Round
 * 4 (Q4) then refused a parameter list on a constructor as well: a class's
 * type parameters are the ones a construction binds.
 */

test('a specialization or mixed list on a class constructor is refused', () => {
  expectEarlyError('class C { constructor<uint8>() {} }', 'SyntaxError');
  expectEarlyError('class C { constructor<uint8, N: uint32>() {} }', 'SyntaxError');
  expectEarlyError('const C = class { constructor<>() {} };', 'SyntaxError');
});

test('a parameter list on a constructor is refused too (round 4, Q4), and an object literal\'s constructor method is unchanged', () => {
  expectEarlyError('class C { constructor<T: type>(x: T) {} }', 'SyntaxError');
  expect(evaluated('const o = { constructor<uint8>() { return 1; } }; "ok";')).toBe('ok');
});
