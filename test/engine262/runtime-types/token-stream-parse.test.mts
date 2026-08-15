import { expect, test } from 'vitest';
import { realmWithMacro } from './harness.mts';

/**
 * `TokenStream.prototype.parse(start, end, goal)`.
 *
 * What lets a macro define a bespoke syntax without the engine knowing anything
 * about it. A macro captures its region, scans whatever it likes, and delegates
 * the one thing it CANNOT do: decide whether `/` begins a regular expression or
 * a division, which is not decidable lexically - after `}` it depends on whether
 * the brace closed a block or an object literal.
 *
 * Rust hands a macro a token stream and needs no such call, because its lexical
 * grammar is parse-INDEPENDENT. JavaScript's is not, which is why the engine
 * offers this rather than leaving a macro to re-implement the grammar.
 */
const NL = String.fromCharCode(10);
const IMPORT = 'import { m } from "./m.js" with { preprocessor: "true" };' + NL;

/** A captured macro that reports its raw tokens beside a delegated parse. */
const DELEGATING = `Object.assign((function (t) {
  var s = t[0] ? t[0].span : undefined;
  var text = t.toString();
  var open = text.indexOf("{"), close = text.lastIndexOf("}");
  var inner = t.parse(open + 1, close, "expression");
  function walk(ts) { return (ts || []).map(function (x) {
    return x.kind === "group" ? "G(" + walk(x.tokens || []) + ")" : x.kind[0] + ":" + String(x.value); }).join(" "); }
  return [{ kind: "string", value: JSON.stringify("RAW[" + walk(t) + "] PARSED[" + walk(inner) + "]"), span: s }];
}), { capture: true })`;

function expandWith(macroSource: string, body: string): string {
  // The macro comes from a MODULE the host loads, as `sec-preprocessor-modules`
  // describes, rather than from a host hook that never appeared in it.
  const realm = realmWithMacro('m', macroSource);
  const module = realm.compileModule(IMPORT + body) as {
    Type: string, Value?: { ECMAScriptCode?: { sourceText?: string } };
  };
  if (module.Type !== 'normal') {
 return 'REFUSED';
}
  const text = module.Value?.ECMAScriptCode?.sourceText ?? '';
  return text.slice(text.indexOf(NL) + 1).trim();
}

test('a delegated parse recovers what re-lexing loses', () => {
  // The contrast IS the feature. Re-lexed, a regular expression is four tokens
  // indistinguishable from a division; parsed, it is one.
  expect(expandWith(DELEGATING, 'const v = @m { /ab/g };'))
    .toBe('const v = "RAW[G(p:/ i:ab p:/ i:g)] PARSED[r:/ab/g]";');
  // A template fares worse re-lexed: `a$` is an identifier that exists in no
  // source, invented by lexing a substitution's text as ECMAScript.
  expect(expandWith(DELEGATING, 'const v = @m { `a${x}b` };'))
    .toBe('const v = "RAW[G(t:` i:a$ G(i:x) i:b t:`)] PARSED[t:`a${x}b`]";');
});

test('an unambiguous range parses to the same tokens either way', () => {
  // Where nothing is parse-dependent the two agree, which is what makes the
  // cases above a REPAIR rather than a difference in representation.
  expect(expandWith(DELEGATING, 'const v = @m { x + 1 };'))
    .toBe('const v = "RAW[G(i:x p:+ n:1)] PARSED[i:x p:+ n:1]";');
});

test('the goal symbol chooses what the range may be', () => {
  const withGoal = (goal: string) => `Object.assign((function (t) {
    var s = t[0] ? t[0].span : undefined;
    var text = t.toString();
    var open = text.indexOf("{"), close = text.lastIndexOf("}");
    var inner = t.parse(open + 1, close, ${JSON.stringify(goal)});
    return [{ kind: "string", value: JSON.stringify(inner.length + " tokens"), span: s }];
  }), { capture: true })`;
  // A statement list is not an expression, so the goal is not decoration.
  expect(expandWith(withGoal('statements'), 'const v = @m { const a = 1; a; };'))
    .toBe('const v = "7 tokens";');
  expect(expandWith(withGoal('expression'), 'const v = @m { const a = 1; a; };'))
    .toBe('REFUSED');
});

test('a range that does not parse is refused', () => {
  expect(expandWith(DELEGATING, 'const v = @m { ) ( };')).toBe('REFUSED');
});

test('an unrecognised goal, and a range outside the source, are refused', () => {
  const badGoal = `Object.assign((function (t) {
    return t.parse(0, 1, "module");
  }), { capture: true })`;
  expect(expandWith(badGoal, 'const v = @m { x };')).toBe('REFUSED');
  const badRange = `Object.assign((function (t) {
    return t.parse(0, 9999, "expression");
  }), { capture: true })`;
  expect(expandWith(badRange, 'const v = @m { x };')).toBe('REFUSED');
});

test('a span exposes the source TEXT its ranges index', () => {
  // `parse(start, end)` indexes the SOURCE, so a macro scanning a captured
  // region needs the same string - and `toString` is a rendering of the tokens,
  // which is not guaranteed to be it. Exposing the source removes the question.
  const reportsBoth = `Object.assign((function (t) {
    var s = t[0].span;
    return [{ kind: "string", value: JSON.stringify(
      (String(t) === s.source.text ? "same" : "differ") + " " + JSON.stringify(s.source.text)), span: s }];
  }), { capture: true })`;
  expect(expandWith(reportsBoth, 'const v = @m { x };'))
    .toBe('const v = "same \\"{ x }\\"";');
  // A macro that scans `source.text` and delegates against it cannot be off by
  // characters the rendering happens to drop, whatever those turn out to be.
  expect(expandWith(reportsBoth, 'const v = @m { /* c */ x };'))
    .toBe('const v = "same \\"{ /* c */ x }\\"";');
});
