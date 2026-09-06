import { test, expect } from 'vitest';
import { evaluated, ok, expectStaticTypeError } from '../harness.mts';

// ---------------------------------------------------------------------------
// AN INTERFACE OF CALL SIGNATURES DENOTES A FUNCTION TYPE.
//
// #sec-object-types: "A |MethodSignature| with no |PropertyName| is a call
// signature. An object type OR INTERFACE whose members are all call signatures
// denotes the ~function~ Type Record whose [[Signatures]] are those signatures
// in declaration order ... It is a type error for an object type to mix call
// signatures with named members or an index signature." README, "Function
// Interfaces": `interface IExample { ({ a: uint32 }): uint32 }`, and a call
// `a({ a: 1 })` through a parameter of that type.
//
// The interface declaration built an object structure and refused a call
// signature - "not supported yet" - while the object-type spelling beside it
// built the function record. And the CHECKER answered null for either spelling,
// so a parameter typed by one was ~any~ and a call through it was checked
// nowhere, where the same call through `(uint32) => void` was a StaticTypeError.
// One builder now serves both spellings, at run time and in the checker.
// ---------------------------------------------------------------------------

test('the README\'s examples: a typed-object parameter, in both spellings, renaming ignored', () => {
  expect(evaluated('interface IExample { ({ a: uint32 }): uint32 } function f(a: IExample) { return a({ a: 1 }); } String(f(({(a:uint32):b}) => b));')).toBe('1');
  expect(evaluated('interface IExample { ({ a: uint32; }): uint32; } function f(a: IExample) { return a({ a: 1 }); } String(f(a => a.a));')).toBe('1');
});

test('overloads: a matching call runs; a call no signature accepts is refused statically', () => {
  expect(ok('interface I { (string, uint32); (uint32); } function f(a: I) { a("a", 1); a(2); } f((x) => x);')).toBe(true);
  // README: "a('a'); // TypeError: No matching signature for (string)."
  expectStaticTypeError('interface I { (string, uint32); (uint32); } function f(a: I) { a("a"); } f((x) => x);');
  // ...and the object-type spelling, which had been ~any~ to the checker too.
  expectStaticTypeError('type F = { (string, uint32); (uint32); }; function f(a: F) { a("a"); } f((x) => x);');
});

test('the call\'s return has the signature\'s type, statically', () => {
  expectStaticTypeError('interface I { (uint32): uint32 } function f(a: I) { let s: string = a(1); } f((x) => x);');
  expect(evaluated('interface I { (uint32): uint32 } function f(a: I) { let u: uint32 = a(1); return u; } String(f((x) => x));')).toBe('1');
  // "void is the default return type".
  expect(evaluated('interface V { (uint32) } function f(a: V) { return a(1); } String(f((x) => {}));')).toBe('undefined');
});

test('the interface and object-type spellings are one function type', () => {
  expect(evaluated('type F = { (uint32): uint32 }; String(type F);')).toBe('(uint.<32>) => uint.<32>');
  expect(evaluated('String(type (uint32) => uint32);')).toBe('(uint.<32>) => uint.<32>');
  // A value typed by one spelling is accepted where the other is required.
  expect(ok('interface I { (uint32): uint32 } type F = { (uint32): uint32 }; function g(f: F) { return f; } function h(i: I) { return g(i); } h((x) => x);')).toBe(true);
  expect(ok('interface I { (uint32): uint32 } type F = { (uint32): uint32 }; function g(i: I) { return i; } function h(f: F) { return g(f); } h((x) => x);')).toBe(true);
});

test('a generic call signature, and a callable interface in a union without parentheses', () => {
  expect(evaluated('interface Id { <T>(x: T): T } function f(i: Id) { return i(5); } String(f((x) => x));')).toBe('5');
  // README 1196: "The interface spelling of a call signature is bounded by its
  // braces, so it needs none" - where the arrow form would.
  expect(evaluated('interface I { (uint32): uint32 } let b: I | null = null; String(b);')).toBe('null');
  expect(evaluated('let b: { (uint32 | null): uint32; } | null = null; String(b);')).toBe('null');
});

test('mixing call signatures with named members is the clause\'s type error, in both spellings', () => {
  expectStaticTypeError('interface M { (uint32): uint32; x: string; }');
  expectStaticTypeError('type M = { (uint32): uint32; x: string };');
  // A call signature beside an index signature, likewise.
  expectStaticTypeError('interface M { (uint32): uint32; [k: string]: uint32; }');
});

test('an unnamed parameter prints as its type alone', () => {
  // It printed `(: uint.<32>) => uint.<32>` - an empty name before the colon.
  expect(evaluated('String(type (uint32) => uint32);')).toBe('(uint.<32>) => uint.<32>');
  expect(evaluated('String(type (x: uint32, y?: string) => void);')).toBe('(x: uint.<32>, y?: string) => void');
  expect(evaluated('String(type (...[].<uint8>) => void);')).toBe('(...[].<uint.<8>>) => void');
});
