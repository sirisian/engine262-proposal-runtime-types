import { expect, test } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * Spec: #sec-enums.
 *
 * An enumerator is a constant of the program, and the switch and match
 * judgments read its value at compile time, so the enumerator properties of
 * the enum Type Object are non-writable and non-configurable and the object
 * is non-extensible. They were ordinary data properties: `E.A = 5` read back
 * 5 and `E.B = 2` added a member the type does not declare.
 */

test('enumerator properties are constant and the Type Object is non-extensible', () => {
  expect(evaluated('enum E { A } String(Object.isExtensible(E)) + ":" + String(Object.getOwnPropertyDescriptor(E, "A").writable) + ":" + String(Object.getOwnPropertyDescriptor(E, "0").configurable);')).toBe('false:false:false');
  expect(evaluated('enum E { A } E.A = 5; String(E.A);')).toBe('0');
  expect(evaluated('enum E { A } E.B = 2; String(E.B);')).toBe('undefined');
});

test('the enumeration surface is unchanged', () => {
  expect(evaluated('enum E { A, B } String(E.B) + String(E.keys().next().value) + String(E[1]);')).toBe('1A1');
  expect(evaluated('enum E { A, B } String(E(1) === E.B);')).toBe('true');
});
