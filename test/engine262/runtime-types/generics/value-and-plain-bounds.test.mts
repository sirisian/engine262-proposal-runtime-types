import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, observeScript } from '../harness.mts';

/**
 * `value` and `plain` are the two BOUND types of #sec-layout-properties: `value` is the type every value
 * type is assignable to, and `plain` the type every plain-data type is assignable to. A generic class can
 * constrain its type parameter only through `extends` - a class-level `where` is refused on purpose
 * (generics/applications.test.mts) - so the question a pool needs to ask has no other place to be asked.
 *
 * They are not the same bound. A class of `string` fields is a VALUE TYPE with no layout, so `extends
 * value` alone admits it and the contiguity a store advertises is still lost; `plain` is the bound that
 * actually gates layout.
 *
 * Unspecified: there is deliberately no `layout` bound beside them. Having a layout is a property of a
 * TYPE rather than of its values, so there is no set of values for it to name.
 */

test('value admits a value type class and refuses a dynamic one', () => {
  expect(evaluated(`value class Enemy { hp: uint16 = 0; }
    class Store<T: type extends value> { xs: [].<T> = []; }
    new Store.<Enemy>(); 'ok';`)).toBe('ok');
  expectStaticTypeError(`dynamic class D { y = 1; }
    class Store<T: type extends value> { xs: [].<T> = []; }
    new Store.<D>();`);
});

test('plain is the narrower bound, and the two differ on a real case', () => {
  // A value type with no layout: `value` admits it, `plain` does not. This is
  // the case that separates the two bounds, and the one the store needs refused.
  expect(evaluated(`value class S { s: string = ''; }
    class VStore<T: type extends value> { xs: [].<T> = []; }
    new VStore.<S>(); 'ok';`)).toBe('ok');
  expectStaticTypeError(`value class S { s: string = ''; }
    class PStore<T: type extends plain> { xs: [].<T> = []; }
    new PStore.<S>();`);
});

test('plain admits scalars and laid-out classes, nested included', () => {
  expect(evaluated(`value class V { x: float32 = 0; y: float32 = 0; }
    value class Body { pos: V; vel: V; }
    class PStore<T: type extends plain> { xs: [].<T> = []; }
    new PStore.<uint8>(); new PStore.<Body>(); 'ok';`)).toBe('ok');
});

test('plain refuses a class holding a reference', () => {
  expectStaticTypeError(`class R { x: uint8 = 1; }
    class H { r: R | null = null; }
    class PStore<T: type extends plain> { xs: [].<T> = []; }
    new PStore.<H>();`);
});

test('the static bound and the reflective question agree', () => {
  // They did not. A constraint is checked before the program runs, and plainness
  // reads a layout computed when a class is evaluated, so every class was
  // refused statically while `Reflect.isAssignable` admitted it at run time. The
  // checker's own field resolver is now handed to the layout module, which is
  // what makes one type give one answer.
  expect(evaluated(`value class Enemy { hp: uint16 = 0; }
    value class S { s: string = ''; }
    [Reflect.isAssignable(Enemy, value), Reflect.isAssignable(Enemy, plain),
     Reflect.isAssignable(S, value), Reflect.isAssignable(S, plain)].join(',');`))
    .toBe('true,true,true,false');
});

test('a type parameter bounded by one of them satisfies that bound where it is forwarded', () => {
  // "If _s_ is a parameter with a constraint, IsSubtype(constraint, _t_)": a parameter is known to be at
  // least its constraint. The two bounds are answered by predicates over a type's structure, which see
  // only a parameter, so `T: type extends value` was refused as an argument to `Box<T: type extends
  // value>` - "T: value is not assignable to value" - and no generic function could build, take or
  // return an application of a class bounded this way.
  const B = 'value class Box<T: type extends value> { value: T; constructor(v: T) { this.value = v; } } ';
  const P = 'value class Pool<T: type extends plain> { n: uint8 = 0; } ';
  expect(evaluated(`${B}function wrap<T: type extends value>(v: T): Box.<T> { return new Box.<T>(v); } String(wrap.<uint8>(9).value) + wrap.<string>('s').value;`)).toBe('9s');
  expect(evaluated(`${B}class Pair<T: type extends value> { a: Box.<T>; constructor(v: T) { this.a = new Box.<T>(v); } } String(new Pair.<uint8>(3).a.value);`)).toBe('3');
  expect(evaluated(`${P}function mk<T: type extends plain>(): Pool.<T> { return new Pool.<T>(); } String(mk.<uint8>().n);`)).toBe('0');
  // `plain` is the narrower bound, so it satisfies `value`, and a bound that is itself a value type does.
  expect(evaluated(`${B}function wrap<T: type extends plain>(v: T): Box.<T> { return new Box.<T>(v); } String(wrap.<uint8>(9).value);`)).toBe('9');
  expect(evaluated(`${B}function wrap<T: type extends uint8 | uint16>(v: T): Box.<T> { return new Box.<T>(v); } String(wrap.<uint8>(9).value);`)).toBe('9');
});

test('a parameter with no bound, or a wider one, does not', () => {
  const B = 'value class Box<T: type extends value> { value: T; constructor(v: T) { this.value = v; } } ';
  const P = 'value class Pool<T: type extends plain> { n: uint8 = 0; } ';
  const refused = { bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-generic-constraint' } };
  expect(observeScript(`${B}function wrap<T: type>(v: T): Box.<T> { return new Box.<T>(v); } 1;`)).toMatchObject(refused);
  expect(observeScript(`${P}function mk<T: type extends value>(): Pool.<T> { return new Pool.<T>(); } 1;`)).toMatchObject(refused);
  expect(observeScript(`${B}interface Named { name: string; } function wrap<T: type extends Named>(v: T): Box.<T> { return new Box.<T>(v); } 1;`)).toMatchObject(refused);
  // And the argument at each call is still judged against the function's own bound.
  expectStaticTypeError(`class Conn { id: uint8 = 1; } ${B}function wrap<T: type extends value>(v: T): Box.<T> { return new Box.<T>(v); } wrap.<Conn>(new Conn());`);
});
