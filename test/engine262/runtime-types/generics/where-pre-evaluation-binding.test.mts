import { test, expect } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

// #sec-generic-where: pre-evaluation reads each value parameter as the call
// binds it, so a written literal argument is built at its parameter's type
// before a clause is decided.

test('a float argument is the rounded value the parameter receives', () => {
  expect(evaluated("function f(x: float32): string where x === 16777216 { return 'ok'; } f(16777217);")).toBe('ok');
  expectStaticTypeError("function f(x: float32): string where x === 16777216 { return 'ok'; } f(16777219);");
});

test('a decimal argument is its exact value, in equality and in relation', () => {
  expect(evaluated("function f(x: decimal128): string where x === 0.2 { return 'ok'; } f(0.2);")).toBe('ok');
  expect(evaluated("function f(x: decimal128): string where x > 0.15 { return 'ok'; } f(0.2);")).toBe('ok');
  expectStaticTypeError("function f(x: decimal128): string where x > 0.15 { return 'ok'; } f(0.1);");
});

test('an integer argument is unchanged', () => {
  expect(evaluated("function f(x: uint8): string where x === 5 { return 'ok'; } f(5);")).toBe('ok');
  expectStaticTypeError("function f(x: uint8): string where x === 5 { return 'ok'; } f(6);");
});
