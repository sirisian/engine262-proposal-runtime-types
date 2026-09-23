import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError, ok } from '../harness.mts';

test('private fields and methods are checked inside their lexical class', () => {
  expectStaticTypeError('class C { #x: uint8 = 1; bad() { this.#x = "s"; } }');
  expectStaticTypeError('class C { #x: uint8 = 1; bad() { let s: string = this.#x; } }');
  expectStaticTypeError('class C { #m(n: uint8) {} bad() { this.#m("s"); } }');
  expectStaticTypeError('class C { static #x: uint8 = 1; static bad() { this.#x = "s"; } }');
  expectStaticTypeError('class C { #x: uint8 = 1; bad(other: C) { other.#x = "s"; } }');
  expect(evaluated('class C { #x: uint8 = 1; #m(n: uint8): uint8 { return n; } good() { this.#x = this.#m(2); return String(this.#x); } } new C().good();')).toBe('2');
});

test('private accessors keep distinct read and write types', () => {
  expectStaticTypeError('class C { get #x(): uint8 { return 1; } set #x(n: uint8) {} bad() { this.#x = "s"; } }');
  expectStaticTypeError('class C { get #x(): uint8 { return 1; } bad() { let s: string = this.#x; } }');
  expect(ok('class C { get #x(): uint8 { return 1; } set #x(n: uint8) {} good() { this.#x = 2; } } new C().good();')).toBe(true);
});

test('private names retain lexical identity and generic arguments', () => {
  expect(ok('class A { #x: uint8 = 1; make() { return class B { #x: string = "s"; good() { this.#x = "t"; } }; } } new (new A().make())().good();')).toBe(true);
  expectStaticTypeError('class Box<T: type> { #x: T; bad(other: Box.<uint8>) { other.#x = "s"; } }');
  expect(ok('class Box<T: type> { #x: T; good(other: Box.<uint8>) { other.#x = 2; } }')).toBe(true);
  expect(evaluated('class C { #x: uint8 = 1; } String("x" in new C());')).toBe('false');
});

test.each(['x', '["x"]', '[("x")]'])('super member %s retains its declared type', (member) => {
  const access = member.startsWith('[') ? `super${member}` : `super.${member}`;
  expectStaticTypeError(`class B { x: uint8 = 1; } class C extends B { bad() { ${access} = "s"; } }`);
  expectStaticTypeError(`class B { x: uint8 = 1; } class C extends B { bad() { let s: string = ${access}; } }`);
  expect(ok(`class B { x: uint8 = 1; } class C extends B { good() { ${access} = 2; } } new C().good();`)).toBe(true);
});

test('computed super methods and static members retain their signatures', () => {
  expectStaticTypeError('class B { m(n: uint8) {} } class C extends B { bad() { super["m"]("s"); } }');
  expectStaticTypeError('class B { static x: uint8 = 1; } class C extends B { static bad() { super["x"] = "s"; } }');
  expect(evaluated('class B { static m(n: uint8): uint8 { return n; } } class C extends B { static good() { return super["m"](2); } } String(C.good());')).toBe('2');
});

test.each(['c.x', 'c["x"]', 'c[("x")]', 'c[key]'])('deleting known typed storage %s is an early error', (access) => {
  expectStaticTypeError(`class C { x: uint8 = 1; } function f(c: C) { const key: "x" = "x"; delete ${access}; }`);
});

test('deletion preserves unknown keys and ordinary properties', () => {
  expect(ok('class C { x: uint8 = 1; } function f(c: C, key) { delete c[key]; }')).toBe(true);
  expect(evaluated('let c = { x: 1 }; String(delete c["x"]);')).toBe('true');
  expect(evaluated('let c: [uint8] = [1]; String(delete c["absent"]);')).toBe('true');
});

test('computed super stores use the setter parameter rather than the getter result', () => {
  const declaration = 'class B { get x(): uint8 { return 1; } set x(v: uint8 | uint16) {} }';
  expect(evaluated(`${declaration} class D extends B { write() { super["x"] = (300 := uint16); } } new D().write(); "ok";`)).toBe('ok');
  expectStaticTypeError(`${declaration} class D extends B { write() { super["x"] = "s"; } }`);
});
