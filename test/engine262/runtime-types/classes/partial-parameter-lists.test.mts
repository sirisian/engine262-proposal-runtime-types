import { expect, test } from 'vitest';
import { evaluated, expectEarlyError, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-type-parameters-static-semantics-early-errors and
 * #sec-partial-classes.
 *
 * "It is a Syntax Error if this |TypeParameters| is a parameter list and it
 * belongs to a `partial` class or interface declaration". A partial re-opens a
 * declaration that already has its parameters, and its members see them (plan
 * OQ1 A). Before this, a list on a partial was accepted, and the partial's
 * members were silently not added.
 *
 * The run time does not yet carry a partial's members to a specialization of a
 * generic class, or to an application of a generic interface, so a partial of
 * either is reported as unsupported rather than accepted and dropped.
 */

test('a parameter list on a partial declaration is a Syntax Error', () => {
  expectEarlyError('class P { x: uint8 = 0; } partial class P<T: type> { m(): uint8 { return 1; } }', 'SyntaxError');
  expectEarlyError('interface I { a: uint8; } partial interface I<T: type> { b: uint8; }', 'SyntaxError');
});

test('a partial of a generic declaration is reported as unsupported', () => {
  expectStaticTypeError('class Box<T: type> { v: T; constructor(v: T) { this.v = v; } } partial class Box { get2(): T { return this.v; } }');
  expectStaticTypeError('interface I<T: type> { a: T; } partial interface I { b: T; }');
});

test('partials of non-generic declarations are unchanged', () => {
  expect(evaluated('class Q { x: uint8 = 0; } partial class Q { m(): uint8 { return 5; } } String(new Q().m());')).toBe('5');
  expect(evaluated('interface P { n: int32; } partial interface P { u: string; } let p: P = { n: 1, u: "s" }; p.u;')).toBe('s');
});
