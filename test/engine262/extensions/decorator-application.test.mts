import { test, expect } from 'vitest';
import { evaluated, expectThrown, expectThrownKind } from '../readme/harness.mts';

/**
 * proposal-runtime-types, decorators.md — stage A of PLAN-decorators.md: the
 * decorator CALL. The contexts themselves are stage B onward; what this stage
 * settles is that a decoration finds its function, evaluates and applies it in
 * the specified order, and hands it a context.
 *
 * Only `ClassField` exists as a context today, so everything here is verified
 * on a field. The class-level position is still refused, and that refusal is
 * asserted rather than assumed — a stage that quietly opened more than it
 * claimed would look identical until stage B contradicted it.
 */

test('a decorator on a class field is found and called', () => {
  expect(evaluated('const log = []; function f(c) { log.push("f:" + String(c.name)); } class A { @f a: uint8; } log.join(",");')).toBe('f:a');
  // "A bare `@f` and an empty `@f()` are equivalent" — the second evaluates to
  // the function the call returns, and by the time a decorator is applied both
  // forms are one thing called with the context alone.
  expect(evaluated('const l = []; function g() { return (c) => l.push("called:" + String(c.name)); } class B { @g() x: uint8; } l.join(",");')).toBe('called:x');
  // The context identifies what was decorated. The rest of decorators.md's
  // ClassFieldReflection — type, static, private, readonly, initial, offset,
  // metadata — is stage B; `kind` and `name` are what stage A needs to show the
  // right declaration reached the right decorator.
  expect(evaluated('let k; function f(c) { k = c.kind; } class A { @f a: uint8; } k;')).toBe('ClassField');
  // Each field's own decoration, in document order.
  expect(evaluated('const log = []; function f(c) { log.push(String(c.name)); } class A { @f a: uint8; @f b: uint8; } log.join(",");')).toBe('a,b');
});

test('decorators evaluate top-down and apply bottom-up', () => {
  // decorators.md "Order": "Decorator expressions are evaluated in document
  // order ... Decorators are applied innermost first, and in reverse source
  // order." Two phases running in OPPOSITE directions, which is TC39's rule and
  // Python's `@a @b def f` == `a(b(f))`.
  //
  // THE ASSERTION THAT MATTERS is one equality on the whole log. A test that
  // checked membership, or checked each phase separately, would pass with the
  // phases collapsed into one — which is the mistake the two-phase rule exists
  // to prevent, since `@a(f()) @b(g()) x` must call `f()` before `g()` while
  // applying `b` before `a`.
  const stacked = 'const log = []; function tag(n) { log.push("eval:" + n); return (c) => log.push("apply:" + n); } '
    + 'class A { @tag("outer") @tag("inner") a: uint8; } ';
  expect(evaluated(`${stacked} log.join(",");`)).toBe('eval:outer,eval:inner,apply:inner,apply:outer');
});

test('a reserved layout control and a user decorator share one field', () => {
  // #sec-memory-layout: the controls are "recognized syntactically and never
  // evaluated", so `@align(4)` is not a function call and has no expression to
  // evaluate. That is what lets one field carry both, and NEITHER MAY CONSUME
  // THE OTHER: the control still places the field and the decorator still fires.
  const both = 'const log = []; function audit(c) { log.push("audit:" + String(c.name)); } '
    + 'class A { @align(4) @audit a: uint8; b: uint32; } ';
  expect(evaluated(`${both} log.join(",");`)).toBe('audit:a');
  expect(evaluated(`${both} String(Reflect.getReflection.<Reflect.ClassField, A>("b").offset);`)).toBe('4');
  // A control alone still evaluates no expression — there is no binding named
  // `packed` and it does not need one. (`packed` is a CLASS control, so it goes
  // on the class; a class control written in a field position is simply not the
  // control, which is why the byteLength below is the packed 3 and not 4.)
  expect(evaluated('@packed class A { a: uint8; b: uint16; } String((type A).byteLength);')).toBe('3');
});

test('what stage A does not open', () => {
  // A decorator has to BE a function. `@notFn` where the binding holds 5 is a
  // TypeError at the decorated declaration rather than a silent no-op.
  expectThrownKind('const notFn = 5; class C { @notFn y: uint8; }', 'TypeError');
  // The class-level position is still refused: `Reflect.Class` does not exist
  // and stage A does not invent it. Asserted so that stage B has to remove this
  // deliberately rather than discover it already gone.
  expectThrown('function f(c) {} @f class A {}');
});
