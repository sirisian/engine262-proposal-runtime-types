import { test, expect } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * PLAN-engine-decorator-replacement stage F: `sec-expansion` and
 * `sec-when-expansion-happens`.
 *
 * The plan's instruction for this stage was to probe whether the phase RUNS
 * before anything about what it produces, because this project has repeatedly
 * spent cycles on the behaviour of code that was never reached.
 */

interface Probe { names?: readonly string[]; expanded?: number; sites?: number }

function probe(source: string): Probe {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const compiled = realm.compileModule(source) as {
    Value?: { ECMAScriptCode?: { ReplacementDecoratorNames?: readonly string[], ExpansionResult?: { expanded?: number, sites?: readonly unknown[] } } };
  };
  const body = compiled.Value?.ECMAScriptCode;
  return {
    names: body?.ReplacementDecoratorNames,
    expanded: body?.ExpansionResult?.expanded,
    sites: body?.ExpansionResult?.sites?.length,
  };
}

const PRE = 'import { derive } from "./m.js" with { preprocessor: "true" }; ';

test('THE PHASE RUNS — and only when the gate says so', () => {
  // A module with no preprocessor import observes NO PHASE AT ALL: the result is
  // absent rather than zero, so the difference between "did not run" and "ran
  // and found nothing" is visible.
  expect(probe('const x = 1;').names).toEqual([]);
  expect(probe('const x = 1;').expanded).toBeUndefined();
  // With the gate open the phase runs, even where it finds nothing to do.
  expect(probe(`${PRE}const x = 1;`).expanded).toBe(0);
});

test('it finds the decorations that name a REPLACEMENT decorator', () => {
  expect(probe(`${PRE}@derive class C {}`).sites).toBe(1);
  expect(probe(`${PRE}@derive class C {} @derive class D {}`).sites).toBe(2);
  // An ordinary decorator is not one, however it is spelled. The name set comes
  // from the import clauses, so `@other` is a runtime decorator and untouched.
  expect(probe(`${PRE}function other(c) {} @other class C {}`).sites).toBe(0);
});

test('the phase sits BEFORE the checker, which is why the ordering is normative', () => {
  // `ParseModule` calls `CheckModule` a dozen lines after parsing, and expansion
  // is inserted between them. An implementation that checked first would reject
  // syntax a replacement decorator was about to produce — which forbids exactly
  // the macros worth writing.
  //
  // Observable here as: a module that expands still type-checks afterwards.
  expect(probe(`${PRE}@derive class C { x: uint8 = 1; }`).sites).toBe(1);
});

test('PINNED: the decorator is not CALLED yet', () => {
  // The loop, the outermost-first order, the depth limit and the gate are in
  // place. Calling a replacement decorator needs its module to have been loaded
  // and evaluated before this point — the load-ordering change — and
  // `ParseModule` runs BEFORE `LoadRequestedModules`, so that inversion is the
  // piece that remains.
  //
  // `expanded` counts sites the phase WOULD run, not calls it made.
  expect(probe(`${PRE}@derive class C {}`).expanded).toBe(1);
});

test('PINNED: a top-level `@f function` throws in a MODULE, not in a script', () => {
  // Pre-existing and independent of this work — measured both ways so a stage F
  // failure is not later blamed on expansion. `@f class` is fine in both.
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(realm.compileModule('function f(c) {} @f function g() {}').Type).toBe('throw');
  expect(realm.compileModule('function f(c) {} @f class C {}').Type).toBe('normal');
});
