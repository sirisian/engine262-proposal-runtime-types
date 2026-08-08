import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * The `type` type (spec #sec-the-type-type).
 *
 * "`type` is the type whose values are the Type Objects. It is described by the
 * Type Record { [[Kind]]: ~primitive~, [[Name]]: *"type"*, [[Arguments]]: << >>
 * }, and it is the Static Type of a type name or type expression in expression
 * position."
 *
 * It is not a value type - its values are Objects and have identity, which
 * interning fixes - but it is a ~primitive~ record in the sense of the kinds,
 * being a named type of the language rather than a structural description. And
 * because `type` is itself a type, `type` is a value of `type`.
 */

test('the name resolves in type position', () => {
  expect(evaluated('let t: type = uint8; String(typeof t);')).toBe('object');
  expect(evaluated('function f(): type { return uint8; } String(f() is type);')).toBe('true');
  expect(evaluated('function f(v: type) { return v is type; } String(f(uint8));')).toBe('true');
  expect(evaluated('function f<T: type>() { return 1; } String(f.<uint8>());')).toBe('1');
});

test('the name resolves in expression position', () => {
  // a Type Object is nameable where a value is expected
  expect(evaluated('String(typeof type);')).toBe('object');
  expect(evaluated('let t: type = type; String(t is type);')).toBe('true');
});

test('the values of type are the Type Objects', () => {
  expect(evaluated('String(uint8 is type);')).toBe('true');
  expect(evaluated('String(string is type);')).toBe('true');
  expect(evaluated('String(5 is type);')).toBe('false');
  expect(evaluated('String("uint8" is type);')).toBe('false');
  // the clause's own recursive case
  expect(evaluated('String((type) is type);')).toBe('true');
  // a value of another type is refused where `type` is required
  expectThrown('let t: type = 5;');
});

test('Type Objects are interned, so they can key a collection', () => {
  expect(evaluated('String(uint8 === uint8);')).toBe('true');
  expect(evaluated('String(uint8 === uint16);')).toBe('false');
  expect(evaluated('const m = new Map.<type, any>(); m.set(uint8, 1); String(m.get(uint8));')).toBe('1');
  expect(evaluated('const m = new Map.<type, any>(); m.set(uint8, 1); String(m.get(uint16));')).toBe('undefined');
  // including the Type Object for `type` itself
  expect(evaluated('const m = new Map.<type, any>(); m.set(type, 7); String(m.get(type));')).toBe('7');
});

test('generics.md\'s EventBus runs as written', () => {
  // the design's illustration of a type parameter used as a VALUE: the channel
  // map is keyed on `T`, which needs `type`, generic methods, and parameters
  // readable as values together
  const BUS = 'class EventBus { #channels = new Map.<type, any>();'
    + ' emit<T>(event: T) { const c = this.#channels.get(T); if (c) { c.push(event); } return this.#channels.size; }'
    + ' open<T>() { this.#channels.set(T, []); return this.#channels.size; }'
    + ' read<T>() { return this.#channels.get(T) ?? []; } } ';
  expect(evaluated(`${BUS}const b = new EventBus(); b.open.<uint8>(); b.emit.<uint8>((1 := uint8));`
    + ' String(b.read.<uint8>().length);')).toBe('1');
  // each parameter keys its own channel
  expect(evaluated(`${BUS}const b = new EventBus(); b.open.<uint8>(); b.open.<uint16>();`
    + ' b.emit.<uint8>((1 := uint8));'
    + ' String(b.read.<uint8>().length) + "," + String(b.read.<uint16>().length);')).toBe('1,0');
  // and a channel never opened reads empty
  expect(evaluated(`${BUS}const b = new EventBus(); String(b.read.<uint32>().length);`)).toBe('0');
});

test('the type alias declaration is unaffected', () => {
  // `type` is still the contextual keyword that begins an alias
  expect(evaluated('type A = uint8; let a: A = (1 := uint8); String(a);')).toBe('1');
  expect(evaluated('type A<T> = [].<T>; let a: A.<uint8> = []; String(a.length);')).toBe('0');
});
