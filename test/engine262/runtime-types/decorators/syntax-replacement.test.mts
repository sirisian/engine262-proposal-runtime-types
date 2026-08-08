import { test, expect } from 'vitest';
import {
  Agent, ManagedRealm, Parser, ReplacementDecoratorNames, setSurroundingAgent,
} from '#self';

/**
 * Spec: #sec-syntax-replacement (Syntax Replacement) - the early errors.
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
  // execution order - and it gives it the capability the arrangement exists for:
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
  // A macro rejects its input by throwing - what a function does to reject its
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


test('a macro that is not COMPILE-TIME EVALUABLE never runs', () => {
  // #sec-preprocessor-modules requires a replacement decorator to be evaluable,
  // and it is checked BEFORE the call - so a macro that names the clock does not
  // get to run once and be caught afterwards.
  //
  // **This was thought to wait on load ordering** and did not: a function object
  // RETAINS ITS OWN SOURCE, the retention `Function.prototype.toString` already
  // requires, so the source to check arrives with the function. The blocker was
  // an assumption about where the source lives.
  const body = `import { m } from "./x.js" with { preprocessor: "true" };${NL}@m class C { x = 1; }`;
  expect(outcome(body, '(function (t) { return t; })')).toBe('ACCEPTED');
  expect(outcome(body, '(function (t) { return Date.now() ? t : t; })')).toContain('not compile-time evaluable');
  expect(outcome(body, '(function (t) { return Math.random() ? t : t; })')).toContain('not compile-time evaluable');
  expect(outcome(body, '(function (t) { return fetch ? t : t; })')).toContain('not compile-time evaluable');
  // The message NAMES what was named and why, since "not evaluable" alone would
  // send an author looking through a whole function.
  expect(outcome(body, '(function (t) { return Date.now() ? t : t; })')).toContain('the wall clock');
  // LOCAL mutation stays legal - a macro must still be able to compute.
  expect(outcome(body, '(function (t) { const s = new Set(); return s.has(1) ? t : t; })')).toBe('ACCEPTED');
});

// -- ReplacementDecoratorNames ---------------------------------------------------

/**
 * #sec-static-semantics-replacementdecoratornames:
 * #sec-static-semantics-replacementdecoratornames.
 */

function names(source: string): string {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  void new ManagedRealm();
  const module = new Parser({ source, specifier: 't' }).parseModule();
  return ReplacementDecoratorNames(module).join(',') || '(none)';
}

test('a preprocessor import introduces its NAMED bindings', () => {
  expect(names('import { derive } from "./m.js" with { preprocessor: "true" };')).toBe('derive');
  expect(names('import { a, b } from "./m.js" with { preprocessor: "true" };')).toBe('a,b');
});

test('an ordinary import introduces nothing', () => {
  expect(names('import { derive } from "./m.js";')).toBe('(none)');
  expect(names('import { derive } from "./m.js" with { type: "json" };')).toBe('(none)');
});

test('only NamedImports contribute - three forms that parse and provide nothing', () => {
  // A default import, a namespace import and a bare specifier introduce no name
  // a DECORATION can be spelled with under the Strict Lexical Rule. All three
  // parse, so a developer can write them and get a preprocessor module that
  // provides no decorators - which is why each is asserted rather than assumed.
  expect(names('import d from "./m.js" with { preprocessor: "true" };')).toBe('(none)');
  expect(names('import * as ns from "./m.js" with { preprocessor: "true" };')).toBe('(none)');
  expect(names('import "./m.js" with { preprocessor: "true" };')).toBe('(none)');
});

test('the names come from the IMPORT CLAUSES, not from scope', () => {
  // A TOP-LEVEL redeclaration is already a SyntaxError in ordinary JavaScript -
  // `import { derive }` then `const derive` is a duplicate binding - so the
  // Strict Lexical Rule's early error is only load-bearing for INNER scopes.
  // Worth knowing before writing a rule that is half redundant.
  // **This is the property the whole rule rests on.** Deciding by scope would be
  // circular: a replacement decorator may introduce declarations, so the scope
  // to resolve against is not final until expansion finishes - which is the
  // thing being decided. A syntactic scan is available before anything runs.
  //
  // An INNER declaration of the same name does not remove it from the set. This
  // is the case the Strict Lexical Rule's early error exists for, and the
  // replacement path
  // raises it.
  expect(names('import { derive } from "./m.js" with { preprocessor: "true" };\n{ const derive = 1; }')).toBe('derive');
  expect(names('import { derive } from "./m.js" with { preprocessor: "true" };\nfunction f() { const derive = 1; }')).toBe('derive');
  // And a module with none is the common case: it decides that no expansion
  // phase runs at all.
  expect(names('const x = 1; export { x };')).toBe('(none)');
});

test('`preprocessor` is a supported import attribute key', () => {
  // Without this a conforming host rejects the attribute before anything else in
  // the feature can run.
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  void new ManagedRealm();
  expect(names('import { d } from "./m.js" with { preprocessor: "true" };')).toBe('d');
});

test('the gate is recorded on the parsed module, before the checker runs', () => {
  // `ParseModule` computes the names where the parsed module first exists and
  // where `CheckModule` is about to run - which is exactly the seam expansion
  // occupies. **The ordering is normative**: expand, then check, so the checker
  // never sees an unexpanded decoration and never rejects syntax a replacement
  // decorator was about to produce.
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const gate = (source: string) => {
    const compiled = realm.compileModule(source) as {
      Value?: { ECMAScriptCode?: { ReplacementDecoratorNames?: readonly string[] } },
    };
    return JSON.stringify(compiled.Value?.ECMAScriptCode?.ReplacementDecoratorNames ?? 'ABSENT');
  };
  expect(gate('import { derive } from "./m.js" with { preprocessor: "true" }; const x = 1;')).toBe('["derive"]');
  // **A module with none observes no phase at all** - same parse, same errors,
  // same positions. That is the common case, and it is what makes a gate worth
  // computing rather than always expanding.
  expect(gate('const x = 1;')).toBe('[]');
  expect(gate('import { a } from "./m.js"; const x = 1;')).toBe('[]');
});
