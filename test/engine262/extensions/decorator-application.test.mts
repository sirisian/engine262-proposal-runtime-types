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
  // #sec-decorator-application: "`@f` and `@f()` are ONE FORM: both resolve
  // with no explicit argument." Not because the empty call is evaluated and its
  // result applied - that was the TC39 FACTORY model, which this clause exists
  // to replace - but because a decoration calls its decorator ONCE, with the
  // written arguments and the context last, and `@f()` writes none.
  const oneForm = 'const l = []; function g(c) { l.push("called:" + String(c.name)); } ';
  expect(evaluated(`${oneForm} class B { @g() x: uint8; } l.join(",");`)).toBe('called:x');
  expect(evaluated(`${oneForm} class B { @g x: uint8; } l.join(",");`)).toBe('called:x');
  // The factory shape is no longer special: `@g()` calls `g` with the context
  // like any other decoration, so a `g` that ignores it and returns a function
  // has returned a value nobody asked for. Pinned because this is the behaviour
  // that CHANGED, and a reader of the old test should find the new answer where
  // the old one was.
  expect(evaluated('const l = []; function g() { return (c) => l.push("factory"); } class B { @g() x: uint8; } l.join(",");')).toBe('');
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
  //
  // With the factory gone the two phases are observed where the clause puts
  // them: phase one evaluates the decorator EXPRESSION, which now includes its
  // ARGUMENTS, and phase two calls. So an argument with a side effect records
  // the evaluation order while the decorator body records the application order
  // - a sharper test than the factory version, because what is being ordered in
  // phase one is exactly what the clause says is evaluated there.
  const stacked = 'const log = []; function ev(n) { log.push("eval:" + n); return n; } '
    + 'function tag(n, c) { log.push("apply:" + n); } '
    + 'class A { @tag(ev("outer")) @tag(ev("inner")) a: uint8; } ';
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
  expect(evaluated(`${field} Object.getOwnPropertyNames(c).join(",");`)).toBe('kind,name,static,private,protected,readonly,type,initial,offset,byteLength,metadata,classContext,addInitializer');
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
  const composed = 'const log = []; function tag(n, c) { log.push(n); } '
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
  expect(evaluated('let c; function grab(x) { c = x; } class A { @grab m() {} } Object.getOwnPropertyNames(c).join(",");')).toBe('kind,name,static,private,abstract,classContext,metadata,addInitializer');

  // MIXED members fire in document order and the class still comes last, which
  // is the composition the ordering rule promises across kinds rather than
  // within one.
  const mixed = 'const log = []; function tag(n, c) { log.push(n + "(" + c.kind + ")"); } '
    + '@tag("C") class A { @tag("f") a: uint8; @tag("m") m() {} @tag("g") get g() { return 1; } } ';
  expect(evaluated(`${mixed} log.join(",");`)).toBe('f(ClassField),m(ClassMethod),g(ClassGetter),C(Class)');
});

test('an operator takes its OWN decorator, which had no grammar', () => {
  // `Reflect.ClassOperator` existed and `memberContextKind` selected it, and
  // `@f operator +` was a SyntaxError - the class element parser chose the
  // operator branch BEFORE a decorator list was read, so a decorated operator
  // reached the bracketed path instead. The list is read ahead of the dispatch
  // now.
  expect(evaluated('let k = "NO"; function f(c) { k = c.kind + "/" + String(c.name); } '
    + 'class O { @f operator +(rhs: O): O { return rhs; } } k;')).toBe('ClassOperator/+');
  expect(evaluated('let k = "NO"; function f(c) { k = String(c.static); } '
    + 'class O { @f static operator +(rhs: O): O { return rhs; } } k;')).toBe('true');
  // THE DISCRIMINATING ASSERTION, as ever for an operator: the registration
  // that shares this interception still works, and `2 + 3` giving 5 is only
  // reachable through the declared operator.
  expect(evaluated('function f(c) {} class O { constructor(v) { this.v = v; } '
    + '@f operator +(r: O): O { return new O(this.v + r.v); } } String((new O(2) + new O(3)).v);')).toBe('5');
  // And the ELEVENTH replacement row, which was unreachable until now: an
  // operator's replacement is re-REGISTERED, since an operator lives in the
  // class operator table rather than as a property.
  expect(evaluated('function rep(c) { return function(r) { return new O(99); }; } '
    + 'class O { constructor(v) { this.v = v; } @rep operator +(r: O): O { return new O(1); } } '
    + 'String((new O(2) + new O(3)).v);')).toBe('99');
});

