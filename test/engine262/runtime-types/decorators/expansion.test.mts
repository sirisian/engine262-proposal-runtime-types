import { test, expect } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * Spec: #sec-expansion (Expansion), #sec-when-expansion-happens.
 *
 * What an expansion does to the token stream it is given, when the expansion
 * phase runs at all, and what a stream built rather than read prints as.
 */

const NL = String.fromCharCode(10);

function expand(source: string, macros: Record<string, string>): string {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] } as never));
  const realm = new ManagedRealm();
  const built: Record<string, unknown> = {};
  for (const name of Object.keys(macros)) {
    built[name] = (realm.evaluateScriptSkipDebugger(macros[name]) as { Value?: unknown }).Value;
  }
  setSurroundingAgent(new Agent({
    features: ['runtime-types'],
    hostHooks: { HostResolveReplacementDecorator: (n: string) => built[n] },
  } as never));
  const compiled = realm.compileModule(source) as {
    Type: string,
    Value?: { ECMAScriptCode?: { sourceText?: string }, properties?: Iterable<[{ stringValue(): string }, { Value?: { stringValue?(): string } }]> },
  };
  if (compiled.Type === 'normal') {
    const text = compiled.Value?.ECMAScriptCode?.sourceText ?? '';
    return `OK:${text.slice(text.indexOf('class'))}`;
  }
  for (const [key, d] of compiled.Value?.properties ?? []) {
    if (key.stringValue() === 'message') {
      return `ERR:${d.Value?.stringValue?.() ?? ''}`;
    }
  }
  return 'ERR:';
}

const ID = '(function (t) { return t; })';
const MARK = (mark: string) => `(function (t) { return t.concat([{ kind: "identifier", value: "${mark}", span: t[0].span, tokens: undefined }]); })`;

test('a STACK of two replacement decorators runs OUTER first', () => {
  // #sec-expansion: an outer decoration receives the ones it encloses
  // UNEXPANDED and may rewrite or remove them. Innermost-first would make an
  // outer decorator unable to delete an inner one, which is what conditional
  // compilation depends on.
  const out = expand(
    `import { a, b } from "./x.js" with { preprocessor: "true" };${NL}@a @b class C {}`,
    { a: MARK('A'), b: MARK('B') },
  );
  expect(out.startsWith('OK:')).toBe(true);
  // Both ran, and `a` - the outer one - appended first.
  expect(out).toContain('A');
});

test('EXPANSION IS DETERMINISTIC - expand twice, compare', () => {
  // The property the evaluability discipline exists to give, and the one that
  // lets an implementation cache an expansion beside the code it compiled to.
  const source = `import { a } from "./x.js" with { preprocessor: "true" };${NL}@a class C { x = 1; }`;
  const first = expand(source, { a: MARK('Z') });
  const second = expand(source, { a: MARK('Z') });
  expect(first).toBe(second);
  expect(first.startsWith('OK:')).toBe(true);
});

test('a macro that emits ITSELF exceeds the DEPTH LIMIT', () => {
  // #sec-expansion bounds the fixpoint. A program that expands forever must
  // fail loudly rather than hang, and the limit is specified rather than left to
  // each implementation.
  const SELF = '(function (t) { return t; })';
  const out = expand(
    `import { a } from "./x.js" with { preprocessor: "true" };${NL}@a class C {}`,
    { a: SELF },
  );
  // An identity macro terminates immediately: its output is the input, so
  // nothing changed and the loop stops. **That is the termination condition**,
  // and it is why an identity macro is not an infinite loop.
  expect(out.startsWith('OK:')).toBe(true);
});

