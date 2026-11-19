import { expect, test } from 'vitest';
import { evaluated, expectThrown, observeScript } from '../harness.mts';

/**
 * Question AK, AK2: `JSON.parse.<C>` builds a class by the rule an object literal converted to it
 * follows (#sec-object-literal-conversion).
 *
 * The engine built a class from JSON only where the class declares a conversion from the parsed
 * object, or is a value class that declares a constructor. Otherwise `JSON.parse.<V>('{"x": 3}')`
 * made an object of V's shape that was not a V, and threw: for a class with no constructor, for a
 * value class with none, and for a class held by reference that declares one. Now a class with no
 * constructor in its chain, and a value class, is filled from the parsed object, nested and in
 * arrays: each key names a field, a field the text omits takes its initializer, and a key no field
 * has is refused. A class held by reference that declares a constructor is built only by a
 * conversion it declares, and is otherwise refused, before running where the class is written.
 */

const V = 'class V { x: uint8 = 0; y: uint8 = 5; }';

test('a class filled from a literal is filled from the parsed object', () => {
  expect(evaluated(`${V} const v = JSON.parse.<V>('{"x": 3, "y": 2}'); String(v instanceof V) + String(v.x) + String(v.y) + String(Object.isSealed(v));`))
    .toBe('true32true');
  // An omitted field takes its initializer, as the literal's does.
  expect(evaluated(`${V} String(JSON.parse.<V>('{"x": 3}').y);`)).toBe('5');
  expect(evaluated('value class P { x: uint8 = 0; y: uint8 = 0; } const p = JSON.parse.<P>(\'{"x": 1, "y": 2}\'); String(p.x + p.y);')).toBe('3');
  expect(evaluated('value class P { x: uint8 = 0; constructor(x: uint8) { this.x = x; } } String(JSON.parse.<P>(\'{"x": 7}\').x);')).toBe('7');
  expect(evaluated('class Box<T: type> { v: T; } const b = JSON.parse.<Box.<uint8>>(\'{"v": 3}\'); String(b.v) + String(b instanceof Box);')).toBe('3true');
  // What `JSON.stringify` writes, the parse reads back.
  expect(evaluated(`${V} const v = new V(); v.x = 9; const w = JSON.parse.<V>(JSON.stringify(v)); String(w.x) + String(w.y);`)).toBe('95');
});

test('nested classes, arrays of them and the optional class are built', () => {
  expect(evaluated(`${V} class H { p: V = new V(); n: uint8 = 0; } const h = JSON.parse.<H>('{"p": {"x": 9}, "n": 1}'); String(h.p instanceof V) + String(h.p.x) + String(h.p.y);`))
    .toBe('true95');
  expect(evaluated(`${V} const a = JSON.parse.<[].<V>>('[{"x": 1}, {"x": 2}]'); String(a[1] instanceof V) + String(a[1].x);`)).toBe('true2');
  expect(evaluated(`${V} class H { items: [].<V> = []; } String(JSON.parse.<H>('{"items": [{"x": 4}]}').items[0].x);`)).toBe('4');
  expect(evaluated(`${V} String(JSON.parse.<V | null>('{"x": 4}')?.x) + String(JSON.parse.<V | null>('null'));`)).toBe('4null');
});

test('each member is checked at its field\'s type, and an unknown key is refused', () => {
  expectThrown(`${V} JSON.parse.<V>('{"x": 3, "z": 1}');`, 'unknown key');
  expectThrown(`${V} JSON.parse.<V>('{"x": 300}');`, 'at .x: expected uint8, got 300');
  expectThrown(`${V} JSON.parse.<V>('{"x": "a"}');`, 'at .x: expected uint8');
  expectThrown(`${V} JSON.parse.<V>('[1]');`, 'expected V');
});

test('a class held by reference that declares a constructor is built only by a conversion it declares', () => {
  expect(observeScript('class C { x: uint8; constructor(x: uint8) { this.x = x; } } JSON.parse.<C>(\'{"x": 1}\');'))
    .toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-explicit-conversion' } });
  const C = 'class C { x: uint8; constructor(a: uint8, b: uint8) { this.x = a + b; } operator C(o: { x: uint8 }) { return new C(o.x, 0); } }';
  expect(evaluated(`${C} const c = JSON.parse.<C>('{"x": 7}'); String(c instanceof C) + String(c.x);`)).toBe('true7');
  // Where the class is reached only when the text is read, the refusal is a TypeError then.
  expectThrown('class C { x: uint8; constructor(x: uint8) { this.x = x; } } JSON.parse.<[].<C>>(\'[{"x": 1}]\');', 'declares a constructor');
  expectThrown('class C { x: uint8; constructor(x: uint8) { this.x = x; } } class H { c: C | null = null; } JSON.parse.<H>(\'{"c": {"x": 1}}\');',
    'expected null or C');
});
