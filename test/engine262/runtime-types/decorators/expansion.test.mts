import { test, expect } from 'vitest';
import { realmWithMacro, realmWithMacros } from '../harness.mts';
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
  // The macros come from a MODULE the host loads, which is how
  // `sec-preprocessor-modules` says a decoration is resolved. A module may
  // export several, which is what a fixture with two decorations needs.
  const realm = realmWithMacros(macros);
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
// Appends a marker STATEMENT. It appended a bare identifier until the printer
// stopped merging created tokens: a stack of two then produced `B A`, which ran
// together as the single identifier `BA` and parsed - so the test passed on
// output that was never valid.
const MARK = (mark: string) => `(function (t) { return t.concat([{ kind: "identifier", value: "${mark}", span: t[0].span, tokens: undefined }, { kind: \"punctuator\", value: \";\", span: t[0].span, tokens: undefined }]); })`;

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

test('a top-level decoration takes the same forms a nested one does', () => {
  // This asserted the opposite - that `@f function` throws in a module - and it
  // was a defect rather than a rule. The module-item path parsed the decorator
  // list and then called parseClassDeclaration unconditionally, so at module TOP
  // LEVEL only a class could be decorated, while the same decoration nested in a
  // function worked for a function, a `let`, a `const`, an enum and a block.
  //
  // `sec-syntax-replacement` says every decorable position may be
  // syntax-replaced, and a component macro - `@jsx export function App()` - sits
  // exactly at module top level, so the two paths now share one dispatch.
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(realm.compileModule('function f(c) {} @f function g() {}').Type).toBe('normal');
  expect(realm.compileModule('function f(c) {} @f class C {}').Type).toBe('normal');
  expect(realm.compileModule('function f(c) {} @f let v = 1;').Type).toBe('normal');
  expect(realm.compileModule('function f(c) {} @f const w = 1;').Type).toBe('normal');
  expect(realm.compileModule('function f(c) {} @f enum E { A }').Type).toBe('normal');
  expect(realm.compileModule('function f(c) {} @f { let a = 1; }').Type).toBe('normal');
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
  const realm = realmWithMacro('m', macroSource);
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
  expect(expandPrinted('@m class C { x = 2; }', DOUBLE)).toBe('class C {x = 4;}');
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

// -- A decoration's own arguments ------------------------------------------------
//
// decoratorreplacement.md 4.2: "The trailing arguments are the decorator's own,
// and they are tokens like everything else - `@derive(Serialize)` passes the
// identifier token `Serialize`, never an eval."
//
// An argumented decoration was never collected as an expansion site at all, so
// the macro was not called AND the decoration survived into the output, where it
// later means something else. It was silent rather than an error. The cause was
// reading [[MemberExpression]]: `@m` puts an IdentifierReference there, but
// `@m(X)` puts a CallExpression in the decoration's own [[CallExpression]] field
// and leaves [[MemberExpression]] empty.
/**
 * Like expandPrinted, but answers the whole expanded body. The helper above
 * slices from `class`, which suits a macro that returns one; these macros report
 * what they RECEIVED, so there is nothing to slice to.
 */
function expandedBody(body: string, macroSource: string): string {
  const realm = realmWithMacro('m', macroSource);
  const compiled = realm.compileModule(PRINT_PRE + body) as {
    Type: string, Value?: { ECMAScriptCode?: { sourceText?: string } };
  };
  if (compiled.Type !== 'normal') {
    return 'THROW';
  }
  const text = compiled.Value?.ECMAScriptCode?.sourceText ?? '';
  return text.slice(text.indexOf(NL) + 1).trim();
}

const ARGS = '(function (t, c, a) { var s = t[0].span;'
  + ' var txt = "n" + arguments.length + ":" + (a ? a.map(function (x) { return x.kind; }).join(",") : "none");'
  + ' return [{ kind: "string", value: JSON.stringify(txt), span: s }]; })';

test('an argumented decoration expands, and a bare one is called without args', () => {
  // Every decoration is called with the TOKENS and a CONTEXT; arguments are a
  // third parameter and only present where the decoration has any. So a bare
  // decoration is two arguments and an argumented one is three.
  expect(expandedBody('@m class C { x = 1; }', ARGS)).toBe('"n2:none"');
  expect(expandedBody('@m(Serialize) class C { x = 1; }', ARGS)).toBe('"n3:group"');
});

test('the arguments arrive as tokens, not as an evaluated value', () => {
  // A `group` token whose contents are the argument list - the parenthesized run,
  // which is how every delimited run reaches a macro. `Serialize` is never
  // looked up: expansion runs before anything is evaluated, so a binding of that
  // name need not exist.
  expect(expandedBody('@m(Serialize) class C {}', ARGS)).toBe('"n3:group"');
  expect(expandedBody('@m(A, B) class C {}', ARGS)).toBe('"n3:group"');
  expect(expandedBody('@m("literal") class C {}', ARGS)).toBe('"n3:group"');
  // An empty argument list is still an argument list - `@m()` is not `@m`.
  expect(expandedBody('@m() class C {}', ARGS)).toBe('"n3:group"');
});

test('an argumented decoration is replaced along with what it decorates', () => {
  // The whole point of the defect: the decoration must not survive into the
  // output. `@m(X)` and its class are both gone, replaced by what the macro
  // returned.
  expect(expandPrinted('@m(X) class C { x = 1; }', IDENTITY)).toBe('class C { x = 1; }');
});

// -- A created token is printed, not sliced ------------------------------------
//
// A token a macro CREATED has no buffer to slice from, so it is printed with a
// separator before it. A token the macro handed back unchanged is sliced from
// the buffer it came from, which is what keeps an untouched run exactly as
// written, comments included.
//
// The two were told apart by asking whether the buffer at the token's span
// matched its value. That is trivially TRUE for a created token, because its
// span is self-relative and the buffer IS its own text - so every created token
// was mistaken for a preserved one and printed with no separator at all.
const EMIT = (tokens: string) => `(function (t) { var s = t[0].span;`
  + ` function k(kind, v) { return { kind: kind, value: v, span: s }; }`
  + ` function g(v, inner) { return { kind: "group", value: v, span: s, tokens: inner }; }`
  + ` return ${tokens}; })`;

test('created tokens are separated, so a keyword does not merge with a name', () => {
  // `const` and `a` printed as `consta`, which is a valid program that declares
  // nothing - a silent change of meaning rather than an error.
  expect(expandedBody('@m class C {}', EMIT('[k("identifier","const"), k("identifier","a"), '
    + 'k("punctuator","="), k("numeric","1"), k("punctuator",";")]'))).toBe('const a = 1 ;');
  // `function` and `f` printed as `functionf`, and `functionf () {}` does not
  // parse - so a macro could not emit a function declaration at all.
  expect(expandedBody('@m class C {}', EMIT('[k("identifier","function"), k("identifier","f"), '
    + 'g("(", []), g("{", [])]'))).toBe('function f () {}');
});

test('a macro can emit a declaration beside what it replaces', () => {
  // This is what a hoisting macro needs: a statement position admits several
  // statements, so a template constant can be emitted at the scope the
  // decoration sat in and referred to by the construct that replaces it.
  expect(expandedBody('@m class C {}', EMIT('[k("identifier","const"), k("identifier","$t"), '
    + 'k("punctuator","="), g("[", [k("string","\\"<div>\\"")]), k("punctuator",";"), '
    + 'k("identifier","function"), k("identifier","View"), g("(", []), '
    + 'g("{", [k("identifier","return"), k("identifier","$t"), k("punctuator",";")])]')))
    .toBe('const $t = ["<div>"] ; function View () {return $t ;}');
});

test('two adjacent identifiers are now a Syntax Error rather than one name', () => {
  // The severity of the defect in one line: `a` then `b` is not a program, and
  // printing it as `ab` made it one.
  expect(expandedBody('@m class C {}', EMIT('[k("identifier","a"), k("identifier","b"), '
    + 'k("punctuator",";")]'))).toBe('THROW');
});

test('a token handed back unchanged is still sliced, comments and all', () => {
  // The other half: preservation must not regress, since it is what a macro
  // that rewrites one thing and leaves the rest alone depends on.
  expect(expandedBody('@m class C { /* kept */ x = 1; }', IDENTITY))
    .toBe('class C { /* kept */ x = 1; }');
});

// -- A decoration may cover an EXPORTED declaration ----------------------------
//
// `sec-syntax-replacement`: "Every decorable position may be syntax-replaced,
// including the positions that do not admit value replacement." A declaration is
// one whether or not it is exported, and a stale early error - a TODO predating
// the proposal - refused every exported form.
//
// It matters beyond tidiness. `@jsx export function View() {...}` is the shape a
// component macro is written in, and it is the only one from which a macro can
// emit a constant BESIDE what it replaces: a decoration INSIDE the export has
// its replacement range inside the export, so a constant emitted there would
// join the export and stop exporting the function.
test('a decoration may precede an export', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(realm.compileModule('function f(c) {} @f export function g() {}').Type).toBe('normal');
  expect(realm.compileModule('function f(c) {} @f export class C {}').Type).toBe('normal');
  expect(realm.compileModule('function f(c) {} @f export const a = 1;').Type).toBe('normal');
  expect(realm.compileModule('function f(c) {} @f export default function g() {}').Type).toBe('normal');
  // The decoration inside the export is unaffected.
  expect(realm.compileModule('function f(c) {} export @f class C {}').Type).toBe('normal');
});

test('a decoration on each side of `export` is still refused', () => {
  // It is not clear which list decorates the declaration.
  //
  // This is checked while `peek()` is still `export`, because the rule that
  // reads [[ClassDeclaration]] cannot carry it: that slot is not populated for
  // `@f export @f class C {}`, so the stale error removed above was the only
  // thing refusing the shape. Measured against the previous behaviour rather
  // than assumed, and this test is what stops it being lost again.
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(realm.compileModule('function f(c) {} @f export @f class C {}').Type).toBe('throw');
});

test('a macro may emit a constant beside an exported declaration', () => {
  // The shape the whole compile-time-template design rests on: the macro's
  // output is two statements, and the constant lands at MODULE scope because
  // that is where the decoration sat.
  const emitted = expandedBody('@m export function View() { return 1; }',
    '(function (t) { var s = t[0].span;'
    + ' function k(kind, v) { return { kind: kind, value: v, span: s }; }'
    + ' function g(v, inner) { return { kind: "group", value: v, span: s, tokens: inner }; }'
    + ' return [k("identifier","const"), k("identifier","$t"), k("punctuator","="),'
    + '  g("[", [k("string","\\"<div>\\"")]), k("punctuator",";")].concat(t); })');
  expect(emitted).toBe('const $t = ["<div>"] ;export function View() { return 1; }');
});

// -- Tokens come from the PARSE, not from a re-lex -------------------------------
//
// #sec-tokensof: "The lexical goal symbol at each position is the one the
// enclosing parse used, so `/` is already resolved to ~punctuator~ or ~regexp~
// and no ambiguity reaches the caller." A macro's stream was instead re-lexed
// from a source slice, which cannot honour that - the lexical grammar is not
// context-free, so only the parse knows which goal symbol applied.
const SHOW = '(function (t) {'
  + ' var s = t[0] ? t[0].span : undefined;'
  + ' function walk(ts) { return ts.map(function (x) {'
  + '   return x.kind === "group" ? "G(" + walk(x.tokens || []) + ")" : x.kind[0] + ":" + String(x.value); }).join(" "); }'
  + ' return [{ kind: "string", value: JSON.stringify(walk(t)), span: s }]; })';

test('a regular expression reaches the macro as one token', () => {
  // It arrived as `/` `ab` `/` `g` - four tokens, indistinguishable from a
  // division, and a macro inspecting them could not tell which it had.
  expect(expandedBody('@m { const r = /ab/g; }', SHOW))
    .toBe('"G(i:const i:r p:= r:/ab/g p:;)";');
  // A division is still a punctuator, which is the other half: the two must be
  // DISTINGUISHABLE, not merely both handled.
  expect(expandedBody('@m { const q = a / b; }', SHOW))
    .toBe('"G(i:const i:q p:= i:a p:/ i:b p:;)";');
});

test('a template literal reaches the macro as one token', () => {
  // It arrived as a backtick, an identifier and a backtick - and for a
  // substitution, as the identifier `a$`, a token that exists in no source.
  expect(expandedBody('@m { const s = `abc`; }', SHOW))
    .toBe('"G(i:const i:s p:= t:`abc` p:;)";');
  expect(expandedBody('@m { const s = `a${x}b`; }', SHOW))
    .toBe('"G(i:const i:s p:= t:`a${x}b` p:;)";');
  // Nested and tagged forms are one token too - the end is taken at the closing
  // backtick, which is the only moment it is knowable, since a template's parts
  // are scanned by advancing the position rather than through `next()`.
  expect(expandedBody('@m { const s = `a${`i${y}`}b`; }', SHOW))
    .toBe('"G(i:const i:s p:= t:`a${`i${y}`}b` p:;)";');
  expect(expandedBody('@m { const s = tag`a${x}`; }', SHOW))
    .toBe('"G(i:const i:s p:= i:tag t:`a${x}` p:;)";');
});

test('neither form produces a group that is not there', () => {
  // The dangerous half of the defect rather than the visible one. A `{` inside a
  // regular expression or a template opened a delimited run, so a macro
  // forwarding tokens saw brace structure the source does not have - and an
  // unbalanced one could mis-nest the rest of the region.
  expect(expandedBody('@m { const r = /a{2}/; }', SHOW))
    .toBe('"G(i:const i:r p:= r:/a{2}/ p:;)";');
  expect(expandedBody('@m { const r = /\\{/; }', SHOW))
    .toBe('"G(i:const i:r p:= r:/\\\\{/ p:;)";');
});

test('a macro that forwards them round-trips byte for byte', () => {
  // Preserved tokens are sliced from the buffer they came from, so this held
  // even while the kinds were wrong. It must keep holding.
  expect(expandedBody('@m { const r = /a{2}/g; const s = `a${x}b`; }', IDENTITY))
    .toBe('{ const r = /a{2}/g; const s = `a${x}b`; }');
});

test('backtracking leaves no residue in the stream', () => {
  // The parse records what it consumed, and a cover-grammar attempt that is
  // abandoned must contribute nothing. An arrow parameter list is what drives
  // most of the checkpoint sites, so it is the case worth pinning.
  expect(expandedBody('@m { const f = (a, b) => a + b; }', SHOW))
    .toBe('"G(i:const i:f p:= G(i:a p:, i:b) p:=> i:a p:+ i:b p:;)";');
});
