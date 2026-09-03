import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * Spec: #sec-inferred-return-types, #sec-anchored-contributions,
 * #sec-published-return-types.
 *
 * A function that declares no return type may still have one, inferred from
 * what its body returns, and the inference is seeded by annotations alone: a
 * function participates when its signature declares a type, or when what it
 * returns derives from one. The headline consequence is a change of PHASE - a
 * mistake that was caught at a boundary while the program ran is now caught
 * before it runs:
 *
 *   function k(a: uint32) { return 's'; }
 *   const n: number = k(5);            // now an early error
 *
 * The two error shapes distinguish the phases and the tests below read them:
 * an early error names a TYPE ("string" is not assignable to "number"), and a
 * boundary error names the VALUE ("s" is not assignable to "number").
 */

function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

/** The message of the error _source_ produces. */
function thrown(source: string): string {
  const completion = run(source) as unknown as { Type: string, Value: { properties?: Map<{ stringValue?(): string }, { Value?: { stringValue?(): string } }> } };
  if (completion.Type !== 'throw') {
    throw new Error('expected a throw completion');
  }
  const props = completion.Value.properties;
  if (props) {
    for (const [k, v] of props) {
      if (k.stringValue?.() === 'message') {
        return v.Value?.stringValue?.() ?? '';
      }
    }
  }
  return '';
}

/** The completion value of _source_, as a string. */
function value(source: string): string {
  const completion = run(source) as unknown as { Type: string, Value: { stringValue(): string } };
  if (completion.Type !== 'normal') {
    throw new Error(`expected a normal completion, got ${completion.Type}`);
  }
  return completion.Value.stringValue();
}

function expectOk(source: string) {
  expect(run(source)).toMatchObject({ Type: 'normal' });
}

/** An error naming a type: the checker decided it before the program ran. */
function expectEarly(source: string, named: string) {
  expect(thrown(source)).toContain(`"${named}"`);
}

test('a typed parameter is enough to infer the return', () => {
  expectEarly('function k(a: uint32) { return "s"; } const n: number = k(5);', 'string');
  expectOk('function k(a: uint32) { return "s"; } const s: string = k(5);');
});

test('a function with no annotation anywhere is unchanged', () => {
  // Legacy: nothing is published, so the mistake is still the boundary's and
  // the message names the VALUE rather than a type.
  expect(thrown('function k() { return "s"; } const n: number = k();')).toContain('"s" is not assignable');
});

test('an annotation reaches one call past where it was written', () => {
  // `g` declares nothing, but what it returns derives from `f`, so it
  // participates and publishes `uint32`.
  expectEarly('function f(): uint32 { return 5; } function g() { return f(); } const s: string = g();', 'uint.<32>');
  expectOk('function f(): uint32 { return 5; } function g() { return f(); } const n: uint32 = g();');
});

test('the order the two are written in does not matter', () => {
  expectEarly('function g() { return f(); } function f(): uint32 { return 5; } const s: string = g();', 'uint.<32>');
});

test('anchoring follows the value, not any mention of a typed name', () => {
  // `h0` CALLS a typed function and returns a literal. The call is not what it
  // returns, so nothing anchors and `h0` stays legacy.
  expect(thrown('function f(): uint32 { return 5; } function h0(b) { f(); return "x"; } const n: number = h0(1);'))
    .toContain('"x" is not assignable');
});

test('a non-participating function answers an inference without publishing', () => {
  // `g1` is legacy at its own call sites, and still contributes `string` to
  // `h`, which participates through `f`.
  // The published type carries `| undefined` as well: an `if`/`else` whose arms
  // both return is not recognized as exhaustive, so the body counts as able to
  // complete. That is the widening imprecision #sec-inferred-result-type
  // permits - a wider type names more values than can occur, never fewer - so
  // the assertion is that both real members are there.
  const message = thrown('function f(): uint32 { return 5; } function g1() { return "foo"; }'
    + ' function h(b) { if (b) { return f(); } else { return g1(); } } const s: string = h(0);');
  expect(message).toContain('uint.<32>');
  expect(message).toContain('string');
  // ...and `g1` itself publishes nothing: its own consumer still fails at the
  // boundary rather than early.
  expect(thrown('function g1() { return "foo"; } const n: number = g1();')).toContain('"foo" is not assignable');
});

