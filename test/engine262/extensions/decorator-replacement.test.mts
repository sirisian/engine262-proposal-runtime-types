import { test, expect } from 'vitest';
import { evaluated } from '../readme/harness.mts';

/**
 * PLAN-decorators.md stage H, the REPLACEMENT half.
 *
 * decorators.md: "Decorators can optionally return a replacement for the
 * decorated target. If a decorator returns `void` (or `undefined`), no
 * replacement occurs. If it returns a value, that value replaces the original
 * target."
 *
 * The table is CLOSED, and the closing sentence is as much of the feature as
 * the table: "Decorators that describe sub-targets (parameters, returns) or
 * structural positions (blocks, enums, tuples, records, let, const) do not
 * support return replacement." A returned value in those positions is
 * discarded, not applied somewhere plausible.
 */

test('a method is replaced by what its decorator returns', () => {
  expect(evaluated('function rep(c) { return function() { return "replaced"; }; } '
    + 'class A { @rep m() { return "original"; } } (new A()).m();')).toBe('replaced');
  // Returning nothing replaces nothing, which is the half that keeps every
  // existing decorator working.
  expect(evaluated('function nop(c) {} class A { @nop m() { return "original"; } } (new A()).m();')).toBe('original');
  // Explicit `undefined` is the same as returning nothing - the clause names
  // both, and a check for "returned a value at all" would differ here.
  expect(evaluated('function nop(c) { return undefined; } class A { @nop m() { return "original"; } } (new A()).m();')).toBe('original');
});

test('a getter and a setter replace their own half of the pair', () => {
  expect(evaluated('function rep(c) { return function() { return 42; }; } '
    + 'class A { @rep get v() { return 1; } } String(new A().v);')).toBe('42');
  // THE HALF THAT IS EASY TO DROP: a getter and a setter of one name share one
  // property, so replacing the getter must carry the setter across. Without
  // that, decorating the getter would silently delete the setter.
  const pair = 'function rep(c) { return function() { return 42; }; } '
    + 'class A { @rep get v(): uint8 { return 1; } set v(x: uint8) { this.stored = x; } } ';
  expect(evaluated(`${pair} const o = new A(); o.v = 7; String(o.stored) + "/" + String(o.v);`)).toBe('7/42');
});

test('a class is replaced, and the BINDING is what takes it', () => {
  // A class declaration's binding is already initialized by the time its
  // decorators run, so the replacement is written back through it - assigning a
  // local would replace nothing, because every later reference resolves the
  // name again.
  expect(evaluated('function rep(c) { return class { tag() { return "replaced"; } }; } '
    + '@rep class A { tag() { return "original"; } } (new A()).tag();')).toBe('replaced');
  expect(evaluated('function nop(c) {} @nop class A { tag() { return "original"; } } (new A()).tag();')).toBe('original');
  // The ordering rule still holds around it: members apply before the class.
  expect(evaluated('const l = []; function m(c) { l.push("member"); } function cls(c) { l.push("class"); } '
    + '@cls class A { @m x: uint8 = 1; } l.join(",");')).toBe('member,class');
});

test('replacements CHAIN, innermost first', () => {
  // "Decorators are applied innermost first, and in reverse source order", so
  // with `@outer @inner` the inner one replaces first and the outer one's
  // replacement is what survives. The log and the result are asserted together,
  // because either alone would pass with the order reversed.
  const stacked = 'const l = []; '
    + 'function outer(c) { l.push("outer"); return function() { return "outer"; }; } '
    + 'function inner(c) { l.push("inner"); return function() { return "inner"; }; } '
    + 'class A { @outer @inner m() { return "orig"; } } ';
  expect(evaluated(`${stacked} (new A()).m() + "|" + l.join(",");`)).toBe('outer|inner,outer');
});

test('the positions the table EXCLUDES do not replace', () => {
  // "Decorators that describe sub-targets (parameters, returns) or structural
  // positions ... do not support return replacement." A returned value is
  // discarded rather than applied somewhere plausible - which is the failure
  // mode a permissive implementation would have.
  expect(evaluated('function rep(c) { return 99; } class A { m(@rep p: uint8) { return "original"; } } (new A()).m(1);')).toBe('original');
  expect(evaluated('function rep(c) { return 99; } class A { m(p: uint8): @rep uint8 { return 1; } } String((new A()).m(1));')).toBe('1');
  expect(evaluated('let n = 0; function rep(c) { return 99; } @rep let x = 5; String(x);')).toBe('5');
  expect(evaluated('function rep(c) { return 99; } @rep { let a = 1; } "block ran";')).toBe('block ran');
});

test('PINNED: what the replacement half does not yet cover', () => {
  // The table's remaining rows. Each is a different INSTALL point rather than a
  // different rule, which is why they are separable: a field's replacement is
  // its initial VALUE (not a function, unlike TC39's), an accessor's is a
  // `{ get, set }` pair, an operator's has to go back into the operator table,
  // and the Function and Object families have their own definition sites.
  expect(evaluated('function rep(c) { return 99; } class A { @rep a: uint8 = 1; } String(new A().a);')).toBe('1');
  expect(evaluated('function rep(c) { return { get() { return 42; }, set(v) {} }; } '
    + 'class A { @rep accessor a: uint8 = 1; } String(new A().a);')).toBe('1');
  expect(evaluated('function rep(c) { return function() { return "replaced"; }; } '
    + '@rep function f() { return "original"; } f();')).toBe('original');
  expect(evaluated('function rep(c) { return function() { return "replaced"; }; } '
    + 'const o = { @rep m() { return "original"; } }; o.m();')).toBe('original');
});
