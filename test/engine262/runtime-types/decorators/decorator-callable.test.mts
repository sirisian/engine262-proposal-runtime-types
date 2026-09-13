import { expect, test } from 'vitest';
import { expectThrown, ok } from '../harness.mts';

/**
 * A decorator is an ordinary expression, and no judgment reached one: the
 * identifier `Decorator` appeared nowhere in check.mts, so `@f` and `@g(x)`
 * were unchecked everywhere.
 *
 * A decorator is CALLED - #sec-decorator-application invokes it with the
 * context - so `@n` for a `uint8` n is the mistake `n()` is. It needs saying
 * separately because `@n` is a MEMBER EXPRESSION rather than a call and reaches
 * no call rule.
 */

const dead = (source: string) => `function __never() { ${source} }`;

test('a decorator must be callable', () => {
  expectThrown(dead('let n: uint8 = uint8(1); class A { @n a: uint8 = uint8(1); }'),
    'is not callable');
  expectThrown(dead('let s: string = "x"; class A { @s a: uint8 = uint8(1); }'),
    'is not callable');
  // On a method as well as a field, and on the class itself.
  expectThrown(dead('let n: uint8 = uint8(1); class A { @n m() { } }'), 'is not callable');
  expectThrown(dead('let n: uint8 = uint8(1); @n class A { }'), 'is not callable');
});

test('the ordinary decorators are untouched', () => {
  expect(ok(dead('function f(c) { } class A { @f a: uint8 = uint8(1); }'))).toBe(true);
  expect(ok(dead('function f(c) { } class A { @f m() { } }'))).toBe(true);
  expect(ok(dead('function g() { return (c) => c; } class B { @g() x: uint8 = uint8(1); }'))).toBe(true);
  expect(ok(dead('const o = { f(c) { } }; class A { @o.f a: uint8 = uint8(1); }'))).toBe(true);
});

test('a decorator WRITTEN WITH ARGUMENTS has them judged', () => {
  // The written arguments are an ordinary argument list once the implicit
  // context is accounted for, so a wrong type among them is refused.
  expectThrown(dead('function g(n: uint8) { return (c) => c; }'
    + ' class C { @g("s") x: uint8 = uint8(1); }'), 'not assignable');
  expect(ok(dead('function g(n: uint8) { return (c) => c; }'
    + ' class C { @g(uint8(1)) x: uint8 = uint8(1); }'))).toBe(true);
});

test('the CONTEXT lands last, and is not demanded of the call', () => {
  // #sec-decorator-application appends the CONTEXT as a trailing argument, so
  // `@f(7)` on `f(n: uint8, c: Reflect.ClassField)` supplies both.
  //
  // It lands LAST, not next, which a DEFAULT before it is what shows: `@f()` on
  // `f(n: uint8 = 5, c: Reflect.ClassField)` fills `n` from its default and `c`
  // from the context. Counting the context as "one more supplied" fills the
  // wrong slot there; the final parameter being satisfied is the right model.
  expect(ok('let got = "never";'
    + ' function f(n: uint8, c: Reflect.ClassField) { got = String(n) + ":" + String(c.name); }'
    + ' class A { @f(7) a: uint8; } got;')).toBe(true);
  expect(ok('const l = []; function f(c: Reflect.ClassField) { l.push(String(c.name)); }'
    + ' class A { @f a: uint8; @f() b: uint8; } l.join(",");')).toBe(true);
});

test('a DEFAULT before the context still leaves the context last', () => {
  expect(ok('let got = "never";'
    + ' function f(n: uint8 = 5, c: Reflect.ClassField) { got = String(n) + ":" + String(c.name); }'
    + ' class A { @f() a: uint8; } got;')).toBe(true);
});

test('a decorator that RETURNS a non-function is not a mistake', () => {
  // There is no factory model here. sec-decorator-application: "giving one an
  // argument is editing its parameter list rather than rewriting it into a
  // factory", and `@f` and `@f()` are one form. So `@g()` calls `g` with the
  // context and `g`'s return is applied to nothing - a `uint8` return is as
  // ordinary as no return.
  //
  // This was reported as a finding, on the strength of the JS decorators
  // factory model rather than this one. The run time accepts it, which is what
  // withdrew it.
  expect(ok('function g(): uint8 { return uint8(1); }'
    + ' class B { @g() x: uint8 = uint8(1); } "ok";')).toBe(true);
  expect(ok('function g(c: Reflect.ClassField): uint8 { return uint8(1); }'
    + ' class B { @g x: uint8 = uint8(1); } "ok";')).toBe(true);
});