test('a body that returns no value publishes void', () => {
  // Not `undefined`: `void` is the annotation such a function would have been
  // given, and `void` is what a binding may not hold.
  expectEarly('function w(a: uint32) { } const x: undefined = w(1);', 'void');
});

test('a mixed body publishes the union, with undefined as a member', () => {
  expectEarly('function v(b, a: uint32) { if (b) { return a; } } const n: uint32 = v(1, 5);', 'uint.<32> | undefined');
});

test('an unknown contribution publishes nothing', () => {
  // A join of ~any~ is indistinguishable from not participating, so the
  // boundary still decides and the message names the value.
  expect(thrown('function q(a: uint32) { return globalThis.missing; } const n: number = q(1);'))
    .toContain('is not assignable');
});

test('a self-recursive function publishes what its base case gives', () => {
  // #sec-inference-fixpoint: the recursive reference contributes `never`, which
  // vanishes from the join as the identity of union, so the base case decides.
  expectEarly('function f(): uint32 { return 5; } function r(n: uint32) { return n > 1 ? r(n) : f(); } const s: string = r(1);', 'uint.<32>');
  expectOk('function f(): uint32 { return 5; } function r(n: uint32) { return n > 1 ? r(n) : f(); } const u: uint32 = r(1);');
  // A function that only calls itself produces no value, and `never` is what
  // an empty contribution set joins to.
  expectOk('function loop(a: uint32) { return loop(a); } let sink; sink = loop;');
});

test('a conditional is the join of its arms', () => {
  // `? :` produces one of its ARMS, like a short-circuit operator, and had no
  // Static Type at all - which made the most common shape of a two-valued
  // return uninferable.
  expectEarly('function c(b, a: uint32) { return b ? a : a; } const s: string = c(1, 5);', 'uint.<32>');
  // A literal arm takes the position's type.
  expectOk('let b = true; const c: uint32 = b ? 1 : 2;');
});

test('a mutual cycle settles on what its paths give', () => {
  // #sec-inference-fixpoint. Computing `a`, the call to `b` drives `b`'s
  // inference with `a` already marked; `b`'s call back to `a` reaches the mark
  // and contributes `never`, which vanishes from the join, so `b` settles on
  // its other paths and `a` settles on that. Marking the whole queue instead
  // makes every call to an unpublished function answer `never` during any
  // inference, which is wrong for the ordinary wrapper.
  expectEarly(`function f(): uint32 { return 5; }
    function a(n: uint32) { return n > 0 ? b(n) : f(); }
    function b(n: uint32) { return a(n); }
    let sink: string; sink = b(1);`, 'uint.<32>');
  // A three-way cycle settles the same way.
  expectEarly(`function f(): uint32 { return 5; }
    function p(n: uint32) { return q(n); }
    function q(n: uint32) { return r(n); }
    function r(n: uint32) { return n > 0 ? p(n) : f(); }
    let sink: string; sink = r(1);`, 'uint.<32>');
});
test('a published type never licenses eliding a check', () => {
  // #sec-published-return-types. Publication makes a call statically typed,
  // which ENABLES an elision that could not fire while the call was ~any~ - so
  // publishing without this exclusion reopens the hole #sec-elision-stability
  // closed for declared types. Here `g` publishes `uint32`, `f` is then
  // replaced, and the boundary must still run.
  expect(run(`function f(): uint32 { return 5; }
    function g() { return f(); }
    f = function () { return 'now-a-string'; };
    const n: uint32 = g();`)).toMatchObject({ Type: 'throw' });
});

test('a published type is enforced where the function returns', () => {
  // #sec-published-return-types, the third reading. Without this the published
  // type is a claim nothing verifies, and the failure below reaches whichever
  // consumer happens to be annotated - or none at all, as here.
  expect(run(`function f(): uint32 { return 5; }
    function g() { return f(); }
    f = function () { return 'now-a-string'; };
    g();`)).toMatchObject({ Type: 'throw' });
  // An honest wrapper is untouched, and its result still carries the type.
  expectOk(`function f(): uint32 { return 5; }
    function g() { return f(); }
    const n: uint32 = g();`);
});

test('a published void does not check the returned value', () => {
  // As for a declared `void` (#sec-void-type): the annotation constrains the
  // consumer, not the value leaving.
  expectOk('function w(a: uint32) { } w(1);');
});

