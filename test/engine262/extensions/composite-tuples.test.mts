import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * PLAN-composites.md phase five: TUPLE composites.
 *
 * `sec-findorcreatetuplecomposite`. The upstream proposal defers a list form on
 * prototype and cost grounds; this design keeps it because "the objections are
 * prototype problems and cost problems, and a typed runtime dissolves the first
 * and prices the second".
 */

const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);

test('an array source makes a frozen, null-prototyped exotic ARRAY', () => {
  // "`Array.isArray` on the argument decides the kind."
  expect(evaluated('const m = Composite([1, 2, 3]); String(m.length) + "/" + String(m[0]) + "/" + String(m[2]);')).toBe('3/1/3');
  expect(evaluated('String(Array.isArray(Composite([1, 2])));')).toBe('true');
  expect(evaluated('String(Object.isFrozen(Composite([1])));')).toBe('true');
  expect(evaluated('String(Object.getPrototypeOf(Composite([1])));')).toBe('null');
  expect(evaluated('String(Composite.isComposite(Composite([1])));')).toBe('true');
  // `length` is own and NON-ENUMERABLE, which keeps `Object.keys` to the
  // elements - one of the three prototype objections the design answers.
  expect(evaluated('Object.keys(Composite([1, 2])).join(",");')).toBe('0,1');
});

test('tuples intern, and a TUPLE never equals a RECORD', () => {
  expect(evaluated('String(Composite([1, 2]) === Composite([1, 2]));')).toBe('true');
  expect(evaluated('String(Composite([1, 2]) === Composite([2, 1]));')).toBe('false');
  // THE ASSERTION THE DEVIATION EXISTS FOR. "Because `length` doesn't
  // participate in enumerable-key equality, tuple and record composites must
  // not intern into one namespace - `Composite([1])` and `Composite({ 0: 1 })`
  // would otherwise collide while disagreeing about shape. The intern key
  // therefore includes the kind."
  expect(evaluated('String(Composite([1]) === Composite({ 0: 1 }));')).toBe('false');
  // And they are distinguishable, which is what keeps the reflection split
  // crisp: `Reflect.Tuple` reflects one kind and `Reflect.Record` the other.
  expect(evaluated('String(Array.isArray(Composite([1]))) + "/" + String(Array.isArray(Composite({ 0: 1 })));')).toBe('true/false');
});

test('a tuple\'s elements are type-sensitive like a record\'s fields', () => {
  expect(evaluated('String(Composite([uint8(1)]) === Composite([1]));')).toBe('false');
  expect(evaluated('String(Composite([uint8(1)]) === Composite([uint8(1)]));')).toBe('true');
  expect(evaluated('String(Composite([uint8(1)]) === Composite([uint16(1)]));')).toBe('false');
});

test('typed tuple creation converts each position', () => {
  expect(evaluated('type T = [uint8, uint8]; String(Reflect.typeOf(Composite.<T>([1, 2])[0]) === (type uint8));')).toBe('true');
  // The pair that says the type argument did the work: it interns with the
  // explicitly-typed elements and not with the untyped ones.
  expect(evaluated('type T = [uint8, uint8]; String(Composite.<T>([1, 2]) === Composite([uint8(1), uint8(2)]));')).toBe('true');
  expect(evaluated('type T = [uint8, uint8]; String(Composite.<T>([1, 2]) === Composite([1, 2]));')).toBe('false');
  // A required POSITION absent is the tuple's version of a required member
  // absent.
  expect(outcome('type T = [uint8, uint8]; Composite.<T>([1]);')).toBe('TypeError');
});

test('PINNED: iteration and the mutating array methods', () => {
  // `sec-composite-getiterator`: untyped `for..of` and spread should recognize
  // the kind and iterate the elements directly, so no `Symbol.iterator` has to
  // live on an object whose prototype is deliberately null. Not wired yet - the
  // manual spelling the design gives does work, which is what says the elements
  // are where iteration would find them.
  expect(evaluated('String(Array.prototype.slice.call(Composite([1, 2])).join(","));')).toBe('1,2');
  expect(outcome('for (const x of Composite([1, 2])) { x; }')).toBe('TypeError');
  // A mutating method throws on a frozen receiver as it does for any frozen
  // array - that half needs no code.
  expect(outcome('Composite([1, 2]).push(3);')).toBe('TypeError');
});
