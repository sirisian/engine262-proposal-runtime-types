import { test, expect } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * PLAN-engine-decorator-replacement stage G: what a token stream PRINTS as when
 * it was built rather than read.
 *
 * The direction is (d) — preserve copied RUNS, print only created tokens —
 * because `sec-applyreplacementdecorator` already requires it: "a token the
 * decorator COPIED from what it was given keeps the Span it arrived with".
 */

const NL = String.fromCharCode(10);
const PRE = `import { m } from "./x.js" with { preprocessor: "true" };${NL}`;

function expand(body: string, macroSource: string): string {
  let macro: unknown;
  setSurroundingAgent(new Agent({
    features: ['runtime-types'],
    hostHooks: { HostResolveReplacementDecorator: (n: string) => (n === 'm' ? macro : undefined) },
  } as never));
  const realm = new ManagedRealm();
  macro = (realm.evaluateScriptSkipDebugger(macroSource) as { Value?: unknown }).Value;
  const compiled = realm.compileModule(PRE + body) as {
    Type: string, Value?: { ECMAScriptCode?: { sourceText?: string } };
  };
  if (compiled.Type !== 'normal') {
    return 'THROW';
  }
  const text = compiled.Value?.ECMAScriptCode?.sourceText ?? '';
  return text.slice(text.indexOf('class'));
}

const IDENTITY = '(function (t) { return t; })';

test('a run the macro did not touch keeps its text — COMMENTS INCLUDED', () => {
  // **This is the whole argument for (d).** Comments are not tokens, so anything
  // re-emitted token by token loses them. A preserved run is SLICED from the
  // buffer it came from, so a region the macro passed through is exactly as
  // written — spacing and comments and all.
  expect(expand('@m class C { /* keep */ x = 2; }', IDENTITY)).toBe('class C { /* keep */ x = 2; }');
  expect(expand('@m class C {   x   =   2;   }', IDENTITY)).toBe('class C {   x   =   2;   }');
});

test('a macro that CHANGES a token gets its change, and the rest prints', () => {
  // The simplest useful macro: find a numeric token and double it. Groups nest,
  // so it recurses — which is a property of the representation rather than an
  // inconvenience: a delimited run is ONE token, so a macro cannot lose a brace.
  const DOUBLE = '(function () { var done = false; function walk(ts) { return ts.map(function (x) {'
    + ' if (x.kind === "group") { return { kind: x.kind, value: x.value, span: x.span, tokens: walk(x.tokens) }; }'
    + ' if (!done && x.kind === "numeric") { done = true; return { kind: x.kind, value: String(Number(x.value) * 2), span: x.span, tokens: x.tokens }; }'
    + ' return x; }); } return walk; })()';
  expect(expand('@m class C { x = 2; }', DOUBLE)).toBe('class C {x =4;}');
});

test('a created token is SEPARATED, because concatenation would merge it', () => {
  // Measured in the analysis: `a` then `b` re-lexes to ONE token, and so do
  // `+`/`+`, `.`/`.` and `return`/`x`. A separator is required for correctness
  // rather than for looks — the printed form above is `{x =4;}` and it parses.
  const DOUBLE = '(function () { var done = false; function walk(ts) { return ts.map(function (x) {'
    + ' if (x.kind === "group") { return { kind: x.kind, value: x.value, span: x.span, tokens: walk(x.tokens) }; }'
    + ' if (!done && x.kind === "numeric") { done = true; return { kind: x.kind, value: String(Number(x.value) * 2), span: x.span, tokens: x.tokens }; }'
    + ' return x; }); } return walk; })()';
  expect(expand('@m class C { x = 2; }', DOUBLE)).not.toContain('x=4');
});

test('a GROUP prints its delimiters around its contents', () => {
  // A group's [[Value]] is its OPENING delimiter, not its text. An earlier
  // printer compared the span's slice to [[Value]], which never matches a group,
  // so every group fell to the print branch and emitted `{` — dropping
  // everything it delimited. The closing delimiter is the record's rather than a
  // token, so it cannot be lost.
  expect(expand('@m class C { x = 2; }', IDENTITY)).toBe('class C { x = 2; }');
});