test('an optional parameter is undefined-inclusive in the body', () => {
  // `f()` hands back the *undefined* the parameter is defined to hold, so the
  // inferred type must admit it: reading the parameter as `uint8` published a
  // type the function's own result failed.
  expectOk('function f(a?: uint8) { return a; } f();');
  expectOk('function f(a?: uint8) { return a; } f(1);');
  expectEarly('function f(a?: uint8) { return a; } const n: uint8 = f();', 'uint.<8> | undefined');
});

test('a method publishes into the shape its member belongs to', () => {
  // #sec-inference-and-function-forms. A member call types through the
  // published return, so the mistake is the checker's rather than the
  // boundary's - the message names a TYPE.
  expectEarly('class C { m(a: uint32) { return "s"; } } const n: number = new C().m(1);', 'string');
  expectOk('class C { m(a: uint32) { return "s"; } } const s: string = new C().m(1);');
  // Anchored rather than signature-typed: the method declares nothing and what
  // it returns derives from a declared type.
  expectEarly('function f(): uint32 { return 5; } class C { m() { return f(); } } const s: string = new C().m();', 'uint.<32>');
  // A method with no annotation and no anchor stays legacy.
  expect(thrown('class C { m() { return "s"; } } const n: number = new C().m();')).toContain('"s" is not assignable');
});

test('a getter publishes the type its property reads at', () => {
  // A getter is the single-value position: no parameters, and its returns ARE
  // the member's type, so it can only participate by anchoring.
  expectEarly('function f(): uint32 { return 5; } class C { get v() { return f(); } } const s: string = new C().v;', 'uint.<32>');
  expectOk('function f(): uint32 { return 5; } class C { get v() { return f(); } } const u: uint32 = new C().v;');
  expect(thrown('class C { get v() { return "s"; } } const n: number = new C().v;')).toContain('"s" is not assignable');
});

test('a method return is enforced like any other', () => {
  expect(run(`function f(): uint32 { return 5; }
    class C { m() { return f(); } }
    f = function () { return 'now-a-string'; };
    new C().m();`)).toMatchObject({ Type: 'throw' });
});

test('a function literal publishes for its RETURN, not for its call sites', () => {
  // A binding without an annotation has the ~any~ Static Type whatever its
  // initializer, so the call site of an arrow or a function expression stays
  // legacy - that is the committed no-binding-inference rule, not a gap. An
  // object literal's method is the same case, since the object reaches its
  // binding no better than the arrow does.
  expect(thrown('const k = (a: uint32) => "s"; const n: number = k(5);')).toContain('"s" is not assignable');
  expect(thrown('const o = { m(a: uint32) { return "s"; } }; const n: number = o.m(1);')).toContain('"s" is not assignable');

  // What publication buys a literal is the RETURN BOUNDARY: a replaced
  // dependency's lie is reported at the function rather than passed on.
  const lie = (g: string) => `function f(): uint32 { return 5; } ${g} f = function () { return 'now-a-string'; }; g();`;
  expect(run(lie('const g = () => f();'))).toMatchObject({ Type: 'throw' });
  expect(run(lie('const g = () => { return f(); };'))).toMatchObject({ Type: 'throw' });
  expect(run(lie('const g = function () { return f(); };'))).toMatchObject({ Type: 'throw' });
  // An honest one is untouched, in both spellings.
  expectOk('function f(): uint32 { return 5; } const g = () => f(); const n: uint32 = g();');
  expectOk('function f(): uint32 { return 5; } const g = () => { return f(); }; const n: uint32 = g();');
});

test('a generator infers its yield type', () => {
  // #sec-inference-and-function-forms: _Y_ is the join of what the `yield`
  // operands contribute. A generator's return annotation is sugar for _Y_, so
  // inferring _Y_ is inferring the annotation the program did not write.
  // _Y_ is the join of the YIELD operands and nothing else. It once read
  // `uint.<8> | undefined`, because the fall-off-the-end contribution of
  // #sec-inferred-result-type - which belongs to _R_ - was joined into _Y_. The
  // tell was that adding a `return` to the same body produced a CLEAN
  // `uint.<8>`: a return statement cannot narrow a yield type, so the routing
  // was the defect rather than the rule. The `expectOk` at the foot of this test
  // is what the old expectation contradicted.
  expectEarly('function f(): uint8 { return 1; } function* g(a: uint32) { yield f(); } const n: number = g(1);', 'Generator.<uint.<8>, void, void>');
  expect(thrown('function f(): uint8 { return 1; } function* g(a: uint32) { yield f(); yield "x"; } const n: number = g(1);')).toContain('uint.<8> | string');
  // A declared annotation still wins, and a legacy generator is unchanged.
  expectEarly('function* g(a: uint32): uint8 { yield 1; } const n: number = g(1);', 'Generator.<uint.<8>, void, void>');
  expectEarly('function* g() { yield 1; } const n: number = g();', 'Generator.<any, void, void>');
  // The inferred element type reaches a `for`-`of` over the generator.
  expectOk('function f(): uint8 { return 1; } function* g(a: uint32) { yield f(); } for (const v of g(1)) { const u: uint8 = v; }');
});

