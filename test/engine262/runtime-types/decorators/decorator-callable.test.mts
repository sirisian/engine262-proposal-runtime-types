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

test('the FACTORY form is not judged as an ordinary call', () => {
  // #sec-decorator-application appends the CONTEXT as a trailing argument, so
  // `@f(7)` on `f(n: uint8, c: Reflect.ClassField)` supplies both. Walking the
  // call as an ordinary one reported `c` as not supplied, and five tests said
  // so. Judging a decorator call needs that implicit argument modelled.
  expect(ok('let got = "never";'
    + ' function f(n: uint8, c: Reflect.ClassField) { got = String(n) + ":" + String(c.name); }'
    + ' class A { @f(7) a: uint8; } got;')).toBe(true);
  expect(ok('const l = []; function f(c: Reflect.ClassField) { l.push(String(c.name)); }'
    + ' class A { @f a: uint8; @f() b: uint8; } l.join(",");')).toBe(true);
});
