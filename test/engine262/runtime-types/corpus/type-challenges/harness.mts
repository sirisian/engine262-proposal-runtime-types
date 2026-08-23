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
import { STD_TYPES_SOURCE } from '../../../../../src/type-system/std-types.mts';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * proposal-runtime-types `annex-standard-kit`, PLAN-std-types.md phase 4: THE
 * REAL KIT, as a script prelude.
 *
 * Three corpus files each carried their own `const KIT` string of five to eight
 * hand-written helpers, and dozens of challenges open-coded the same few
 * builders inline - `literal` 22 times, `tupleOf` 21, `union` 18,
 * `elementTypes` 18, `objectOf` 14, `arms` 10. Every one of those was a place
 * the corpus and the shipped kit could drift apart silently, which is the
 * failure `annex-standard-kit` forbids: "Where the kit and the core describe
 * one operation, they must agree."
 *
 * This is the SHIPPED source - `STD_TYPES_SOURCE`, imported from the engine,
 * not a copy - with `export` stripped so its functions are ordinary script
 * declarations. The corpus harness evaluates SCRIPTS, so a prelude is how the
 * kit reaches it; `standard-kit.test.mts` uses the module path instead, because
 * there the import is itself under test.
 *
 * A challenge that implements a helper the kit also exports keeps its own: a
 * later function declaration wins over an earlier one at the same scope, so
 * `partial` written by challenge 4 shadows the kit's. That is the exercise
 * rule - "implementing the utility is the whole point" - and this prelude
 * replaces only the SCAFFOLDING a challenge uses to express its answer.
 */
const KIT_ONLY = STD_TYPES_SOURCE.replace(/^export /gm, '');

/**
 * Three helpers the corpus's own preludes defined and the kit deliberately does
 * NOT export, kept here so the challenges that use them keep working.
 *
 * They share the property that makes them not kit material: every `std:types`
 * export returns a TYPE or a piece of one, and these return ordinary JavaScript
 * VALUES - an array of reflection nodes, a Set of names, a Set of literal
 * values. They are conveniences for writing a challenge, not builders, and
 * putting them in the kit would widen its surface with things that do not build
 * anything.
 *
 * `props(T)` is one expression over `reflect`; the other two are one expression
 * over `arms` and `reflect`. Written here rather than inlined at each call site
 * so the corpus keeps reading as it did.
 */
const CORPUS_LOCAL = `
function props(T) { return reflect(T).properties; }
function keysSet(T) { return new Set(reflect(T).properties.map(p => p.name)); }
function keyVals(K) { return new Set(arms(K).map(a => reflect(a).value)); }
`;

/**
 * The full corpus prelude: the shipped kit, plus the three value-level helpers
 * above. Exported as `KIT` because that is the name the challenges already use,
 * and because a challenge should not have to know which of the two halves a
 * helper came from - it only has to know that neither is written here twice.
 */
export const KIT = `${KIT_ONLY}\n${CORPUS_LOCAL}`;

/** A challenge program with the corpus prelude in scope. */
export const kit = (program: string) => `${KIT}\n${program}`;

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
