import { test, expect } from 'vitest';
import {
  evaluated, expectStaticTypeError, expectThrown, runFlagOff,
} from '../harness.mts';

/**
 * Function overloading and overload resolution.
 *
 * A name declared by more than one function signature resolves, at each call, to
 * the signature whose parameter list best fits the argument values (spec
 * #sec-overload-resolution). Resolution collects the viable signatures, an argument
 * list satisfying a signature's arity and each argument assignable to its
 * parameter, then ranks them by the worst match of any argument against its
 * parameter: an exact type, then an untyped literal taking the parameter's type
 * (#sec-literal-overload-ranking), then an ordinary widening, then an untyped
 * catch-all. Exactly one best signature is called; no viable signature, or more
 * than one equally best, is a type error.
 *
 * The overloaded name is a single function whose `length` is the smallest minimum
 * arity among the signatures and whose `name` is the shared name; `call`, `apply`,
 * and `bind` resolve by the same rules. Overloading is available where a name may
 * legally have more than one function declaration: at the top level and in a
 * function body. A block forbids duplicate function declarations, so no overload
 * arises there.
 *
 * Return-type overloading (#sec-overloading-on-return-type) selects by the call's
 * contextual type, a separate mechanism from the argument ranking here; where two
 * signatures differ only in their return, a call with no contextual type is
 * ambiguous, which is the error this file checks.
 */

// -- Type-based dispatch -------------------------------------------------------
// A call selects the signature whose parameter type the argument matches.
test('a call selects the signature matching the argument type', () => {
  const two = 'function f(a: uint8): string { return "int"; } function f(a: string): string { return "str"; }';
  expect(evaluated(`${two} f((5 := uint8));`)).toBe('int');
  expect(evaluated(`${two} f("hi");`)).toBe('str');
});

// Resolution is by type, not by declaration order: reversing the declarations
// selects the same signature for the same argument.
test('resolution does not depend on declaration order', () => {
  const forward = 'function f(a: uint8): string { return "int"; } function f(a: string): string { return "str"; }';
  const reverse = 'function f(a: string): string { return "str"; } function f(a: uint8): string { return "int"; }';
  expect(evaluated(`${forward} f((5 := uint8));`)).toBe('int');
  expect(evaluated(`${reverse} f((5 := uint8));`)).toBe('int');
});

// -- Arity-based dispatch ------------------------------------------------------
// Signatures of different lengths are selected by the number of arguments.
test('a call selects the signature matching the argument count', () => {
  const two = 'function g(a: uint8): string { return "one"; } function g(a: uint8, b: uint8): string { return "two"; }';
  expect(evaluated(`${two} g((1 := uint8));`)).toBe('one');
  expect(evaluated(`${two} g((1 := uint8), (2 := uint8));`)).toBe('two');
});

// An optional parameter lets a shorter call reach the longer signature.
test('an optional parameter admits a shorter argument list', () => {
  const src = 'function g(a: uint8, b?: string): string { return b === undefined ? "short" : "long"; }';
  expect(evaluated(`${src} g((1 := uint8));`)).toBe('short');
  expect(evaluated(`${src} g((1 := uint8), "x");`)).toBe('long');
});

// A rest parameter absorbs any number of trailing arguments.
test('a rest parameter absorbs the trailing arguments in resolution', () => {
  const two = 'function g(a: uint8): string { return "one"; } function g(a: uint8, ...rest: [].<uint8>): string { return "rest" + String(rest.length); }';
  expect(evaluated(`${two} g((1 := uint8));`)).toBe('one');
  expect(evaluated(`${two} g((1 := uint8), (2 := uint8), (3 := uint8));`)).toBe('rest2');
});

// -- length and name -----------------------------------------------------------
// The overloaded function's length is the smallest minimum arity of its signatures.
test('the overloaded function length is the smallest minimum arity', () => {
  expect(evaluated('function h(a: uint8) {} function h(a: uint8, b: uint8) {} String(h.length);')).toBe('1');
  // an optional first parameter makes the minimum arity zero
  expect(evaluated('function h(a?: uint8) {} function h(a: uint8, b: uint8) {} String(h.length);')).toBe('0');
});

