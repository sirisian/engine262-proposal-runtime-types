import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

// Spec: sec-user-defined-conversions, the second declaring form.
//
// "`operator` T`()`, a parameterless member | Declared on the source class S |
// S to T, by converting the receiver."
//
// The declaration parsed and was INERT. Two causes, both found by instrumenting
// rather than reasoning: the registration guard requires [[OperatorName]], which
// a conversion leaves null (its target is in [[Type]]), and there are THREE
// loops over class members in ClassDefinitionEvaluation - only one of which
// class bodies take.

test('a declared conversion applies at every boundary', () => {
  expect(evaluated('class A { x = 7; operator number() { return this.x; } } const a = new A(); let n: number = a; String(n);')).toBe('7');
  expect(evaluated('class A { x = 7; operator number() { return this.x; } } function f(v: number) { return v; } String(f(new A()));')).toBe('7');
  expect(evaluated('class A { x = 7; operator number() { return this.x; } } function g(): number { return new A(); } String(g());')).toBe('7');
  // A typed target too, not only `number`.
  expect(evaluated('class A { operator uint8() { return 7; } } const a = new A(); let n: uint8 = a; String(Number(n));')).toBe('7');
});

test('it fires only for the target it declares', () => {
  // Declaring a conversion to `number` does not make the class a `string`.
  expectThrown('class A { operator number() { return 7; } } let s: string = new A();');
  expectThrown('class B { x = 7; } let n: number = new B();');
  // A plain object is unaffected.
  expectThrown('let n: number = {};');
});

test('the other conversions are unchanged', () => {
  // Form 1, the converting constructor.
  expect(evaluated('class M { constructor(a: float32) { this.v = a; } } let t: M = 1; String(Number(t.v));')).toBe('1');
  // And a value that already fits never routes through a user conversion.
  expect(evaluated('let n: number = 5; String(n);')).toBe('5');
});
