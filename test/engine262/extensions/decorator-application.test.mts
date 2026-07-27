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

test('each member position takes its own context', () => {
  // decorators.md distinguishes a method from a getter from a setter by CONTEXT
  // TYPE rather than by a `kind` string the decorator has to test — which is
  // the whole reason the contexts are separate types. So the assertion is that
  // the POSITION selects the context, not that a decorator can tell them apart.
  const members = 'const log = []; function tag(c) { log.push(c.kind + ":" + String(c.name)); } '
    + 'class A { @tag m() {} @tag get g() { return 1; } @tag set s(v) {} @tag static st() {} } ';
  expect(evaluated(`${members} log.join(",");`)).toBe('ClassMethod:m,ClassGetter:g,ClassSetter:s,ClassMethod:st');
  // `static` is on the context, so a static method is a ClassMethod that says so.
  expect(evaluated('let c; function grab(x) { c = x; } class A { @grab static m() {} } String(c.static);')).toBe('true');
  // A method's context carries the same `classContext` a field's does.
  expect(evaluated('let c; function grab(x) { c = x; } class Named { @grab m() {} } c.classContext.kind + "/" + String(c.classContext.name);')).toBe('Class/Named');
  expect(evaluated('let c; function grab(x) { c = x; } class A { @grab m() {} } Object.getOwnPropertyNames(c).join(",");')).toBe('kind,name,static,private,abstract,classContext');

  // MIXED members fire in document order and the class still comes last, which
  // is the composition the ordering rule promises across kinds rather than
  // within one.
  const mixed = 'const log = []; function tag(n) { return (c) => log.push(n + "(" + c.kind + ")"); } '
    + '@tag("C") class A { @tag("f") a: uint8; @tag("m") m() {} @tag("g") get g() { return 1; } } ';
  expect(evaluated(`${mixed} log.join(",");`)).toBe('f(ClassField),m(ClassMethod),g(ClassGetter),C(Class)');
});

test('a decorated operator has a context but no grammar', () => {
  // `Reflect.ClassOperator` exists and `memberContextKind` selects it, but the
  // GRAMMAR admits no decorator before `operator`: `@f operator +(rhs: T): T`
  // is a SyntaxError while the same operator without a decorator parses.
  //
  // Pinned as a gap rather than left to be discovered. The context is built and
  // reachable the moment the grammar admits the position, so this is a parser
  // change and not a semantics one.
  expect(evaluated('class Op { operator +(rhs: Op): Op { return this; } } "parses";')).toBe('parses');
  expectThrown('function f(c) {} class Op { @f operator +(rhs: Op): Op { return this; } }');
});

test('sub-targets: parameters and returns apply before their declaration', () => {
  // Stage C of PLAN-decorators.md. decorators.md writes the positions as
  // `d(@f a: uint32): @f uint32` — a decorator before the parameter, and before
  // the return TYPE. Neither position parsed before this stage, so this is a
  // grammar change as much as a semantics one.
  //
  // decorators.md "Order": "A declaration's sub-targets apply before the
  // declaration itself: parameter decorators in parameter order, then the
  // return's, then the method's own."
  const method = 'const log = []; function tag(n) { return (c) => log.push(n + "(" + c.kind + (c.index !== undefined ? ":" + c.index : "") + ")"); } '
    + 'class A { @tag("m") d(@tag("p0") a: uint32, @tag("p1") b: uint32): @tag("ret") uint32 { return a; } } ';
  expect(evaluated(`${method} log.join(",");`)).toBe('p0(ClassMethodParameter:0),p1(ClassMethodParameter:1),ret(ClassMethodReturn),m(ClassMethod)');

  // Parameters run LEFT TO RIGHT within a declaration. The reverse-source-order
  // rule applies within ONE decorated position, not across positions — which is
  // why the index assertion above matters: `p0` before `p1` and both before the
  // return is the only arrangement consistent with "in parameter order".

  // An accessor's sub-targets take their own contexts: a getter has a return
  // and no parameter, a setter a parameter and no return worth naming, which is
  // why decorators.md gives a ClassSetterParameter and no ClassSetterReturn.
  const accessors = 'const log = []; function tag(n) { return (c) => log.push(n + "(" + c.kind + ")"); } '
    + 'class A { @tag("g") get g(): @tag("gret") uint8 { return 1; } @tag("s") set s(@tag("sp") v: uint8) {} } ';
  expect(evaluated(`${accessors} log.join(",");`)).toBe('gret(ClassGetterReturn),g(ClassGetter),sp(ClassSetterParameter),s(ClassSetter)');

  // A sub-target reaches the declaration it is part of, as a member reaches its
  // class.
  expect(evaluated('let c; function grab(x) { c = x; } class A { m(@grab p: uint8) {} } c.methodContext.kind + "/" + String(c.methodContext.name);')).toBe('ClassMethod/m');
});

