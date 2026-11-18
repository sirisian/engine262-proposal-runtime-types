import { test, expect } from 'vitest';
import { evaluated, expectThrown, observeScript } from '../harness.mts';

/**
 * A class that extends a fixed-length array (#sec-value-classes).
 *
 * "A value class extends nothing, a value class, or a fixed-length array of a value type", and "a
 * class that extends a value type is a value, and is written `value class`". A fixed-length array of
 * a value type is a value type (#sec-value-types), so an instance of a class over one is copied and
 * compared as the array is.
 *
 * It was, without the word: `class G extends [4].<uint8> { }` was the one class whose head did not
 * say its kind. It was also half a value. It was copied and compared by its elements, and it was not
 * assignable to `value`, had no layout and no default, could not be a field of a value class, and a
 * field it declared was dropped by every copy.
 */

const refused = { bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-value-class' } };
const G = 'value class G extends [4].<uint8> { first(): uint8 { return this[0]; } } ';

test('the head says the kind of a class over an array', () => {
  // A fixed-length array of a value type is a value, and so is a class over it.
  expect(evaluated(`${G}"ok";`)).toBe('ok');
  expect(observeScript('class G extends [4].<uint8> { }')).toMatchObject(refused);
  expectThrown('class G extends [4].<uint8> { }', 'extends a fixed-length array of a value type, so it is a value, and is written `value class`');
  // A generic one is judged where it is declared, before any application.
  expect(observeScript('class Grid<W: uint32, H: uint32> extends [W * H].<uint8> { }')).toMatchObject(refused);
  expect(evaluated('value class Grid<W: uint32, H: uint32> extends [W * H].<uint8> { } String(new Grid.<4, 4>().length);')).toBe('16');
  // A dynamic array and an array of references are reference types: a class over one is held by
  // reference, and cannot be declared a value.
  expect(evaluated('class L extends [].<uint8> { } function f() { const a = new L(); const b = a; b.push(5); return String(a.length); } f();')).toBe('1');
  expect(observeScript('value class L extends [].<uint8> { }')).toMatchObject(refused);
  expect(evaluated('class N { v: uint8 = 0; } class R extends [2].<N | null> { } function f() { const a = new R(); const b = a; b[0] = new N(); return String(a[0] !== null); } f();')).toBe('true');
  expect(observeScript('class N { v: uint8 = 0; } value class R extends [2].<N | null> { }')).toMatchObject(refused);
  // An element type that is a parameter is bounded by `value`, as a field's type is, so the
  // class is judged where it is applied.
  expect(evaluated('value class V<T: type> extends [2].<T> { } String((type V.<uint16>).byteLength);')).toBe('4');
  expectThrown('class N { } value class V<T: type> extends [2].<T> { } new V.<N>();', '"N" is not assignable to "value", the constraint of "T"');
  expectThrown('class N { } value class V<T: type extends any> extends [2].<T> { } new V.<N>();', 'its base is not one');
  // A class over a value class over an array follows the rule for a value class.
  expect(evaluated(`${G}value class G2 extends G { second(): uint8 { return this[1]; } } function f() { const a = new G2(); a[1] = 4; const b = a; return String(b.second()) + String(b instanceof G); } f();`)).toBe('4true');
  expect(observeScript(`${G}class G2 extends G { }`)).toMatchObject(refused);
});

test('it is a whole value: copied, compared, laid out, defaulted', () => {
  // Copied where it is bound, with its class, and compared by its elements.
  expect(evaluated(`${G}function f() { const a = new G(); const b = a; b[0] = 5; return String(a[0]) + String(b[0]) + String(b instanceof G) + String(b.first()); } f();`)).toBe('05true5');
  expect(evaluated(`${G}function f() { const a = new G(); const b = new G(); const c = new G(); c[1] = 2; return String(a === b) + String(a === c); } f();`)).toBe('truefalse');
  // A value type, and plain data where its elements are.
  expect(evaluated(`${G}String(Reflect.isAssignable(G, value)) + String(Reflect.isAssignable(G, plain));`)).toBe('truetrue');
  expect(evaluated(`${G}value class Box<T: type extends plain> { v: T; constructor(v: T) { this.v = v; } } String(new Box.<G>(new G()).v[0]) + String((type Box.<G>).byteLength);`)).toBe('04');
  // Its layout is its base's.
  expect(evaluated(`${G}String((type G).hasLayout) + '/' + String((type G).byteLength) + '/' + String((type G).alignment);`)).toBe('true/4/1');
  expect(evaluated('value class Grid<W: uint32, H: uint32> extends [W * H].<uint16> { } String((type Grid.<4, 4>).byteLength);')).toBe('32');
  expect(evaluated('value class P { x: uint8 = 0; y: uint8 = 0; } value class Ps extends [3].<P> { } String((type Ps).byteLength);')).toBe('6');
  // A field of a value class, stored in it and copied with it.
  expect(evaluated(`${G}value class H { g: G; n: uint32 = 0; } String((type H).byteLength);`)).toBe('8');
  expect(evaluated(`${G}value class H { g: G; } function f() { const h = new H(); const k = h; k.g[0] = 7; return String(h.g[0]) + String(k.g[0]) + String(h.g instanceof G); } f();`)).toBe('07true');
  // Its default is its base's, as an instance of the class, and a fresh one each time.
  expect(evaluated(`${G}function f() { let g: G; return String(g instanceof G) + String(g[0]) + String(g.length) + String(g.first()); } f();`)).toBe('true040');
  expect(evaluated(`${G}function f() { let a: G; let b: G; a[0] = 3; return String(a[0]) + String(b[0]); } f();`)).toBe('30');
  expect(evaluated(`${G}function f() { const a = new [2].<G>(); return String(a[0] instanceof G) + String(a[1].first()); } f();`)).toBe('true0');
  expect(evaluated('value class Grid<W: uint32, H: uint32> extends [W * H].<uint8> { } function f() { let g: Grid.<2, 2>; return String(g.length) + String(g instanceof Grid.<2, 2>); } f();')).toBe('4true');
  // A value has no identity to be held by, and may be shared where it is laid out.
  expectThrown(`${G}const m = new WeakMap(); m.set(new G(), 1);`, 'cannot be weakly referenced');
  expect(evaluated(`${G}type S = shared G; 'ok';`)).toBe('ok');
  expect(evaluated(`${G}value class P { g: G; n: uint8 = 0; } String(new SoA.<P, 4>().length);`)).toBe('4');
});

test('its elements are the whole of its value', () => {
  // A field beside them was dropped by every copy and ignored by every comparison.
  expect(observeScript('value class G extends [4].<uint8> { tag: uint8 = 0; }')).toMatchObject(refused);
  expectThrown('value class G extends [4].<uint8> { tag: uint8 = 0; }', 'so it declares no instance field');
  expect(observeScript('value class G extends [4].<uint8> { #tag: uint8 = 0; }')).toMatchObject(refused);
  expect(observeScript('value class G extends [4].<uint8> { loose; }')).toMatchObject(refused);
  expectThrown('value class V<T: type extends value> extends [2].<T> { tag: uint8 = 0; } new V.<uint8>();', 'so it declares no instance field');
  // A static field, a method, an accessor, an index accessor and a constructor are not instance fields.
  expect(evaluated('value class G extends [4].<uint8> { static count: uint32 = 2; get last(): uint8 { return this[3]; } } String(G.count) + String(new G().last);')).toBe('20');
  expect(evaluated('value class G extends [16].<uint8> { get operator[](x: uint32, y: uint32) { return ref this[y * 4 + x]; } } const g = new G(); g[2, 1] = 10; String(g[6]);')).toBe('10');
  expect(evaluated('value class G extends [4].<uint8> { constructor(fill: uint8) { super(); for (let i: uint32 = 0; i < 4; i++) this[i] = fill; } } String(new G(7)[3]);')).toBe('7');
});

test('what is not built', () => {
  // Its layout is its base's, and placing one on a buffer is specified and not built: the
  // refusal says so, where it said the class had no layout.
  expectThrown(`${G}const b = new ArrayBuffer(8); new(b, 0) G();`, 'specified but not implemented in this engine');
});

test('an instance reports its class, and a store to a copy of one is seen', () => {
  const G = 'value class G extends [4].<uint8> { sum() { return this[0] + this[1] + this[2] + this[3]; } } ';
  // #sec-runtimetypeof: "a class instance reports the ~nominal~ type of its class". The array
  // answer came first, so the type of a G was the type of its base.
  expect(evaluated(`${G}String(Reflect.typeOf(new G()) === (type G)) + String(new G() is G);`)).toBe('truetrue');
  expect(evaluated('class Dyn extends [].<uint8> { } String(Reflect.typeOf(new Dyn()) === (type Dyn));')).toBe('true');
  expect(evaluated(`${G}const a = new G(); const b = a; b[0] = 9; String(a[0]) + String(b[0]) + String(Reflect.typeOf(b) === (type G));`)).toBe('09true');
  // #sec-value-type-copying: a parameter of the class is a copy, as one of its base is.
  expect(observeScript(`${G}function f(g: G) { g[0] = 1; }`)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-store-to-copy' } });
  expect(observeScript(`${G}value class H { g: G; } function f(h: H) { h.g[0] = 1; }`)).toMatchObject({ errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-store-to-copy' } });
  // Read afterwards, passed by reference, or stored through an index operator of the class.
  expect(observeScript(`${G}function f(g: G) { g[0] = 1; return g.sum(); }`).errorClass).toBeUndefined();
  expect(evaluated(`${G}function f(ref g: G) { g[0] = 1; } const g = new G(); f(ref g); String(g[0]);`)).toBe('1');
  expect(observeScript('value class Grid extends [4].<uint8> { get operator[](x: uint32, y: uint32) { return ref this[y * 2 + x]; } } function f(g: Grid) { g[1, 1] = 1; }').errorClass).toBeUndefined();
});