test('an operator\'s PARAMETERS and RETURN are decorated, though the operator is not', () => {
  // An OperatorDefinition is intercepted in the class-body walk (it registers
  // in the operator table) and never reaches ClassElementEvaluation, which is
  // where every other member's sub-target decorators are applied. So
  // `operator +(@f rhs: Op)` PARSED AND SILENTLY DID NOTHING — a decoration
  // accepted and dropped, which reads as support and is worse than the
  // SyntaxError the operator's own decorator still gives.
  //
  // The two positions are now wired at the interception itself.
  const opParam = 'let c; function grab(x) { c = x; } class Op { operator +(@grab r: Op): Op { return r; } } ';
  expect(evaluated(`${opParam} c.kind + ':' + String(c.index);`)).toBe('ClassOperatorParameter:0');
  // The sub-target reaches its owner, and the owner is named by its OPERATOR.
  expect(evaluated(`${opParam} c.methodContext.kind + '/' + String(c.methodContext.name);`)).toBe('ClassOperator/+');
  // Parameters before the return, as everywhere else.
  const both = 'const log = []; function tag(n, c) { log.push(n + \'(\' + c.kind + \')\'); } '
    + 'class Op { operator +(@tag(\'p\') r: Op): @tag(\'ret\') Op { return r; } } ';
  expect(evaluated(`${both} log.join(',');`)).toBe('p(ClassOperatorParameter),ret(ClassOperatorReturn)');
  // THE RETURN TAKES ITS OWN CONTEXT. It borrowed `ClassMethodReturn` when C1
  // wired it, because the table had no `ClassOperatorReturn`; the table now has
  // one. Every other callable member had a return context - ClassGetterReturn,
  // ClassMethodReturn, FunctionReturn, ObjectGetterReturn, ObjectMethodReturn -
  // and the borrow made "decorate method returns but not operator returns"
  // unwriteable, since a context IS the dispatch.
  expect(evaluated('let k; function grab(x) { k = x.kind; } class Op { operator -(): @grab Op { return this; } } k;')).toBe('ClassOperatorReturn');
  // A static operator is the same declaration on the constructor.
  expect(evaluated('let c; function grab(x) { c = x; } class Op { static operator +(@grab r: Op): Op { return r; } } String(c.methodContext.name);')).toBe('+');

  // THE DISCRIMINATING ASSERTION, per the invariant that an operator dispatch
  // must be proved by a case whose fallback computes something else: the
  // operator still REGISTERS and still runs. Wiring the decorators at the
  // interception must not disturb the registration that shares it, and
  // `new Op(2) + new Op(3)` giving 5 is only available from the declared
  // operator — the fallback on two objects is not a number.
  expect(evaluated('function f(c) {} class Op { constructor(v) { this.v = v; } operator +(@f r: Op): Op { return new Op(this.v + r.v); } } '
    + 'String((new Op(2) + new Op(3)).v);')).toBe('5');

  // The operator's OWN decorator is still a SyntaxError, so this stage opened
  // the sub-targets and nothing else. Stated here rather than assumed, for the
  // same reason stage A asserted what it did not open.
  // The operator's own decorator now has a grammar too (phase five), so what
  // this asserts is that the two are INDEPENDENT: the sub-targets fire whether
  // or not the operator itself is decorated, which is the rule a shared `if`
  // has broken three times.
  expect(evaluated('let k = "NO"; function f(c) { k = c.kind; } '
    + 'class Op { operator +(@f rhs: Op): Op { return this; } } k;')).toBe('ClassOperatorParameter');
});

