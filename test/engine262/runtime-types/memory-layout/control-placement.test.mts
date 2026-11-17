import { test, expect } from 'vitest';
import { evaluated, expectThrown, observeScript } from '../harness.mts';

/**
 * A layout control is written where it has something to place (#sec-layout-control).
 *
 * "It is a type error to write a layout control where it has nothing to place: `packed`, `alignAll`
 * and `size` on anything but a value class, `align`, `offset`, `offsetBit` and `endian` on anything
 * but an instance field of one, and any of them where the value class has no layout."
 *
 * The seven names are reserved and never evaluated, so a control was accepted wherever a decorator
 * may be written - a class of any kind, a method, a function, an enum - and placed nothing unless
 * the class had a layout. `@packed class Header { ... }` with `value` forgotten was an object held
 * by reference that reported no layout, and nothing said so.
 */

const refused = { bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-layout' } };
const accepted = (source: string) => expect(observeScript(source).errorClass, source).toBeUndefined();

const classControls = ['@packed', '@alignAll(8)', '@size(8)'];
const fieldControls = ['@align(4)', '@offset(4)', '@offsetBit(3)', '@endian("big")'];

test.each(['class', 'sealed class', 'abstract class', 'dynamic class'])('a control on a %s places nothing', (head) => {
  for (const control of classControls) {
    expect(observeScript(`${control} ${head} A { a: uint8 = 0; b: uint16 = 0; }`), control).toMatchObject(refused);
  }
  for (const control of fieldControls) {
    expect(observeScript(`${head} A { a: uint32 = 0; ${control} b: uint32 = 0; }`), control).toMatchObject(refused);
  }
  expectThrown(`@packed ${head} A { a: uint8 = 0; b: uint16 = 0; }`, '"A" is not a value class and has no layout, so "@packed" places nothing; declare it `value class`');
  // A class with an untyped field is not a value class either.
  expect(observeScript(`@packed ${head} A { a; b: uint8 = 0; }`)).toMatchObject(refused);
  expect(observeScript(`${head} A { @align(4) a; }`)).toMatchObject(refused);
});

test('on a value class each control places what it names', () => {
  expect(evaluated('@packed value class A { a: uint8 = 0; b: uint16 = 0; } String((type A).byteLength);')).toBe('3');
  expect(evaluated('@alignAll(8) value class A { a: uint8 = 0; } String((type A).alignment);')).toBe('8');
  expect(evaluated('@size(8) value class A { a: uint8 = 0; } String((type A).byteLength);')).toBe('8');
  expect(evaluated('value class A { a: uint8 = 0; @align(4) b: uint8 = 0; } String(Reflect.getReflection.<Reflect.ClassFieldLayout, A>("b").offset);')).toBe('4');
  expect(evaluated('value class A { a: uint8 = 0; @offset(4) b: uint8 = 0; } String(Reflect.getReflection.<Reflect.ClassFieldLayout, A>("b").offset);')).toBe('4');
  accepted('value class A { a: uint.<3> = 0; @offsetBit(3) b: uint.<2> = 0; }');
  accepted('value class A { @endian("big") a: uint32 = 0; }');
  // A control that changes nothing for this field still has a field to apply to.
  accepted('value class A { @endian("big") a: uint8 = 0; }');
  // A subclass of a laid-out class is laid out after it, with or without a control of its own.
  expect(evaluated('@packed value class A { a: uint8 = 0; b: uint16 = 0; } value class B extends A { c: uint8 = 0; } String((type B).byteLength);')).toBe('4');
});

test('an object places a field by holding it in a value class', () => {
  // A queue shared by reference is not a value, and it wants its two indices on two cache lines.
  // The alignment belongs to the type of what is stored: a value class of one field, whose
  // layout rounds its size up to its alignment, so two of them never share a line wherever each
  // is stored - an object's field, a binding, an element of an array.
  const Padded = 'value class Padded<T: type> { @align(64) value: T; } ';
  expect(evaluated(`${Padded}const t = type Padded.<uint32>; String(t.byteLength) + ":" + String(t.alignment);`)).toBe('64:64');
  expect(evaluated(`${Padded}String((type [4].<Padded.<uint32>>).byteLength);`)).toBe('256');
  const Queue = `${Padded}class Queue<T: type, N: uint32> {
    #slots: shared [N].<T>;
    #head: shared Padded.<uint32>;
    #tail: shared Padded.<uint32>;
    push(v: T): boolean {
      const tail = this.#tail.value;
      if (tail - this.#head.value == N) return false;
      this.#slots[tail & (N - 1)] = v;
      this.#tail.value = tail + 1;
      return true;
    }
    pop(ref out: T): boolean {
      const head = this.#head.value;
      if (head == this.#tail.value) return false;
      out = this.#slots[head & (N - 1)];
      this.#head.value = head + 1;
      return true;
    }
  } `;
  expect(evaluated(`${Queue}const q = new Queue.<uint8, 2>(); const log = [q.push(5), q.push(6), q.push(7)]; let out: uint8 = 0; while (q.pop(ref out)) log.push(out); log.join(",");`))
    .toBe('true,true,false,5,6');
  // The control written on the object's own field is refused, and the message names both remedies.
  expectThrown('class Queue { @align(64) #head: shared uint32 = 0; @align(64) #tail: shared uint32 = 0; }',
    '"Queue" is not a value class and has no layout, so "@align" places nothing; declare it `value class`, or hold the field in a value class that places it');
});

test('a class control is not written on a member, nor a field control on a class', () => {
  expect(observeScript('value class A { @packed a: uint8 = 0; }')).toMatchObject(refused);
  expect(observeScript('@align(4) value class A { a: uint8 = 0; }')).toMatchObject(refused);
  expectThrown('@align(4) value class A { a: uint8 = 0; }', '"@align" places an instance field of a value class, and is written on a class');
  // A static field, a method and an accessor are no part of an instance's layout.
  expect(observeScript('value class A { a: uint8 = 0; @align(4) static s: uint8 = 0; }')).toMatchObject(refused);
  expect(observeScript('value class A { a: uint8 = 0; @align(4) m() { } }')).toMatchObject(refused);
  expect(observeScript('value class A { a: uint8 = 0; @offset(4) get g(): uint8 { return this.a; } }')).toMatchObject(refused);
});

test('a control is not written on what is not a class', () => {
  expect(observeScript('@packed function f() { }')).toMatchObject(refused);
  expect(observeScript('@packed enum E { A, B }')).toMatchObject(refused);
  expect(observeScript('function f(@align(4) x: uint8) { }')).toMatchObject(refused);
  expect(observeScript('const o = @packed { a: 1 };')).toMatchObject(refused);
  expectThrown('@packed function f() { }', '"@packed" lays out a value class, and is not written on one');
  // A decorator of another name is an ordinary decorator.
  accepted('function log(c: Reflect.Class) { } @log class A { a: uint8 = 0; }');
});

test('a value class that has no layout has nothing for a control to place', () => {
  // Reported where the field's type shows it...
  expect(observeScript("@packed value class A { s: string = ''; b: uint8 = 0; }")).toMatchObject(refused);
  expectThrown("@packed value class A { s: string = ''; b: uint8 = 0; }", '"A" has no layout, since its field "s" has the type "string", which has none, so "@packed" places nothing');
  expect(observeScript("value class A { s: string = ''; @align(4) b: uint8 = 0; }")).toMatchObject(refused);
  // ...and where the class is evaluated otherwise: a field of a class that has none, and an
  // application of a generic class at an argument that has none.
  expectThrown("value class Inner { s: string = ''; } @packed value class Outer { i: Inner; n: uint8 = 0; }", 'so "@packed" places nothing');
  const P = '@packed value class P<T: type extends value> { a: uint8 = 0; v: T; constructor(v: T) { this.v = v; } } ';
  expect(evaluated(`${P}String((type P.<uint32>).byteLength);`)).toBe('5');
  expectThrown(`${P}new P.<string>('s');`, 'so "@packed" places nothing');
  // A class with no control has no layout and no complaint.
  expect(evaluated("value class A { s: string = ''; b: uint8 = 0; } String((type A).hasLayout);")).toBe('false');
});

test('a size is judged for the class it is written on', () => {
  // The fields exceeding a `size` was reported for a class of any kind, though only a value
  // class has a size. The control being written there at all is what is reported now.
  expectThrown('@size(1) class A { a: uint32 = 0; }', 'is not a value class');
  expectThrown('@size(1) value class A { a: uint32 = 0; }', 'declares size "1" but its fields need "4" bytes');
});

test('a class expression carries its decorators', () => {
  // The parser read the list to see what it decorated and then dropped it, so a control on a class
  // expression placed nothing and a decorator on one never ran.
  expect(evaluated('const A = @packed value class { a: uint8 = 0; b: uint16 = 0; }; String((type A).byteLength);')).toBe('3');
  expect(evaluated('const A = value class { a: uint8 = 0; b: uint16 = 0; }; String((type A).byteLength);')).toBe('4');
  expect(observeScript('const A = @packed class { a: uint8 = 0; b: uint16 = 0; };')).toMatchObject(refused);
  const D = 'let seen = ""; function d(c: Reflect.Class) { seen += "d" + String(c.name); } function e(c: Reflect.Class) { seen += "e"; } ';
  // Applied to the finished class, nearest first, as on a declaration.
  expect(evaluated(`${D}const A = @d @e class { a: uint8 = 0; }; seen + typeof A;`)).toBe('edAfunction');
  expect(evaluated(`${D}@d @e class A { a: uint8 = 0; } seen + typeof A;`)).toBe('edAfunction');
  expect(evaluated(`${D}const A = @d class Inner { a: uint8 = 0; }; seen;`)).toBe('dInner');
  expect(evaluated(`${D}const A = @d @packed value class { a: uint8 = 0; b: uint16 = 0; }; seen + String((type A).byteLength);`)).toBe('dA3');
  // A mixin applies them at each application.
  expect(evaluated(`${D}const M = (B) => @e class extends B { t: uint8 = 0; }; class X { } class Y { } M(X); M(Y); seen;`)).toBe('ee');
});
