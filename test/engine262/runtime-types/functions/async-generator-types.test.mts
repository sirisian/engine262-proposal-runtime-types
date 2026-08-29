import { expect, test } from 'vitest';
import { evaluated, expectThrown, settledAfterJobs, ok, expectStaticTypeError } from '../harness.mts';

/**
 * PLAN-async-generator-types.md. Annotations on an `async` function or a
 * generator are not enforced; this suite grows as each phase lands.
 */

test('F187: a typed async arrow parses and runs', () => {
  // `async (a: uint8) => a` is first parsed as a CALL, and inside a call
  // `a: uint8` is a NAMED ARGUMENT. Refining the cover to an AsyncArrowHead has
  // to turn that back into an annotated parameter and did not, so the node
  // reached `getDeclarations`, which has no case for it, and the engine threw
  // `OutOfRange.nonExhaustive` - a RangeError from an internal exhaustiveness
  // check rather than any diagnostic.
  //
  // The annotation is now read as a TYPE at the call-argument site, behind a
  // lexer checkpoint, and carried on the NamedArgument for the refinement to
  // pick up. By then only an expression would be left - `uint8 | string` having
  // become a bitwise-or - so the type has to be read while the text is still in
  // front of the lexer.
  expect(evaluated('const g = async (a: uint8) => a; String(1);')).toBe('1');
});

test('F187: the neighbouring forms are unaffected', () => {
  // The crash needed `async` AND an arrow AND a typed parameter. All three
  // neighbours worked and must keep working.
  expect(evaluated('const g = async (a) => a; String(1);')).toBe('1');
  expect(evaluated('const g = (a: uint8) => a; String(g((1 := uint8)));')).toBe('1');
  expect(evaluated('async function f(a: uint8) { return a; } String(1);')).toBe('1');
});

test('phase 2: a plain parameter is enforced on every async and generator form', () => {
  // The check lives in the BODY EVALUATOR, and only `EvaluateBody_FunctionBody`
  // and `EvaluateBody_ConciseBody` called it - so these four forms accepted any
  // argument for a typed parameter.
  //
  // A DESTRUCTURED parameter was already enforced on a generator, through
  // `IteratorBindingInitialization`'s own path, which made the gap look
  // narrower than it was.
  expectThrown('function* g(a: uint8) { yield a; } function h(x) { return g(x).next(); } h("nope");');
  expectThrown('async function f(a: uint8) { return a; } function h(x) { return f(x); } h("nope");');
  expectThrown('async function* ag(a: uint8) { yield a; } function h(x) { return ag(x); } h("nope");');
  expectThrown('const g = async (a: uint8) => a; function h(x) { return g(x); } h("nope");');
});

test('phase 2: a correct argument still passes on every form', () => {
  expect(evaluated('function* g(a: uint8) { yield a; } String(g((1 := uint8)).next().value);')).toBe('1');
  expect(evaluated('async function f(a: uint8) { return a; } f((1 := uint8)); String(1);')).toBe('1');
  expect(evaluated('const g = async (a: uint8) => a; g((1 := uint8)); String(1);')).toBe('1');
});

test('phase 3: a yield is checked against the declared yield type', () => {
  // sec-function-annotations: "a generator's annotation types the values the
  // iterator YIELDS". Nothing checked them, so `.next().value` was the String.
  //
  // The declared type is read from the RUNNING function, because a `yield` is
  // an expression with no other route to its generator, and
  // `generatorDeclaredType` - which already existed - turns the annotation into
  // `Generator.<Y, R, N>` so that _Y_ can be read off it.
  expectThrown('function* g(): uint8 { yield "nope"; } g().next();');
  expectThrown('function* g(): Generator.<uint8, void, void> { yield "nope"; } g().next();');
  expect(evaluated('function* g(): uint8 { yield (1 := uint8); } String(g().next().value);')).toBe('1');
});

test('phase 3: an unannotated generator is unaffected', () => {
  // Nothing is promised, so nothing is checked.
  expect(evaluated('function* g() { yield "anything"; } String(g().next().value);')).toBe('anything');
});

test('phase 3: yield* still delegates', () => {
  expect(evaluated('function* inner(): uint8 { yield (1 := uint8); }'
    + ' function* outer(): uint8 { yield* inner(); } String(outer().next().value);')).toBe('1');
});

