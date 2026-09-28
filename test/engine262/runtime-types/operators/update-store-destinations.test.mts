import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-unary-operators-for-typed-values

test("rejects index update function", () => {
  expectStaticTypeError("class C { get operator[](i: uint32): uint8 { return 0; } set operator[](i: uint32, v: () => uint8) {} } function unused(c: C) { c[0]++; }");
});

test("rejects index update object", () => {
  expectStaticTypeError("class C { get operator[](i: uint32): uint8 { return 0; } set operator[](i: uint32, v: { n: uint8 }) {} } function unused(c: C) { c[0]++; }");
});

test("rejects index update nominal", () => {
  expectStaticTypeError("class D { n: uint8 = 0; } class C { get operator[](i: uint32): uint8 { return 0; } set operator[](i: uint32, v: D) {} } function unused(c: C) { c[0]++; }");
});

test("accepts index update control", () => {
  expect(ok("class C { get operator[](i: uint32): uint8 { return 0; } set operator[](i: uint32, value: uint8) {} } function unused(c: C) { c[0]++; }")).toBe(true);
});

test("accepts index update any", () => {
  expect(ok("class C { get operator[](i: uint32): uint8 { return 0; } set operator[](i: uint32, v: any) {} } new C()[0]++;")).toBe(true);
});

test("accepts index postfix string", () => {
  expect(ok("class C { get operator[](i: uint32): uint8 { return 0; } set operator[](i: uint32, value: string) {} } function unused(c: C) { c[0]++; }")).toBe(true);
});

test("accepts index prefix string", () => {
  expect(ok("class C { get operator[](i: uint32): uint8 { return 0; } set operator[](i: uint32, value: string) {} } function unused(c: C) { --c[0]; }")).toBe(true);
});

test("unknown setter alternative", () => {
  expect(ok("class C { get operator[](i: uint32): uint8 { return 0; } set operator[](i: uint32, v: any) {} } function f(c: C) { --c[0]; }")).toBe(true);
});

test("string setter conversion executes", () => {
  expect(ok("class C { get operator[](i: uint32): uint8 { return 0; } set operator[](i: uint32, v: string) {} } new C()[0]++;")).toBe(true);
});