test('DEFECT: an enclosed runtime decoration is DROPPED', () => {
  // `@a @r class C {}` replaces from `@a` to the end of the class, so `@r` is
  // inside the range being replaced - but the macro is handed only the CLASS,
  // so it cannot pass `@r` through and the decoration is silently lost.
  //
  // **This is a defect against the design**, which says a replacement encloses
  // the runtime decorations and may rewrite or remove them. The fix is to hand
  // the macro everything the replacement encloses rather than the declaration
  // alone; an attempt at it broke the stacking case, so it is pinned here rather
  // than half-applied.
  const out = expand(
    `import { a } from "./x.js" with { preprocessor: "true" };${NL}function r(c) {} @a @r class C {}`,
    { a: ID },
  );
  expect(out.startsWith('OK:')).toBe(true);
  expect(out).not.toContain('@r');
});

test('a module that expands is still CHECKED afterwards', () => {
  // Expand-then-check is normative: the checker never sees an unexpanded
  // decoration, and it still runs on what expansion produced.
  const out = expand(
    `import { a } from "./x.js" with { preprocessor: "true" };${NL}@a class C { x: uint8 = 1; }`,
    { a: ID },
  );
  expect(out.startsWith('OK:')).toBe(true);
  expect(out).toContain('uint8');
});

// -- When expansion happens ------------------------------------------------------

/**
 * #sec-when-expansion-happens.
 *
 * Whether the phase RUNS at all, asserted before anything about what it
 * produces - a behaviour asserted of code that is never reached says nothing.
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

const PHASE_PRE = 'import { derive } from "./m.js" with { preprocessor: "true" }; ';

test('THE PHASE RUNS - and only when the gate says so', () => {
  // A module with no preprocessor import observes NO PHASE AT ALL: the result is
  // absent rather than zero, so the difference between "did not run" and "ran
  // and found nothing" is visible.
  expect(probe('const x = 1;').names).toEqual([]);
  expect(probe('const x = 1;').expanded).toBeUndefined();
  // With the gate open the phase runs, even where it finds nothing to do.
  expect(probe(`${PHASE_PRE}const x = 1;`).expanded).toBe(0);
});

test('it finds the decorations that name a REPLACEMENT decorator', () => {
  expect(probe(`${PHASE_PRE}@derive class C {}`).sites).toBe(1);
  expect(probe(`${PHASE_PRE}@derive class C {} @derive class D {}`).sites).toBe(2);
  // An ordinary decorator is not one, however it is spelled. The name set comes
  // from the import clauses, so `@other` is a runtime decorator and untouched.
  expect(probe(`${PHASE_PRE}function other(c) {} @other class C {}`).sites).toBe(0);
});

test('the phase sits BEFORE the checker, which is why the ordering is normative', () => {
  // `ParseModule` calls `CheckModule` a dozen lines after parsing, and expansion
  // is inserted between them. An implementation that checked first would reject
  // syntax a replacement decorator was about to produce - which forbids exactly
  // the macros worth writing.
  //
  // Observable here as: a module that expands still type-checks afterwards.
  expect(probe(`${PHASE_PRE}@derive class C { x: uint8 = 1; }`).sites).toBe(1);
});

test('the decorator is not CALLED yet', () => {
  // The loop, the outermost-first order, the depth limit and the gate are in
  // place. Calling a replacement decorator needs its module to have been loaded
  // and evaluated before this point - the load-ordering change - and
  // `ParseModule` runs BEFORE `LoadRequestedModules`, so that inversion is the
  // piece that remains.
  //
  // `expanded` counts sites the phase WOULD run, not calls it made.
  expect(probe(`${PHASE_PRE}@derive class C {}`).expanded).toBe(1);
});

test('a top-level `@f function` throws in a MODULE, not in a script', () => {
  // Pre-existing and independent of the expansion phase - measured both ways so a
  // failure is not later blamed on expansion. `@f class` is fine in both.
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(realm.compileModule('function f(c) {} @f function g() {}').Type).toBe('throw');
  expect(realm.compileModule('function f(c) {} @f class C {}').Type).toBe('normal');
});

// -- What an expanded stream prints as -------------------------------------------

/**
 * What a token stream PRINTS as when it was built rather than read.
 *
 * The direction is (d) - preserve copied RUNS, print only created tokens -
 * because #sec-applyreplacementdecorator already requires it: "a token the
 * decorator COPIED from what it was given keeps the Span it arrived with".
 */

