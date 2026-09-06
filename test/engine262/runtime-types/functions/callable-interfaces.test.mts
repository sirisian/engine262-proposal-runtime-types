import { test, expect } from 'vitest';
import { evaluated, ok, expectStaticTypeError, expectThrownKind, expectError } from '../harness.mts';

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

// ---------------------------------------------------------------------------
// PARAMETER DEFAULTS IN A FUNCTION TYPE, AND NAMED ARGUMENTS THROUGH A TYPED CALLEE.
//
// README, "Function Interfaces":
//   interface IExample { (string = '5', named: uint32); }
//   function f(a: IExample) { a(named: 10); }   // 10
//   f((a, b) => b);
//
// Two existing rules, applied to the signature the TYPE supplies. Named
// arguments bind against "the selected signature" (#sec-call-argument-binding)
// and are "a compact way to skip default parameters" (README); a type-level
// position may carry a default, as a tuple element does (`[uint8, uint32 =
// 10]`). Where the callee is reached through a binding whose declared type is a
// function type or a callable interface, that type's signature is the
// declaration in view - the implementer's own names are unknown and may differ,
// as README 1788 says - so the caller assembles the positional list from it:
// names map, skipped positions take the signature's defaults, an untyped
// primitive argument takes the parameter's type, and the implementer receives a
// full list. None of this existed: the grammar had no default, and a named call
// through a typed callee read the IMPLEMENTER's parameter names.
//
// Getting there required parameters to be typed BINDINGS at run time, which they
// were not: `function f(a: uint8) { a = g() }` was enforced nowhere for an
// untyped `g`, while the same assignment to a `let` was refused.
// ---------------------------------------------------------------------------

test('the README\'s example: a named argument through an interface, the default filled by the type', () => {
  expect(evaluated('interface IExample { (string = "5", named: uint32); } function f(a: IExample) { return a(named: 10); } String(f((a, b) => b));')).toBe('10');
  // The implementer receives the FULL positional list: the type's default first.
  expect(evaluated('interface IExample { (string = "5", named: uint32); } function f(a: IExample) { return a(named: 10); } String(f((a, b) => a + ":" + String(b)));')).toBe('5:10');
});

test('the default is evaluated once for the type and converted at the parameter\'s type', () => {
  expect(evaluated('interface I { (n: uint8 = 3, s: string); } function f(a: I) { return a(s: "x"); } String(f((n, s) => String(n is uint8) + "," + String(n)));')).toBe('true,3');
  // A function TYPE carries a default too, as its tuple of arguments would.
  expect(evaluated('let g: (x: uint8, y: uint8 = 9) => uint8 = (p, q) => p * q; String(g(x: 2));')).toBe('18');
  // A rest parameter takes no default.
  expectError('let f: (...a: [].<uint8> = []) => void;');
});

test('an untyped primitive argument takes the parameter\'s type, as at a declared parameter', () => {
  expect(evaluated('let g: (x: uint8, y: uint8 = 9) => boolean = (p, q) => p is uint8 && q is uint8; String(g(x: 2));')).toBe('true');
  expectThrownKind('interface I { (n: uint8, s: string); } function f(a: I) { return a(n: "x", s: "y"); } f((n, s) => n);', 'TypeError');
  // An object argument is passed as it is.
  expect(evaluated('interface I { (o: object, n: uint8 = 1); } function f(a: I) { const k = {}; return a(o: k) === k; } String(f((o, n) => o));')).toBe('true');
});

test('a required parameter left unfilled, and a name the signature lacks, are TypeErrors', () => {
  expectThrownKind('interface I { (a: uint8, b: uint8); } function f(x: I) { return x(b: 1); } f((a, b) => a);', 'TypeError');
  expectThrownKind('interface I { (a: uint8, b: uint8); } function f(x: I) { return x(c: 1); } f((a, b) => a);', 'TypeError');
});

test('positional calls through the type are unchanged, and a callee with no type in view reads its own names', () => {
  expect(evaluated('let g: (x: uint8, y: uint8 = 9) => uint8 = (p, q) => p * q; String(g(2, 3));')).toBe('6');
  expect(evaluated('function h(p: uint8, q: uint8 = 4) { return p * q; } String(h(p: 3));')).toBe('12');
});

test('a parameter is a typed binding at run time, as a let is', () => {
  // #sec-typed-bindings: "checked against its initializer and against every
  // later assignment". A parameter's binding carried no declared type, so a
  // reassignment through an untyped value was unchecked at run time.
  expectThrownKind('function f(a: uint8) { a = g(); } function g() { return "s"; } f(1);', 'TypeError');
  expect(evaluated('function f(a: uint8) { a = g(); return String(a is uint8); } function g() { return 5; } f(1);')).toBe('true');
  expect(evaluated('function id<T>(v: T) { return v; } String(id(3));')).toBe('3');
});
