import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * #sec-enums: "an enumerator's initializer stands in a position whose
 * contextual type is the underlying type". Over a function type, a function
 * literal initializer is the enumerator's value and takes the position's
 * signature, its literal returns included; only a function of two parameters
 * is the sequential form, which produces each member's value and has it
 * converted. Classifying every function literal as a producer published
 * `x => 0` as returning the literal 0, and the evaluated enumerator refused
 * itself.
 */

const F = 'type F = (float32) => float32; ';

test('a function literal over a function type takes the signature, literal returns included', () => {
  expect(evaluated(`${F}enum C: F { Zero = x => 0 } String(Number(C.Zero(5)));`)).toBe('0');
  expect(evaluated(`${F}enum C: F { Zero = (x: float32) => 0 } typeof C.Zero;`)).toBe('function');
  expect(evaluated(`${F}function h() { enum C: F { Zero = x => 0 } return typeof C.Zero; } h();`)).toBe('function');
  expectThrown(`${F}enum C: F { Zero = x => 'a' }`, 'is not assignable to "float32"');
});

test('the sequential form still produces values', () => {
  expect(evaluated('enum Count: float32 { Zero = (index, name) => index * 100, One, Two } String(Count.Two);')).toBe('200');
  expect(evaluated("enum S: string { A = (i, n) => n.toLowerCase(), B } S.B;")).toBe('b');
});
