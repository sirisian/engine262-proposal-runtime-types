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

// Form 3: `operator T(value: S)`, a member taking one parameter, declared on the
// TARGET and running with no receiver. The clause calls it "the form a type
// declares when its constructor is already spoken for, as `Temporal.Instant`'s
// is by epoch nanoseconds" - so with forms 1 and 2 landed it is the only way a
// type whose constructor means something else can declare an inbound conversion.
//
// It did not PARSE. `parseType` ends by folding a following `( ... )` into a
// ComputedType through `parseArguments`, which reads the contents as
// EXPRESSIONS; it does not throw, it returns, and the branch's `expect(LPAREN)`
// then failed on parens already eaten.

test('form 3: a one-parameter conversion operator on the target', () => {
  expect(evaluated('class C { constructor() { this.v = 0; } operator C(value: float32) { const c = new C(); c.v = Number(value); return c; } } let t: C = 5; String(t.v);')).toBe('5');
  expect(evaluated('class C { constructor() { this.v = 0; } operator C(value: float32) { const c = new C(); c.v = Number(value); return c; } } function f(x: C) { return x.v; } String(f(5));')).toBe('5');
  // A source the declared parameter does not admit is still refused.
  expectThrown('class C { constructor(){} operator C(value: float32) { return new C(); } } let t: C = "s";');
});

test('form 3 parses beside the other operator forms', () => {
  expect(evaluated('class A { operator number() { return 1; } } "ok";')).toBe('ok');
  expect(evaluated('class A { static operator number() { return 1; } } "ok";')).toBe('ok');
  expect(evaluated('class V { constructor(x){this.x=x;} operator +(o: V) { return new V(this.x + o.x); } } const s = new V(1) + new V(2); String(s.x);')).toBe('3');
  expect(evaluated('class M { constructor(){ this.d=[1,2]; } operator [](i: uint32) { return this.d[Number(i)]; } } const m = new M(); String(m[1]);')).toBe('2');
});
