import { test, expect } from 'vitest';
import {
  evaluated, expectEarlyError, expectThrown,
} from '../harness.mts';

/**
 * proposal-runtime-types #sec-type-parameters and #sec-parameter-kinds: every
 * parameter states its domain, `T: type` declares a type parameter, any other
 * domain declares a value parameter, and an entry without `name :` is an
 * argument of a specialization list. Plan: runtime-types const specialization,
 * phase 2 (C01, C02, C22, C25).
 */

test('C25: a class over T: type constructs and checks its argument', () => {
  // Before explicit domains, `T: type` was read as a VALUE parameter whose
  // domain is `type`, and construction reported that uint.<8> "is not
  // assignable to type, the constraint of T".
  expect(evaluated('class Box<T: type> { v: T; constructor(v: T) { this.v = v; } } String(new Box.<uint8>(3).v);')).toBe('3');
  expectThrown('class Box<T: type> { v: T; constructor(v: T) { this.v = v; } } new Box.<uint8>(300);');
});

test('C25: a type parameter binds from an argument\'s type (D2)', () => {
  expect(evaluated('function f<T: type>(x: T): T { return x; } String(f((3 := uint16)) is uint16);')).toBe('true');
  expect(evaluated('function f<T: type>(x: [].<T>): string { return String(T); } f([(1 := uint8)]);')).toBe('uint.<8>');
});

test('C25: explicit application reaches an overload over T: type', () => {
  expect(evaluated('function f<T: type>(x: T): string { return "one"; } function f<U: type>(x: U, y: U): string { return "two"; }'
    + ' f.<uint8>((1 := uint8), (2 := uint8));')).toBe('two');
});

test('a value parameter still binds the constant it is given (D2)', () => {
  expect(evaluated('enum Component: uint8 { A, B }; function f<C: Component>(c: C) { return String(C); } f(Component.B);')).toBe('1');
  expect(evaluated('class C<W: uint32> { m() { return W; } } String(new C.<4>().m());')).toBe('4');
});

test('bounds, defaults, packs, and higher-kinded parameters take their domain first', () => {
  expect(evaluated('function f<T: type extends uint8 | uint16>(x: T): string { return String(T); } f((1 := uint16));')).toBe('uint.<16>');
  expect(evaluated('class A<T: type = uint8> { } String(new A() instanceof A.<uint8>);')).toBe('true');
  expect(evaluated('function f<...Ts: [].<type>>(...xs: Ts): string { return String(xs.length); } f((1 := uint8), "a");')).toBe('2');
  expect(evaluated('function f<...I: [].<uint32>>(): string { return String(I.length); } f.<0, 1, 2>();')).toBe('3');
  expect(evaluated('type Identity<T: type> = T; class B<W<_>: type, T: type> { } typeof B.<Identity, uint8>;')).toBe('function');
});

test('a generic signature displays its domains', () => {
  expect(evaluated('function id<T: type>(x: T): T { return x; } String(Reflect.typeOf(id));')).toBe('<T: type>(x: T) => T');
  expect(evaluated('function f<N: uint32, ...Ts: [].<type>>(): void {} String(Reflect.typeOf(f));')).toBe('<N: uint32, ...Ts: [].<type>>() => void');
});

test('C22: an entry without a domain is an argument, not a parameter', () => {
  expectEarlyError('function f<T>(x: T) {}', 'SyntaxError');
  expectEarlyError('class Box<T> {}', 'SyntaxError');
  expectEarlyError('function f<T extends uint>(x: T) {}', 'SyntaxError');
  expectEarlyError('class A<T = uint8> {}', 'SyntaxError');
  expectEarlyError('function f<...Ts>() {}', 'SyntaxError');
  expectThrown('function f<T>(x: T) {}', 'a type parameter is declared as `T: type`');
  expectThrown('function f<T extends uint>(x: T) {}', 'write `T: type extends ...`');
  expectThrown('function f<...Ts>() {}', 'a type parameter is declared as `...Ts: [].<type>`');
});

test('specialization lists and captures are reported, not accepted and ignored', () => {
  // #sec-specialization-lists: selection is not implemented yet, and a list
  // that cannot be selected must be reported.
  expectEarlyError('class Box<T: type> {} class Box<uint32> {}', 'SyntaxError');
  expectEarlyError('class Box<T: type, N: uint32> {} class Box<const T, 8> {}', 'SyntaxError');
  expectThrown('class Box<uint32> {}', 'specialization is not supported yet');
  expectThrown('class Box<Map.<string, uint8>> {}', 'specialization is not supported yet');
  expectThrown('class Pair<const T, T> {}', 'a capture, `const T`');
});

test('a value parameter has no extends bound, and a higher-kinded one has domain type', () => {
  expectEarlyError('function f<N: uint32 extends 4>() {}', 'SyntaxError');
  expectEarlyError('class B<W<_>: uint32> {}', 'SyntaxError');
});

test('`out` stays an ordinary name', () => {
  expect(evaluated('function f<out: type>(x: out): string { return String(out); } f((1 := uint8));')).toBe('uint.<8>');
  expect(evaluated('class C<out T: type> { } typeof C;')).toBe('function');
});

// Recorded gaps, each owned by a later part of the plan.

test.fails('D6: a parameter named after a predefined type shadows it in the body too', () => {
  // The annotation reads the parameter and the body reads the builtin.
  expect(evaluated('function f<uint32: type>() { return String(uint32 === string); } f.<string>();')).toBe('true');
});

test('D3: a bound written as a domain is refused at the declaration', () => {
  expectEarlyError('interface Ord { lt(o: any): boolean; } function f<T: Ord>() {}', 'StaticTypeError');
  expectEarlyError('class K {} function f<T: K>() {}', 'StaticTypeError');
  expectEarlyError('function f<V: (x: uint8) => uint8>() {}', 'StaticTypeError');
  expectThrown('interface Ord { lt(o: any): boolean; } function f<T: Ord>() {}', 'did you mean `T: type extends Ord`?');
  // value domains stay admitted: enumerations, literal unions, primitives
  expect(evaluated('enum E: uint8 { A, B }; function f<C: E>(): string { return String(C); } f.<E.B>();')).toBe('1');
  expect(evaluated('function f<V: 1 | 2>(): string { return String(V); } f.<2>();')).toBe('2');
});

test.fails('#sec-parameter-kinds: an alias of type declares a type parameter', () => {
  expect(evaluated('type Kind = type; function f<T: Kind>(x: T): T { return x; } String(f((3 := uint16)) is uint16);')).toBe('true');
});
