import { test, expect } from 'vitest';
import { evaluated, expectThrownKind } from '../readme/harness.mts';

/**
 * A NON-SIMPLE parameter list - one with a default, a rest element, or a
 * destructuring pattern - binds its parameters in a separate parameter
 * environment, and FunctionDeclarationInstantiation then makes the
 * VariableEnvironment a new record whose outer is that one.
 *
 * An environment record's HasBinding is not recursive, so `EnforceParameterTypes`
 * asking the variable environment found nothing and skipped every parameter of
 * such a function SILENTLY - the annotation was accepted and never enforced.
 */

test('a parameter with a default still has its annotation enforced', () => {
  // The same call converts either way: a `float32` 0.1 is 0.10000000149011612.
  expect(evaluated('function f(x: float32 = 0.1): float32 { return x; } String(Number(f(0.1)));')).toBe('0.10000000149011612');
  expect(evaluated('function f(x: float32): float32 { return x; } String(Number(f(0.1)));')).toBe('0.10000000149011612');
  // And the default itself is converted, not left a plain Number.
  expect(evaluated('function f(x: float32 = 0.1): float32 { return x; } String(Number(f()));')).toBe('0.10000000149011612');
  // A closure over the parameter sees the converted value.
  expect(evaluated('function f(x: float32 = 0.1): float32 { const g = () => x; return g(); } String(Number(f()));')).toBe('0.10000000149011612');
});

test('the annotation is enforced, not merely applied', () => {
  // The gap was a SOUNDNESS one: an argument the annotation excludes was
  // admitted when the list was non-simple, and refused when it was simple.
  expectThrownKind('function anyv() { return "s"; } function f(x: float32 = 0.1): float32 { return x; } f(anyv());', 'TypeError');
  expectThrownKind('function anyv() { return "s"; } function f(x: float32): float32 { return x; } f(anyv());', 'TypeError');
});

test('the other non-simple forms are unaffected in their own behaviour', () => {
  expect(evaluated('function f(...xs: [].<uint8>): uint32 { return xs.length; } String(Number(f(1,2,3)));')).toBe('3');
  expect(evaluated('function f(a: float32, b: float32 = 0.1): float32 { return a; } String(Number(f(0.1)));')).toBe('0.10000000149011612');
  // An untyped function with a default is ordinary JavaScript and unchanged.
  expect(evaluated('function f(x = 1) { return x + 1; } String(f());')).toBe('2');
});
