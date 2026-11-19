import { test, expect } from 'vitest';
import { evaluated, observeScript, expectThrownKind } from '../harness.mts';
import { observeModuleGraph } from '../module-observer.mts';

/**
 * Question AE, direction AE1. #sec-explicit-conversion: "An explicit conversion
 * is written as a call on the type, `uint8(v)`, or with the conversion operator
 * after the value, `v := uint8`. The two are the same operation." The README
 * casts a class the same way, `MyType(5)` and `BinaryNode({ ... })`. A call on a
 * typed class with one argument is now the conversion of that argument to the
 * class. It was refused before the program ran, as a class constructor invoked
 * without `new`, which is what a call with no argument or several still is.
 */

const V = 'class V { x: uint8 = 0; y: uint8 = 0; }';

/** How _source_ ended, and the rule and message of its error. */
const outcome = (source: string) => {
  const observed = observeScript(source);
  const value = observed.completion.Value as { properties?: Map<{ stringValue(): string }, { Value?: { stringValue?(): string } }> };
  let message: string | undefined;
  for (const [key, descriptor] of value?.properties ?? []) {
    if (key.stringValue() === 'message') message = descriptor.Value?.stringValue?.();
  }
  return {
    type: observed.completion.Type, bodyEntered: observed.bodyEntered, errorClass: observed.errorClass,
    rule: observed.diagnostic?.rule, message,
  };
};

test('a call on a typed class with one argument converts it as := does', () => {
  // An object literal fills the class, and a field's literal wraps, as in `{ x: 300 } := V`.
  expect(evaluated(`${V} const v = V({ x: 300 }); [v.x, v.y, v instanceof V].join();`)).toBe('44,0,true');
  expect(evaluated(`${V} const v = { x: 300 } := V; [v.x, v.y, v instanceof V].join();`)).toBe('44,0,true');
  // A value already of the class is that value.
  expect(evaluated(`${V} const a = new V(); String(V(a) === a);`)).toBe('true');
  // A converting constructor, the README's `MyType(5)`.
  expect(evaluated('class MyType { x: float32 = 0; constructor(x: float32) { this.x = x; } } String(MyType(5).x);')).toBe('5');
  // Overloaded constructors are ranked as at a store.
  expect(evaluated('value class M { x: float32 = 0; constructor(x: float32) { this.x = x; } constructor(y: uint32) { this.x = float32(y) * 2; } } [M(1).x, M(uint32(1)).x].join();'))
    .toBe('1,2');
  // A value class is filled whether or not it declares a constructor.
  expect(evaluated('value class P { x: float32 = 0; y: float32 = 0; constructor(x: float32, y: float32) { this.x = x; this.y = y; } } const p = P({ x: 1, y: 2 }); String(p.x + p.y);'))
    .toBe('3');
  // A conversion the class declares from an object runs.
  expect(evaluated('class Vertex { x: float32 = 0; y: float32 = 0; constructor(x: float32, y: float32) { this.x = x; this.y = y; } '
    + 'operator Vertex(o: { x: float32, y: float32 }) { return new Vertex(o.x * 2, o.y); } } String(Vertex({ x: 1, y: 2 }).x);')).toBe('2');
  // The README's node built in one expression.
  expect(evaluated('class BinaryNode { position: uint32 = 0; op: string = ""; } const n = BinaryNode({ position: 3, op: "+" }); n.op + String(n.position);'))
    .toBe('+3');
});

test('the call has the class type, through an alias, a class expression and a base', () => {
  expect(evaluated(`${V} const v: V = V({ x: 1 }); const n: uint8 = v.x; String(n);`)).toBe('1');
  expect(outcome(`${V} const s: string = V({ x: 1 });`)).toMatchObject({ bodyEntered: false, rule: 'rt-assignability' });
  expect(evaluated(`${V} const W = V; String(W({ x: 7 }).x);`)).toBe('7');
  expect(evaluated('const V = class { x: uint8 = 0; }; String(V({ x: 7 }).x);')).toBe('7');
  // A class is typed by an inherited field too (#sec-typed-classes).
  expect(evaluated('class B { x: uint8 = 0; } class D extends B { } String(D({ x: 7 }).x);')).toBe('7');
  // Two calls in one program: each is read as the conversion.
  expect(evaluated(`${V} const a = V({ x: 1 }); const b = V({ x: 2 }); String(a.x + b.x);`)).toBe('3');
  expect(evaluated(`${V} String(V({ x: 1 }).x) + String(V({ x: 2 }).x);`)).toBe('12');
  // Inside the class's own body.
  expect(evaluated('class V { x: uint8 = 0; twice(): V { return V({ x: this.x * 2 }); } } const v = new V(); v.x = 3; String(v.twice().x);')).toBe('6');
});

