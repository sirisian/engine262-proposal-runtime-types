/**
 * Harness for the type-challenge corpus (ecmascript-types/examples/typechallenges.md).
 *
 * Each challenge's builder solution is a sequence of statements ending in one or
 * more assertion expressions written as bare statements, e.g.
 *
 *   type HelloWorld = string;
 *   HelloWorld === string;              // an assertion: must be true
 *   Reflect.typeOf('hi') === HelloWorld;
 *
 * The corpus note says: "The harness's `Expect<Equal<X, Y>>` becomes `===`, so
 * the cases are written as plain assertions." So every top-level `===` (or other
 * boolean) expression statement in a builder is a claim that must hold. This
 * harness runs a builder and asserts that each such claim evaluates to `true`.
 *
 * Type identity via interning is the load-bearing mechanism: `A === B` is true
 * iff A and B are the same interned Type Object. The corpus asserts with it
 * directly, so the harness does no special handling; it just evaluates and
 * checks truthiness.
 */
import { expect } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

export interface ChallengeResult {
  readonly completion: 'normal' | 'throw';
  readonly value: string | undefined;
}

/** Evaluate a builder source in a fresh runtime-types realm. */
export function evaluateBuilder(source: string): ChallengeResult {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const completion = realm.evaluateScriptSkipDebugger(source) as unknown as {
    Type: 'normal' | 'throw';
    Value?: { stringValue?(): string };
  };
  return {
    completion: completion.Type,
    value: completion.Value?.stringValue?.(),
  };
}

/**
 * Run a challenge whose builder is written so that its final expression is the
 * assertion to check. Wraps the source so the last expression's boolean value is
 * returned as a string, and asserts it is "true".
 *
 * `assertions` are appended as `String(<expr>)` probes; each must yield "true".
 * This lets a challenge with multiple `===` claims be checked individually with
 * a clear per-assertion failure, rather than relying on the last statement only.
 */
export function runChallenge(builder: string, assertions: readonly string[]): void {
  for (const assertion of assertions) {
    // Re-evaluate the builder with this assertion as the final, stringified
    // expression. Fresh realm per assertion keeps them independent.
    const source = `${builder}\nString(${assertion});`;
    const result = evaluateBuilder(source);
    if (result.completion !== 'normal') {
      throw new Error(`assertion threw: ${assertion}`);
    }
    expect(result.value, `assertion failed: ${assertion}`).toBe('true');
  }
}

/**
 * The simplest shape: a self-contained builder that ends in `String(<bool>)` (or
 * whose assertions are already inlined). Asserts the whole program yields "true".
 */
export function expectBuilderTrue(source: string): void {
  const result = evaluateBuilder(source);
  expect(result.completion, `builder threw: ${source.slice(0, 60)}`).toBe('normal');
  expect(result.value).toBe('true');
}

/** A challenge that is expected to fail type-checking or throw (e.g. @ts-expect-error cases). */
export function expectBuilderThrows(source: string): void {
  const result = evaluateBuilder(source);
  expect(result.completion, `expected throw, got normal: ${source.slice(0, 60)}`).toBe('throw');
}
