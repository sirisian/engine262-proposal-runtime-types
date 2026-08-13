import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// `SameType` was defined by an algorithm with three steps keyed on the LEFT
// operand alone - enum, literal, parameterized - and no mirror for the right.
// That made a relation named for equality asymmetric: `SameType("a", string)`
// answered true where `SameType(string, "a")` answered false, so every caller
// treating it as equality inherited an order dependence.
//
// It is now MUTUAL SUBTYPING, symmetric by construction and inheriting
// reflexivity and transitivity from IsSubtype - a genuine equivalence. Scala's
// `=:=` is the same definition. The refinement behaviour lives in IsSubtype,
// where callers wanting it now ask directly.
//
// These assert the CONSEQUENCES, which is what a program can observe.

test('order does not change what a type means', () => {
  // The property that failed. Every reducible pair, both ways round.
  expect(evaluated('type U = "a" | string; let x: U = "b"; String(x);')).toBe('b');
  expect(evaluated('type U = string | "a"; let x: U = "b"; String(x);')).toBe('b');
  expect(evaluated('type U = 1 | number; let x: U = 5; String(x);')).toBe('5');
  expect(evaluated('type U = number | 1; let x: U = 5; String(x);')).toBe('5');
  expect(evaluated('type U = true | boolean; let x: U = false; String(x);')).toBe('false');
  expect(evaluated('type U = boolean | true; let x: U = false; String(x);')).toBe('false');
});

test('assignability stays reflexive across the type kinds', () => {
  // Mutual subtyping inherits its properties from IsSubtype, so a kind where
  // IsSubtype were not reflexive would silently stop being the same type as
  // itself.
  expect(evaluated('let a: uint8 = 5; let b: uint8 = a; String(Number(b));')).toBe('5');
  expect(evaluated('let a: float64 = 1.5; let b: float64 = a; String(Number(b));')).toBe('1.5');
  expect(evaluated('type O = { a: uint8 }; let x: O = { a: 1 }; let y: O = x; String(Number(y.a));')).toBe('1');
  expect(evaluated('let x: [uint8, uint8] = [1, 2]; let y: [uint8, uint8] = x; String(Number(y[0]));')).toBe('1');
  expect(evaluated('let x: [].<uint8> = [1]; let y: [].<uint8> = x; String(y.length);')).toBe('1');
  expect(evaluated('enum E: uint8 { A, B } let x: E = E.A; let y: E = x; String(Number(y));')).toBe('0');
});

// Metadata claims survive interning: interning needs STRUCTURAL identity, not
// mutual assignability. Two records that denote the same values may carry
// different metadata claims, and interning them together loses one - switching
// interning to mutual subtyping broke every metadata-narrowing case with
// "not claimed by any meta type". That behaviour is covered end to end by
// ranges/conformance.test.mts, which needs the surrounding declarations; it is
// noted here because it is what separates the two relations.

test('distinct types are still distinct', () => {
  // A symmetric relation must not become a permissive one.
  expectThrown('type U = "a" | "b"; let x: U = "c";');
  expectThrown('let x: uint8 = "s";');
  expect(evaluated('type U = 5 | uint8; let x: U = 7; String(Number(x));')).toBe('7');
});
