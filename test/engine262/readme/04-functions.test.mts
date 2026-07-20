import { test, expect } from 'vitest';
import { evaluated, bool, ok, expectThrown } from './harness.mts';

/**
 * README feature coverage — functions.
 * Sections: Function signatures with constraints (including Optional
 * Parameters), Typed Arrow Functions (including Function Types in Unions).
 *
 * The "default return type is void", "undefined is not a valid return type",
 * and "a body that returns a value under a void signature is a TypeError" rules
 * are STATIC checker rules and are covered by the checker tests. Here we verify
 * the runtime and type-identity behavior: that these forms parse and run, that a
 * function type records its parameter and return types correctly, and that
 * optional parameters and typed arrows behave at run time.
 */

// ── Function type identity: parameters and return are part of the type ────────
// A function type interns by its signature. Two function types are the same iff
// their parameter types and return type match; a name on a parameter is
// decoration and does not change the type.
test('Function types: identity follows the parameter and return types', () => {
  expect(bool('type F = (uint8) => uint8; type G = (uint8) => uint8; String(F === G);')).toBe(true);
  // a distinct parameter type is a distinct function type
  expect(bool('type F = (uint8) => uint8; type G = (uint16) => uint8; String(F === G);')).toBe(false);
  // a distinct return type is a distinct function type
  expect(bool('type F = (uint8) => uint8; type G = (uint8) => uint16; String(F === G);')).toBe(false);
  // naming a parameter does not change the type
  expect(bool('type F = (uint8) => uint8; type G = (x: uint8) => uint8; String(F === G);')).toBe(true);
});

test('Function types: parameter and return types are recovered by reflection', () => {
  expect(bool('type F = (uint8) => uint8; String(Reflect.getReflection(F).signatures[0].parameters[0].type === uint8);')).toBe(true);
  expect(bool('type F = (uint8) => uint8; String(Reflect.getReflection(F).signatures[0].return.type === uint8);')).toBe(true);
  // multiple parameters keep their order and types
  expect(bool('type F = (uint8, uint16) => uint8; let s = Reflect.getReflection(F).signatures[0]; String(s.parameters.length === 2 && s.parameters[0].type === uint8 && s.parameters[1].type === uint16);')).toBe(true);
});

// ── Function signatures: forms that parse and run ─────────────────────────────
test('Function signatures: annotated parameters and return, and the no-parameter typed form', () => {
  expect(evaluated('function h(a: int32): void {} typeof h;')).toBe('function');
  expect(evaluated('function f(): void {} typeof f;')).toBe('function');
  // a more elaborate constraint list parses and runs
  expect(ok('function f(a: int32, b: string, c: [].<bigint>): int32 { return a; } typeof f;')).toBe(true);
});

// ── Optional Parameters ───────────────────────────────────────────────────────
// One function can handle both the present and absent argument: `b?` may be
// omitted at the call.
test('Optional Parameters: b? may be omitted or supplied', () => {
  expect(evaluated('function f(a: uint32, b?: uint32) { return a; } String(f(1));')).toBe('1');
  expect(evaluated('function f(a: uint32, b?: uint32) { return a; } String(f(1, 2));')).toBe('1');
  // a supplied optional argument is passed through
  expect(evaluated('function f(a: uint32, b?: uint32) { return b; } String(f(1, 5));')).toBe('5');
});

// ── Typed Arrow Functions ─────────────────────────────────────────────────────
// A single typed parameter still takes its parentheses; an untyped parameter
// does not. Explicit and implicit return types both parse and run.
test('Typed Arrow Functions: parenthesization and return types', () => {
  // single typed parameter, parenthesized
  expect(evaluated('let e = (x: uint8) => x; typeof e;')).toBe('function');
  // untyped parameter, no parentheses (as today)
  expect(evaluated('let f = x => x * x; String(f(3));')).toBe('9');
  // explicit return type
  expect(evaluated('let d = (x: uint8, y: uint8): uint16 => (x + y := uint16); typeof d;')).toBe('function');
  // no-parameter arrow always writes the parentheses
  expect(evaluated('let b = () => {}; typeof b;')).toBe('function');
});

test('Typed Arrow Functions: a bare identifier in a function type is a type, not a parameter name', () => {
  // (uint8) => uint8 takes a uint8; the type records one parameter of type uint8
  expect(bool('type F = (uint8) => uint8; String(Reflect.getReflection(F).signatures[0].parameters.length === 1 && Reflect.getReflection(F).signatures[0].parameters[0].type === uint8);')).toBe(true);
});

// ── Parentheses group; the arrow makes a function type ────────────────────────
// `(uint8)` is a grouped uint8, not a function type; only `=>` makes a function
// type.
test('Function types: parentheses group, the arrow makes the function type', () => {
  // a parenthesized type is just that type
  expect(bool('type A = (uint8); String(A === uint8);')).toBe(true);
});

// ── Function Types in Unions ──────────────────────────────────────────────────
// A function type's return extends as far right as it can, so a function type in
// a union must be parenthesized; the two orders are then the same type.
test('Function Types in Unions: the return extends right; a function arm is parenthesized', () => {
  // return extends right: Find returns uint32 | null (one function type)
  expect(evaluated('type Find = (string) => uint32 | null; String(Reflect.getReflection(Find).kind);')).toBe('function');
  // a parenthesized function type in a union; order does not matter
  expect(bool('type A = ((string) => uint32) | null; type B = null | ((string) => uint32); String(A === B);')).toBe(true);
});

// ── Function value membership ─────────────────────────────────────────────────
// A typed function value is an instance of its signature type and of Function.
test('Function values: a typed function is an instance of its signature and of Function', () => {
  expect(evaluated('type F = (uint8) => uint8; const f = (x: uint8): uint8 => x; String(f instanceof F);')).toBe('true');
  expect(evaluated('const f = (x: uint8): uint8 => x; String(f instanceof Function);')).toBe('true');
});

// ── Function type has no default ──────────────────────────────────────────────
// A function type is among the types with no meaningful zero, so a typed binding
// of a function type without an initializer holds undefined (DefaultValueOf none).
test('Function types: a binding of a function type without an initializer has no default', () => {
  expect(bool('let a: (int32, string) => string; String(a === undefined);')).toBe(true);
});
