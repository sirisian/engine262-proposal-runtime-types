import { expect, test } from 'vitest';
import { evaluated, expectEarlyError } from '../harness.mts';

/**
 * Spec: #sec-parameterkind.
 *
 * "If _p_ has a |TypeParameterHoles|, then: If _written_ is not the |Type|
 * `type`, throw a *TypeError* exception." The domain is read from how it is
 * written (#sec-parameter-kinds), and the throw happens at the declaration,
 * which #sec-type-errors makes a type error. The parser raised it as a Syntax
 * Error.
 */

test('a higher-kinded parameter whose domain is not written `type` is a type error', () => {
  expectEarlyError('function f<W<_>: uint32>() {}', 'StaticTypeError');
  expectEarlyError('class B<W<_>: uint32> {}', 'StaticTypeError');
  // Through an alias as well, since the kind is read from the spelling.
  expectEarlyError('type Ty = type; function f<W<_>: Ty>() {}', 'StaticTypeError');
});

test('a higher-kinded parameter written `W<_>: type` is unchanged', () => {
  expect(evaluated('class Box<T: type> { v: T; constructor(v: T) { this.v = v; } } '
    + 'function f<W<_>: type>(x: W.<uint8>): W.<uint8> { return x; } String(f.<Box>(new Box.<uint8>(2)).v);')).toBe('2');
});
