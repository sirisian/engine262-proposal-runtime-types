import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-explicit-conversion

test("rejects constructor cast bad alias", () => {
  expectStaticTypeError("const U = uint8; function unused(s: string) { return U(s); }");
});

test("rejects converter alias chain", () => {
  expectStaticTypeError("const U = uint8; const V = U; function unused(value: string) { return V(value); }");
});

test("accepts constructor cast good alias", () => {
  expect(ok("const U = uint8; globalThis.__observation = String(U(3));")).toBe(true);
});

test("accepts converter const erased control", () => {
  expect(ok("const U: any = uint8; function unused(value: string) { return U(value); }")).toBe(true);
});

test("accepts converter const shadow control", () => {
  expect(ok("const U = uint8; function unused(U: (value: string) => uint8) { return U('text'); }")).toBe(true);
});

test("alias keeps initializer lexical type", () => {
  expectStaticTypeError("const U = uint8; function f(s: string) { type uint8 = string; return U(s); }");
});

test("alias binding shadowed by parameter", () => {
  expect(ok("const U = uint8; function f(U: (s: string) => uint8) { return U(\"ok\"); }")).toBe(true);
});

test("numeric alias conversion wraps", () => {
  expect(ok("const U = uint8; U(300);")).toBe(true);
});

test("closed numeric family alias", () => {
  expectStaticTypeError("const U = uint.<8>; function f(s: string) { return U(s); }");
});