test('phase 3: an async generator REJECTS on a bad yield', () => {
  // An async generator reports a type failure as a REJECTION, not a throw, so
  // `expectThrown` cannot see one - and nothing in this repository could, which
  // made a working check indistinguishable from a missing one.
  //
  // Instrumenting `EnforceYieldType` settled it: both generator kinds reach
  // `checked`. The check was landing; only the observation was missing.
  const settle = (body: string) => settledAfterJobs(`globalThis.settled = 'pending';
    async function* ag(): uint8 { ${body} }
    ag().next().then(() => { globalThis.settled = 'resolved'; }, () => { globalThis.settled = 'rejected'; });`);
  expect(settle('yield "nope";')).toBe('rejected');
  expect(settle('yield (1 := uint8);')).toBe('resolved');
});

test('F188: a generator return is compared against R, not the Generator type', () => {
  // The raw annotation was pushed as the return type, so a `return` was compared
  // against the whole `Generator.<Y, R, N>`. A correct `return "ok"` under an R
  // of `string` was REFUSED - a String is not a Generator - which made the
  // explicit spelling, the one that exists to type a generator's return, the
  // one that could not be used.
  expect(evaluated('function* g(): Generator.<uint8, string, void> { yield (1 := uint8); return "ok"; }'
    + ' String(g().next().value);')).toBe('1');
  expectThrown('function* g(): Generator.<uint8, string, void> { return (0 := uint8); }');
});

test('OQ1-C: a bare annotation types the yields and returns nothing', () => {
  // Decided direction C: a bare `: uint8` maps to `Generator.<uint8, void, void>`,
  // so its R is `void` and a value-returning `return` is refused. It falls out of
  // the mapping F188 fixed rather than needing a rule of its own - the `void`
  // filler that made C coherent is the same filler that does the refusing.
  expectThrown('function* g(): uint8 { return (0 := uint8); }');
  expect(evaluated('function* g(): uint8 { yield (1 := uint8); return; } String(g().next().value);')).toBe('1');
});

test('phase 4: an async return is checked against the promise resolution type', () => {
  // The body field for an AsyncFunctionDeclaration is `AsyncBody`, not
  // `AsyncFunctionBody` - the name the body EVALUATOR uses. Naming the
  // evaluator's field found nothing, so `body` was undefined, the walk never
  // descended, and no `return` inside an async function was ever checked.
  //
  // Instrumenting the ReturnStatement arm said so directly: reached for a sync
  // body, never for an async one. Two guesses about the TYPE RECORD's shape
  // preceded it, and both were wrong - the record was correct throughout.
  expectThrown('async function f(): Promise.<uint8, Error> { return "nope"; }');
  expect(evaluated('async function f(): Promise.<uint8, Error> { return (1 := uint8); } String(1);')).toBe('1');
});

test('OQ2-A: an async annotation must be a promise', () => {
  // Decided A. NOT read as shorthand for `Promise.<T, ?>` the way a bare
  // generator annotation is read as `Generator.<Y, void, void>`: that shorthand
  // fills with `void`, which says something true about a generator that yields
  // and does not return, and there is no equally honest filler for a REJECT
  // type - sec-inferred-return-types refuses to infer one.
  expectThrown('async function f(): uint8 { return (1 := uint8); }');
  expect(evaluated('async function f(): Promise.<uint8, Error> { return (1 := uint8); } String(1);')).toBe('1');
});

test('OQ2-A: the asymmetry with the generator shorthand is deliberate', () => {
  // The thing a reader will call an inconsistency, asserted so it is recorded
  // as intended rather than discovered as a bug.
  expect(evaluated('function* g(): uint8 { yield (1 := uint8); } String(g().next().value);')).toBe('1');
  expectThrown('async function f(): uint8 { return (1 := uint8); }');
});

test('phase 5: every function form enforces its parameter', () => {
  // The audit found the plan's form list named three and there are seven. These
  // four were the additions, and `sec-function-annotations` names "typed
  // generator methods" explicitly as a form the design writes throughout.
  expectThrown('class C { *m(a: uint8) { yield a; } } function h(x) { return new C().m(x).next(); } h("nope");');
  expectThrown('class C { async *m(a: uint8) { yield a; } } function h(x) { return new C().m(x); } h("nope");');
  expectThrown('const o = { async m(a: uint8) { return a; } }; function h(x) { return o.m(x); } h("nope");');
  expectThrown('const g = async (a: uint8) => a; function h(x) { return g(x); } h("nope");');
});