test('yield* contributes conservatively', () => {
  // `yield*` yields the elements of its OPERAND, not the operand, and reading
  // the operand's own type would have published a generator of generators.
  // Until the operand's yield type is read, the honest answer is unknown.
  expectEarly('function f(): uint8 { return 1; } function* inner() { yield f(); }'
    + ' function* g(a: uint32) { yield* inner(); } const n: number = g(1);', 'Generator.<any, void, void>');
});

test('an async declaration reads its declared return type', () => {
  // Not an inference fix: an `AsyncFunctionDeclaration` was admitted by neither
  // arm of the declaration pass, so it got no signature at all and a call of it
  // was ~any~ even where the program wrote the annotation the design uses
  // throughout - `async function f(): Promise.<uint8, Error>`.
  expectEarly('async function af(a: uint32): Promise.<string, any> { return "s"; } const n: number = af(1);', 'Promise.<string, any>');
  expectOk('async function af(a: uint32): Promise.<string, any> { return "s"; } const p: Promise.<string, any> = af(1);');
});

test('an async function infers the type its result resolves with', () => {
  // #sec-inference-and-function-forms: publish `Promise.<T, any>`. The reject
  // type is never inferred - anything may throw, and the convention that
  // `undefined` there means a promise that never rejects is a claim no body
  // supports, so `any` is what an inference can honestly say about it.
  expectEarly('async function af(a: uint32) { return "s"; } const n: number = af(1);', 'Promise.<string, any>');
  expectOk('async function af(a: uint32) { return "s"; } const p: Promise.<string, any> = af(1);');
  // A promise contribution contributes what IT resolves with, the flattening
  // `await` performs.
  expectEarly('async function inner(a: uint32) { return "s"; } async function outer(a: uint32) { return inner(a); } const n: number = outer(1);', 'Promise.<string, any>');
  // A body that returns no value resolves with nothing.
  expectEarly('async function af(a: uint32) { } const n: number = af(1);', 'Promise.<void, any>');
  // With no annotation and no anchor it stays legacy, and the boundary decides.
  expect(thrown('async function af() { return "s"; } const n: number = af();')).toContain('[object Promise]');
});

test('reflection reports a published return type', () => {
  // #sec-inferred-return-types and the RuntimeTypeOf note. The point of
  // inferring is that a program need not repeat what its body already says, and
  // that only holds if the inferred type can be READ: a type enforced at the
  // boundary and denied by reflection would be the one fact about a value a
  // program could not get at.
  //
  // Asserted by INTERNING rather than by display: a published signature must be
  // the same Type Object as the written annotation, not merely print alike.
  expectOk(`function k(a: uint32) { return 's'; }
    function d(a: uint32): string { return 's'; }
    if (Reflect.typeOf(k) !== Reflect.typeOf(d)) { throw new Error('x'); }`);
  // An anchored wrapper reports what it publishes.
  expectOk(`function f(): uint32 { return 5; }
    function g() { return f(); }
    function d(): uint32 { return 5; }
    if (Reflect.typeOf(g) !== Reflect.typeOf(d)) { throw new Error('x'); }`);
  // A function that publishes nothing reports no signature, which is the
  // unannotated rule the note protects: reporting an all-`any` signature for a
  // function that declared none would be inference the program did not ask for.
  expectOk(`function k() { return 's'; }
    function d(a: uint32): string { return 's'; }
    if (Reflect.typeOf(k) === Reflect.typeOf(d)) { throw new Error('x'); }`);
});

