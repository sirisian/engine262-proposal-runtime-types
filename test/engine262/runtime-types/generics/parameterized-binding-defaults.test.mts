import { test, expect } from 'vitest';
import { evaluated, expectThrown, observeScript } from '../harness.mts';

/**
 * A binding whose type mentions a type parameter holds the default the application gives
 * (#sec-defaultvalueof).
 *
 * "A ~parameter~ is exempt: nothing is known about what an application will bind." The exemption
 * was of the bare parameter only, so `let s: [2].<T>;` in a generic function was refused for
 * having no default whatever `T` was, where a field of that type in a generic class waited for
 * the application.
 */

const P = 'value class P { x: uint32; } ';

test('the default is the application\'s', () => {
  expect(evaluated(`${P}function f<T: type>() { let s: [2].<T>; return s; } String(f.<P>()[1].x) + f.<uint8>().join('');`)).toBe('000');
  expect(evaluated('function f<T: type>() { let s: [T, T]; return s; } f.<uint8>().join("");')).toBe('00');
  expect(evaluated('function f<N: uint32>() { let s: [N].<uint8>; return s.length; } String(f.<3>());')).toBe('3');
  expect(evaluated(`${P}function f<T: type>() { let s: shared [2].<T>; return s.length; } String(f.<P>());`)).toBe('2');
  expect(evaluated(`${P}function f<T: type>(x: T) { let s: [2].<T>; s[0] = x; return s; } String(f(new P())[0].x);`)).toBe('0');
});

test('an application whose type has no default is refused when it runs', () => {
  expectThrown('function f<T: type>() { let s: [2].<T>; return s; } f.<symbol>();', '"[2].<symbol>" has no default value');
});

test('a type with no parameter in it is judged where it is written, as before', () => {
  expect(observeScript('function f() { let s: symbol; }')).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-missing-default' } });
});
