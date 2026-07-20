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

/** Run with the feature OFF (to check flag-gating and backwards compatibility). */
export function runFlagOff(source: string) {
  setSurroundingAgent(new Agent({ features: [] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

/** Evaluate to the string value of a normal completion (asserts normal). */
export function evaluated(source: string): string {
  const completion = run(source);
  expect(completion, `expected normal completion for: ${source}`).toMatchObject({ Type: 'normal' });
  const v = (completion as unknown as { Value: { stringValue?(): string, numberValue?(): number } }).Value;
  if (v?.stringValue) { return v.stringValue(); }
  if (v?.numberValue) { return String(v.numberValue()); }
  return String(v);
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
