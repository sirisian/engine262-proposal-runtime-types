import { expect } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * Shared harness for the README feature suite. Each test verifies a concrete,
 * engine-checkable part of a feature described in ecmascript-types/README.md.
 *
 * The suite is organized to mirror the README's section order, one file per run
 * of sections, so a reader can walk the proposal and the tests side by side. Where
 * a feature's full surface is out of the core engine's scope (SIMD hardware ops,
 * memory layout, and the like), the test verifies the part that is implemented and
 * says plainly, in a comment, what is deferred to an extension document.
 */

/** Run a script with the runtime-types feature on; return the raw completion. */
export function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

/** Extract the string-ish value of a normal completion (shared by the evaluators). */
function normalValueString(completion: unknown, source: string): string {
  expect(completion, `expected normal completion for: ${source}`).toMatchObject({ Type: 'normal' });
  const v = (completion as { Value: { stringValue?(): string, numberValue?(): number } }).Value;
  if (v?.stringValue) { return v.stringValue(); }
  if (v?.numberValue) { return String(v.numberValue()); }
  return String(v);
}

/**
 * Run a script under a fixed pseudorandom seed (via HostDefined.randomSeed) and
 * return its string value. Two calls with the same seed start from the same
 * stream, so a sequence of draws is reproducible.
 */
export function evaluatedSeeded(seed: string, source: string): string {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm({ randomSeed: () => seed });
  return normalValueString(realm.evaluateScriptSkipDebugger(source), source);
}

/**
 * Evaluate several scripts in order on ONE realm and return the last one's
 * string value. Because the automatic job queue drains between evaluations, an
 * earlier script may schedule microtasks (an async function's continuation, a
 * settled promise) whose effects a later reader script then observes.
 */
export function evaluatedSequence(sources: readonly string[]): string {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  let last = '';
  for (const source of sources) {
    last = normalValueString(realm.evaluateScriptSkipDebugger(source), source);
  }
  return last;
}

/** Run with the feature OFF (to check flag-gating and backwards compatibility). */
export function runFlagOff(source: string) {
  setSurroundingAgent(new Agent({ features: [] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

/** Evaluate to the string value of a normal completion (asserts normal). */
export function evaluated(source: string): string {
  return normalValueString(run(source), source);
}

/** True iff `source` runs to a normal completion. */
export function ok(source: string): boolean {
  return (run(source) as { Type: string }).Type === 'normal';
}

/** Assert `source` throws (a TypeError or other), i.e. is rejected at run time. */
export function expectThrown(source: string) {
  expect(run(source), `expected throw for: ${source}`).toMatchObject({ Type: 'throw' });
}

/** Assert `source` is a parse/early error under the feature (does not run). */
export function expectError(source: string) {
  const c = run(source) as { Type: string };
  expect(c.Type, `expected error (throw) for: ${source}`).toBe('throw');
}

/** Evaluate to the string value of a normal completion with the feature OFF. */
export function evaluatedFlagOff(source: string): string {
  return normalValueString(runFlagOff(source), source);
}

/** Assert `source` is an error with the feature OFF (syntax stays invalid). */
export function expectErrorFlagOff(source: string) {
  const c = runFlagOff(source) as { Type: string };
  expect(c.Type, `expected flag-off error for: ${source}`).toBe('throw');
}

/**
 * Evaluate a boolean-ish type expression to 'true'/'false'. Convention: the
 * source ends in an expression that stringifies a boolean, e.g.
 * `String(A === B)`.
 */
export function bool(source: string): boolean {
  return evaluated(source) === 'true';
}
