import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * Question AJ, AJ2: an object literal passes to the target's element.
 *
 * A literal filled a class where `:=` named the class and at a field of a class type. Everywhere
 * else it converted as a plain object, and failed when run: `[{ x: 1 }] := [].<V>`, an element of
 * a tuple, a field `items: [].<V>`, and `{ x: 1 } := (V | null)`. Now each element of an array or
 * tuple literal fills its position's class, and the one class of a union whose other members are
 * `null` and `undefined` fills, at every depth. A union of two classes names no one class, and a
 * literal converted to it is refused before running; only `:=` converts a literal.
 */

const V = 'class V { x: uint8 = 0; }';
const early = (rule: string) => ({ bodyEntered: false, diagnostic: { rule } });

test('each element of an array or tuple literal fills its position\'s class', () => {
  expect(evaluated(`${V} const a = [{ x: 1 }, { x: 300 }] := [].<V>; String(a[0] instanceof V) + String(a[1].x) + String(a.length);`)).toBe('true442');
  expect(evaluated(`${V} const a = [{ x: 1 }, { x: 2 }] := [2].<V>; String(a[1] instanceof V) + String(a[1].x);`)).toBe('true2');
  expect(evaluated(`${V} const a = [{ x: 1 }, { x: 2 }] := [V, V]; String(a[0] instanceof V) + String(a[1].x);`)).toBe('true2');
  expect(evaluated(`${V} const a = [{ x: 1 }, 300] := [V, uint8]; String(a[0] instanceof V) + String(a[1]);`)).toBe('true44');
  expect(evaluated('class Box<T: type> { v: T; } const a = [{ v: 300 }] := [].<Box.<uint8>>; String(a[0].v);')).toBe('44');
  // An element that is already a value converts as before, and a spread ends what the literal
  // tells about positions.
  expect(evaluated(`${V} const rest = [new V()]; const a = [{ x: 1 }, ...rest] := [].<V>; String(a.length) + String(a[0] instanceof V);`)).toBe('2true');
});

test('a field of an array of a class fills each element', () => {
  expect(evaluated(`${V} class H { items: [].<V> = []; } const h = { items: [{ x: 1 }, { x: 300 }] } := H; String(h.items[1] instanceof V) + String(h.items[1].x);`))
    .toBe('true44');
  expect(evaluated(`${V} class H { items: [].<V> = []; } String(H({ items: [{ x: 5 }] }).items[0].x);`)).toBe('5');
});

test('the one class of a union with null or undefined fills', () => {
  expect(evaluated(`${V} const v = { x: 300 } := (V | null); String(v instanceof V) + String(v?.x);`)).toBe('true44');
  expect(evaluated(`${V} const v = { x: 300 } := (V | undefined); String(v?.x);`)).toBe('44');
  expect(evaluated(`${V} class H { p: V | null = null; } const h = { p: { x: 300 } } := H; String(h.p instanceof V) + String(h.p?.x);`)).toBe('true44');
  expect(evaluated(`${V} const a = [{ x: 1 }, null] := [].<V | null>; String(a[0] instanceof V) + String(a[1]);`)).toBe('truenull');
});

test('a literal at any depth is checked as the class it fills', () => {
  expect(observeScript(`${V} [{ x: 1, z: 2 }] := [].<V>;`)).toMatchObject(early('rt-explicit-conversion'));
  expect(observeScript(`${V} ({ x: 1, z: 2 }) := (V | null);`)).toMatchObject(early('rt-explicit-conversion'));
  expect(observeScript(`${V} class H { items: [].<V> = []; } ({ items: [{ z: 1 }] }) := H;`)).toMatchObject(early('rt-explicit-conversion'));
  expect(observeScript('class C { x: uint8; constructor() { this.x = 1; } } [{ x: 1 }] := [].<C>;')).toMatchObject(early('rt-explicit-conversion'));
});

test('a union of two classes is refused', () => {
  const W = 'class W { y: uint8 = 0; }';
  expect(observeScript(`${V} ${W} ({ x: 1 }) := (V | W);`)).toMatchObject(early('rt-explicit-conversion'));
  expect(observeScript(`${V} ${W} ({ x: 1 }) := (V | W | null);`)).toMatchObject(early('rt-explicit-conversion'));
  expect(observeScript(`${V} ${W} [{ x: 1 }] := [].<V | W>;`)).toMatchObject(early('rt-explicit-conversion'));
});
