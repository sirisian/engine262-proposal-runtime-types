import { test, expect } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * PLAN-engine-decorator-replacement stage H: the early errors.
 *
 * Two are Static Semantics over `Module : ModuleBody?` and are raised before
 * anything runs. Two come from `ApplyReplacementDecorator`.
 */

const NL = String.fromCharCode(10);
const PRE = 'import { m } from "./x.js" with { preprocessor: "true" }; ';

function outcome(source: string, macroSource?: string): string {
  let macro: unknown;
  setSurroundingAgent(new Agent({
    features: ['runtime-types'],
    hostHooks: { HostResolveReplacementDecorator: (n: string) => (n === 'm' ? macro : undefined) },
  } as never));
  const realm = new ManagedRealm();
  if (macroSource) {
    macro = (realm.evaluateScriptSkipDebugger(macroSource) as { Value?: unknown }).Value;
  }
  const compiled = realm.compileModule(source) as { Type: string, Value?: { properties?: Iterable<[{ stringValue(): string }, { Value?: { stringValue?(): string } }]> } };
  if (compiled.Type === 'normal') {
    return 'ACCEPTED';
  }
  for (const [key, descriptor] of compiled.Value?.properties ?? []) {
    if (key.stringValue() === 'message') {
      return descriptor.Value?.stringValue?.() ?? 'THROW';
    }
  }
  return 'THROW';
}

test('SHADOWING a replacement decorator name is an early error', () => {
  // Load-bearing only for INNER scopes: a TOP-LEVEL redeclaration is already a
  // duplicate binding in ordinary JavaScript, so this rule half restates one the
  // language has. Worth knowing, and worth writing for the case that needs it.
  expect(outcome(`${PRE}{ const m = 1; }`)).toContain('cannot be shadowed');
  expect(outcome(`${PRE}function f() { const m = 1; }`)).toContain('cannot be shadowed');
  expect(outcome(`${PRE}function f(m) {}`)).toContain('cannot be shadowed');
  // The import clause that INTRODUCED the name is not itself a shadow.
  expect(outcome(`${PRE}@m class C {}`)).toBe('ACCEPTED');
});

test('a replacement decorator must be written OUTERMOST', () => {
  // It runs first, so writing it outermost makes source order agree with
  // execution order — and it gives it the capability the arrangement exists for:
  // a replacement ENCLOSES the runtime decorations and may rewrite or remove
  // them with what it replaces.
  expect(outcome(`${PRE}function r(c) {} @r @m class C {}`)).toContain('must be written outermost');
  expect(outcome(`${PRE}function r(c) {} @m @r class C {}`)).toBe('ACCEPTED');
});

test('neither rule fires without a preprocessor import', () => {
  // A module with no replacement decorator names observes nothing.
  expect(outcome('function r(c) {} @r class C {}')).toBe('ACCEPTED');
  expect(outcome('{ const m = 1; }')).toBe('ACCEPTED');
});

test('a macro that THROWS and one that returns the wrong shape are DIFFERENT errors', () => {
  // A macro rejects its input by throwing — what a function does to reject its
  // arguments, and what cannot be ignored. Returning the wrong SHAPE is a
  // different mistake and says so.
  const body = `import { m } from "./x.js" with { preprocessor: "true" };${NL}@m class C { x = 1; }`;
  expect(outcome(body, '(function (t) { return t; })')).toBe('ACCEPTED');
  expect(outcome(body, '(function (t) { throw new TypeError("nope"); })')).toContain('rejected what it decorates');
  expect(outcome(body, '(function (t) { return 42; })')).toContain('did not return tokens');
  expect(outcome(body, '(function (t) { return null; })')).toContain('did not return tokens');
});

test('every one of these is reachable BEFORE anything runs', () => {
  // The property the whole design was built for: each is a Syntax Error from
  // compiling the module, not a failure at some later evaluation.
  expect(outcome(`${PRE}{ const m = 1; }`)).not.toBe('ACCEPTED');
  expect(outcome(`${PRE}function r(c) {} @r @m class C {}`)).not.toBe('ACCEPTED');
});
