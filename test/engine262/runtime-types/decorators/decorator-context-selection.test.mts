import { test, expect } from 'vitest';
import { evaluated } from '../harness.mts';

/**
 * PLAN-decorators-remaining.md section 6.1's THIRD ASSERTION: "it got the RIGHT
 * CONTEXT".
 *
 * The family matrices assert that a decorator RAN and that it saw the right
 * name. They do not assert WHICH context it received, because the fixtures use
 * an untyped `function tag(n, c)` that accepts anything. Selection by context
 * type has been available since cycle 130; these are the assertions that use
 * it.
 *
 * The difference matters: "a decorator ran" and "the RIGHT decorator ran" are
 * different claims, and only the second catches a context being built for the
 * wrong position - which is the defect shape this plan has met most often.
 */

test('a decorator SELECTS on the context it is given', () => {
  // Two overloads of one name, one per context. Which one fires is the
  // assertion - an untyped decorator would have accepted either and told us
  // nothing.
  expect(evaluated('const l = []; '
    + 'function f(c: Reflect.ClassField) { l.push("field"); } '
    + 'function f(c: Reflect.ClassMethod) { l.push("method"); } '
    + 'class A { @f a: uint8 = 1; @f m() {} } l.join(",");')).toBe('field,method');
});

test('each member position selects its OWN context, not a sibling\'s', () => {
  const decls = 'const l = []; '
    + 'function f(c: Reflect.ClassField) { l.push("field"); } '
    + 'function f(c: Reflect.ClassMethod) { l.push("method"); } '
    + 'function f(c: Reflect.ClassGetter) { l.push("getter"); } '
    + 'function f(c: Reflect.ClassSetter) { l.push("setter"); } '
    + 'function f(c: Reflect.ClassAccessor) { l.push("accessor"); } ';
  expect(evaluated(`${decls} class A { @f a: uint8 = 1; } l.join(",");`)).toBe('field');
  expect(evaluated(`${decls} class A { @f m() {} } l.join(",");`)).toBe('method');
  expect(evaluated(`${decls} class A { @f get g() { return 1; } } l.join(",");`)).toBe('getter');
  expect(evaluated(`${decls} class A { @f set s(v) {} } l.join(",");`)).toBe('setter');
  expect(evaluated(`${decls} class A { @f accessor c: uint8 = 1; } l.join(",");`)).toBe('accessor');
  // ALL FIVE in one class, in declaration order - the whole point of section 6.2's
  // all-positions fixture, and safe here because each position is ALSO asserted
  // alone above. A4's caveat: a fixture that decorates every position at once
  // is structurally blind to "fires only when a sibling is decorated", so it
  // must be an ADDITION to per-position tests, never a replacement.
  expect(evaluated(`${decls} class A { @f a: uint8 = 1; @f m() {} @f get g() { return 1; } `
    + '@f set s(v) {} @f accessor c: uint8 = 1; } l.join(",");')).toBe('field,method,getter,setter,accessor');
});

test('a SUB-TARGET selects its own context too', () => {
  const decls = 'const l = []; '
    + 'function f(c: Reflect.ClassMethodParameter) { l.push("param"); } '
    + 'function f(c: Reflect.ClassMethodReturn) { l.push("return"); } '
    + 'function f(c: Reflect.ClassMethod) { l.push("method"); } ';
  expect(evaluated(`${decls} class A { m(@f x: uint8) {} } l.join(",");`)).toBe('param');
  expect(evaluated(`${decls} class A { m(): @f uint8 { return uint8(1); } } l.join(",");`)).toBe('return');
  // A method decorated ALONGSIDE its sub-targets fires all three, each with its
  // own context - which is the case A4 records as having hidden a defect for
  // eleven cycles, because a sub-target only fired when its OWNER was decorated.
  expect(evaluated(`${decls} class A { @f m(@f x: uint8): @f uint8 { return uint8(1); } } l.join(",");`))
    .toBe('param,return,method');
  // And the sub-targets fire when the owner is NOT decorated, which is the
  // assertion that defect would have failed.
  expect(evaluated(`${decls} class A { m(@f x: uint8): @f uint8 { return uint8(1); } } l.join(",");`))
    .toBe('param,return');
});

test('a CLASS and a FUNCTION select their own contexts', () => {
  const decls = 'const l = []; '
    + 'function f(c: Reflect.Class) { l.push("class"); } '
    + 'function f(c: Reflect.Function) { l.push("function"); } '
    + 'function f(c: Reflect.ClassField) { l.push("field"); } ';
  expect(evaluated(`${decls} @f class A {} l.join(",");`)).toBe('class');
  expect(evaluated(`${decls} @f function h() {} l.join(",");`)).toBe('function');
  // A decorated class whose FIELD is also decorated fires both, members first -
  // decorators.md's ordering rule, asserted through context selection rather
  // than through a shared counter.
  expect(evaluated(`${decls} @f class A { @f a: uint8 = 1; } l.join(",");`)).toBe('field,class');
});
