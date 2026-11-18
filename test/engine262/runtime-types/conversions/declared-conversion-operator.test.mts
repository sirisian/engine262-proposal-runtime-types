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

test('form 3 from an object type applies to an object literal as to a binding holding one', () => {
  // #sec-user-defined-conversions applies a declared conversion at an assignment, an argument and a
  // return. A binding holding `{ x: 5 }` converted; the literal itself was refused before the
  // program ran, "an object literal is not assignable to D".
  const D = 'class D { x: uint8 = 0; operator D(o: { x: uint8 }) { const d = new D(); d.x = o.x + 1; return d; } } ';
  expect(evaluated(`${D}const d: D = { x: 5 }; String(d.x);`)).toBe('6');
  expect(evaluated(`${D}let d: D = new D(); d = { x: 5 }; String(d.x);`)).toBe('6');
  expect(evaluated(`${D}function f(d: D) { return d.x; } String(f({ x: 5 }));`)).toBe('6');
  expect(evaluated(`${D}function f(): D { return { x: 5 }; } String(f().x);`)).toBe('6');
  // So does a converting constructor of an object type.
  expect(evaluated('class E { x: uint8 = 0; constructor(o: { x: uint8 }) { this.x = o.x + 1; } } const e: E = { x: 5 }; String(e.x);')).toBe('6');
  // A literal its parameter does not admit is refused where it runs, as a binding holding it is.
  expectThrown(`${D}const d: D = { y: 5 };`, 'is not assignable to "{ x: uint.<8> }"');
});

test('a conversion\'s parameter is its own', () => {
  // It was read before the operator's scope was entered, so it was declared in the scope around
  // the class, and a later `const o` there was "Identifier o already declared".
  expect(evaluated('class D { x: uint8 = 0; operator D(o: { x: uint8 }) { return new D(); } } const o = 1; String(o);')).toBe('1');
  expect(evaluated('class D { operator D(value: uint8) { return new D(); } } let value = 2; String(value);')).toBe('2');
  // Nor is it visible outside the operator.
  expectThrown('class D { operator D(p: uint8) { return new D(); } } p;', 'not defined');
});

test('form 3 parses beside the other operator forms', () => {
  expect(evaluated('class A { operator number() { return 1; } } "ok";')).toBe('ok');
  expect(evaluated('class A { static operator number() { return 1; } } "ok";')).toBe('ok');
  expect(evaluated('class V { constructor(x){this.x=x;} operator +(o: V) { return new V(this.x + o.x); } } const s = new V(1) + new V(2); String(s.x);')).toBe('3');
  expect(evaluated('class M { constructor(){ this.d=[1,2]; } operator [](i: uint32) { return this.d[Number(i)]; } } const m = new M(); String(m[1]);')).toBe('2');
});

// The TUPLE conversion target (#sec-user-defined-conversions): `operator [number, number, string]()`. Only an
// EMPTY bracket pair names the index accessor `operator[]`; a `[` opening a tuple type is a conversion target,
// and must not be consumed as the operator name.

test('a conversion may target a tuple type', () => {
  const decl = 'class A { x = 1; y = 2; z = "s"; operator [number, number, string]() { return [this.x, this.y, this.z]; } } ';
  expect(evaluated(`${decl}const a = new A(); let t: [number, number, string] = a; String(t[0]);`)).toBe('1');
  expect(evaluated(`${decl}function f(t: [number, number, string]) { return t[0]; } String(f(new A()));`)).toBe('1');
  // And an array-typed target parses too.
  expect(evaluated('class B { operator [].<number>() { return [1]; } } "ok";')).toBe('ok');
});

test('the index accessor is untouched by that disambiguation', () => {
  expect(evaluated('class M { constructor() { this.d = [1, 2]; } operator [](i: uint32) { return this.d[Number(i)]; } } const m = new M(); String(m[1]);')).toBe('2');
  expect(evaluated('class M { constructor() { this.d = [0, 0]; } operator [](i: uint32) { return this.d[Number(i)]; } set operator [](i: uint32, v) { this.d[Number(i)] = v; } } const m = new M(); m[0] = 9; String(m[0]);')).toBe('9');
});
