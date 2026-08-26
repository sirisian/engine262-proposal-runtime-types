import { expect, test } from 'vitest';
import { evaluated, expectThrown, settledAfterJobs } from '../harness.mts';

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