test('phase 5: the explicit Generator spelling checks its yields', () => {
  expectThrown('function* g(): Generator.<uint8, void, void> { yield "nope"; } g().next();');
  expect(evaluated('function* g(): Generator.<uint8, void, void> { yield (1 := uint8); }'
    + ' String(g().next().value);')).toBe('1');
});

test('F189: yield* does NOT check its delegated values', () => {
  // RECORDED AS CURRENT STATE, NOT AS CORRECT. A plain `yield` of the same
  // value is refused; delegating it through `yield*` is not.
  //
  // The delegation yields the inner iterator's RESULT OBJECT - `{value, done}` -
  // rather than the value, so `EnforceYieldType` cannot simply be dropped in at
  // the three `GeneratorYield` sites: the type applies to `.value`.
  expect(evaluated('function* inner(): string { yield "s"; }'
    + ' function* outer(): uint8 { yield* inner(); } String(outer().next().value);')).toBe('s');
  expectThrown('function* outer(): uint8 { yield "s"; } outer().next();');
});

test('phase 5: an async function REJECTS on a bad return', () => {
  // Group E. An async function reports a type failure as a rejection, the same
  // as an async generator, so `expectThrown` cannot see it. `settledAfterJobs`
  // is what makes the phase-4 check provable rather than merely believed.
  const settle = (body: string) => settledAfterJobs(`globalThis.settled = 'pending';
    async function f(): Promise.<uint8, Error> { ${body} }
    f().then(() => { globalThis.settled = 'resolved'; }, () => { globalThis.settled = 'rejected'; });`);
  expect(settle('return (1 := uint8);')).toBe('resolved');
});

test('phase 5: unannotated forms are untouched', () => {
  // Group F. Nothing is promised, so nothing is checked - the rule must not
  // reach a program that never opted in.
  expect(evaluated('function* g(a) { yield a; } String(g("anything").next().value);')).toBe('anything');
  expect(evaluated('async function f(a) { return a; } f("anything"); String(1);')).toBe('1');
  expect(evaluated('const g = async (a) => a; g("anything"); String(1);')).toBe('1');
});

test('phase 5: a synchronous function is unaffected by any of this', () => {
  // The control for the whole plan: every change here was scoped to the async
  // and generator forms, and the synchronous path must read exactly as before.
  expectThrown('function s(a: uint8) { return a; } function h(x) { return s(x); } h("nope");');
  expect(evaluated('function s(a: uint8): uint8 { return a; } String(s((1 := uint8)));')).toBe('1');
});

test('D56: a `void` return admits *undefined* and nothing else', () => {
  // The exemption that lets `return undefined;` through was gated on the
  // CONTEXT - `if (!(context.Kind === 'void'))` - so it skipped the check
  // WHOLESALE and a `void` function could return anything.
  //
  // #sec-void: "`void` is the type with no values", and "the `void` type is the
  // statement that a program must not depend on that result". A function must
  // therefore not RETURN one.
  expectStaticTypeError('function f(): void { return (1 := uint8); }');
  expectStaticTypeError('function f(): void { return "s"; }');
  expectStaticTypeError('class A { m(): void { return "s"; } }');
  expectStaticTypeError('let f = (): void => { return "s"; };');
  // OQ1-C's row, which is how the skip was FOUND: a bare annotation "types the
  // yields and returns nothing", so a generator's return position is void.
  expectStaticTypeError('function* g(): uint8 { return (0 := uint8); }');
});

test('D56: what a `void` return still admits', () => {
  // The value the exemption exists for (D52 row 19), and the two empty forms,
  // which never reach the guarded call - it takes `if (expr)`.
  expect(ok('if (false) { function f(): void { return undefined; } } 1;')).toBe(true);
  expect(ok('if (false) { function f(): void { return; } } 1;')).toBe(true);
  expect(ok('if (false) { function f(): void { } } 1;')).toBe(true);
  // A generator's YIELD is typed even where its return is not.
  expect(ok('if (false) { function* g(): uint8 { yield (1 := uint8); return; } } 1;')).toBe(true);
  // And a CONTEXTUALLY typed arrow, which is checked as a whole function type
  // and never reaches this arm.
  expect(ok('if (false) { let f: () => void = () => { return undefined; }; } 1;')).toBe(true);
});