// The overloaded function's name is the shared declared name.
test('the overloaded function name is the shared name', () => {
  expect(evaluated('function f(a: uint8) {} function f(a: string) {} f.name;')).toBe('f');
});

// -- call, apply, bind ---------------------------------------------------------
// The overloaded name is an ordinary function, so these route through resolution.
test('call, apply, and bind resolve by the same rules', () => {
  const two = 'function f(a: uint8): string { return "int"; } function f(a: string): string { return "str"; }';
  expect(evaluated(`${two} f.call(undefined, "hi");`)).toBe('str');
  expect(evaluated(`${two} f.apply(undefined, ["hi"]);`)).toBe('str');
  expect(evaluated(`${two} var b = f.bind(undefined); b((3 := uint8));`)).toBe('int');
});

// -- Literal ranking -----------------------------------------------------------
// A typed literal argument matches its own value type exactly, selecting the
// signature with that numeric parameter over another numeric signature.
test('a typed literal selects the signature with its exact numeric type', () => {
  const two = 'function f(a: uint8): string { return "u8"; } function f(a: int32): string { return "i32"; }';
  expect(evaluated(`${two} f((5 := uint8));`)).toBe('u8');
  expect(evaluated(`${two} f((5 := int32));`)).toBe('i32');
});

// An untyped numeric literal is viable for a numeric parameter (it takes the
// parameter's type, as a single typed parameter would coerce it), so a numeric
// signature is selected over a non-numeric one.
test('an untyped numeric literal takes a numeric parameter over a non-numeric signature', () => {
  const two = 'function f(a: uint8): string { return "num"; } function f(a: string): string { return "str"; }';
  expect(evaluated(`${two} f(5);`)).toBe('num');
  expect(evaluated(`${two} f("x");`)).toBe('str');
});

// -- Catch-all -----------------------------------------------------------------
// An unannotated parameter is the `any` type: a catch-all that ranks below any
// typed match but accepts an argument the typed signatures reject.
test('an unannotated parameter is a catch-all ranked below a typed match', () => {
  const two = 'function f(a: uint8): string { return "typed"; } function f(a): string { return "any"; }';
  expect(evaluated(`${two} f((5 := uint8));`)).toBe('typed');
  expect(evaluated(`${two} f({});`)).toBe('any');
});

// -- Errors --------------------------------------------------------------------
// No viable signature is a type error.
test('a call matching no signature is a type error', () => {
  expectThrown('function k(a: uint8): string { return "u"; } function k(a: string): string { return "s"; } k(true);');
});

// More than one equally-best signature is ambiguous, a type error. A single uint8
// argument fits both f(uint8) and f(uint8, string = "x") at the exact tier.
test('an ambiguous call between equally-ranked signatures is a type error', () => {
  expectThrown('function f(a: uint8): string { return "one"; } function f(a: uint8, b: string = "x"): string { return "two"; } f((1 := uint8));');
});

// Two signatures differing only in their return type are ambiguous where the call
// has no contextual type to select between them (#sec-overloading-on-return-type).
test('signatures differing only in return type are ambiguous with no contextual type', () => {
  expectThrown('function f(): uint32 { return (1 := uint32); } function f(): string { return "s"; } f();');
});

// -- Function body scope -------------------------------------------------------
// Overloading is available for function declarations inside a function body.
test('overloading resolves among declarations inside a function body', () => {
  const outer = 'function outer() { function f(a: uint8): string { return "int"; } function f(a: string): string { return "str"; } return RETURN; }';
  expect(evaluated(`${outer.replace('RETURN', 'f((5 := uint8))')} outer();`)).toBe('int');
  expect(evaluated(`${outer.replace('RETURN', 'f("x")')} outer();`)).toBe('str');
});