test('assignability reads the effective return type', () => {
  // #sec-published-return-types, the second reading. A published type lives in
  // its own field so that identity, overload-set formation, and ranking keep
  // reading the declared one; a comparison of two function types has to be told
  // to look at the other field.
  //
  // Refused: `g` returns a `uint32` and the position wants a `string`.
  expectEarly(`function f(): uint32 { return 5; }
    function g() { return f(); }
    let cb: () => string = g;`, '() => uint.<32>');
  // Accepted: the same function at a position that matches what it returns.
  expectOk(`function f(): uint32 { return 5; }
    function g() { return f(); }
    let cb: () => uint32 = g;`);
  // A function that publishes nothing is unaffected, and the shallow function
  // check admits it as before.
  expectOk('function g() { return 5; } let cb: () => string = g;');
});

test('a generic call is typed where its return is concrete', () => {
  // #sec-generic-functions. A generic call had no Static Type at all, because
  // the CALLEE `g.<uint8>` - a TypeArgumentsExpression - had none, so nothing
  // downstream could be checked however completely the function was annotated.
  expectEarly('function f(): uint32 { return 5; } function g<T>(a: T) { return f(); } const s: string = g.<uint8>(1);', 'uint.<32>');
  expectOk('function f(): uint32 { return 5; } function g<T>(a: T) { return f(); } const u: uint32 = g.<uint8>(1);');
});

test('a return that names a type parameter is bound by the call', () => {
  // #sec-generic-functions. `T` now denotes the parameter its declaration binds
  // — for the whole signature and body — and a call that supplies type
  // arguments substitutes them, so `first.<uint32>([1])` is a `uint32`.
  expectEarly('function first<T>(a: [].<T>): T { return a[0]; } const s: string = first.<uint32>([1]);', 'uint.<32>');
  expectOk('function first<T>(a: [].<T>): T { return a[0]; } const u: uint32 = first.<uint32>([1]);');
  // A call that supplies no type arguments binds them from what it PASSES.
  expectEarly('let x: uint32 = 5; function id<T>(v: T): T { return v; } const s: string = id(x);', 'uint.<32>');
  expectOk('let x: uint32 = 5; function id<T>(v: T): T { return v; } const u: uint32 = id(x);');
  // An argument that says nothing about `T` leaves it unbound, and an unbound
  // type parameter constrains nothing rather than refusing the call.
  expectOk('function id<T>(v: T): T { return v; } id(5); id("hi");');
});
test('an inference-sourced error says where the type came from', () => {
  // The gate this document set for itself: participation is non-local on
  // purpose - an annotation's reach travels through returns - so an error that
  // names a type the program never wrote has to carry what the reach was.
  expect(thrown('function k(a: uint32) { return "s"; } const n: number = k(5);'))
    .toContain('the inferred return type of "k"');
  expect(thrown('function f(): uint32 { return 5; } function g() { return f(); } const s: string = g();'))
    .toContain('the inferred return type of "g"');
  // A DECLARED type is one the program wrote, and needs no explanation.
  expect(thrown('function d(a: uint32): string { return "s"; } const n: number = d(5);'))
    .not.toContain('inferred return type');
  expect(thrown('let x: uint32 = 5; const s: string = x;')).not.toContain('inferred return type');
});

test('a generic function infers a return over its type parameters', () => {
  // #sec-inference-and-function-forms: the inference runs over the
  // UNINSTANTIATED body, so a contribution may mention the declaration's type
  // parameters and the published type is an expression over them, substituted
  // at each call.
  expectEarly('function first<T>(a: [].<T>) { return a[0]; } const s: string = first.<uint32>([1]);', 'uint.<32>');
  expectOk('function first<T>(a: [].<T>) { return a[0]; } const u: uint32 = first.<uint32>([1]);');
  // Bound from the argument rather than written.
  expectEarly('let x: uint32 = 5; function id<T>(v: T) { return v; } const s: string = id(x);', 'uint.<32>');
  // A binding reached through a container.
  expectEarly('let a: [].<uint32> = [1]; function first<T>(x: [].<T>): T { return x[0]; } const s: string = first(a);', 'uint.<32>');
});

test('a published type over type parameters is not enforced at the boundary', () => {
  // Such a type means something only once a call binds them, and the boundary
  // sees one function for every instantiation - so enforcing it there would
  // refuse `id(5)` against a bare `T`. The checker publishes it and substitutes
  // per call; the run time is told nothing.
  expectOk('function id<T>(v: T) { return v; } id(5); id("hi"); id({});');
});

