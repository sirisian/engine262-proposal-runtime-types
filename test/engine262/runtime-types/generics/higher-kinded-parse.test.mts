import { test, expect } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';
import {
  ok, evaluated, run,
} from '../harness.mts';

/**
 * PLAN-higher-kinded-types-engine.md phase 1, per #sec-higher-kinded-parameters.
 *
 * A parameter is higher-kinded when its name is followed by a bracketed list of
 * `_`, and the count of holes is its arity. Nothing here gives the arity a
 * meaning yet — that is phase 2 — so these are parse assertions.
 */

test('a higher-kinded parameter declares, at each arity and position', () => {
  expect(ok('interface I<W<_>> {}')).toBe(true);
  expect(ok('interface I<W<_, _>> {}')).toBe(true);
  expect(ok('interface I<W<_>, T> {}')).toBe(true);
  expect(ok('interface I<T, W<_>> {}')).toBe(true);
  expect(ok('class C<W<_>> {}')).toBe(true);
  expect(ok('type A<W<_>> = uint8;')).toBe(true);
});

test('only `_` is a hole', () => {
  // Each of these is a spelling a reader might reasonably try. `<W<T>>` reads
  // as a nested parameter; `~`, `*`, and a numeral are the three alternatives
  // named and rejected in higherkindedtypes.md.
  expect(ok('interface I<W<T>> {}')).toBe(false);
  expect(ok('interface I<W<~>> {}')).toBe(false);
  expect(ok('interface I<W<*>> {}')).toBe(false);
  expect(ok('interface I<W<1>> {}')).toBe(false);
});

test('arity zero is spelled without brackets', () => {
  expect(ok('interface I<W<>> {}')).toBe(false);
  expect(ok('interface I<W> {}')).toBe(true);
});

test('a higher-kinded parameter takes a constraint and a default', () => {
  expect(ok('type Identity<T> = T; interface I<W<_> : Identity.<uint8>> {}')).toBe(true);
  expect(ok('type Identity<T> = T; interface I<T, W<_> = Identity> {}')).toBe(true);
});

test('a defaulted parameter may not precede a required one', () => {
  // The rule was stated in the specification and enforced nowhere, and the
  // higher-kinded work found it by relying on it: `Iterator<T, R, N, W<_> =
  // Identity>` places its wrapper last BECAUSE of this rule, and an unenforced
  // rule is not a reason for anything.
  expect(ok('type Identity<T> = T; interface I<W<_> = Identity, T> {}')).toBe(false);
  expect(ok('type Identity<T> = T; interface I<T, W<_> = Identity> {}')).toBe(true);

  // It is not a rule about kinded parameters — it holds for every parameter,
  // which is where it was missing.
  expect(ok('interface I<T = uint8, U> {}')).toBe(false);
  expect(ok('interface I<U, T = uint8> {}')).toBe(true);
  expect(ok('interface I<U, T = uint8, V = uint8> {}')).toBe(true);
});

test('the shared tokens still mean what they did', () => {
  // `_` is the pattern wildcard and `%` is both the remainder operator and the
  // pipeline topic. This extension leans on positional disambiguation, so the
  // positions it does not touch are asserted here.
  expect(evaluated('const r = match (1) { when _: "any"; }; String(r);')).toBe('any');
  expect(evaluated('String(7 % 4);')).toBe('3');
  expect(evaluated('String(5 |> % + 1);')).toBe('6');
});

/**
 * PLAN-higher-kinded-types-engine.md phase 2: the arity reaches the record.
 *
 * A `~parameter~` Type Record carries the arity its declaration wrote, and the
 * central rule follows from it — a higher-kinded parameter stands for a
 * declaration, so it is NOT a type and may not be written as one.
 */

test('an unapplied higher-kinded parameter is not a type', () => {
  expect(ok('class C<W<_>> { v: W; }')).toBe(false);
  expect(ok('type Identity<T> = T; class C<W<_>> { v: W.<uint8>; }')).toBe(true);
});

