import { test, expect } from 'vitest';
import { evaluated, expectThrown, observeScript } from '../harness.mts';

/**
 * The bound a value class implies (#sec-value-classes).
 *
 * "A type parameter of a value class that the type of an instance field, or the class's heritage,
 * mentions is bounded by `value` where it is written with no bound." Every field of a value class
 * has a value type, so such a parameter can be bound only to a value type, and the head of the
 * class has said so.
 *
 * The bound had to be written, `value class Box<T: type extends value>`, on each such parameter;
 * only a field whose whole type was the parameter asked for it, a field of `[4].<T>` or `T | null`
 * being left to the application; and it was written as a name, which a binding called `value` in
 * scope of the class hid.
 */

const refused = { bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-generic-constraint' } };
const N = 'class N { id: uint8 = 1; } ';

test('a parameter a field is written in is bounded by value', () => {
  const B = 'value class Box<T: type> { v: T; constructor(v: T) { this.v = v; } } ';
  expect(evaluated(`${B}function f() { const a = new Box.<uint8>(3); const b = a; b.v = 4; return String(a.v) + String(b.v); } f();`)).toBe('34');
  expect(evaluated(`${B}String(new Box.<string>('s').v);`)).toBe('s');
  // An argument that is not a value type is refused where the class is applied, before it runs.
  expect(observeScript(`${N}${B}function f() { return new Box.<N>(new N()); }`)).toMatchObject(refused);
  expectThrown(`${N}${B}new Box.<N>(new N());`, '"N" is not assignable to "value", the constraint of "T"');
  // Wherever in the field's type the parameter is written.
  expect(evaluated('value class Buf<T: type> { v: [4].<T>; } String((type Buf.<uint16>).byteLength);')).toBe('8');
  expect(observeScript(`${N}value class Buf<T: type> { v: [4].<T | null>; } function f() { return new Buf.<N>(); }`)).toMatchObject(refused);
  expect(evaluated('value class Opt<T: type> { v: T | null = null; } String(new Opt.<uint8>().v);')).toBe('null');
  expect(observeScript(`${N}value class Opt<T: type> { v: T | null = null; } function f() { return new Opt.<N>(); }`)).toMatchObject(refused);
  expect(evaluated('value class Pair<A: type, B: type> { t: [A, B]; constructor(t: [A, B]) { this.t = t; } } String(new Pair.<uint8, string>([1, "x"]).t[1]);')).toBe('x');
  // The body may rely on it: a default, and an argument to another class that asks for a value.
  expect(evaluated(`${B}value class Zero<T: type> { v: T; constructor(v: T) { this.v = v; } zero(): T { let t: T; return t; } } String(new Zero.<uint8>(3).zero());`)).toBe('0');
  expect(evaluated(`${B}value class D<T: type> { b: Box.<T>; constructor(b: Box.<T>) { this.b = b; } } String(new D.<uint8>(new Box.<uint8>(5)).b.v);`)).toBe('5');
});

test('the heritage counts as a field does', () => {
  const B = 'value class Box<T: type> { v: T; constructor(v: T) { this.v = v; } } ';
  expect(evaluated(`${B}value class D<T: type> extends Box.<T> { constructor(v: T) { super(v); } } String(new D.<uint8>(6).v);`)).toBe('6');
  expect(observeScript(`${N}${B}value class D<T: type> extends Box.<T> { constructor(v: T) { super(v); } } function f() { return new D.<N>(new N()); }`)).toMatchObject(refused);
  expect(evaluated('value class V<T: type> extends [2].<T> { } String((type V.<uint16>).byteLength);')).toBe('4');
});

test('a parameter no field mentions is not bounded', () => {
  // A phantom parameter names what the value is about, and may name anything.
  expect(evaluated(`${N}value class Handle<T: type> { index: uint32 = 0; } String(new Handle.<N>().index);`)).toBe('0');
  // One used by a method, a static member or a constructor parameter alone.
  expect(evaluated(`${N}value class Tool<T: type> { n: uint8 = 0; idOf(c: T): T { return c; } } String(new Tool.<N>().idOf(new N()).id);`)).toBe('1');
  expect(evaluated(`${N}value class S<T: type> { n: uint8 = 0; static make(x: T): T { return x; } } String(new S.<N>().n);`)).toBe('0');
  // A value parameter is a number, not a type.
  expect(evaluated('value class Buf<L: uint32> { v: [L].<uint8>; } String((type Buf.<4>).byteLength);')).toBe('4');
  // A class that is not a value class holds anything.
  expect(evaluated(`${N}class Box<T: type> { v: T; constructor(v: T) { this.v = v; } } String(new Box.<N>(new N()).v.id);`)).toBe('1');
});

test('a bound that is written is the bound', () => {
  // `value` and a narrower value type, as before.
  expect(evaluated('value class Box<T: type extends value> { v: T; constructor(v: T) { this.v = v; } } String(new Box.<uint8>(3).v);')).toBe('3');
  expect(evaluated('value class V<T: type extends uint8 | uint16> { v: T; constructor(v: T) { this.v = v; } } String(new V.<uint8>(1).v);')).toBe('1');
  expect(evaluated('value class V<T: type extends plain> { v: T; constructor(v: T) { this.v = v; } } String((type V.<uint8>).byteLength);')).toBe('1');
  // One that is not a value type is refused, `any` included: it is how a parameter is kept
  // unbounded, so it cannot type a field.
  const notValue = { bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-value-class' } };
  expect(observeScript('interface Named { name: string; } value class V<T: type extends Named> { v: T; constructor(v: T) { this.v = v; } }')).toMatchObject(notValue);
  expectThrown('interface Named { name: string; } value class V<T: type extends Named> { v: T; constructor(v: T) { this.v = v; } }', 'whose bound "Named" is not a value type');
  // `extends any` on a parameter that is only passed on keeps it unbounded.
  expect(evaluated(`${N}value class Handle<T: type> { index: uint32 = 0; } value class W<T: type extends any> { h: Handle.<T>; } String(new W.<N>().h.index);`)).toBe('0');
  expect(observeScript(`${N}value class Handle<T: type> { index: uint32 = 0; } value class W<T: type> { h: Handle.<T>; } function f() { return new W.<N>(); }`)).toMatchObject(refused);
});

test('the implied bound is the type, which no binding hides', () => {
  const B = 'value class Box<T: type> { v: T; constructor(v: T) { this.v = v; } }';
  expect(evaluated(`const value = 1; ${B} String(new Box.<uint8>(value).v);`)).toBe('1');
  expect(evaluated(`function f(value: uint8) { ${B} return String(new Box.<uint8>(value).v); } f(7);`)).toBe('7');
  expect(observeScript(`${N}const value = 1; ${B} function g() { return new Box.<N>(new N()); }`)).toMatchObject(refused);
  // The written name is still a name, and the diagnostic for a hidden one still says so.
  expectThrown('const value = 1; value class Box<T: type extends value> { v: T; constructor(v: T) { this.v = v; } }', 'a binding of that name in scope hides it');
});

test('a specialization is selected under the implied bound', () => {
  const general = "v: T; tag(): string { return 'general'; } constructor(v: T) { this.v = v; }";
  const byte = "v: uint8; tag(): string { return 'byte'; } constructor(v: uint8) { this.v = v; }";
  expect(evaluated(`value class Cell<T: type> { ${general} } value class Cell<uint8> { ${byte} } new Cell.<uint8>(1).tag() + '/' + new Cell.<uint16>(1).tag();`)).toBe('byte/general');
});

test('a class expression implies it too', () => {
  expect(evaluated('const Box = value class<T: type> { v: T; constructor(v: T) { this.v = v; } }; String(new Box.<uint8>(2).v);')).toBe('2');
});
