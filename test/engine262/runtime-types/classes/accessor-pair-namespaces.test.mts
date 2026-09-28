import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-typed-classes

test("rejects class static pair", () => {
  expectStaticTypeError("class B { static get x(): uint8 { return 0; } static set x(v: string) {} }");
});

test("rejects class private pair", () => {
  expectStaticTypeError("class B { get #x(): uint8 { return 0; } set #x(v: string) {} }");
});

test("rejects private pair reversed", () => {
  expectStaticTypeError("class C { set #x(v: string) {} get #x(): uint8 { return 0; } }");
});

test("accepts static pair control", () => {
  expect(ok("class C { static get x(): uint8 { return 0; } static set x(v: uint8 | string) {} }")).toBe(true);
});

test("accepts private pair control", () => {
  expect(ok("class C { get #x(): uint8 { return 0; } set #x(v: uint8) {} }")).toBe(true);
});

test("accepts static getter only control", () => {
  expect(ok("class C { static get x(): uint8 { return 0; } }")).toBe(true);
});

test("accepts static setter only control", () => {
  expect(ok("class C { static set x(v: string) {} }")).toBe(true);
});

test("private static pair", () => {
  expectStaticTypeError("class C { static get #x(): uint8 { return 0; } static set #x(x: string) {} }");
});

test("class expression static pair", () => {
  expectStaticTypeError("const C = class { static get x(): uint8 { return 0; } static set x(x: string) {} };");
});

test("separate private identities", () => {
  expect(ok("class A { get #x(): uint8 { return 0; } } class B extends A { set #x(x: string) {} }")).toBe(true);
});

test("static field replaces accessor descriptor", () => {
  expect(ok("class C { static get x(): uint8 { return 0; } static set x(x: string) {} static x: string = \"ok\"; }")).toBe(true);
});