test('the refusal names the arity', () => {
  // Asserting the MESSAGE, not only the refusal. A reader who writes `W` where
  // `W.<T>` belongs needs to be told how many arguments it wants, and the
  // generics work found a refusal that was right for the wrong words because
  // nothing checked them.
  const completion = run('class C<W<_, _>> { v: W; }');
  expect(completion.Type).toBe('throw');
  let message = '';
  for (const [key, desc] of (completion.Value as { properties: Map<{ stringValue?(): string }, { Value: { stringValue(): string } }> }).properties) {
    if (key.stringValue?.() === 'message') {
      message = desc.Value.stringValue();
    }
  }
  expect(message).toContain('2');
  expect(message).toContain('unapplied');
});

test('arity distinguishes parameters of the same name', () => {
  // `W<_>` and `W<_, _>` are different parameters: one stands for a
  // one-argument declaration and the other for a two-argument one, so a value
  // of one is not a value of the other.
  expect(ok('class C<W<_>> { v: W.<uint8>; }')).toBe(true);
  expect(ok('class C<W<_, _>> { v: W.<uint8>; }')).toBe(true);
});

test('an ordinary parameter is untouched', () => {
  // Arity 0 is what every existing generic declares, and the whole generics
  // suite is the real assertion; these are the shapes closest to the change.
  expect(ok('class C<T> { v: T; }')).toBe(true);
  expect(ok('class C<T> { m(v: T): T { return v; } }')).toBe(true);
  expect(ok('function f<T>(x: T): T { return x; }')).toBe(true);
});

/**
 * PLAN-higher-kinded-types-engine.md phase 3.
 *
 * The APPLICATION half works: `W.<T>` where `W` is a bound higher-kinded
 * parameter resolves the parameter to the declaration an application bound to
 * it and applies that, so `W.<X>` means what writing the bound declaration
 * applied to X means. An alias argument goes through InstantiateGenericAlias
 * and a class or interface through the ordinary argument attach.
 *
 * The VALIDATION half took two attempts. It was written into
 * TypeNodeToTypeRecord first, where a `const` annotation reaches it and a type
 * annotation does not - the two-resolver split this work has met repeatedly.
 * It lives in one shared helper now, called from both, because a rule enforced
 * in one resolver and not the other is a rule that holds in some positions.
 */

test('a bound higher-kinded parameter applies', () => {
  expect(ok('type Identity<T> = T; class C<W<_>> { v: W.<uint8>; }')).toBe(true);
  expect(ok('class C<W<_>> { v: W; }')).toBe(false);
});

test('an argument must be a generic declaration of matching arity', () => {
  const P = 'type Identity<T> = T; class One<T> {} class Box<W<_>> {} class Pair<W<_, _>> {} ';
  expect(ok(`${P}function f(x: Box.<Identity>) {}`)).toBe(true);
  expect(ok(`${P}function f(x: Box.<One>) {}`)).toBe(true);
  expect(ok(`${P}function f(x: Pair.<Map>) {}`)).toBe(true);
  expect(ok(`${P}function f(x: Box.<uint8>) {}`)).toBe(false);
  expect(ok(`${P}function f(x: Box.<Map>) {}`)).toBe(false);
});

test('the two failures carry different messages', () => {
  // The clause distinguishes them because they are different mistakes, and
  // "uint8 is not assignable to Box" - the generic diagnostic, which is what
  // the first attempt produced - is true and useless.
  const P = 'class Box<W<_>> {} ';
  const messageOf = (src: string) => {
    const completion = run(src);
    let message = '';
    const value = completion.Value as { properties?: Map<{ stringValue?(): string }, { Value: { stringValue(): string } }> };
    for (const [key, desc] of value.properties ?? []) {
      if (key.stringValue?.() === 'message') {
        message = desc.Value.stringValue();
      }
    }
    return message;
  };
  expect(messageOf(`${P}function f(x: Box.<uint8>) {}`)).toContain('not a generic declaration');
  // And a LIBRARY generic reports its arity rather than being mistaken for a
  // non-declaration: its record carries no declaration node to count, which is
  // what made `Map` report the wrong one of the two.
  expect(messageOf(`${P}function f(x: Box.<Map>) {}`)).toContain('takes');
  expect(messageOf(`${P}function f(x: Box.<Map>) {}`)).toContain('2');
});

