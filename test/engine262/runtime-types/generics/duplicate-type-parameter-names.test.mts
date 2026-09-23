import { expect, test } from 'vitest';
import { evaluated, expectEarlyError } from '../harness.mts';

/**
 * Spec: #sec-type-parameters-static-semantics-early-errors.
 *
 * "It is a Syntax Error if the BoundNames of two |TypeParameter|s of the list
 * are the same." Nothing compared them: the later parameter silently shadowed
 * the earlier one on a function, a class, an alias and an interface alike.
 */

test('a name declared twice in one list is a Syntax Error', () => {
  expectEarlyError('function f<T: type, T: type>(x: T) {}', 'SyntaxError');
  expectEarlyError('class C<T: type, T: type> {}', 'SyntaxError');
  expectEarlyError('type P<T: type, T: type> = [T, T];', 'SyntaxError');
  expectEarlyError('interface I<T: type, T: type> { a: T; }', 'SyntaxError');
  expectEarlyError('function g<N: uint8, N: type>() {}', 'SyntaxError');
});

test('distinct names, and a nested list reusing an outer name, are unchanged', () => {
  expect(evaluated('function f<T: type, U: type>(x: T, y: U): U { return y; } String(f(1, 2));')).toBe('2');
  expect(evaluated('class C<T: type> { m<T: type>(x: T): T { return x; } } String(new C.<uint8>().m(3));')).toBe('3');
});
