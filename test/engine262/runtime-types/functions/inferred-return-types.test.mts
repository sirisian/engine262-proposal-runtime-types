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

test('a recursive function is left unpublished rather than guessed at', () => {
  // The fixpoint of #sec-inference-fixpoint is not yet iterated to convergence;
  // a function that reaches its own unpublished signature contributes something
  // unknown and publishes nothing, which is the conservative answer.
  expectOk('function fac(n: uint32) { return n > 1 ? fac(n) : 1; } fac(1);');
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

test('an object literal method does not publish yet', () => {
  // Pinned as a KNOWN GAP rather than left to be discovered: the specification
  // includes an object literal's method, and only the class element loop
  // publishes so far. The message names the value, so this is the boundary
  // deciding, not the checker.
  expect(thrown('const o = { m(a: uint32) { return "s"; } }; const n: number = o.m(1);')).toContain('"s" is not assignable');
});