test('an ABSTRACT method\'s parameters and return are decorated too', () => {
  // An AbstractMethodDefinition is intercepted at the same place and for the
  // same reason (it has no runtime behaviour to evaluate), so it dropped its
  // sub-target decorations in exactly the same way. It is a declaration whose
  // parameters are declared, and decorators.md's `ClassMethodReflection`
  // carries `abstract` precisely because an abstract method is reflectable.
  const am = 'let c; function grab(x) { c = x; } abstract class A { abstract m(@grab p: uint8): uint8; } ';
  expect(evaluated(`${am} c.kind + ':' + String(c.index);`)).toBe('ClassMethodParameter:0');
  expect(evaluated(`${am} String(c.methodContext.name);`)).toBe('m');
  expect(evaluated('let k; function grab(x) { k = x.kind; } abstract class A { abstract m(p: uint8): @grab uint8; } k;')).toBe('ClassMethodReturn');
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
  const method = 'const log = []; function tag(n, c) { log.push(n + "(" + c.kind + (c.index !== undefined ? ":" + c.index : "") + ")"); } '
    + 'class A { @tag("m") d(@tag("p0") a: uint32, @tag("p1") b: uint32): @tag("ret") uint32 { return a; } } ';
  expect(evaluated(`${method} log.join(",");`)).toBe('p0(ClassMethodParameter:0),p1(ClassMethodParameter:1),ret(ClassMethodReturn),m(ClassMethod)');

  // Parameters run LEFT TO RIGHT within a declaration. The reverse-source-order
  // rule applies within ONE decorated position, not across positions — which is
  // why the index assertion above matters: `p0` before `p1` and both before the
  // return is the only arrangement consistent with "in parameter order".

  // An accessor's sub-targets take their own contexts: a getter has a return
  // and no parameter, a setter a parameter and no return worth naming, which is
  // why decorators.md gives a ClassSetterParameter and no ClassSetterReturn.
  const accessors = 'const log = []; function tag(n, c) { log.push(n + "(" + c.kind + ")"); } '
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
  const everything = 'const log = []; function t(n, c) { log.push(n); } '
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
  const fn = 'const log = []; function tag(n, c) { log.push(n + "(" + c.kind + ")"); } '
    + '@tag("fn") function g(@tag("p") x: uint8): @tag("r") uint8 { return x; } ';
  expect(evaluated(`${fn} log.join(",");`)).toBe('p(FunctionParameter),r(FunctionReturn),fn(Function)');
  // The context carries the function itself.
  expect(evaluated('let t; function grab(c) { t = c; } @grab function named() {} t.kind + "/" + String(t.name) + "/" + String(t.type === named);')).toBe('Function/named/true');

  // `Let` and `Const` are the first decorators on a STATEMENT rather than a
  // member, and they fire when the statement executes — so the binding's value
  // is already there to be described.
  expect(evaluated('let t; function grab(c) { t = c; } @grab let x = 41; t.kind + "/" + String(t.name) + "/" + String(Number(t.initial));')).toBe('Let/x/41');
  expect(evaluated('let t; function grab(c) { t = c; } @grab const y = 7; t.kind + "/" + String(t.name) + "/" + String(Number(t.initial));')).toBe('Const/y/7');
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
  const obj = 'const log = []; function tag(n, c) { log.push(n + "(" + c.kind + ")"); } '
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

test('block decorators fire on entry, every entry', () => {
  // Stage F of PLAN-decorators.md. decorators.md "Order": "Block, `let`, and
  // `const` decorators are on the other timeline: they fire when the STATEMENT
  // EXECUTES rather than when a declaration is evaluated. A block decorator on
  // a loop body therefore fires ONCE PER ITERATION, which makes block
  // decorators the only ones that can run more than once."
  //
  // That asymmetry is the feature and not an accident: a decorator observing a
  // block is observing an execution rather than a declaration. So the counting
  // assertion is the point of the stage.
  expect(evaluated('let n = 0; function f(c) { n += 1; } @f { let a = 1; } String(n);')).toBe('1');
  expect(evaluated('let n = 0; function f(c) { n += 1; } for (let i = 0; i < 3; ++i) @f { let b = i; } String(n);')).toBe('3');
  expect(evaluated('let n = 0; function f(c) { n += 1; } let i = 0; while (i < 4) { i += 1; @f { let b = i; } } String(n);')).toBe('4');
  // A block whose loop never runs never fires — which is what distinguishes
  // "when the statement executes" from "when the declaration is evaluated".
  expect(evaluated('let n = 0; function f(c) { n += 1; } for (let i = 0; i < 0; ++i) @f { let b = i; } String(n);')).toBe('0');

  // Every block position parses: bare, if, while, do-while, for, for-in, for-of.
  expect(evaluated('function f(c) {} @f { let a = 1; } if (true) @f { let b = 1; } while (false) @f { let c = 1; } '
    + 'do @f { let d = 1; } while (false); for (let i = 0; i < 1; ++i) @f { let e = 1; } '
    + 'for (const k in {}) @f { let g = 1; } for (const v of []) @f { let h = 1; } "all parse";')).toBe('all parse');
});

test('a block reflection carries its label and nothing more — DEFERRED, not missing', () => {
  // decorators.md gives every block reflection a `block: Expression`, plus
  // `condition`, `initializer`, and `update` for the loop forms — and then
  // says: "That `Expression` is not defined here. MACRO AST IS OUT OF SCOPE.
  // The Expression is a placeholder."
  //
  // So the AST-valued fields are ABSENT rather than *undefined*, and this test
  // asserts their absence deliberately. A stage that shipped them as *undefined*
  // would look like a bug; a reader who meets this test meets the deferral.
  expect(evaluated('let c; function f(x) { c = x; } @f { let a = 1; } Object.getOwnPropertyNames(c).join(",");')).toBe('kind,label');
  expect(evaluated('let c; function f(x) { c = x; } @f { let a = 1; } c.kind;')).toBe('Block');
  // THE NINE CONTEXTS ARE NOW DISTINGUISHED (phase five): the parser records
  // the form that OWNS a block and the evaluator reads it back, so a bare block
  // keeps `Block` and each statement's body reports its own. What stays
  // deferred is only the AST-valued fields above.
  const k = 'let c; function f(x) { c = x; } ';
  expect(evaluated(`${k} if (true) @f { let a = 1; } c.kind;`)).toBe('IfBlock');
  expect(evaluated(`${k} if (false) { } else @f { let a = 1; } c.kind;`)).toBe('ElseBlock');
  expect(evaluated(`${k} if (false) { } else if (true) @f { let a = 1; } c.kind;`)).toBe('ElseIfBlock');
  expect(evaluated(`${k} let i = 0; while (i < 1) @f { i += 1; } c.kind;`)).toBe('WhileBlock');
  expect(evaluated(`${k} let n = 0; do @f { n += 1; } while (n < 1); c.kind;`)).toBe('DoWhileBlock');
  expect(evaluated(`${k} for (let i = 0; i < 1; i += 1) @f { let a = 1; } c.kind;`)).toBe('ForBlock');
  expect(evaluated(`${k} for (const x of [1]) @f { let a = 1; } c.kind;`)).toBe('ForOfBlock');
  expect(evaluated(`${k} for (const x in { a: 1 }) @f { let a = 1; } c.kind;`)).toBe('ForInBlock');
  expect(evaluated('[typeof Reflect.Block, typeof Reflect.IfBlock, typeof Reflect.ElseIfBlock, typeof Reflect.ElseBlock, '
    + 'typeof Reflect.WhileBlock, typeof Reflect.DoWhileBlock, typeof Reflect.ForBlock, typeof Reflect.ForInBlock, '
    + 'typeof Reflect.ForOfBlock].join(",");')).toBe('object,object,object,object,object,object,object,object,object');
  // KNOWN LIMIT: every position currently reports `Block` rather than its own
  // kind, because the block node DOES now record which statement form contains
  // it (phase five): the parser marks the body and the evaluator reads it back.
  expect(evaluated('let c; function f(x) { c = x; } if (true) @f { let a = 1; } c.kind;')).toBe('IfBlock');
});

test('the enum family: enumerators before their enum', () => {
  // Stage G of PLAN-decorators.md. decorators.md writes `@f enum Count { @f
  // Zero, ... }`, and the ordering rule applies to a third container kind
  // exactly as it does to a class and an object literal: members first, in
  // document order, container last.
  const e = 'const log = []; function tag(n, c) { log.push(n + "(" + c.kind + ":" + String(c.name) + ")"); } '
    + '@tag("E") enum Count { @tag("z") Zero, @tag("o") One, Two } ';
  expect(evaluated(`${e} log.join(",");`)).toBe('z(EnumEnumerator:Zero),o(EnumEnumerator:One),E(Enum:Count)');
  // An undecorated enumerator between decorated ones is skipped, not
  // misattributed — `Two` above contributes nothing.
  expect(evaluated('let n = 0; function f(c) { n += 1; } enum E2 { @f A, B, C } String(n);')).toBe('1');
  // The enum's context carries the enum type itself.
  expect(evaluated('let c; function grab(x) { c = x; } @grab enum E3 { A } String(c.type === E3);')).toBe('true');
});

test('the Tuple and Record contexts FIRE, on a decorated expression', () => {
  // decorators.md: `const e = @f Composite([0]); // Reflect.Tuple` and
  // `const d = @f Composite({ a: 1 }); // Reflect.Record`.
  //
  // These were pinned as blocked on composites, then - once composites landed -
  // on the EXPRESSION position, since `@f Composite([0])` was a SyntaxError and
  // so was `@f ({})`: the gap was the position, not anything composite-specific.
  // A decorator on an ordinary expression closes both.
  //
  // WHICH CONTEXT FIRES IS DECIDED BY THE VALUE, not by the syntax - and the
  // array/object split is exactly the one a composite's KIND already makes,
  // which is why the intern key carries it.
  expect(evaluated('(() => { let k = "NO"; function f(c) { k = c.kind; } const e = @f Composite([0]); return k; })();')).toBe('Tuple');
  expect(evaluated('(() => { let k = "NO"; function f(c) { k = c.kind; } const d = @f Composite({ a: 1 }); return k; })();')).toBe('Record');
  // The decorated expression still EVALUATES to its value.
  expect(evaluated('(() => { function f(c) {} const e = @f Composite([7]); return String(e[0]); })();')).toBe('7');
  // A decorated OBJECT LITERAL keeps reporting `Object`, which is what says the
  // new path did not swallow the existing one.
  expect(evaluated('(() => { let k = "NO"; function f(c) { k = c.kind; } const b = @f { a: 1 }; return k; })();')).toBe('Object');
});
