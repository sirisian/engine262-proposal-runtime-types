import { expect, test } from 'vitest';
import { evaluated, expectEarlyError, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-type-references and #sec-bindtypearguments.
 *
 * Two named type arguments with the same name are a Syntax Error: the list
 * alone shows it. A name that is not a parameter, and a positional argument
 * after a named one, are TYPE errors (Q3 of the round-2 review): deciding them
 * needs the applied declaration - a positional argument after a variadic
 * parameter's name joins its run - and a Syntax Error cannot wait for an
 * imported or computed declaration to resolve. Either way each is reported
 * before an arity check can name the wrong mistake: `h.<V: uint8>` against a
 * two-parameter `h` once read "the call takes 1 type arguments".
 */

const H = 'function h<T: type, U: type>(x: T, y: U): U { return y; } ';

test('each malformed named list is refused early, naming its mistake', () => {
  expectEarlyError(`${H} h.<T: uint8, T: uint16>(1, 2);`, 'SyntaxError');
  expectEarlyError(`${H} h.<V: uint8>(1, 2);`, 'StaticTypeError');
  expectEarlyError(`${H} h.<T: uint8, uint16>(1, 2);`, 'StaticTypeError');
  expectEarlyError('function h<T: type>(x: T) {} h.<U: uint8>(1);', 'StaticTypeError');
});

test('a well-formed named list binds, and one that leaves a parameter out is still a type error', () => {
  expect(evaluated(`${H} String(h.<U: uint16, T: uint8>(1, 2));`)).toBe('2');
  expectStaticTypeError(`${H} h.<T: uint8>(1, 2);`);
  expectStaticTypeError('function h<T: type>(x: T) {} h.<uint8, uint16>(1);');
});