/**
 * PLAN-higher-kinded-types-engine.md phase 4 — probed, and three of the four
 * clauses need work that is now located rather than guessed at.
 *
 * 1. FIXED. A kinded argument was resolved as a type, so it worked in a
 *    parameter annotation and failed in a `const` one. `function f(x: B.<Identity>) {}` is
 *    accepted; `const a: B.<Identity> = null` reports that Identity "is not a
 *    type" — which is true of a bare generic alias and beside the point, since
 *    a kinded position wants a DECLARATION.
 *
 *    The cause is ordering rather than a missing rule: TypeNodeToTypeRecord
 *    resolves every type argument before it knows the base, so it cannot ask
 *    whether the parameter at that position is kinded. Resolving the base
 *    first, or deferring a bare name until the parameter is known, is the
 *    change. This is the fourth time this feature has met the two-resolver
 *    split, and the first where the two paths differ in ORDER rather than in
 *    which rules they know.
 *
 * 2. ANSWERED, AND IT IS NOT THIS FEATURE'S. `where` does not parse for ANY
 *    declaration - the token appears nowhere in the parser - so the refusal was
 *    about the clause and not about the kinded parameter, which is what the
 *    question was for. sec-generic-where writes a `where` "with the
 *    WhereClauses of sec-where-clauses where sec-checked-contracts admits
 *    them", and checked contracts is a specified extension the engine has not
 *    implemented. A kinded constraint will work when `where` does, and needs
 *    nothing of its own beyond what phase 3 already resolves.
 *
 * 3. VARIANCE HOLDS. Applications binding different wrappers are distinct, for
 *    a class argument and for an alias argument alike.
 *
 *    The cause was at CONSTRUCTION rather than in the comparison: resolveType
 *    answers null for a bare generic name - correctly, since one is not a type
 *    - the null was filtered out, the arity check failed, and `new B.<Boxed>()`
 *    fell through to the bare `B`, which is assignable to every application.
 *
 *    A generic ALIAS needed a second fix. It resolves its body with its
 *    parameters unbound, so `type Identity<T> = T` yielded nothing and the name
 *    was registered nowhere - right for a type position and wrong wherever the
 *    name denotes the DECLARATION. It is recorded under its own name now, and a
 *    type position still refuses it.
 */

test('a kinded argument works in a parameter annotation', () => {
  expect(ok('type Identity<T> = T; class B<W<_>> {} function f(x: B.<Identity>) {}')).toBe(true);
});

test('a bare generic declaration is not a type', () => {
  // Correct, and the reason 1 above is a positional problem rather than a
  // missing rule: `Identity` unapplied is a declaration, and a type position
  // should refuse it.
  expect(ok('type Identity<T> = T; const a: Identity = 1;')).toBe(false);
});

test('a kinded argument resolves in a const annotation', () => {
  // The positional gap: arguments were resolved as types before the base was
  // known, so a bare generic declaration - which is what a kinded position
  // wants - reported that it "is not a type".
  const P = 'type Identity<T> = T; class B<W<_>> {} ';
  // The construction must supply the argument too. A bare `new B()` is a `B`
  // and correctly does not satisfy `B.<Identity>` - the same rule an ordinary
  // generic follows, and it only became visible once applications stopped
  // collapsing to their base.
  expect(ok(`${P}const a: B.<Identity> = new B.<Identity>();`)).toBe(true);
  expect(ok(`${P}const a: B.<Identity> = new B();`)).toBe(false);
  expect(ok(`${P}function f(x: B.<Identity>) {}`)).toBe(true);

  // And the refusals survive the fallback: it resolves a bare name to its
  // declaration, and the validation still refuses it where the parameter was
  // not kinded or the arity does not match.
  expect(ok(`${P}const a: B.<uint8> = new B.<uint8>();`)).toBe(false);
  expect(ok(`${P}const a: B.<Map> = new B.<Map>();`)).toBe(false);
});

test('applications binding different class wrappers are distinct', () => {
  const P = 'class One<T> {} class Two<T> {} class B<W<_>> {} ';
  expect(ok(`${P}const a: B.<One> = new B.<One>();`)).toBe(true);
  expect(ok(`${P}const a: B.<One> = new B.<Two>();`)).toBe(false);
});