test('the call refuses what := refuses, in the same phase', () => {
  expect(outcome(`${V} V({ z: 7 });`)).toMatchObject({ bodyEntered: false, rule: 'rt-explicit-conversion' });
  expect(outcome(`${V} ({ z: 7 } := V);`)).toMatchObject({ bodyEntered: false, rule: 'rt-explicit-conversion' });
  expect(outcome('abstract class A { x: uint8 = 0; } A({ x: 1 });')).toMatchObject({ bodyEntered: false, rule: 'rt-abstract-construction' });
  // A class held by reference that declares a constructor is not filled from a literal.
  expect(outcome('class R { x: uint8 = 0; constructor(x: uint8) { this.x = x; } } R({ x: 1 });'))
    .toMatchObject({ bodyEntered: false, rule: 'rt-explicit-conversion' });
  // A value of another type is refused when it runs, as by `:=`.
  expectThrownKind(`${V} V("a");`, 'TypeError');
  expectThrownKind(`${V} ("a" := V);`, 'TypeError');
});

test('a call with no argument or several is still refused, and says what converts', () => {
  for (const call of ['V()', 'V({ x: 1 }, 2)', 'V(...[{ x: 1 }])']) {
    expect(outcome(`${V} ${call};`)).toMatchObject({
      bodyEntered: false, errorClass: 'StaticTypeError', rule: 'rt-declared-call',
      message: 'a typed class constructor cannot be invoked without new, except with one argument, which it converts',
    });
  }
  // An optional call and a tagged template are not the conversion.
  expect(outcome(`${V} V?.({ x: 1 });`)).toMatchObject({ bodyEntered: false, rule: 'rt-declared-call',
    message: 'a typed class constructor cannot be invoked without new' });
  expect(outcome(`${V} V\`a\`;`)).toMatchObject({ bodyEntered: false, rule: 'rt-declared-call' });
});

test('a class that is not typed, or is generic, keeps the call refused', () => {
  // An untyped class keeps JavaScript's TypeError.
  expectThrownKind('class C { } C(1);', 'TypeError');
  // A class annotated only on a method or a static field is not typed.
  expect(outcome('class C { m(): uint8 { return 1; } } C(1);')).toMatchObject({ bodyEntered: false, rule: 'rt-declared-call' });
  expect(outcome('class S { static n: uint8 = 0; } S(1);')).toMatchObject({ bodyEntered: false, rule: 'rt-declared-call' });
  // A generic class's constructor is the family's.
  expect(outcome('class Box<T: type> { v: T; constructor(v: T) { this.v = v; } } Box(1);')).toMatchObject({ bodyEntered: false, rule: 'rt-declared-call' });
  expect(outcome('class Box<T: type> { v: T; constructor(v: T) { this.v = v; } } Box.<uint8>(1);')).toMatchObject({ bodyEntered: false, rule: 'rt-declared-call' });
  expectThrownKind('class Box<T: type> { v: T; } const f: any = Box; f({ v: 1 });', 'TypeError');
});

test('where the checker cannot see the class, the run time converts', () => {
  expect(evaluated(`${V} const f: any = V; String(f({ x: 7 }).x);`)).toBe('7');
  expect(evaluated(`${V} let f = V; String(f({ x: 7 }).x);`)).toBe('7');
  expect(evaluated(`${V} class W { x: uint8 = 9; } let c = Math.random() < 2; String((c ? V : W)({ x: 1 }).x);`)).toBe('1');
  // A class typed through a base the checker does not establish.
  expect(evaluated('function mixin(B) { return class extends B { }; } class D extends mixin(class { x: uint8 = 0; }) { m(): uint8 { return 1; } } String(D({ x: 1 }).x);'))
    .toBe('1');
  // The constructor's own [[Call]] is unchanged: the conversion is the call expression's.
  expectThrownKind(`${V} V.call(undefined, { x: 1 });`, 'TypeError');
  expectThrownKind(`${V} Reflect.apply(V, undefined, [{ x: 1 }]);`, 'TypeError');
});

test('the argument is evaluated after the callee, once', () => {
  expect(evaluated(`${V} let log = ""; const f = () => { log += "f"; return V; }; f()({ x: (log += "a", 1) }); log;`)).toBe('fa');
});

test('a class imported from a module converts by a call', async () => {
  const result = await observeModuleGraph({
    dep: 'export class V { x: uint8 = 0; }',
    main: 'import { V } from "dep"; const v: V = V({ x: 300 }); if (v.x !== 44) throw new Error(String(v.x));',
  });
  expect(result).toMatchObject({ status: 'fulfilled', bodyEntries: ['dep', 'main'] });
  expect(result.errorClass).toBeUndefined();
  // A call with no argument is refused when it runs: the refusal before the
  // program runs does not follow an import, here as before.
  const refused = await observeModuleGraph({
    dep: 'export class V { x: uint8 = 0; }',
    main: 'import { V } from "dep"; V();',
  });
  expect(refused).toMatchObject({ status: 'rejected', errorClass: 'TypeError', bodyEntries: ['dep', 'main'] });
});