test('the whole ordering rule composes across every level', () => {
  // THE TEST §6.2 OF THE PLAN ASKED FOR, for the class family: one program
  // decorating every position it legally can, one array, ONE EQUALITY on the
  // joined log.
  //
  // A membership check would pass with any of these four levels reordered,
  // which is the whole failure mode the ordering rule exists to prevent. The
  // sequence below is the one a reader of decorators.md's "Order" section would
  // predict, and if it ever stops reading that way the ORDER is wrong rather
  // than the test.
  const everything = 'const log = []; function t(n) { return (c) => log.push(n); } '
    + '@t("C2") @t("C1") '
    + 'class B { '
    + '  @t("f2") @t("f1") a: uint8; '
    + '  @t("m") m(@t("p") x: uint8): @t("r") uint8 { return x; } '
    + '  @t("g") get g(): @t("gr") uint8 { return 1; } '
    + '} ';
  expect(evaluated(`${everything} log.join(",");`)).toBe('f1,f2,p,r,m,gr,g,C1,C2');
});

test('the function family and bindings', () => {
  // Stage D of PLAN-decorators.md. `@f function g() {}` and `@f let x = 1;`
  // needed grammar too: `@` had routed unconditionally to a class declaration,
  // so the decorator list is now parsed first and what follows decides which
  // declaration it was.
  expect(evaluated('function f(c) {} @f function g() {} @f let x = 1; @f const y = 2; @f class A {} "all four parse";')).toBe('all four parse');

  // A function's sub-targets take the FUNCTION contexts, not the class ones.
  // Falling through to the class defaults would have been invisible to any
  // ordering test — the sequence is identical either way — so the kinds are
  // asserted, not just the order.
  const fn = 'const log = []; function tag(n) { return (c) => log.push(n + "(" + c.kind + ")"); } '
    + '@tag("fn") function g(@tag("p") x: uint8): @tag("r") uint8 { return x; } ';
  expect(evaluated(`${fn} log.join(",");`)).toBe('p(FunctionParameter),r(FunctionReturn),fn(Function)');
  // The context carries the function itself.
  expect(evaluated('let t; function grab(c) { t = c; } @grab function named() {} t.kind + "/" + String(t.name) + "/" + String(t.type === named);')).toBe('Function/named/true');

  // `Let` and `Const` are the first decorators on a STATEMENT rather than a
  // member, and they fire when the statement executes — so the binding's value
  // is already there to be described.
  expect(evaluated('let t; function grab(c) { t = c; } @grab let x = 41; t.kind + "/" + String(t.name) + "/" + String(Number(t.value));')).toBe('Let/x/41');
  expect(evaluated('let t; function grab(c) { t = c; } @grab const y = 7; t.kind + "/" + String(t.name) + "/" + String(Number(t.value));')).toBe('Const/y/7');
});