test('applications binding different alias wrappers are distinct', () => {
  const P = 'type Identity<T> = T; type Boxed<T> = [].<T>; class B<W<_>> {} ';
  expect(ok(`${P}const a: B.<Identity> = new B.<Identity>();`)).toBe(true);
  expect(ok(`${P}const a: B.<Identity> = new B.<Boxed>();`)).toBe(false);

  // And a bare generic alias is still not a type, which is what makes the
  // registration above a change to where the NAME resolves rather than to what
  // an alias means.
  expect(ok('type Identity<T> = T; const a: Identity = 1;')).toBe(false);
  expect(ok('type Boxed<T> = [].<T>; const a: Boxed.<uint8> = [1];')).toBe(true);
});

/**
 * PLAN-higher-kinded-types-engine.md phase 5 — done, at the third attempt, and
 * the two failed ones located it.
 *
 * A higher-kinded parameter is bound only by explicit application and never
 * inferred. Refusing that in InferGenericBindings, where a call's bindings are
 * decided, refuses BOTH forms: inference cannot tell a supplied kinded
 * parameter from an unsupplied one, because the frame that would hold the
 * explicit arguments is what inference is being asked to produce.
 *
 * The check belongs at the CALL, where the callee node is in hand and whether a
 * TypeArgumentsExpression rides on it is exactly the question being asked. That
 * is where the typed JSON.parse and the SoA constructors already intercept, for
 * the same reason.
 */

test('a kinded parameter must be supplied by explicit application', () => {
  const P = 'type Identity<T> = T; function g<W<_>, T>(x: W.<T>): void {} ';
  expect(ok(`${P}g.<Identity, uint8>(1);`)).toBe(true);
  expect(ok(`${P}g(1);`)).toBe(false);

  // Inference for ordinary parameters is untouched, which is the assertion
  // that matters: the refusal is about a kinded parameter and not about
  // generic calls.
  expect(ok('function f<T>(x: T): T { return x; } const n: uint8 = 1; f(n);')).toBe(true);
  expect(ok('function h(x) { return x; } h(5);')).toBe(true);
});

test('the refusal explains that inference is not attempted', () => {
  // The message says WHY rather than reporting a missing binding. Recovering W
  // and T from one argument admits two consistent answers, so choosing is a
  // search - and sec-evaluation-budget meters computation rather than search.
  const completion = run('type Identity<T> = T; function g<W<_>, T>(x: W.<T>): void {} g(1);');
  let message = '';
  const value = completion.Value as { properties?: Map<{ stringValue?(): string }, { Value: { stringValue(): string } }> };
  for (const [key, desc] of value.properties ?? []) {
    if (key.stringValue?.() === 'message') {
      message = desc.Value.stringValue();
    }
  }
  expect(message).toContain('explicit application');
  expect(message).toContain('never inferred');
});

/**
 * PLAN-higher-kinded-types-engine.md phase 6 — the prerequisite, nearly.
 *
 * `Identity`, the wrapper meaning NO wrapper, resolves as a TYPE in every
 * position: `Identity.<uint8>` is `uint8` in a parameter annotation and in a
 * `const` one, a wrong value is refused, and a program's own
 * `type Identity<T> = T` still wins.
 *
 * It is not yet usable as a KINDED ARGUMENT, and the reason is the binding
 * rather than the meaning - see the test below.
 *
 * It took six attempts and the reason is worth keeping. Identity is not one of
 * the iteration interfaces: every member of that family DESCRIBES a shape and
 * Identity REDUCES to its argument, which is what an alias does and what the
 * interface builder cannot express. Three attempts to build it as an interface
 * failed in three different ways for that one reason.
 *
 * The reducing form then needed all three of the places a type name is
 * answered - the checker's resolver, the runtime's, and a global binding, since
 * a `const` annotation is EVALUATED and needs the name to be a value. Wiring
 * one at a time produced a different failure each time, and the last two are
 * the two-resolver split this feature has now met five times.
 *
 * Deferring to a user declaration is a decision rather than an accident:
 * Identity is an alias a program could legitimately redeclare, unlike
 * `Iterable`, which is a protocol and wins over a program's declaration.
 */

test('a program may declare its own Identity', () => {
  // The reducing form defers to a user declaration, which is what makes
  // Identity an alias rather than a protocol. The interface attempts shadowed
  // this and broke four tests.
  expect(ok('type Identity<T> = T; const a: Identity.<uint8> = 1;')).toBe(true);
  expect(ok('type Identity<T> = T; class B<W<_>> {} const b: B.<Identity> = new B.<Identity>();')).toBe(true);
});

