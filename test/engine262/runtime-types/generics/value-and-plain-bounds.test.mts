import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * `value` and `plain` are the two BOUND types. A generic class can constrain its
 * type parameter only through `extends` - a class-level `where` is refused on
 * purpose (generics/applications.test.mts) - so the question a pool needs to ask
 * has no other place to be asked.
 *
 * generationalstore.md asks for `extends value` and names both halves while
 * asking for one spelling: "implicit `Sized` plus explicit `Copy`". They are not
 * the same bound. A class of `string` fields is a VALUE TYPE with no layout, so
 * `extends value` alone admits it and the contiguity a store advertises is still
 * lost; `plain` is the bound that actually gates layout.
 *
 * There is deliberately no `layout` beside them: having a layout is a property of
 * a TYPE rather than of its values, so there is no set of values for it to name.
 */

test('value admits a value type class and refuses a dynamic one', () => {
  expect(evaluated(`class Enemy { hp: uint16 = 0; }
    class Store<T: type extends value> { xs: [].<T> = []; }
    new Store.<Enemy>(); 'ok';`)).toBe('ok');
  expectStaticTypeError(`dynamic class D { y = 1; }
    class Store<T: type extends value> { xs: [].<T> = []; }
    new Store.<D>();`);
});

test('plain is the narrower bound, and the two differ on a real case', () => {
  // A value type with no layout: `value` admits it, `plain` does not. This is
  // the case that separates the two bounds, and the one the store needs refused.
  expect(evaluated(`class S { s: string = ''; }
    class VStore<T: type extends value> { xs: [].<T> = []; }
    new VStore.<S>(); 'ok';`)).toBe('ok');
  expectStaticTypeError(`class S { s: string = ''; }
    class PStore<T: type extends plain> { xs: [].<T> = []; }
    new PStore.<S>();`);
});

test('plain admits scalars and laid-out classes, nested included', () => {
  expect(evaluated(`class V { x: float32 = 0; y: float32 = 0; }
    class Body { pos: V; vel: V; }
    class PStore<T: type extends plain> { xs: [].<T> = []; }
    new PStore.<uint8>(); new PStore.<Body>(); 'ok';`)).toBe('ok');
});

test('plain refuses a class holding a reference', () => {
  expectStaticTypeError(`reference class R { x: uint8 = 1; }
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
  expect(evaluated(`class Enemy { hp: uint16 = 0; }
    class S { s: string = ''; }
    [Reflect.isAssignable(Enemy, value), Reflect.isAssignable(Enemy, plain),
     Reflect.isAssignable(S, value), Reflect.isAssignable(S, plain)].join(',');`))
    .toBe('true,true,true,false');
});
