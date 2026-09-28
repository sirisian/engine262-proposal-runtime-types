import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-operator-results

test("rejects instanceof hook argument", () => {
  expectStaticTypeError("class C { static [Symbol.hasInstance](x: uint8): boolean { return true; } } function unused(x: string) { return x instanceof C; }");
});

test("rejects class hasinstance inherited", () => {
  expectStaticTypeError("class B { static [Symbol.hasInstance](value: uint8): boolean { return true; } } class C extends B {} function unused(value: string) { return value instanceof C; }");
});

test("rejects class hasinstance constalias", () => {
  expectStaticTypeError("class C { static [Symbol.hasInstance](value: uint8): boolean { return true; } } const Alias = C; function unused(value: string) { return value instanceof Alias; }");
});

test("accepts class hasinstance control", () => {
  expect(ok("class C { static [Symbol.hasInstance](value: uint8): boolean { return true; } } function unused(value: uint8) { return value instanceof C; }")).toBe(true);
});

test("specialized static hook", () => {
  expectStaticTypeError("class C<T: type> { static [Symbol.hasInstance](x: T): boolean { return true; } } function f(x: string) { return x instanceof C.<uint8>; }");
});

test("specialized compatible hook", () => {
  expect(ok("class C<T: type> { static [Symbol.hasInstance](x: T): boolean { return true; } } function f(x: uint8) { return x instanceof C.<uint8>; }")).toBe(true);
});

test("ordinary class membership", () => {
  expect(ok("class C {} new C() instanceof C;")).toBe(true);
});