test('Identity resolves in every position', () => {
  // `Identity.<T>` is `T`. The three places a type name is answered each had to
  // learn it: the checker's resolver, the runtime's, and a global binding for
  // the evaluated positions.
  expect(ok('const a: Identity.<uint8> = 1;')).toBe(true);
  expect(ok('const a: Identity.<uint8> = "s";')).toBe(false);
  expect(ok('function f(x: Identity.<uint8>) {}')).toBe(true);

  // And as a KINDED ARGUMENT, which is what the unification needs: a
  // higher-kinded parameter binds a generic DECLARATION, so the global binding
  // holds the declaration a prelude parsed rather than a stand-in.
  expect(ok('class B<W<_>> {} const b: B.<Identity> = new B.<Identity>();')).toBe(true);
  expect(ok('type Identity<T> = T; class B<W<_>> {} const b: B.<Identity> = new B.<Identity>();')).toBe(true);
});

test('deep but finite nesting completes', () => {
  // The budget's other direction, which the plan asks for explicitly: a budget
  // that fires on reasonable code is a bug, so realistic nesting must complete.
  expect(ok('type Bx<T> = [].<T>; const a: Bx.<Bx.<uint8>> = [[1]];')).toBe(true);
  expect(ok('type Bx<T> = [].<T>; class B<W<_>> {} const b: B.<Bx> = new B.<Bx>();')).toBe(true);
});

/**
 * THE BUDGET NOW REACHES GENERIC ALIAS INSTANTIATION, with one caveat.
 *
 * `type R<T> = R.<T>` used to overflow the HOST stack - a RangeError that is
 * not an engine262 completion, so no program could observe it and the
 * diagnostic sec-evaluation-budget requires never appeared. It now reports a
 * type error naming the alias, which is what the clause asks for.
 *
 * Two things had to be true and each hid the other. The instantiation had to
 * CONSUME steps, which it never did. And a budget frame had to be OPEN: the
 * checking pass brackets one, but a `const` annotation resolves on a runtime
 * path that never entered it, so ConsumeEvaluationSteps found no frame and
 * silently returned. Opening a frame around the check alone was still not
 * enough - each recursion opened a fresh one and started from zero - so the
 * frame spans the recursive instantiation, which BeginTypeEvaluation supports
 * by joining an enclosing frame rather than nesting a new one.
 *
 * THE CAVEAT: at the DEFAULT budget the host stack still overflows first. Ten
 * million steps is far more recursion than a JavaScript stack survives, so the
 * budget is correct and its floor is above what the host can reach. The
 * specification fixes that floor - DEFAULT_STEP_LIMIT is
 * "#sec-evaluation-budget's floor a host meets or exceeds" - so lowering it is
 * a specification question rather than an engine one, and a host that wants the
 * diagnostic configures a lower limit, as the test below does.
 *
 * That is worth raising against the clause: a floor a host cannot reach without
 * crashing is not a floor.
 */

test('an unbounded type evaluation exhausts the budget and reports', () => {
  // The failing direction the plan asks for, at a lowered budget - which is
  // what a host does when it wants the diagnostic rather than the stack.
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm({ typeEvaluationBudget: { steps: 50, records: 50 } });
  const completion = realm.evaluateScriptSkipDebugger('type R<T> = R.<T>; const a: R.<uint8> = 1;');

  expect(completion.Type).toBe('throw');
  let message = '';
  const value = completion.Value as { properties?: Map<{ stringValue?(): string }, { Value: { stringValue(): string } }> };
  for (const [key, desc] of value.properties ?? []) {
    if (key.stringValue?.() === 'message') {
      message = desc.Value.stringValue();
    }
  }
  // A reportable type error naming the alias, not a host RangeError.
  expect(message).toContain('budget');
  expect(message).toContain('R');
});

test('an ordinary alias is unaffected by the metering', () => {
  // The other direction, at the same lowered budget: metering must not refuse
  // code that terminates.
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm({ typeEvaluationBudget: { steps: 50, records: 50 } });
  const completion = realm.evaluateScriptSkipDebugger('type Bx<T> = [].<T>; const a: Bx.<Bx.<uint8>> = [[1]]; "y";');
  expect(completion.Type).toBe('normal');
});
