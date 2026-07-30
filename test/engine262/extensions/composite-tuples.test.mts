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

test('a tuple composite ITERATES BY KIND, with no Symbol.iterator', () => {
  // `sec-composite-getiterator`. Its prototype is deliberately *null*, so there
  // is nowhere for a `Symbol.iterator` to live - which is one of the three
  // prototype objections the design answers by DISSOLVING rather than
  // accepting: "iteration stops being a prototype lookup".
  expect(evaluated('let out = []; for (const x of Composite([1, 2, 3])) { out.push(x); } out.join(",");')).toBe('1,2,3');
  expect(evaluated('[...Composite([1, 2])].join(",");')).toBe('1,2');
  expect(evaluated('const [a, b] = Composite([7, 8]); String(a) + "/" + String(b);')).toBe('7/8');
  // The manual protocol spelling the design gives.
  expect(evaluated('String(Array.prototype.slice.call(Composite([1, 2])).join(","));')).toBe('1,2');
  // A RECORD composite is not iterable, which is what says the recognition is
  // by KIND and not by being a composite.
  expect(outcome('for (const x of Composite({ x: 1 })) { x; }')).toBe('TypeError');
  // And an ordinary array is untouched.
  expect(evaluated('[...[1, 2]].join(",");')).toBe('1,2');
  // A mutating method still throws on the frozen receiver, as for any frozen
  // array - that half needed no code.
  expect(outcome('Composite([1, 2]).push(3);')).toBe('TypeError');
});
