import { test, expect } from 'vitest';
import { evaluated, bool, ok, expectThrown } from './harness.mts';

/**
 * README feature coverage — overloading and parameter forms.
 * Sections: Function Overloading (and Overload Resolution), Named Parameters,
 * Rest Parameters.
 *
 * Two features here are NOT yet implemented in the engine and are documented as
 * gaps (see PENDING-CAPABILITIES.md, capabilities C and D) rather than asserted:
 *
 *  - Function OVERLOADING is absent. Declaring two functions of one name is
 *    ordinary redeclaration (the last wins); a call runs it regardless of the
 *    argument types, so type-based overload resolution does not happen. The
 *    normative spec (sec-overload-resolution) defines the four-tier ranking; the
 *    Signature Record list on the ~function~ type already supports multiple
 *    signatures, but the value/dispatch side is unbuilt.
 *
 *  - NAMED arguments (`f(a: 1, b: 2)`) and object-spread arguments
 *    (`f(...{ a: 1, b: 2 })`) at the call site are absent.
 *
 * REST parameters ARE implemented and are verified here.
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
// Declaring two functions of one name parses. (Type-based dispatch is not yet
// implemented; see the file header and PENDING-CAPABILITIES.md capability C.)
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

// ── Documented gaps: overloading dispatch and named arguments ─────────────────
// These record the CURRENT behavior so a future implementation has a failing
// baseline to turn green. They are written to pass against today's engine, with
// the note that the target behavior differs.
test('Function Overloading: type-based dispatch is not yet implemented (documents the gap)', () => {
  // Target (spec sec-overload-resolution): f((5 := uint8)) selects the uint8
  // signature and returns "int". Today, dispatch is declaration-order: the last
  // declaration wins regardless of argument type. We assert the current
  // behavior so the gap is visible and testable.
  expect(evaluated('function f(a: uint8): string { return "int"; } function f(a: string): string { return "str"; } f((5 := uint8));')).toBe('str');
});

test('Named arguments and object-spread arguments are not yet implemented (documents the gap)', () => {
  // Target (README "Named Parameters"): f(a: 1, b: "x") and f(...{ a: 1, b: "x" })
  // bind by parameter name. Today both are rejected.
  expectThrown('function f(a: uint8, b: string) { return b; } f(a: (1 := uint8), b: "x");');
  expectThrown('function f(a: uint32, b: string) { return b; } f(...{ a: 10, b: "b" });');
});