test('a decorated function declaration still hoists — a KNOWN DIVERGENCE', () => {
  // decorators.md "Order", written in cycle 115: "A DECORATED FUNCTION
  // DECLARATION DOES NOT HOIST. `@dec function f() {}` behaves as
  // `var f = @dec function () {};`" — because hoisting it would evaluate its
  // decorator expressions either before the bindings they reference exist or
  // out of document order, and TC39's function-decorators proposal reaches the
  // same answer having rejected four alternatives.
  //
  // THE ENGINE STILL HOISTS IT. The decorators fire at the written position, so
  // the EXPRESSION ORDER the rule protects is already right; what is not yet
  // enforced is the binding's absence above the declaration. Suppressing it
  // means skipping InstantiateFunctionObject at FIVE hoisting sites — Block,
  // GlobalDeclarationInstantiation, FunctionDeclarationInstantiation, the
  // global object, and modules — and doing some of them would be worse than
  // doing none, since the behaviour would differ by scope.
  //
  // Pinned here so the divergence from a rule this project itself wrote is
  // visible rather than discovered.
  expect(evaluated('function noop(c) {} const before = typeof d; @noop function d() { return 1; } before + "/" + typeof d;')).toBe('function/function');
  // An undecorated declaration hoists and must keep doing so.
  expect(evaluated('const r = h(); function h() { return "hoisted"; } r;')).toBe('hoisted');
});

test('the object family mirrors the class family', () => {
  // Stage E of PLAN-decorators.md, whose premise was: "structurally parallel to
  // B and C, which is the point: if B and C are right this is mechanical, and
  // if it is not mechanical then B or C generalized wrongly."
  //
  // Mostly mechanical, with ONE exception recorded below.
  const obj = 'const log = []; function tag(n) { return (c) => log.push(n + "(" + c.kind + ")"); } '
    + 'const o = @tag("O") { '
    + '  @tag("f") a: 1, '
    + '  @tag("m") m(@tag("p") x: uint32): @tag("r") uint32 { return x; }, '
    + '  @tag("g") get c(): @tag("gr") uint32 { return 1; }, '
    + '  @tag("s") set d(@tag("sp") v: uint32) {} '
    + '}; ';
  // Every context is its OWN, and members apply before the container.
  expect(evaluated(`${obj} log.join(",");`)).toBe(
    'f(ObjectField),p(ObjectMethodParameter),r(ObjectMethodReturn),m(ObjectMethod),'
    + 'gr(ObjectGetterReturn),g(ObjectGetter),sp(ObjectSetterParameter),s(ObjectSetter),O(Object)',
  );

  // THE ONE THING THAT DID NOT GENERALIZE, and the plan predicted the shape of
  // it: the sub-target mapping. An owner kind that does not name its own
  // parameter and return contexts silently borrows the CLASS ones — which is
  // invisible to an ordering test, since the sequence is identical either way.
  // Stage D hit it for `Function` and stage E hit it again for all three object
  // member kinds. Asserted by kind, not by order, which is the only way to see
  // it.
  expect(evaluated('let c; function grab(x) { c = x; } const o = { m(@grab p: uint32) {} }; c.kind;')).toBe('ObjectMethodParameter');
  expect(evaluated('let c; function grab(x) { c = x; } const o = { get g(): @grab uint32 { return 1; } }; c.kind;')).toBe('ObjectGetterReturn');
  expect(evaluated('let c; function grab(x) { c = x; } const o = { set s(@grab v: uint32) {} }; c.kind;')).toBe('ObjectSetterParameter');

  // "For objects the metadata is on the INSTANCE", so a member's context points
  // at the object rather than at a constructor.
  expect(evaluated('let c; function grab(x) { c = x; } const o = { @grab a: 1 }; String(typeof c.objectContext);')).toBe('object');

  // `@` in expression position no longer implies a class — the same dispatch
  // the statement position needed in stage D.
  expect(evaluated('function f(c) {} const a = @f class {}; const b = @f { x: 1 }; typeof a + "/" + typeof b;')).toBe('function/object');
});
