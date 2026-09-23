import { expect, test } from 'vitest';
import { evaluated, expectEarlyError, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-type-references and #sec-bindtypearguments.
 *
 * A named type argument whose name is not a parameter, two with the same name,
 * and a positional argument after a named one are Syntax Errors. They were
 * raised as StaticTypeErrors, and where the number of written arguments
 * differed from the parameter count an arity check reported first and named
 * the wrong mistake: `h.<V: uint8>` against a two-parameter `h` read "the call
 * takes 1 type arguments".
 */

const H = 'function h<T: type, U: type>(x: T, y: U): U { return y; } ';

test('each malformed named list is a Syntax Error naming its mistake', () => {
  expectEarlyError(`${H} h.<V: uint8>(1, 2);`, 'SyntaxError');
  expectEarlyError(`${H} h.<T: uint8, T: uint16>(1, 2);`, 'SyntaxError');
  expectEarlyError(`${H} h.<T: uint8, uint16>(1, 2);`, 'SyntaxError');
  expectEarlyError('function h<T: type>(x: T) {} h.<U: uint8>(1);', 'SyntaxError');
});

test('a well-formed named list binds, and one that leaves a parameter out is still a type error', () => {
  expect(evaluated(`${H} String(h.<U: uint16, T: uint8>(1, 2));`)).toBe('2');
  expectStaticTypeError(`${H} h.<T: uint8>(1, 2);`);
  expectStaticTypeError('function h<T: type>(x: T) {} h.<uint8, uint16>(1);');
});
