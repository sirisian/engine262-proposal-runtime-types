import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// -- A deferred application as a binding's type (#sec-deferred-applications) --
//
// "an application over an unbound parameter is carried as an ~application~ Type
// Record and evaluated at specialization". The closed alias form always worked;
// these are the forms inside a generic body, where the parameter is bound by the
// call rather than by the declaration.

const pairOf = 'function pairOf(T) { return Reflect.makeType({ kind: "tuple", '
  + 'elements: [{ type: T, rest: false }, { type: T, rest: false }] }); } ';

test('a deferred application annotates a binding and specializes per call', () => {
  // The default is the specialization's, which is what distinguishes a real
  // deferral from a lucky one: the same generic gives typed zeros at uint8 and
  // empty strings at string.
  expect(evaluated(`${pairOf} function make<T>(x: T) { let p: pairOf(T); return p; }`
    + ' const r = make((1 := uint8)); `${r.length}:${r[0]}:${r[0] is uint8}`;')).toBe('2:0:true');
  expect(evaluated(`${pairOf} function make<T>(x: T) { let p: pairOf(T); return p; }`
    + ' const r = make("a"); `${r.length}:${JSON.stringify(r[0])}`;')).toBe('2:""');
});

test('a deferred application enforces its annotation', () => {
  expect(evaluated(`${pairOf} function init<T>(x: T) { let p: pairOf(T) = [x, x]; return p; }`
    + ' String(init((7 := uint8)));')).toBe('7,7');
  expectThrown(`${pairOf} function bad<T>(x: T) { let p: pairOf(T) = ["wrong", "wrong"]; return p; }`
    + ' bad((1 := uint8));');
  // And the store into it is checked, with either initializer shape - the
  // already-conforming one is what the tuple stamp above is for.
  expectThrown(`${pairOf} function f<T>(x: T) { let p: pairOf(T) = [1, 2]; p[0] = "bad"; return p; }`
    + ' f((1 := uint8));');
  expectThrown(`${pairOf} function f<T>(x: T) { let p: pairOf(T) = [x, x]; p[0] = "bad"; return p; }`
    + ' f((1 := uint8));');
});

test('a deferred application works in every position a parameter is bound', () => {
  expect(evaluated(`${pairOf} function nested<T>(x: T) { let p: pairOf(pairOf(T)); return p; }`
    + ' const r = nested((1 := uint8)); `${r.length}:${r[0].length}`;')).toBe('2:2');
  expect(evaluated(`${pairOf} function param<T>(x: T, p: pairOf(T)) { return p.length; }`
    + ' String(param((1 := uint8), [1, 2]));')).toBe('2');
  expect(evaluated(`${pairOf} function ret<T>(x: T): pairOf(T) { return [x, x]; }`
    + ' String(ret((3 := uint8)));')).toBe('3,3');
});

test('a class field is the one position it does not reach', () => {
  // KNOWN-DIVERGENCES.md: a specialized generic's FIELD type is not
  // substituted, so the application is still over an unbound parameter when the
  // field is defined. The error names `[T, T]`, which is the parameter showing
  // through, and it is reported by the rule that refuses a declaration whose
  // type has no default - that rule is doing its job on a type the
  // substitution gap left behind.
  expectThrown(`${pairOf} class Box<T> { p: pairOf(T); } new Box.<uint8>();`);
});
