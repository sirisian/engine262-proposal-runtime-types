import { test, expect } from 'vitest';
import { evaluated, bool, ok, expectThrown } from './harness.mts';

/**
 * README feature coverage — overloading and parameter forms.
 * Sections: Function Overloading (and Overload Resolution), Named Parameters,
 * Rest Parameters.
 *
 * Function OVERLOADING resolves a call to the signature that best fits the
 * argument types (spec sec-overload-resolution): same-name function declarations
 * accumulate as signatures, and a call selects among them by a ranking of each
 * argument against each parameter. Rest parameters and type-based dispatch are
 * verified here.
 *
 * NAMED arguments (`f(a: 1, b: 2)`) and object-spread arguments
 * (`f(...{ a: 1, b: 2 })`) at the call site are not yet implemented, and are
 * documented as a gap rather than asserted.
 */

// ── Rest Parameters ───────────────────────────────────────────────────────────
// A rest parameter collects the trailing arguments. Its annotation is an array
// type describing the element type; the binding is the collected array.
test('Rest Parameters: a typed rest parameter collects the trailing arguments', () => {
  expect(evaluated('function f(a: string, ...args: [].<uint32>) { return args.length; } String(f("a", 0, 1, 2, 3));')).toBe('4');
  expect(evaluated('function f(a: uint8, ...rest: [].<string>) { return rest[0]; } f((1 := uint8), "hello", "y");')).toBe('hello');
  // with no trailing arguments the rest is empty
  expect(evaluated('function f(a: uint8, ...rest: [].<string>) { return rest.length; } String(f((1 := uint8)));')).toBe('0');
});

test('Rest Parameters: the preceding typed parameter is still enforced', () => {
  // the leading typed parameter converts at the boundary
  expect(evaluated('function f(a: uint8, ...rest: [].<string>) { return a; } String(f((7 := uint8), "x"));')).toBe('7');
});

// ── Rest parameters in function types ─────────────────────────────────────────
// An unnamed rest parameter is `...` followed by its type; naming it does not
// change the signature.
test('Rest Parameters: unnamed and named rest in a function type are the same signature', () => {
  expect(bool('type F = (...[].<uint8>) => void; type G = (...args: [].<uint8>) => void; String(F === G);')).toBe(true);
  // the rest element is recorded as a parameter of the signature
  expect(evaluated('type F = (uint8, ...[].<string>) => void; String(Reflect.getReflection(F).signatures[0].parameters.length);')).toBe('2');
});

// ── Function Overloading: what works today ────────────────────────────────────
// Declaring two functions of one name parses and evaluates; type-based dispatch
// among them is verified below.
test('Function Overloading: same-name declarations parse and evaluate', () => {
  expect(ok('function f(a: uint8): string { return "int"; } function f(a: string): string { return "str"; } typeof f;')).toBe(true);
});

// A single (non-overloaded) typed function enforces its own signature: the
// argument converts at the boundary and the return is checked. This is the
// enforcement that overload resolution will build on.
test('Function Overloading: a single typed signature enforces its parameters and return', () => {
  // parameter conversion at the boundary (an any-typed argument in range)
  expect(evaluated('function f(a: uint8): uint8 { return a; } let x = 5; String(f(x) === (5 := uint8));')).toBe('true');
  // an out-of-range any argument is rejected at the boundary
  expectThrown('function f(a: uint8): uint8 { return a; } let x = 300; f(x);');
});

// ── Function Overloading: type-based dispatch ─────────────────────────────────
// A call to an overloaded name selects the signature whose parameters best fit
// the argument types (spec sec-overload-resolution).
test('Function Overloading: type-based dispatch selects the matching signature', () => {
  // f((5 := uint8)) selects the uint8 signature; f("x") selects the string one.
  expect(evaluated('function f(a: uint8): string { return "int"; } function f(a: string): string { return "str"; } f((5 := uint8));')).toBe('int');
  expect(evaluated('function f(a: uint8): string { return "int"; } function f(a: string): string { return "str"; } f("x");')).toBe('str');
  // resolution does not depend on declaration order.
  expect(evaluated('function f(a: string): string { return "str"; } function f(a: uint8): string { return "int"; } f((5 := uint8));')).toBe('int');
});

test('Named arguments and object-spread arguments are not yet implemented (documents the gap)', () => {
  // Target (README "Named Parameters"): f(a: 1, b: "x") and f(...{ a: 1, b: "x" })
  // bind by parameter name. Today both are rejected.
  expectThrown('function f(a: uint8, b: string) { return b; } f(a: (1 := uint8), b: "x");');
  expectThrown('function f(a: uint32, b: string) { return b; } f(...{ a: 10, b: "b" });');
});
