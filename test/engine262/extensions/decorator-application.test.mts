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
  // The class-level position WAS refused here, and stage B (cycle 117) removed
  // that refusal deliberately - which is what the assertion was for. It now
  // asserts the opposite, and the two lines together are the record that the
  // opening was intended rather than accidental.
  expect(evaluated('let k; function f(c) { k = c.kind; } @f class A {} k;')).toBe('Class');
});

test('the class family: contexts exist and carry their declaration', () => {
  // Stage B of PLAN-decorators.md. decorators.md's `ClassReflection` is `name`,
  // `type`, `abstract`, `metadata`; `ClassFieldReflection` adds `static`,
  // `private`, `protected`, `readonly`, `initial`, and the layout pair.
  expect(evaluated('[typeof Reflect.Class, typeof Reflect.ClassMethod, typeof Reflect.ClassGetter, typeof Reflect.ClassSetter, typeof Reflect.ClassAccessor, typeof Reflect.ClassOperator].join(",");')).toBe('object,object,object,object,object,object');

  // A class decorator sees the class ITSELF, not a description of one.
  expect(evaluated('let t; function f(c) { t = c.type; } @f class A {} String(t === A);')).toBe('true');
  expect(evaluated('let k; function f(c) { k = c.kind + ":" + String(c.name); } @f class A {} k;')).toBe('Class:A');

  // The widened ClassField carries the declaration, not only the layout.
  const field = 'let c; function f(x) { c = x; } class A { @f static s: uint8; } ';
  expect(evaluated(`${field} Object.getOwnPropertyNames(c).join(",");`)).toBe('kind,name,static,private,protected,readonly,type,classContext');
  expect(evaluated(`${field} String(c.static) + "/" + String(c.private) + "/" + String(c.type === uint8);`)).toBe('true/false/true');
  expect(evaluated('let c; function f(x) { c = x; } class B { @f #p: uint8; } String(c.private);')).toBe('true');

  // "classContext: Reflect.Class.<TClass>" — a member's context carries its
  // class's, which is what lets one decorator reach the declaration it belongs
  // to without the class having to pass itself.
  expect(evaluated('let c; function f(x) { c = x; } class Named { @f a: uint8; } c.classContext.kind + ":" + String(c.classContext.name);')).toBe('Class:Named');
});

test('members apply before their container, in document order', () => {
  // decorators.md "Order": "Members apply before their container, in document
  // order, and the container's own decorators apply last. A class decorator
  // sees a FINISHED CLASS, including whatever its fields' and methods'
  // decorators did."
  //
  // One equality on the whole log again: a membership check would pass with the
  // class running first, which is the arrangement the rule exists to forbid.
  const both = 'const log = []; '
    + 'function cls(c) { log.push("class:" + String(c.name)); } '
    + 'function fld(c) { log.push("field:" + String(c.name) + "@" + String(c.classContext.name)); } '
    + '@cls class B { @fld b: uint8; @fld c: uint8; } ';
  expect(evaluated(`${both} log.join(",");`)).toBe('field:b@B,field:c@B,class:B');

  // And the two rules compose: reverse source order WITHIN a declaration,
  // document order ACROSS declarations, container last.
  const composed = 'const log = []; function tag(n) { return (c) => log.push(n); } '
    + '@tag("C2") @tag("C1") class A { @tag("f2") @tag("f1") a: uint8; @tag("g") b: uint8; } ';
  expect(evaluated(`${composed} log.join(",");`)).toBe('f1,f2,g,C1,C2');
});
