import { expect, test } from 'vitest';
import { evaluated, expectEarlyError, expectThrown, observeScript } from '../harness.mts';

/**
 * Round 4's lower-value diagnostics (#sec-type-diagnostic-identity): each
 * failure reports the rule responsible for it, with a message that names what
 * went wrong.
 */

test('a call that leaves a required parameter without an argument is a call-argument failure', () => {
  expect(observeScript('function f(a: uint8, b: uint8) { return a; } f(1);')).toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-call-argument' } });
  expectThrown('function f(a: uint8, b: uint8) { return a; } f(1);', 'the call supplies no argument for "b"');
  expect(evaluated('function f(a: uint8, b: uint8) { return a; } String(f(1, 2));')).toBe('1');
});

test('an enum called with no value to convert is refused before the body', () => {
  expect(observeScript('enum E { A } E();')).toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-call-argument' } });
  expect(evaluated('enum E { A, B } String(E(1) === E.B);')).toBe('true');
});

test('a type parameter without a default after one with a default is named', () => {
  expectEarlyError('function f<A: type = uint8, B: type>() {}', 'SyntaxError');
  expectThrown('function f<A: type = uint8, B: type>() {}', 'a type parameter without a default cannot follow one with a default');
  expect(evaluated('function f<A: type, B: type = uint8>() { return 1; } String(f.<string>());')).toBe('1');
});

test('a primitive using resource is said to have no Symbol.dispose method', () => {
  expectThrown('let z: uint8 = 1; { using r: uint8 = 5; }', 'is a primitive, which has no Symbol.dispose method');
});
