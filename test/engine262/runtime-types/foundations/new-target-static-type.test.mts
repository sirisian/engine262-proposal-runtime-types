import { test, expect } from 'vitest';
import { evaluated, ok } from '../harness.mts';

// ---------------------------------------------------------------------------
// `new.target` HAS THE ~any~ TYPE, DELIBERATELY.
//
// `#sec-static-type`'s table says so, and the reason is not that nobody got to
// it. Its value is a constructor or *undefined*, and the constructor is NOT
// bounded by the enclosing function - `Reflect.construct(t, a, newTarget)`
// supplies an arbitrary one - so a type naming the enclosing class or a subclass
// is unsound. The honest type is a union with *undefined*, and a union with
// *undefined* cannot have its members read without NARROWING, which this
// specification defines only for references. `new.target` is a meta-property.
//
// So this file PINS the behaviour rather than asserting an absence: every
// program below runs today, and the union type that looks correct would refuse
// the fourth. Whoever adds narrowing for meta-properties - `import.meta` has the
// same shape - should type `new.target` as
// `((...args: [].<any>) => any) | undefined` and this file becomes the
// acceptance suite for that change.
// ---------------------------------------------------------------------------

test('the guard and both identity forms', () => {
  expect(evaluated('function f() { if (new.target === undefined) { return "call"; } return "new"; } f();')).toBe('call');
  expect(evaluated('function g() { return new.target === g; } let r = "no"; function probe() { r = String(new.target === probe); } new probe(); r;')).toBe('true');
  // The abstract-base idiom, which is what `new.target` chiefly exists for.
  expect(evaluated('class B { constructor() { if (new.target === B) { throw new TypeError("abstract"); } } } class D extends B { } String(new D() instanceof B);')).toBe('true');
});

test('the member read that a union type would refuse', () => {
  // THE ROW THAT DECIDES THE DESIGN. Under a union with *undefined* this is
  // `"name" is not declared by every member`, because the truthiness test
  // cannot narrow a meta-property.
  expect(evaluated('function h() { return new.target ? new.target.name : "none"; } h();')).toBe('none');
  expect(evaluated('let seen = "?"; function h2() { seen = new.target ? new.target.name : "none"; } new h2(); seen;')).toBe('h2');
});

test('the value escapes the frame, and an arrow inherits it', () => {
  expect(evaluated('class C { constructor() { this.k = new.target; } } String(typeof new C().k);')).toBe('function');
  expect(evaluated('let r = "no"; function k() { const inner = () => new.target; r = String(inner() === k); } new k(); r;')).toBe('true');
});

test('the constructor is NOT bounded by the enclosing function', () => {
  // This is why a precise type is unsound: `Zed` is unrelated to `probe`.
  expect(evaluated('class Zed { } let seen = "?"; function probe() { seen = String(new.target === Zed); } Reflect.construct(probe, [], Zed); seen;')).toBe('true');
  expect(evaluated('class Zed { } let nm = "?"; function probe() { nm = new.target.name; } Reflect.construct(probe, [], Zed); nm;')).toBe('Zed');
});

test('contexts that can never construct see undefined', () => {
  expect(evaluated('function m() { return new.target === undefined; } String(m());')).toBe('true');
  expect(evaluated('class N { m() { return new.target === undefined; } } String(new N().m());')).toBe('true');
});
