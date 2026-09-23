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
  // #sec-parameterkind throws a *TypeError* for a holes parameter whose domain
  // is not written `type`, at the declaration: a type error
  // (higher-kinded-domain-kind.test.mts).
  expectEarlyError('class B<W<_>: uint32> {}', 'StaticTypeError');
});

test('`out` stays an ordinary name', () => {
  expect(evaluated('function f<out: type>(x: out): string { return String(out); } f((1 := uint8));')).toBe('uint.<8>');
  expect(evaluated('class C<out T: type> { } typeof C;')).toBe('function');
});

test('D2: a domain admitting Type Objects alongside other values is refused', () => {
  expectEarlyError('function f<V: any>() {}', 'StaticTypeError');
  expectEarlyError('function f<V: type | uint32>() {}', 'StaticTypeError');
  expectThrown('function f<V: any>() {}', 'admits Type Objects alongside other values');
  // a union of value domains is itself a value domain
  expect(evaluated('function f<V: uint8 | string>(): string { return String(V); } f.<"a">();')).toBe('a');
});

// Recorded gaps, each owned by a later part of the plan.

test('D6: a parameter named after a predefined type shadows it in the body too', () => {
  expect(evaluated('function f<uint32: type>() { return String(uint32 === string); } f.<string>();')).toBe('true');
  expect(evaluated('function f<uint32: type>(x: uint32): string { return String(uint32); } f.<string>("a");')).toBe('string');
  expect(evaluated('class C<string: type> { m() { return String(string); } } new C.<uint8>().m();')).toBe('uint.<8>');
});

test('#sec-generic-parameters-as-values: a type parameter is scoped lexically', () => {
  // It shadows every enclosing binding of its name...
  expect(evaluated('let T = 5; function f<T: type>() { return String(T); } f.<string>();')).toBe('string');
  expect(evaluated('const N = 1; function f<N: uint32>() { return String(N * 2); } f.<7>();')).toBe('14');
  expect(evaluated('let T = 9; class Box<T: type> { m() { return String(T); } } new Box.<string>().m();')).toBe('string');
  expect(evaluated('let T = 5; function f<T: type>() { return () => String(T); } f.<string>()();')).toBe('string');
  // ...and the body's own declarations shadow it, as they shadow a parameter's.
  expect(evaluated('function f<T: type>() { { let T = 5; return String(T); } } f.<string>();')).toBe('5');
  // Outside the declaration the enclosing binding is untouched.
  expect(evaluated('let T = 5; function f<T: type>() { return T; } f.<string>(); String(T);')).toBe('5');
});

test('#sec-type-parameters-static-semantics-early-errors: a callable\'s own level cannot rebind a type parameter', () => {
  // The declaration's parameter list, the top of its body, and any `var` or
  // function hoisting there would rebind the parameter for the whole body.
  expectEarlyError('function f<T: type>() { let T; }', 'SyntaxError');
  expectEarlyError('function f<T: type>() { const T = uint16; }', 'SyntaxError');
  expectEarlyError('function f<T: type>() { function T() {} }', 'SyntaxError');
  expectEarlyError('function f<T: type>(T) {}', 'SyntaxError');
  expectEarlyError('function f<N: uint32>() { { var N = 1; } }', 'SyntaxError');
  expectEarlyError('class C { m<T: type>() { let T; } }', 'SyntaxError');
  expectEarlyError('class C { operator+.<T: type>(rhs: T) { let T; return this; } }', 'SyntaxError');
  expectThrown('function f<T: type>() { let T; }', '`T` is a type parameter of this declaration');
  expectThrown('function f<T: type>() { { var T; } }', 'declare it with `let` in a nested block');
  // A nested scope may shadow it, as it may shadow an ordinary parameter.
  expect(evaluated('function f<T: type>() { { let T = 5; return String(T); } } f.<string>();')).toBe('5');
  expect(evaluated('function f<T: type>() { return [7].map((T) => String(T)).join(); } f.<string>();')).toBe('7');
  expect(evaluated('function f<T: type>() { function g() { var T = 3; return T; } return String(g()); } f.<string>();')).toBe('3');
  expect(evaluated('class M<K: type, V: type> { sum(m) { let out = 0; m.forEach((V, K) => { out += V; }); return String(out); } } new M.<string, uint8>().sum(new Map([["a", 2]]));')).toBe('2');
  // A class's parameters are not a callable's: its body declares no bindings.
  expect(evaluated('class B<T: type> { static { let T = 4; } } "ok";')).toBe('ok');
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

test('#sec-parameter-kinds: a kind is read from its spelling, so an alias of type is refused with the spelling', () => {
  expectEarlyError('type Kind = type; function f<T: Kind>(x: T): T { return x; }', 'StaticTypeError');
  expectThrown('type Kind = type; function f<T: Kind>(x: T): T { return x; }', 'writes the type kind through an alias; a parameter\'s kind is read from how its domain is written, so declare it as `T: type`');
  expectThrown('type Kinds = [].<type>; function f<...Ts: Kinds>() {}', 'declare it as `...Ts: [].<type>`');
  // An alias declared after its use, or in an enclosing scope, is refused alike.
  expectEarlyError('function f<T: Kind>() {} type Kind = type;', 'StaticTypeError');
  // An alias of a VALUE domain is a value domain as before.
  expect(evaluated('type Small = uint8; function f<N: Small>(): string { return String(N); } f.<7>();')).toBe('7');
  // The mixed domain keeps its own message.
  expectThrown('function f<V: type | uint32>() {}', 'admits Type Objects alongside other values');
});
