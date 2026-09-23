import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-higher-kinded-parameters.
 *
 * A higher-kinded parameter "is not a type, so a type position naming one
 * unapplied is a type error"; "an argument that is not a generic declaration
 * at all is a type error naming the argument"; and "an argument that is a
 * generic declaration of the wrong parameter count is a type error naming both
 * counts". The last two were judged where a class is applied in a type
 * position, and not where explicit arguments bind a generic function.
 */

const BOX = 'class Box<T: type> { v: T; constructor(v: T) { this.v = v; } } ';

test('a higher-kinded parameter named unapplied is refused in its declaration', () => {
  expectStaticTypeError('function f<W<_>: type>(x: W) { return x; }');
  expectStaticTypeError('function f<W<_>: type>(x: W.<uint8>): W { return x; }');
});

test('an explicit argument must be a generic declaration of the parameter\'s arity', () => {
  expectStaticTypeError('function g<W<_>: type>(x: W.<uint8>) { return x; } g.<uint8>(1);');
  expectStaticTypeError(`${BOX} function h<W<_, _>: type>(x: W.<uint8, uint8>) { return x; } h.<Box>(1);`);
  expectStaticTypeError(`${BOX} function h<W<_, _>: type>(x: W.<uint8, uint8>) { return x; } const s = h.<Box>;`);
});

test('an applied parameter, a matching argument, and forwarding are admitted', () => {
  expect(evaluated(`${BOX} function f<W<_>: type>(x: W.<uint8>): W.<uint8> { return x; } String(f.<Box>(new Box.<uint8>(1)).v);`)).toBe('1');
  expect(evaluated(`${BOX} function f<W<_>: type>(x: W.<uint8>): W.<uint8> { return x; } `
    + 'function k<V<_>: type>(x: V.<uint8>): V.<uint8> { return f.<V>(x); } String(k.<Box>(new Box.<uint8>(3)).v);')).toBe('3');
});
