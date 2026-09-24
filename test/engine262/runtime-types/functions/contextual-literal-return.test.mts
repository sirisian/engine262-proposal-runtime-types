import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * A FUNCTION LITERAL AT A FUNCTION-TYPED POSITION TAKES ITS TARGET'S RETURN TYPE.
 *
 * #sec-contextual-types: a function or arrow expression "in a position whose
 * contextual type is a function type takes that type's signature for every position
 * it leaves unannotated: a parameter's type, the return type ... The signature so
 * taken is the Static Type of the expression".
 *
 * An arrow and a function expression took their parameter types but not their return
 * type, which was inferred from the body with the context only as a hint. Two bugs
 * followed:
 *
 * - `const fn: () => uint8 = () => 3` returned an unconverted `number` at run time -
 *   nothing was published for the run time to enforce - where a contextually typed
 *   METHOD returned a `uint8`.
 * - `const a: () => Promise.<uint8> = async () => 3` was REFUSED: the inferred
 *   signature was `() => Promise.<uint8, any>`, not assignable to the target. The
 *   annotated form was accepted.
 *
 * Three places now take the contextual return type: the body is checked against it,
 * the static signature is it, and it is published for the run time.
 */

const TY = (x: string) => `String(Reflect.typeOf(${x}))`;

test('a contextually typed arrow returns its target\'s type', () => {
  expect(evaluated(`const fn: () => uint8 = () => 3; ${TY('fn()')};`)).toBe('uint.<8>');
  expect(evaluated(`const fn: () => uint8 = () => { return 3; }; ${TY('fn()')};`)).toBe('uint.<8>');
});

test('so does a contextually typed function expression', () => {
  expect(evaluated(`const fn: () => uint8 = function () { return 3; }; ${TY('fn()')};`)).toBe('uint.<8>');
});

test('and an arrow passed where a function type is expected', () => {
  expect(evaluated(`function call(f: () => uint8) { return f(); } ${TY('call(() => 3)')};`)).toBe('uint.<8>');
});

test('the body is checked against the return type it takes', () => {
  // As a method's is: the return is refused, not the whole function afterwards.
  expectStaticTypeError('const fn: () => uint8 = () => { return 300; };');
});

test('a contextually typed async arrow is accepted', () => {
  // Refused before, as `() => Promise.<uint8, any>`.
  expect(evaluated('const a: () => Promise.<uint8> = async () => 3; String(typeof a());')).toBe('object');
});

test('it now matches a contextually typed method', () => {
  expect(evaluated(`type O = { m(): uint8 }; const o: O = { m() { return 3; } }; ${TY('o.m()')};`)).toBe('uint.<8>');
});

// ---- what must not change -------------------------------------------------

test('an arrow with no contextual type still infers its return type', () => {
  expect(evaluated(`const g = () => 3; ${TY('g()')};`)).toBe('number');
});

test('a void context still discards, and a generic callback still infers', () => {
  expect(evaluated('const h: () => void = () => 3; String(h());')).toBe('3');
  expect(evaluated('String([1, 2].map((x) => x + 1).join(\',\'));')).toBe('2,3');
});

test('a wider target return type is taken as written', () => {
  expect(evaluated('const w: () => number | string = () => 3; String(w());')).toBe('3');
});

test('an enumerator initializer converts its value rather than taking a return type', () => {
  // The exception. `Zero = (index, name) => index * 100` PRODUCES each member's value,
  // which the enum converts to `float32`; `index * 100` is a `number`. Taking `float32`
  // as the literal's return type, and checking the body against it, refused this -
  // caught by the enum suite when this fix first landed without the exception.
  expect(evaluated('enum Count: float32 { Zero = (index, name) => index * 100, One, Two } String(Count.Two);'))
    .toBe('200');
});

// ---- the payoff for return inference --------------------------------------

test('return inference now reaches a contextually typed arrow', () => {
  // The loop binding reads its return type from the checker's stack; the arrow had
  // none there, so `i` stayed a `number`. It now has one.
  expect(evaluated('let t = \'\'; const fn: () => uint8 = () => { for (const i of 0..<3) { '
    + 't = String(Reflect.typeOf(i)); return i; } return 0; }; fn(); t;')).toBe('uint.<8>');
  expectStaticTypeError('const fn: () => uint8 = () => { for (const i of 0..<300) { return i; } return 0; };');
});