// -- Feature off ---------------------------------------------------------------
// With runtime types disabled, same-name function declarations are ordinary
// redeclaration: the last declaration is the binding and a call runs it
// regardless of the argument, so no overload resolution takes place.
test('with the feature off, the last declaration wins and dispatch is not type-based', () => {
  const flagOff = (source: string) => {
    const c = runFlagOff(source) as { Type: string, Value: { stringValue?(): string } };
    expect(c.Type, `expected normal completion (flag off) for: ${source}`).toBe('normal');
    return c.Value.stringValue?.() ?? String(c.Value);
  };
  // Both calls run the last declaration; the first is shadowed, not an overload.
  expect(flagOff('function f(a) { return "first"; } function f(a) { return "second"; } f(1);')).toBe('second');
  expect(flagOff('function f(a) { return "first"; } function f(a) { return "second"; } f("x");')).toBe('second');
});

// -- Signatures naming a user-declared type -------------------------------------
//
// A parameter annotation is resolved when the overloaded function is FIRST
// CALLED, against the environment the declarations were written in, rather than
// when they were hoisted. Resolving at hoist time reads a `type`, `interface`,
// or `enum` binding while it is still in its temporal dead zone - hoisting runs
// before the statement that initializes one - so every user-declared type but a
// class was unusable in an overloaded signature. A class survived only because
// its annotation resolves through the class-type table rather than through the
// binding, which is why nothing noticed.
test('an overloaded signature may name an enum, an alias, or a class', () => {
  expect(evaluated('enum C { Zero, One } '
    + 'function f(x: C): string { return "enum"; } function f(x: string): string { return "str"; } '
    + 'f(C.One) + "/" + f("q");')).toBe('enum/str');
  expect(evaluated('type A = uint8; '
    + 'function f(x: A): string { return "alias"; } function f(x: string): string { return "str"; } '
    + 'f((1 := uint8)) + "/" + f("q");')).toBe('alias/str');
  expect(evaluated('class K {} '
    + 'function f(x: K): string { return "class"; } function f(x: string): string { return "str"; } '
    + 'f(new K()) + "/" + f("q");')).toBe('class/str');
  // A structural alias reaches it through the same path.
  expect(evaluated('type O = { a: uint8 }; '
    + 'function f(x: O): string { return "obj"; } function f(x: string): string { return "str"; } '
    + 'f({ a: (1 := uint8) });')).toBe('obj');
});

test('the declaration may come after the function that annotates with it', () => {
  // Resolution happens at the call, so the order of the two declarations in the
  // source does not matter - which is what a hoisted function declaration means
  // everywhere else in the language.
  expect(evaluated('function f(x: C): string { return "enum"; } function f(x: string): string { return "str"; } '
    + 'enum C { Zero, One } f(C.One);')).toBe('enum');
  // And inside a function body, where the same instantiation runs.
  expect(evaluated('enum C { Zero, One } '
    + 'function outer() { function f(x: C): string { return "enum"; } function f(x: string): string { return "str"; } return f(C.One); } '
    + 'outer();')).toBe('enum');
});

test('deferring the resolution does not weaken the arity or the ranking', () => {
  // `length` is the smallest arity among the signatures, and arity is syntactic -
  // it is read from the parameter nodes without resolving anything.
  expect(evaluated('function f(x: uint8): string { return "a"; } function f(x: uint8, y: uint8): string { return "b"; } '
    + 'String(f.length);')).toBe('1');
  // Two widths still rank as they did.
  expect(evaluated('function f(x: uint8): string { return "u8"; } function f(x: uint16): string { return "u16"; } '
    + 'f((1 := uint8)) + "/" + f((1 := uint16));')).toBe('u8/u16');
  // An argument no signature accepts is still refused, and statically - the
  // checker reaches it before the script runs, so a try cannot swallow it.
  expectStaticTypeError('function f(x: uint8): string { return "u"; } function f(x: string): string { return "s"; } f(true);');
});
