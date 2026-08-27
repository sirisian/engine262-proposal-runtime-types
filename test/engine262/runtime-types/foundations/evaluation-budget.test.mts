import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * Spec: #sec-evaluation-budget (The Evaluation Budget).
 *
 * "Evaluation under this clause is metered by two host-defined limits: a count
 * of evaluation steps and a count of constructed Type Records, each per
 * top-level type-position evaluation."
 *
 * The checker and the checking pass run USER CODE by design - a builder at
 * specialization, a `where` predicate at a check, a meta hook at a crossing -
 * so an unbudgeted checker is a denial-of-service surface on any tool that
 * runs one. These tests assert that the meter exists, that it does not change
 * what a program produces, and that exhaustion is not something the evaluated
 * code can catch its way out of.
 */

function runWithBudget(source: string, typeEvaluationBudget?: { steps?: number, records?: number, depth?: number }) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm(typeEvaluationBudget ? { typeEvaluationBudget } as never : undefined);
  return realm.evaluateScriptSkipDebugger(source);
}

const dims = 'type Dim = { m: number, ratio: number }; '
  + 'meta Dim { default = { m: 0, ratio: 1 }; subtype(a, b) { return a.m === b.m; } '
  + 'validate(v, c) { return true; } conversionFactor(a, b) { return a.ratio / b.ratio; } } '
  + 'type Meter = float32.<{ m: 1, ratio: 1 }>; type Kilometer = float32.<{ m: 1, ratio: 1000 }>; ';

// A crossing between two parameterizations of one base, which is what makes
// the pass consult a meta hook at all.
// The crossing the CHECKING PASS adjudicates: a same-base different-metadata
// pair inside a never-called function is deferred by check.mts and decided by
// the pass, which is the evaluation this budget meters. A cast evaluated at
// run time is a different evaluation and is not this clause's business.
const crossing = `${dims} function neverCalled(k: Kilometer) { let m2: Meter = k; } "done";`;

test('the budget does not change what a program produces', () => {
  // "the limits decide whether compilation fails, never what it produces". A
  // default budget is ten million steps and a million records, so no ordinary
  // program comes near it and every existing behaviour is unchanged.
  expect(runWithBudget(crossing)).toMatchObject({ Type: 'normal' });
  expect(runWithBudget('let x: uint8 = 5; String(x);')).toMatchObject({ Type: 'normal' });
  // A generous explicit budget behaves exactly as the default does, which is
  // the property that lets a host raise a floor: raising one can only turn a
  // failure into a result, never a result into a different one.
  expect(runWithBudget(crossing, { steps: 1_000_000, records: 1_000_000 })).toMatchObject({ Type: 'normal' });
});

test('an exhausted budget abandons the type evaluation', () => {
  // Zero steps: the first meta hook the pass would call exhausts it, and the
  // pass reports rather than running on.
  const completion = runWithBudget(crossing, { steps: 0 });
  expect(completion).toMatchObject({ Type: 'throw' });
  // The same source with a budget that admits the work completes, which is
  // what makes the failure the BUDGET's rather than the program's.
  expect(runWithBudget(crossing, { steps: 100 })).toMatchObject({ Type: 'normal' });
});

test('exhaustion is not catchable by the evaluated code', () => {
  // "Exhaustion is not an abrupt completion the evaluated code can observe. No
  // `try` statement within the evaluation handles it." A hook that wraps its
  // own body in `try` cannot swallow the exhaustion and resume, because the
  // state is sticky rather than thrown: every metered point after it
  // short-circuits and the containing evaluation still fails.
  const guarded = 'type Dim = { m: number, ratio: number }; '
    + 'meta Dim { default = { m: 0, ratio: 1 }; subtype(a, b) { try { return a.m === b.m; } catch (e) { return true; } } '
    + 'validate(v, c) { return true; } conversionFactor(a, b) { return a.ratio / b.ratio; } } '
    + 'type Meter = float32.<{ m: 1, ratio: 1 }>; type Kilometer = float32.<{ m: 1, ratio: 1000 }>; '
    + 'function neverCalled(k: Kilometer) { let m2: Meter = k; } "done";';
  expect(runWithBudget(guarded, { steps: 0 })).toMatchObject({ Type: 'throw' });
  expect(runWithBudget(guarded, { steps: 100 })).toMatchObject({ Type: 'normal' });
});

test('the record limit meters constructed Type Records', () => {
  // The second of the two limits, and it counts CONSTRUCTION rather than
  // mention: a type already interned is not built again, so the count follows
  // how many types a program builds and not how often it names them.
  expect(runWithBudget('let x: uint8 = 5; String(x);', { records: 0 })).toMatchObject({ Type: 'normal' });
  expect(runWithBudget(crossing, { records: 1_000_000 })).toMatchObject({ Type: 'normal' });
});

test('the DEPTH limit is what stops a recursive generic alias', () => {
  // A step limit meters TOTAL work and cannot bound stack DEPTH. Each level of a
  // recursive instantiation is a nested call, so a self-referential alias hit the
  // HOST's stack - a few thousand frames - long before ten million steps, and
  // `type R<T> = R.<T>; type X = R.<uint8>;` ended in `Maximum call stack size
  // exceeded`.
  //
  // #sec-evaluation-budget rules that out in terms: exhaustion "is not an abrupt
  // completion the evaluated code can observe" and the evaluation is
  // "abandoned". A host stack overflow is neither - it escapes the engine
  // entirely, so no program observes the diagnostic the clause requires and the
  // surrounding call dies with it. The clause's own comment already named
  // `type R<T> = R.<T>` as the case metering was added for; metering STEPS did
  // not reach it.
  //
  // Every shape recurses, because every one of them nests: the recursion may sit
  // directly in the body or inside a member, and the member may be an object, an
  // array, a tuple, a function parameter, or a union arm.
  const recursions = [
    'type R<T> = R.<T>; type X = R.<uint8>;',
    'type N<T> = { next: N.<T> }; type X = N.<uint8>;',
    'type N<T> = { next: [].<N.<T>> }; type X = N.<uint8>;',
    'type N<T> = { next: [N.<T>] }; type X = N.<uint8>;',
    'type N<T> = { f: (N.<T>) => void }; type X = N.<uint8>;',
    'type N<T> = { next: N.<T> | null }; type X = N.<uint8>;',
    // Mutual recursion, which no single declaration's own name would catch.
    'type A<T> = { b: B.<T> }; type B<T> = { a: A.<T> }; type X = A.<uint8>;',
  ];
  for (const source of recursions) {
    // A COMPLETION, not a host throw. If the depth limit regresses this line
    // does not fail - the call escapes vitest's expectation entirely - so the
    // shape of the assertion matters as much as the assertion.
    expect(runWithBudget(`${source} String(1);`)).toMatchObject({ Type: 'throw' });
  }
});

test('the depth limit does not reject ordinary nesting', () => {
  // The limit is a floor set well clear of anything written on purpose. A
  // non-recursive generic, and a legitimately nested one, are untouched.
  expect(runWithBudget('type Box<T> = { v: T }; type X = Box.<Box.<Box.<uint8>>>; String(1);'))
    .toMatchObject({ Type: 'normal' });
  // Non-generic self-reference is a different rule entirely and keeps its own,
  // sharper diagnostic about a finite layout rather than a budget.
  expect(runWithBudget('type L = { next: L }; String(1);')).toMatchObject({ Type: 'throw' });
});
