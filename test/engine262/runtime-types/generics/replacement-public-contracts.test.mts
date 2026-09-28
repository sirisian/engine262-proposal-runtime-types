import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-class-replacement-contracts

test("rejects case missing method", () => {
  expectStaticTypeError("class B<T: type> { m(v: T): T { return v; } } class B<uint8> {}");
});

test("rejects case wrong method", () => {
  expectStaticTypeError("class B<T: type> { m(v: T): T { return v; } } class B<uint8> { m(v: string): string { return v; } }");
});

test("rejects case bad symbol", () => {
  expectStaticTypeError("const key = Symbol(); class B<T: type> { [key](v: T): T { return v; } } class B<uint8> {}");
});

test("rejects case narrowed setter", () => {
  expectStaticTypeError("class B<T: type> { get x(): T { throw 0; } set x(v: T | string) {} } class B<uint8> { get x(): uint8 { return 0; } set x(v: uint8) {} }");
});

test("rejects case readonly field", () => {
  expectStaticTypeError("class B<T: type> { x: T; } class B<uint8> { readonly x: uint8 = 0; }");
});

test("rejects case optional constructor", () => {
  expectStaticTypeError("class B<T: type> { constructor(x?: T) {} } class B<uint8> { constructor(x: uint8) {} }");
});

test("rejects case constructor narrow reference", () => {
  expectStaticTypeError("class B<T: type> { constructor(x: T) {} } class B<uint8> { constructor(ref x: uint8) {} }");
});

test("rejects case ref constructor", () => {
  expectStaticTypeError("class B<T: type> { constructor(ref x: T) {} } class B<uint8> { constructor(x: uint8) {} }");
});

test("rejects case rest constructor", () => {
  expectStaticTypeError("class B<T: type> { constructor(...x: [].<T>) {} } class B<uint8> { constructor(x: uint8) {} }");
});

test("accepts case method good", () => {
  expect(ok("class B<T: type> { m(v: T): T { return v; } } class B<uint8> { m(v: uint8): uint8 { return v; } }")).toBe(true);
});

test("accepts case readonly good", () => {
  expect(ok("class B<T: type> { readonly x: T; } class B<uint8> { readonly x: uint8 = 0; }")).toBe(true);
});

test("accepts case constructor optional good", () => {
  expect(ok("class B<T: type> { constructor(x?: T) {} } class B<uint8> { constructor(x?: uint8) {} } new B.<uint8>();")).toBe(true);
});

test("accepts case constructor ref good", () => {
  expect(ok("class B<T: type> { constructor(ref x: T) {} } class B<uint8> { constructor(ref x: uint8) {} }")).toBe(true);
});

test("replacement loses inherited method", () => {
  expectStaticTypeError("class A { m(): uint8 { return 0; } } class B<T: type> extends A {} class B<uint8> {}");
});

test("replacement inherits required method", () => {
  expect(ok("class A { m(x: uint8): uint8 { return x; } } class B<T: type> { m(x: T): T { return x; } } class B<uint8> extends A {}")).toBe(true);
});

test("replacement loses default omission", () => {
  expectStaticTypeError("class B<T: type> { constructor(x: uint8 = 0) {} } class B<uint8> { constructor(x: uint8) {} }");
});

test("replacement supplies its own default", () => {
  expect(ok("class B<T: type> { constructor(x?: T) {} } class B<uint8> { constructor(x: uint8 = 0) {} } new B.<uint8>();")).toBe(true);
});

test("replacement method changes reference mode", () => {
  expectStaticTypeError("class B<T: type> { m(ref x: T): void {} } class B<uint8> { m(x: uint8): void {} }");
});

test("replacement reference target is invariant", () => {
  expectStaticTypeError("class A {} class D extends A {} class B<T: type> { constructor(ref x: T) {} } class B<D> { constructor(ref x: A) {} }");
});

test('closed capture discharges member compatibility', () => {
  expectStaticTypeError('class B<T: type> { m(x: T): T { return x; } } class B<const E> { m(x: string): string { return x; } } type Bad = B.<uint8>;');
});

test('closed capture discharges constructor omission', () => {
  expectStaticTypeError('class B<T: type> { constructor(x?: T) {} } class B<const E> { constructor(x: E) {} } type Bad = B.<uint8>;');
});

test('compatible closed capture preserves its contract', () => {
  expect(ok('class B<T: type> { m(x: T): T { return x; } } class B<const E> { m(x: E): E { return x; } } type Good = B.<uint8>;')).toBe(true);
});

test('constructor rest extent preserves the accepted count', () => {
  expectStaticTypeError('class B<T: type> { constructor(...x: [2].<T>) {} } class B<uint8> { constructor(...x: [4].<uint8>) {} }');
});

test('expression application discharges captured contracts', () => {
  expectStaticTypeError('class B<T: type> { m(x: T): T { return x; } } class B<const E> { m(x: string): string { return x; } } const C = B.<uint8>;');
});

test('construction discharges captured contracts', () => {
  expectStaticTypeError('class B<T: type> { m(x: T): T { return x; } } class B<const E> { m(x: string): string { return x; } } new B.<uint8>();');
});

test('replacement inherits a compatible constructor', () => {
  expect(ok('class A { constructor(x: uint8) {} } class B<T: type> { constructor(x: T) {} } class B<uint8> extends A {}')).toBe(true);
});

test('replacement preserves inherited constructor requirements', () => {
  expectStaticTypeError('class A { constructor(x?: uint8) {} } class B<T: type> extends A {} class B<uint8> { constructor(x: uint8) {} }');
});

test('untyped replacement constructor preserves reference mode', () => {
  expectStaticTypeError('class B<T: type> { constructor(ref x: T) {} } class B<uint8> { constructor(x) {} }');
});

test('untyped replacement method preserves reference mode', () => {
  expectStaticTypeError('class B<T: type> { m(ref x: T): void {} } class B<uint8> { m(x) {} }');
});

test('undefined-admitting replacement constructor preserves omission', () => {
  expect(ok('class B<T: type> { constructor(x?: T) {} } class B<uint8> { constructor(x: uint8 | undefined) {} } new B.<uint8>();')).toBe(true);
});

test('untyped replacement constructor accepts copied arguments', () => {
  expect(ok('class B<T: type> { constructor(x: T) {} } class B<uint8> { constructor(x) {} } new B.<uint8>(1);')).toBe(true);
});