test('an inferred reference return is a location', () => {
  // #sec-inference-and-function-forms and #sec-location-consuming-contexts. A
  // function that returns a `ref` and declares no return type still makes its
  // call a location, which is the implicit-auto philosophy at the one place a
  // return type reaches grammar-adjacent semantics.
  const arr = 'let arr: [].<uint32> = [1, 2]; ';
  const at = 'function at(a: [].<uint32>, i: uint32) { return ref a[i]; } ';
  expect(value(arr + at + 'at(arr, 0) = 7; String(arr[0]);')).toBe('7');
  expect(value(arr + at + 'at(arr, 0)++; String(arr[0]);')).toBe('2');
  expect(value(arr + at + 'function g(ref x: uint32) { x = 8; } g(ref at(arr, 0)); String(arr[0]);')).toBe('8');
  // Everywhere else it decays to the element's value, so writing to the copy
  // leaves the array alone.
  expect(value(arr + at + 'let v = at(arr, 0); v = 9; String(arr[0]) + ":" + String(v);')).toBe('1:9');
});

test('a mixed reference and value body is decided at the assignment', () => {
  // Where the contributions MIX a reference with a value the call's return type
  // is not statically one or the other, so the check is the deferred run-time
  // one: the branch that returned a reference writes through, and the branch
  // that returned a value reports that there is no location to assign to.
  // Refusing the declaration outright is the stricter reading and is not what
  // the implementation does.
  const setup = 'let arr: [].<uint32> = [1, 2]; '
    + 'function m(b, a: [].<uint32>) { if (b) { return ref a[0]; } return 0; } ';
  expect(value(setup + 'm(1, arr) = 5; String(arr[0]);')).toBe('5');
  expect(run(setup + 'm(0, arr) = 5;')).toMatchObject({ Type: 'throw' });
});

test('an inference-sourced error names the annotation it came from', () => {
  // The second half of the gate. Participation is non-local by design: an
  // annotation's reach travels through returns, so a function nobody annotated
  // acquires a type, and the question left is not "which return" but "which
  // annotation". Naming the callee closes it.
  expect(thrown('function f(): uint32 { return 5; } function g() { return f(); } const s: string = g();'))
    .toContain('which is what "f" declares');
  // A chain names the IMMEDIATE anchor, which is the one a reader can act on.
  expect(thrown('function f(): uint32 { return 5; } function g() { return f(); }'
    + ' function h() { return g(); } const s: string = h();')).toContain('which is what "g" declares');
  // A function typed by its own signature has no anchor to name, and says only
  // that the type was inferred.
  const own = thrown('function k(a: uint32) { return "s"; } const n: number = k(5);');
  expect(own).toContain('inferred return type of "k"');
  expect(own).not.toContain('declares');
  // A declared type is one the program wrote and needs no explanation at all.
  expect(thrown('function d(a: uint32): string { return "s"; } const n: number = d(5);'))
    .not.toContain('inferred return type');
});

test('a typed local binding anchors a contribution', () => {
  // #sec-anchored-contributions names "a binding's annotation" among the things
  // that anchor. The inference pass declared the PARAMETERS and nothing else,
  // so a body's own typed bindings were invisible to it: the contribution read
  // as unknown and the function published nothing, while the same function
  // returning its parameter or a declared call published correctly.
  expectEarly('function g(a: uint32) { let t: uint8 = 1; return t; } const s: string = g(1);', 'uint.<8>');
  expectEarly('function g(a: uint32) { const t: uint8 = 1; return t; } const s: string = g(1);', 'uint.<8>');
  // The two that already worked, as the comparison that found this.
  expectEarly('function g(a: uint8) { return a; } const s: string = g(1);', 'uint.<8>');
  expectEarly('function f(): uint8 { return 1; } function g(a: uint32) { return f(); } const s: string = g(1);', 'uint.<8>');
});

