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
 * The kit's exports also reachable as `std.<name>`, which is how
 * typechallenges.md's "With std:types" blocks are written - the corpus document
 * imports the module as a namespace. Built by scraping the export names out of
 * the source rather than listing them, so a helper added to the kit is reachable
 * both ways without editing this file.
 */
const STD_NAMESPACE = `const std = { ${STD_TYPES_SOURCE.split('\n')
  .filter((line) => line.startsWith('export function '))
  .map((line) => line.slice('export function '.length).split('(')[0])
  .join(', ')} };`;

/**
 * The full corpus prelude: the shipped kit, plus the three value-level helpers
 * above. Exported as `KIT` because that is the name the challenges already use,
 * and because a challenge should not have to know which of the two halves a
 * helper came from - it only has to know that neither is written here twice.
 */
export const KIT = `${KIT_ONLY}\n${CORPUS_LOCAL}\n${STD_NAMESPACE}`;

/**
 * A challenge program with the corpus prelude in scope, minus any export the
 * program declares for itself.
 *
 * PLAN-std-types.md phase 4b step 7. Shadowing was supposed to make this
 * unnecessary: a challenge that implements a helper the kit also exports
 * declares its own `function omit`, a later declaration wins over an earlier
 * one, and the exercise rule - "implementing the utility is the whole point" -
 * keeps working.
 *
 * That holds for an UNANNOTATED declaration and fails for an annotated one.
 * Two `function mutable(T: type): type` at one scope are a duplicate OVERLOAD,
 * not a shadow, and the second is a Syntax Error. So the prelude was safe for
 * the corpus's older challenges and unsafe for its typed ones - a distinction
 * neither program hints at, and one that broke `concat`, `merge`, `mutable`,
 * `reverse` and `zip`.
 *
 * Rather than renaming those challenges to suit the harness, or wrapping the
 * prelude and losing the bare-name spelling the corpus uses throughout, the
 * prelude simply omits what the program is about to declare. The challenge's
 * definition is then the only one, which is what shadowing was meant to
 * achieve.
 */
export const kit = (program: string) => {
  const declared = new Set(
    [...program.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
  );
  const exported = STD_TYPES_SOURCE.split('\n')
    .filter((line) => line.startsWith('export function '))
    .map((line) => line.slice('export function '.length).split('(')[0]);
  // The kit evaluates INSIDE a closure and is handed out as `std`, so a name the
  // challenge redeclares cannot reach the kit's own calls: `removeKind` keeps
  // calling the kit's `omit` even where the challenge defines a different one.
  // Exposing it by destructuring rather than by declaration is also what lets a
  // name simply be omitted - a `const` that is never introduced cannot clash
  // with the `function` the challenge declares.
  const kept = exported.filter((name) => !declared.has(name));
  const namespace = `const std = (() => {\n${KIT_ONLY}\nreturn { ${exported.join(', ')} };\n})();`;
  const bare = kept.length > 0 ? `const { ${kept.join(', ')} } = std;` : '';
  return `${namespace}\n${bare}\n${CORPUS_LOCAL}\n${program}`;
};

export interface ChallengeResult {
  readonly completion: 'normal' | 'throw';
  readonly value: string | undefined;
  /** The thrown error's message, where the program threw. */
  readonly error?: string | undefined;
}

/** Evaluate a builder source in a fresh runtime-types realm. */
export function evaluateBuilder(source: string): ChallengeResult {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const completion = realm.evaluateScriptSkipDebugger(source) as unknown as {
    Type: 'normal' | 'throw';
    Value?: { stringValue?(): string };
  };
  // PLAN-std-types.md phase 4b: report the THROWN MESSAGE, not the first sixty
  // characters of source. Those sixty characters are now the kit prelude, so a
  // failure read "builder threw: const std = (() => { // ---- foundations" for
  // every challenge in the corpus - identical, and useless for telling one
  // cause from another. Triaging the ported blocks was impossible until this
  // reported what actually went wrong.
  let error;
  if (completion.Type === 'throw') {
    const v = completion.Value as unknown as {
      properties?: Map<{ stringValue?(): string }, { Value?: { stringValue?(): string } }>,
      stringValue?(): string,
    };
    for (const [k, entry] of v?.properties ?? []) {
      if (k.stringValue?.() === 'message') {
        error = entry.Value?.stringValue?.();
      }
    }
    error ??= v?.stringValue?.();
  }
  return {
    completion: completion.Type,
    value: completion.Value?.stringValue?.(),
    error,
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
  expect(result.completion, `builder threw: ${result.error}`).toBe('normal');
  expect(result.value).toBe('true');
}

/** A challenge that is expected to fail type-checking or throw (e.g. @ts-expect-error cases). */
export function expectBuilderThrows(source: string): void {
  const result = evaluateBuilder(source);
  expect(result.completion, `expected throw, got normal: ${source.slice(0, 60)}`).toBe('throw');
}
