import { expect, test } from 'vitest';
import { expectThrown, ok } from '../harness.mts';

/**
 * Spec: #sec-type-errors. A determinable type violation is an Early Error, so
 * it fires whether or not the code runs. Calling a value whose type has no call
 * signature, constructing one that is not a constructor, and instantiating an
 * `abstract` class are each written down on both sides - the type at the
 * declaration, the operation at the use - and were the run time's "n is not a
 * function", "1 (typed) is not a constructor" and "$1 is an abstract class and
 * cannot be instantiated".
 *
 * Every case below sits inside a function that is never called, so a rule that
 * fires only at run time does not pass this file.
 */

const dead = (source: string) => `function __never() { ${source} }`;

test('a value of a primitive type is not callable', () => {
  expectThrown(dead('let n: uint8 = uint8(1); let q = n();'), 'is not callable');
  expectThrown(dead('let s: string = "x"; let q = s();'), 'is not callable');
  expectThrown(dead('let b: boolean = true; let q = b();'), 'is not callable');
  // A member whose declared type is a primitive is the same question.
  expectThrown(dead('class C { x: uint8 = uint8(1); } let c: C = new C(); let q = c.x();'),
    'is not callable');
});

test('a value of a primitive type is not a constructor', () => {
  expectThrown(dead('let n: uint8 = uint8(1); let q = new n();'), 'is not a constructor');
  expectThrown(dead('let s: string = "x"; let q = new s();'), 'is not a constructor');
});

test('an abstract class cannot be instantiated', () => {
  expectThrown(dead('abstract class A { abstract m(): uint8; } let a = new A();'),
    'abstract class');
  expectThrown(dead('abstract class A { x: uint8 = uint8(1); constructor() {} } let a = new A();'),
    'abstract class');
  // A concrete subclass is the point of the modifier, and `super()` reaches the
  // abstract base legitimately.
  expect(ok(dead('abstract class A { abstract m(): uint8; }'
    + ' class B extends A { m(): uint8 { return uint8(1); } } let q = new B();'))).toBe(true);
  expect(ok(dead('abstract class A { x: uint8 = uint8(1); }'
    + ' class B extends A { constructor() { super(); } } let q = new B();'))).toBe(true);
  // Reached through a BINDING the class is not named, and the run time answers.
  expect(ok(dead('abstract class A { abstract m(): uint8; } const K = A; let a = new K();'))).toBe(true);
});

test('what callability does not reach', () => {
  // A CONVERSION's callee names a type, whose Static Type is an object rather
  // than the primitive it denotes.
  expect(ok(dead('let q = uint32(1);'))).toBe(true);
  expect(ok(dead('let q = string(1);'))).toBe(true);

  // Ordinary callables, and the two escapes that must stay open.
  expect(ok(dead('function f(): uint8 { return uint8(1); } let q = f();'))).toBe(true);
  expect(ok(dead('class C { m(): uint8 { return uint8(1); } } let q = new C().m();'))).toBe(true);
  expect(ok(dead('interface F { (): uint8 } function g(f: F) { return f(); }'))).toBe(true);
  expect(ok(dead('function h(cb: () => uint8) { return cb(); }'))).toBe(true);
  expect(ok(dead('let a: any = () => 1; let q = a();'))).toBe(true);
  expect(ok(dead('let u = () => 1; let q = u();'))).toBe(true);

  // A library method, and a construction of a library or user class.
  expect(ok(dead('let a: [].<uint8> = []; let q = a.map((x) => x);'))).toBe(true);
  expect(ok(dead('let s: string = "x"; let q = s.charAt(0);'))).toBe(true);
  expect(ok(dead('let m = new Map.<string, uint8>();'))).toBe(true);
  expect(ok(dead('let e = new Error("x");'))).toBe(true);
  expect(ok(dead('sealed class S { x: uint8 = uint8(1); } let q = new S();'))).toBe(true);

  // A COMPUTED member callee is not asked. `a[Symbol.iterator]` reads a
  // well-known method, and the element-read rules type a computed access on an
  // array as its ELEMENT whatever the key is, so the callee comes back
  // `uint.<8>`. The element typing is what is wrong there, not the call.
  expect(ok(dead('let a: [].<uint8> = []; let q = a[Symbol.iterator]();'))).toBe(true);
  expect(ok(dead('let q = [2][Symbol.iterator]();'))).toBe(true);

  // A generic class's own name inside a static field: typing the target would
  // reach the rule that refuses a bare generic, which this judgment must not
  // provoke.
  expect(ok('class Box<T> { x: uint8; static default = new Box(); } "ok";')).toBe(true);
});

test('an OBJECT is not callable either', () => {
  // The rule was held to primitives because "an object or a nominal may carry
  // call signatures". The record shapes say which do: only a ~function~ record
  // has [[Signatures]], and `callableForm` has already unwrapped a nominal whose
  // Structure is one. A structure still an ~object~ after that carries no call
  // signature.
  expectThrown(dead('class C { } let c: C = new C(); let q = c();'), 'is not callable');
  expectThrown(dead('class C { x: uint8 = uint8(1); } let c: C = new C(); let q = c();'),
    'is not callable');
  expectThrown(dead('let o: { a: uint8 } = { a: uint8(1) }; let q = o();'), 'is not callable');
  expectThrown(dead('interface I { a: uint8 } function g(i: I) { let q = i(); }'),
    'is not callable');
});

test('everything that CAN be called still is', () => {
  // A callable interface has become a ~function~ and is not reached.
  expect(ok(dead('interface F { (): uint8 } function g(f: F) { return f(); }'))).toBe(true);
  expect(ok(dead('let o: { (): uint8 } = (() => uint8(1)); let q = o();'))).toBe(true);
  expect(ok(dead('let f: () => uint8 = () => uint8(1); let q = f();'))).toBe(true);
  expect(ok(dead('class C { } let q = new C();'))).toBe(true);
  expect(ok(dead('let a: any = () => 1; let q = a();'))).toBe(true);

  // KNOWN LIMIT: a LIBRARY nominal is still the run time's - `new Map()` then
  // `m()` - its structure not being an ~object~ record for this test to see.
  expect(ok(dead('let m: Map.<string, uint8> = new Map(); let q = m();'))).toBe(true);
});