test('a refused union names the member that does not fit, and its return', () => {
  // The finer half of the gate. Naming the function answers "why does this
  // have a type"; naming the anchor answers "which annotation"; a union leaves
  // the question a reader of a multi-return function actually asks - of
  // `uint32 | string` refused at a `string`, WHICH return produced the
  // `uint.<32>`.
  const h = 'function f(): uint32 { return 5; } function g1() { return "foo"; }'
    + ' function h(b) { if (b) { return f(); } return g1(); } ';
  expect(thrown(`${h} const s: string = h(0);`)).toContain('whose "uint.<32>" comes from "f"');
  // The other member offends at the other target, and is named instead.
  expect(thrown(`${h} const u: uint32 = h(0);`)).toContain('whose "string" comes from "g1"');
  // Where MORE than one member fails there is no single answer, so the message
  // falls back to the anchor rather than picking one.
  const both = thrown(`${h} const t: boolean = h(0);`);
  expect(both).toContain('inferred return type of "h"');
  expect(both).not.toContain('comes from');
  // A non-union keeps the simpler form.
  expect(thrown('function f(): uint32 { return 5; } function g() { return f(); } const s: string = g();'))
    .toContain('which is what "f" declares');
});

/**
 * Where a CONSTRUCTOR meets return inference, plus one widening rule this file
 * never pinned.
 */

test('the multi-arm widening, pinned', () => {
  // Nothing here covered a multi-arm inferred return, so the widening rule was
  // free to drift. It is not `1 | "s"` - the literals widen - and it is not
  // `uint8 | string` either. It is `number | string`, asserted by IDENTITY
  // rather than by `kind`, so a change to the rule has to change this line
  // rather than slip past a shape check.
  const r = 'function f(b: boolean) { if (b) { return 1; } return "s"; }'
    + ' const t = Reflect.getReflection(Reflect.typeOf(f)).signatures[0].return.type; ';
  expect(value(`${r} String(t === type number | string);`)).toBe('true');
  expect(value(`${r} String(t === type 1 | "s");`)).toBe('false');
  expect(value(`${r} String(t === type uint8 | string);`)).toBe('false');
});

test('a constructor contributes nothing to inference', () => {
  // #sec-published-return-types: "A setter declares no return type, and a
  // constructor has none to infer." The constructor now reflects a SIGNATURE,
  // which is a different thing - its parameters are known and its result is
  // fixed by rule, so nothing is inferred. The absence of the `return` slot is what says so.
  for (const decl of [
    'class C { x: uint8 = 1; constructor(y: uint8) {} }',
    'class C { x: uint8 = 1; constructor(y) {} }',
    'class C { x: uint8 = 1; }',
  ]) {
    expect(value(`${decl} const r = Reflect.getReflection.<Reflect.ClassMethod, C>('constructor');`
      + ' String(r.signatures[0].return === undefined);'), decl).toBe('true');
  }
});

test('a method NAMED `constructor` on an object literal does infer', () => {
  // The boundary of the rule above. `{ constructor() {} }` is an ordinary
  // method: it is not a construction, so it has a return type like any other
  // method, and it keeps its annotation too.
  expect(value('const o = { constructor(a: uint8) { return a; } };'
    + ' const s: uint8 = o.constructor(3); String(s);')).toBe('3');
  expect(value('const o = { constructor(): uint8 { return 4; } }; String(o.constructor());')).toBe('4');
});

test('inference through a factory yields the class', () => {
  // `new K()` has static type `K`, and that is true rather than assumed: no
  // typed class can return anything else.
  // So an unannotated factory infers the class, seeded by the construction.
  expect(value('class K { x: uint8 = 1; } function make() { return new K(); }'
    + ' const s = Reflect.getReflection(Reflect.typeOf(make)).signatures[0];'
    + ' String(s.return.type === type K);')).toBe('true');
  // and the inferred type is usable at a boundary, which is the point
  expect(value('class K { x: uint8 = 1; } function make() { return new K(); }'
    + ' const k: K = make(); String(k.x);')).toBe('1');
});

test('a getter\'s published return still joins its shape', () => {
  // Regression guard on the clause the rule touches: the annotation refusal is
  // scoped to `constructor`, and a getter is the neighbour most likely to be
  // caught by an over-wide rule, since it reaches the same parse.
  expect(value('class C { x: uint8 = 1; get g(): uint8 { return this.x; } }'
    + ' const r = Reflect.getReflection.<Reflect.ClassGetter, C>("g");'
    + ' String(r.type !== undefined);')).toBe('true');
  expect(value('class C { x: uint8 = 1; get g(): uint8 { return this.x; } }'
    + ' const v: uint8 = (new C()).g; String(v);')).toBe('1');
});
