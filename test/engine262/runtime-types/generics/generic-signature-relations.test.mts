// The relations on generic signatures (spec.emu #sec-samefunctiontype,
// #sec-issignaturesubtype,
// #sec-overload-resolution). Identity is up to renaming; assignability follows
// one question - could a caller reading the target be misled?; an overload set
// may mix concrete and generic members, concrete winning.
import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

test('two generic function types that differ only in a name are one type (alpha-equivalence, J31)', () => {
  expect(evaluated('type A = <T>(x: T) => T; type B = <U>(x: U) => U; String(A === B);')).toBe('true');
  expect(evaluated('type A = <T, U>(x: T, y: U) => U; type B = <U, T>(x: U, y: T) => T; String(A === B);')).toBe('true');
});

test('a different shape is a different type (J32, J33)', () => {
  expect(evaluated('type A = <T>(x: T) => T; type B = <T, U>(x: T) => T; String(A === B);')).toBe('false');
  expect(evaluated('type A = <T>(x: T) => T; type C = (x: uint8) => uint8; String(A === C);')).toBe('false');
  expect(evaluated('type A = <T>(x: T) => T; type D = <T>(x: T, y: T) => T; String(A === D);')).toBe('false');
});

test('a generic function crosses into a CONCRETE slot by instantiation (J35 shape)', () => {
  // The relation infers T = uint8 from the slot's parameter, checks the
  // instantiated signature, and the call through the slot works.
  expect(evaluated('function id<T>(x: T): T { return x; } let g: (uint8) => uint8 = id; String(g(3));')).toBe('3');
  expect(evaluated('function first<T>(xs: [].<T>): T { return xs[0]; } let f: ([].<uint8>) => uint8 = first; String(f([7, 8]));')).toBe('7');
});

test('a concrete function does NOT cross into a generic slot (J36)', () => {
  expectThrown('let h: <T>(x: T) => T = (x: uint8): uint8 => x;', 'not assignable');
});

test('a generic function crosses into a generic slot of the same shape (J37)', () => {
  expect(evaluated('function id<T>(x: T): T { return x; } let h: <U>(x: U) => U = id; "ok";')).toBe('ok');
});

test('an overload set mixes concrete and generic members, concrete winning (J84 shape)', () => {
  const R = "function route(e: uint8): string { return 'u8'; } function route<T>(e: T): string { return 'g'; }";
  expect(evaluated(`${R} String(route(1));`)).toBe('u8');
  expect(evaluated(`${R} String(route('s'));`)).toBe('g');
  expect(evaluated(`${R} String(route(true));`)).toBe('g');
});

// Pre-existing and pinned: an INSTANCE is not assignable to an interface
// by shape when the interface declares a method - `interface Bus { on(name:
// string): void }` against a class with that very method already throws
// "SimpleBus is not assignable to Bus" with no generics in sight. The generic
// identification is in place (the method type carries its TypeParameters, the
// interface member its own); this flips when instance-to-interface method
// satisfaction lands.
test.fails('a class satisfies a generic interface method by shape, with its own parameter names', () => {
  expect(evaluated('interface Bus { on<T>(name: string, h: (e: T) => void): void; } class SimpleBus { on<U>(name: string, h: (e: U) => void): void {} } let b: Bus = new SimpleBus(); "ok";')).toBe('ok');
});
