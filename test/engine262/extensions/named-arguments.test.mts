import { test, expect } from 'vitest';
import { evaluated, expectThrown, runFlagOff } from '../readme/harness.mts';

/**
 * Named arguments and object-spread arguments at the call site.
 *
 * A named argument `name: expr` selects a parameter by name rather than by
 * position, a compact way to supply a later parameter while omitting earlier ones
 * that have defaults (README "Named Parameters"). Named arguments may be written
 * in any order, and a parameter not supplied by position or by name takes its
 * default where it has one; a required parameter left unfilled, or a name that
 * matches no parameter, is a type error. A spread of an object literal
 * `...{ a: 1, b: 2 }` binds each property by parameter name, while a spread of an
 * iterable, `...arr` or `...[1, 2]`, still fills positions in order.
 *
 * The syntax is new: a bare `identifier:` at the top of a call argument is a
 * syntax error today, so a named-argument call means nothing in an existing
 * program, and with runtime types disabled it remains a syntax error.
 */

// -- Named arguments select by name --------------------------------------------
test('a named argument selects a parameter by name', () => {
  expect(evaluated('function f(a: string, b: string) { return b; } f("p", b: "x");')).toBe('x');
});

test('named arguments may be written in any order', () => {
  expect(evaluated('function f(a: string, b: string) { return a + b; } f(b: "B", a: "A");')).toBe('AB');
  expect(evaluated('function f(a: string, b: string, c: string) { return a + b + c; } f(c: "C", a: "A", b: "B");')).toBe('ABC');
});

test('all arguments may be named', () => {
  expect(evaluated('function f(a: uint32, b: uint32) { return a + b; } f(a: 1, b: 2);')).toBe('3');
});

// -- Skipping defaulted parameters ---------------------------------------------
test('a named argument skips an earlier defaulted parameter', () => {
  expect(evaluated('function f(a: string = "d", b: string) { return a + b; } f(b: "a");')).toBe('da');
  expect(evaluated('function f(a: uint32, b: string = "d", c: string = "e") { return b + c; } f(1, c: "C");')).toBe('dC');
});

// -- Errors --------------------------------------------------------------------
test('omitting a required parameter is a type error', () => {
  // option1 has no default, so naming only option2 leaves it unfilled
  expectThrown('function g(option1: string, option2: string) {} g(option2: "a");');
});

test('a named argument for no such parameter is a type error', () => {
  expectThrown('function f(a: uint32, b: uint32) {} f(a: 1, z: 2);');
});

// -- Rest parameter ------------------------------------------------------------
test('a named argument for the rest parameter collects the trailing arguments', () => {
  // naming the rest opens it: the following positional arguments join it
  expect(evaluated('function f(a: uint8, b: string = "", ...args: [].<string>) { return String(a) + "|" + b + "|" + String(args.length); } f((8 := uint8), args: "a", "b");')).toBe('8||2');
  expect(evaluated('function f(a: uint32, ...rest: [].<uint32>) { return a + "|" + String(rest.length); } f(1, rest: 2, 3);')).toBe('1|2');
});

// -- Object spread binds by name -----------------------------------------------
test('a spread of an object literal binds each property by parameter name', () => {
  expect(evaluated('function f(a: string, b: string) { return a + "," + b; } f(...{ a: "A", b: "B" });')).toBe('A,B');
  // property order does not matter; binding is by name
  expect(evaluated('function f(a: uint32, b: uint32) { return a - b; } f(...{ b: 1, a: 10 });')).toBe('9');
});

test('an object spread with a property naming no parameter is a type error', () => {
  expectThrown('function f(a: uint32, b: uint32) {} f(...{ a: 1, z: 9 });');
});

// -- Positional and iterable spread are unchanged ------------------------------
test('positional arguments are unaffected', () => {
  expect(evaluated('function f(a: string, b: string) { return b; } f("p", "q");')).toBe('q');
});

test('a spread of an iterable still fills positions in order', () => {
  expect(evaluated('function f(a: uint32, b: uint32) { return a + b; } f(...[3, 4]);')).toBe('7');
  expect(evaluated('function f(a: uint32, b: uint32) { return a - b; } let arr = [10, 3]; f(...arr);')).toBe('7');
});

// -- Feature off ---------------------------------------------------------------
test('with the feature off, a named-argument call is a syntax error', () => {
  const c = runFlagOff('function f(a, b) {} f(1, b: 2);') as { Type: string };
  expect(c.Type).toBe('throw');
});

test('with the feature off, positional calls are unaffected', () => {
  const c = runFlagOff('function f(a, b) { return b; } f(1, 2);') as { Type: string, Value: { numberValue?(): number } };
  expect(c.Type).toBe('normal');
  expect(c.Value.numberValue?.()).toBe(2);
});
