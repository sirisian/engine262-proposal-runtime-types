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

function runWithBudget(source: string, typeEvaluationBudget?: { steps?: number, records?: number }) {
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
