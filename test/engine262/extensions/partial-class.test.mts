import { test, expect } from 'vitest';
import { evaluated, expectThrown, runFlagOff } from '../readme/harness.mts';

/**
 * The `partial class` extension.
 *
 * A `partial class` re-opens a class that is already declared, in the same
 * program or as an intrinsic, to add methods and operators to it (README "Class
 * Extension"). The `partial` keyword is required: it declares no new binding and
 * merges its members into the existing class, so a program cannot fork a class's
 * behaviour by an accidental re-declaration, which remains an error. Adding
 * behaviour this way is available even on a sealed class, since it introduces no
 * new subclass or case; only a mixin that would subclass a sealed class from
 * outside its module is refused.
 *
 * `partial` is a class modifier, written before `class` like `abstract`, `sealed`,
 * and `dynamic`. It is available only under the runtime types feature.
 */

// -- Adding members ------------------------------------------------------------
test('a partial class adds an instance method to an existing class', () => {
  expect(evaluated('class A { foo() { return "foo"; } } partial class A { bar() { return "bar"; } } let a = new A(); a.foo() + a.bar();')).toBe('foobar');
});

test('the original members remain after a partial extension', () => {
  expect(evaluated('class A { foo() { return 1; } } partial class A { bar() { return 2; } } let a = new A(); String(a.foo());')).toBe('1');
});

test('a partial class adds a static method', () => {
  expect(evaluated('class A {} partial class A { static make() { return "made"; } } A.make();')).toBe('made');
});

test('a partial method has access to instance state set by the original constructor', () => {
  expect(evaluated('class A { constructor() { this.x = 42; } } partial class A { getX() { return this.x; } } let a = new A(); String(a.getX());')).toBe('42');
});

test('several partial classes may extend the same class', () => {
  expect(evaluated('class A {} partial class A { a() { return "a"; } } partial class A { b() { return "b"; } } let o = new A(); o.a() + o.b();')).toBe('ab');
});

// -- Extending an intrinsic ----------------------------------------------------
test('a partial class can add a method to an intrinsic class', () => {
  expect(evaluated('partial class Array { second() { return this[1]; } } String([10, 20, 30].second());')).toBe('20');
});

// -- Sealed classes ------------------------------------------------------------
test('partial extension is available on a sealed class', () => {
  expect(evaluated('sealed class S { foo() { return 1; } } partial class S { bar() { return 2; } } String(new S().bar());')).toBe('2');
});

// -- Errors --------------------------------------------------------------------
test('a bare re-declaration of an existing class is rejected', () => {
  // without `partial`, re-declaring a class is an error, not a silent fork
  expectThrown('class A { foo() {} } class A { bar() {} } new A();');
});

test('a partial class over a name that is not a class is an error', () => {
  expectThrown('partial class Nope { foo() {} } new Nope();');
});

// -- Feature off ---------------------------------------------------------------
test('with the feature off, partial is not a class modifier', () => {
  const c = runFlagOff('class A {} partial class A { bar() {} } new A();') as { Type: string };
  expect(c.Type).toBe('throw');
});