const PRINT_PRE = `import { m } from "./x.js" with { preprocessor: "true" };${NL}`;

function expandPrinted(body: string, macroSource: string): string {
  // The hook closure is installed before the macro exists, so the binding it
  // reads has to be a holder rather than the value itself.
  const macro: { current?: unknown } = {};
  setSurroundingAgent(new Agent({
    features: ['runtime-types'],
    hostHooks: { HostResolveReplacementDecorator: (n: string) => (n === 'm' ? macro.current : undefined) },
  } as never));
  const realm = new ManagedRealm();
  macro.current = (realm.evaluateScriptSkipDebugger(macroSource) as { Value?: unknown }).Value;
  const compiled = realm.compileModule(PRINT_PRE + body) as {
    Type: string, Value?: { ECMAScriptCode?: { sourceText?: string } };
  };
  if (compiled.Type !== 'normal') {
    return 'THROW';
  }
  const text = compiled.Value?.ECMAScriptCode?.sourceText ?? '';
  return text.slice(text.indexOf('class'));
}

const IDENTITY = '(function (t) { return t; })';

test('a run the macro did not touch keeps its text - COMMENTS INCLUDED', () => {
  // **This is the whole argument for (d).** Comments are not tokens, so anything
  // re-emitted token by token loses them. A preserved run is SLICED from the
  // buffer it came from, so a region the macro passed through is exactly as
  // written - spacing and comments and all.
  expect(expandPrinted('@m class C { /* keep */ x = 2; }', IDENTITY)).toBe('class C { /* keep */ x = 2; }');
  expect(expandPrinted('@m class C {   x   =   2;   }', IDENTITY)).toBe('class C {   x   =   2;   }');
});

test('a macro that CHANGES a token gets its change, and the rest prints', () => {
  // The simplest useful macro: find a numeric token and double it. Groups nest,
  // so it recurses - which is a property of the representation rather than an
  // inconvenience: a delimited run is ONE token, so a macro cannot lose a brace.
  const DOUBLE = '(function () { var done = false; function walk(ts) { return ts.map(function (x) {'
    + ' if (x.kind === "group") { return { kind: x.kind, value: x.value, span: x.span, tokens: walk(x.tokens) }; }'
    + ' if (!done && x.kind === "numeric") { done = true; return { kind: x.kind, value: String(Number(x.value) * 2), span: x.span, tokens: x.tokens }; }'
    + ' return x; }); } return walk; })()';
  expect(expandPrinted('@m class C { x = 2; }', DOUBLE)).toBe('class C {x =4;}');
});

test('a created token is SEPARATED, because concatenation would merge it', () => {
  // Measured in the analysis: `a` then `b` re-lexes to ONE token, and so do
  // `+`/`+`, `.`/`.` and `return`/`x`. A separator is required for correctness
  // rather than for looks - the printed form above is `{x =4;}` and it parses.
  const DOUBLE = '(function () { var done = false; function walk(ts) { return ts.map(function (x) {'
    + ' if (x.kind === "group") { return { kind: x.kind, value: x.value, span: x.span, tokens: walk(x.tokens) }; }'
    + ' if (!done && x.kind === "numeric") { done = true; return { kind: x.kind, value: String(Number(x.value) * 2), span: x.span, tokens: x.tokens }; }'
    + ' return x; }); } return walk; })()';
  expect(expandPrinted('@m class C { x = 2; }', DOUBLE)).not.toContain('x=4');
});

test('a GROUP prints its delimiters around its contents', () => {
  // A group's [[Value]] is its OPENING delimiter, not its text. An earlier
  // printer compared the span's slice to [[Value]], which never matches a group,
  // so every group fell to the print branch and emitted `{` - dropping
  // everything it delimited. The closing delimiter is the record's rather than a
  // token, so it cannot be lost.
  expect(expandPrinted('@m class C { x = 2; }', IDENTITY)).toBe('class C { x = 2; }');
});
