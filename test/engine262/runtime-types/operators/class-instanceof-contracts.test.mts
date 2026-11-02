import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-operator-results
// A mutable Script-global constructor needs a known invocation context.
// Uncalled bodies and later Scripts are covered by deferred-global-constructors.

test("rejects instanceof hook argument", () => {
  expectStaticTypeError("class C { static [Symbol.hasInstance](x: uint8): boolean { return true; } } function check(x: string) { return x instanceof C; } check('s');");
});

test("rejects class hasinstance inherited", () => {
  expectStaticTypeError("class B { static [Symbol.hasInstance](value: uint8): boolean { return true; } } class C extends B {} function check(value: string) { return value instanceof C; } check('s');");
});

test("rejects class hasinstance constalias", () => {
  expectStaticTypeError("class C { static [Symbol.hasInstance](value: uint8): boolean { return true; } } const Alias = C; function unused(value: string) { return value instanceof Alias; }");
});

test("accepts class hasinstance control", () => {
  expect(ok("class C { static [Symbol.hasInstance](value: uint8): boolean { return true; } } function unused(value: uint8) { return value instanceof C; }")).toBe(true);
});

test("specialized static hook", () => {
  expectStaticTypeError("class C<T: type> { static [Symbol.hasInstance](x: T): boolean { return true; } } function f(x: string) { return x instanceof C.<uint8>; } f('s');");
});

test("specialized compatible hook", () => {
  expect(ok("class C<T: type> { static [Symbol.hasInstance](x: T): boolean { return true; } } function f(x: uint8) { return x instanceof C.<uint8>; }")).toBe(true);
});

test("ordinary class membership", () => {
  expect(ok("class C {} new C() instanceof C;")).toBe(true);
});
