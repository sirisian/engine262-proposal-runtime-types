import { expect, test } from 'vitest';
import { evaluated, expectThrown, observeScript } from '../harness.mts';

/**
 * #sec-structure-of-arrays: "_T_ must be a value type class or a primitive";
 * #sec-threading-shared-modifier admits a value type with a layout. Each
 * refusal now names the type and the reason. A structure of arrays of a class
 * held by reference was accepted before running, every field of it having a
 * layout, and refused when it ran with "this element type" cannot be stored as
 * columns, the placeholder quoted as the type. A `shared` operand with no
 * layout was refused as "not a value type", which a `string` and a value class
 * holding one are (#sec-value-types).
 */

const early = { bodyEntered: false, errorClass: 'StaticTypeError' };

test('a structure of arrays of a class held by reference is refused before running', () => {
  expect(observeScript('class P { x: uint8 = 0; } function f() { return new SoA.<P>(2); }')).toMatchObject({ ...early, diagnostic: { rule: 'rt-layout' } });
  expectThrown('class P { x: uint8 = 0; } new SoA.<P>(2);', '"P" cannot be split into columns: it is not a value class, and a structure of arrays holds a value class or a primitive');
  expect(evaluated('value class P { x: uint8 = 0; } String(new SoA.<P>(2).length);')).toBe('2');
});

test('a field of no layout is named with its type', () => {
  expectThrown('value class P { name: string = ""; age: uint8 = 0; } new SoA.<P>(2);', '"P" cannot be split into columns: its field "name" has the type "string", which has no layout');
});

test('shared refuses a type that is not a value type, and a value type with no layout, each by its reason', () => {
  expect(observeScript('class R { r: uint8 = 0; } let a: shared R;')).toMatchObject({ ...early, diagnostic: { rule: 'rt-type-required' } });
  expectThrown('class R { r: uint8 = 0; } let a: shared R;', '"shared R" is not a valid type: "R" is not a value type, and an object is reached from every thread already');
  expectThrown('let a: shared string;', '"shared string" is not a valid type: "string" has no layout, and shared storage holds a value of a fixed size');
  // A value class whose declaration shows a field of no layout is refused
  // before running; it was left to the run time, with the class's layout.
  expect(observeScript('value class P { name: string = ""; age: uint8 = 0; } let a: shared P;')).toMatchObject({ ...early, diagnostic: { rule: 'rt-type-required' } });
  expectThrown('value class P { name: string = ""; age: uint8 = 0; } let a: shared [2].<P>;', '"shared [2].<P>" is not a valid type: "[2].<P>" has no layout');
  expect(evaluated('value class P { age: uint8 = 0; } let a: shared P; String(a.age);')).toBe('0');
});

test('an application is refused when it runs, by the same reasons', () => {
  const C = 'class C<T: type> { one: shared T; } ';
  expectThrown(`${C}new C.<string>();`, '"shared string" is not a valid type: "string" has no layout');
  expectThrown(`class R { r: uint8 = 0; } ${C}new C.<R>();`, '"shared R" is not a valid type: "R" is not a value type');
});
