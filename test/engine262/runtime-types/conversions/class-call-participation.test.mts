import { expect, test } from 'vitest';
import { evaluated, expectThrown, expectThrownKind, observeScript } from '../harness.mts';

/**
 * Question BV, direction BV2. #sec-explicit-conversion: `T(v)` and `v := T` are
 * one operation for every type. AE1 made a call on a TYPED class, one with a
 * typed field or declared `value`, the conversion of its one argument. Every
 * other class whose call without `new` is refused, one that "participates
 * through its typed members, declared operators, type parameters, class
 * modifiers, or implemented interfaces" (#sec-function-types), refused `C(v)`
 * before running while `v := C` converted:
 *
 *   interface I { } class C implements I { } C({})   refused
 *   ({} := C)                                        an instance of C
 *
 * Such a class is now called as a type is. A class written in JavaScript has
 * none of these, so its call keeps ECMA-262's TypeError.
 */

const kinds: readonly [string, string][] = [
  ['implements an interface', 'interface I { } class C implements I { }'],
  ['annotates a method', 'class C { m(): uint8 { return 1; } }'],
  ['annotates a parameter', 'class C { m(a: uint8) { return a; } }'],
  ['declares an operator', 'class C { operator+(o) { return this; } }'],
  ['annotates a static field', 'class C { static n: uint8 = 1; }'],
  ['annotates a getter', 'class C { get g(): uint8 { return 1; } }'],
  ['is sealed', 'sealed class C { }'],
  ['is dynamic', 'dynamic class C { }'],
];

test('a call on a class that participates converts its argument as := does', () => {
  for (const [, declaration] of kinds) {
    expect(evaluated(`${declaration} const o = C({}); String(o instanceof C);`)).toBe('true');
    expect(evaluated(`${declaration} const o = ({} := C); String(o instanceof C);`)).toBe('true');
    // A value already of the class is that value.
    expect(evaluated(`${declaration} const c = new C(); String(C(c) === c);`)).toBe('true');
  }
  // A field the class declares is filled, and the call has the class's type.
  expect(evaluated('interface I { } class C implements I { x = 1; m(): uint8 { return 2; } } const o = C({ x: 5 }); const n: uint8 = o.m(); String(o.x) + String(n);'))
    .toBe('52');
  expect(observeScript('interface I { } class C implements I { m(): uint8 { return 2; } } const s: string = C({}).m();'))
    .toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-assignability' } });
  // A converting constructor converts, as `5 := C` does.
  expect(evaluated('class C { constructor(a: uint8) { this.a = a; } } String(C(5).a);')).toBe('5');
});

test('the call refuses what := refuses, in the same phase', () => {
  const same = (call: string, operator: string, rule: string) => {
    expect(observeScript(call)).toMatchObject({ bodyEntered: false, diagnostic: { rule } });
    expect(observeScript(operator)).toMatchObject({ bodyEntered: false, diagnostic: { rule } });
  };
  same('interface I { } class C implements I { } C({ y: 1 });', 'interface I { } class C implements I { } ({ y: 1 } := C);', 'rt-explicit-conversion');
  same('abstract class A { } A({});', 'abstract class A { } ({} := A);', 'rt-abstract-construction');
  same('class C { m(): uint8 { return 1; } } C(1);', 'class C { m(): uint8 { return 1; } } (1 := C);', 'rt-explicit-conversion');
  // A class that declares a constructor is not filled from a literal.
  same('class C { constructor(a: uint8) { this.a = a; } } C({});', 'class C { constructor(a: uint8) { this.a = a; } } ({} := C);', 'rt-explicit-conversion');
  // A value whose type is not known is refused when it runs, by both.
  expectThrown('interface I { } class C implements I { } const v: any = 5; C(v);', 'is not assignable to "C"');
  expectThrown('interface I { } class C implements I { } const v: any = 5; v := C;', 'is not assignable to "C"');
  expectThrownKind('class C { constructor(a: uint8) { this.a = a; } } C(300);', 'RangeError');
  // A class over a built-in is filled by nothing it does not declare, and the
  // conversion says so when it runs, as `:=` does.
  expectThrown('class E extends Error { m(): uint8 { return 1; } } E({});', 'only by a conversion it declares');
  expectThrown('class E extends Error { m(): uint8 { return 1; } } ({} := E);', 'only by a conversion it declares');
});

test('a subclass of a class that participates converts, through every spelling', () => {
  const B = 'interface I { } class B implements I { }';
  expect(evaluated(`${B} class D extends B { } String(D({}) instanceof D);`)).toBe('true');
  expect(evaluated(`${B} const W = B; String(W({}) instanceof B);`)).toBe('true');
  expect(evaluated(`${B} type W = B; String(W({}) instanceof B);`)).toBe('true');
  expect(evaluated(`${B} String(B?.({}) instanceof B);`)).toBe('true');
  // Where the checker cannot see the class, the run time converts.
  expect(evaluated(`${B} const K: any = B; String(K({}) instanceof B);`)).toBe('true');
  // An application of a generic class names one class and converts; the family's own name does not.
  expect(evaluated('class Box<T: type> { } String(Box.<uint8>({}) instanceof Box);')).toBe('true');
  expect(observeScript('class Box<T: type> { } Box({});')).toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-declared-call' } });
});

test('a call with no argument or several is refused, and says what converts', () => {
  for (const call of ['C()', 'C({}, {})', 'C(...[{}])']) {
    expect(observeScript(`interface I { } class C implements I { } ${call};`)).toMatchObject({
      bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-declared-call' },
    });
  }
  expectThrown('interface I { } class C implements I { } C();', 'except with one argument, which it converts');
});

test('a class written in JavaScript keeps its TypeError, and so does the constructor\'s [[Call]]', () => {
  expectThrown('class C { } C({});', 'cannot be invoked without new');
  expectThrown('class B { } class C extends B { } C({});', 'cannot be invoked without new');
  expectThrown('class E extends Error { } E({});', 'cannot be invoked without new');
  expectThrown('interface I { } class C implements I { } [{}].map(C);', 'cannot be invoked without new');
  expectThrown('interface I { } class C implements I { } Reflect.apply(C, undefined, [{}]);', 'cannot be invoked without new');
  expectThrown('interface I { } class C implements I { } C.call(undefined, {});', 'cannot be invoked without new');
});
