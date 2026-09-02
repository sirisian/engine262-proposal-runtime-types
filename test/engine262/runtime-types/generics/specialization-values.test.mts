// PLAN-variadic-and-named-generic-arguments.md Phase 4 remainder (F-C, F-I;
// spec.emu #sec-generic-function-values): a generic function applied in
// expression position denotes its SPECIALIZATION as a value - interned per
// function and ordered bindings, `where` checked once at creation, no receiver
// captured, the instantiated signature as its type - and `typeof T` reads the
// parameter. Before this the expression evaluated to the bare function and the
// bindings were lost.
import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

const ID = 'function id<T>(x: T): T { return x; }';

test('one specialization per function and ordered bindings, whatever the spelling (J61, J62)', () => {
  expect(evaluated(`${ID} String(id.<uint8> === id.<uint8>);`)).toBe('true');
  expect(evaluated(`${ID} String(id.<uint8> === id.<T: uint8>);`)).toBe('true');
  expect(evaluated(`${ID} String(id.<uint8> !== id.<string> && id.<uint8> !== id);`)).toBe('true');
});

test('a specialization is a first-class function: stored, keyed, called later (J63, J64)', () => {
  expect(evaluated(`${ID} const s = id.<uint8>; String(s(3));`)).toBe('3');
  expect(evaluated(`${ID} const m = new Map(); m.set(id.<uint8>, 1); String(m.get(id.<uint8>));`)).toBe('1');
  expect(evaluated('function dbl<N: number>(x: number): number { return x * N; } const f = dbl.<10>; String(f(2));')).toBe('20');
});

test('its type is the instantiated signature; the bare name keeps the generic one (J67)', () => {
  expect(evaluated(`${ID} String(Reflect.typeOf(id.<uint8>));`)).toBe('(x: uint.<8>) => uint.<8>');
  expect(evaluated(`${ID} String(Reflect.typeOf(id));`)).toBe('(x: T) => T');
});

test('a method specialization captures no receiver and is receiver-independent (J68, J69)', () => {
  expect(evaluated('class V { m<I: uint32>(): uint32 { return I; } } const s = V.prototype.m.<3>; String(s.call(new V()));')).toBe('3');
  expect(evaluated('class V { m<I: uint32>(): uint32 { return I; } } String(new V().m.<3> === V.prototype.m.<3>);')).toBe('true');
});

test('where clauses run once, at creation (J65)', () => {
  expect(evaluated('function f<N: uint32>(): uint32 where N < 4 { return N; } const s = f.<2>; String(s());')).toBe('2');
  expectThrown('function f<N: uint32>(): uint32 where N < 4 { return N; } const s = f.<9>;', 'where');
});

test('typeof reads a type parameter (F-I)', () => {
  expect(evaluated('function f<T>(): boolean { return typeof T === typeof uint8; } String(f.<uint8>());')).toBe('true');
  expect(evaluated('function g<V: uint32>(): string { return typeof V; } g.<3>();')).toBe('number');
  expect(evaluated('function h<...I: [].<uint32>>(): string { return typeof I; } h.<1, 2>();')).toBe('object');
});
