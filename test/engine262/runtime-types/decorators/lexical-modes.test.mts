import { expect, test } from 'vitest';
import { realmWithMacro } from '../harness.mts';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * Scoped lexical modes: a macro declares the mode its region is scanned in.
 *
 * A region a macro decorates is otherwise scanned as ECMAScript, which is why a
 * DSL that is not ECMAScript cannot reach a macro at all. JSX is the motivating
 * case and the reason is not the one it looks like: `const v = < 2;` fails
 * exactly as `const v = <div/>;` does, so the blocker is that `<` cannot BEGIN
 * an expression - the parse stops there and never reaches the closing tag. The
 * `/` in `</div>` is a second, downstream problem.
 *
 * With a mode declared on the import, the region is found by delimiter rather
 * than tokenized as ECMAScript, and its tokens are produced by the mode's own
 * scanner. What a macro returns is ordinary ECMAScript either way: a mode
 * changes INGESTION only.
 */
const NL = String.fromCharCode(10);
// The import declares no grammar. Being a preprocessor decoration is what makes
// `@jsx { ... }` a region; WHICH grammar it is read in comes from the macro,
// which is resolved before the parse.
const JSX_IMPORT = 'import { jsx } from "./x.js" with { preprocessor: "true" };' + NL;

/**
 * Wraps a macro so its region is CAPTURED.
 *
 * There is no `jsx` grammar in the engine any more. A macro wanting a reading of
 * its own captures the region, scans the text itself, and delegates the ranges
 * that are ECMAScript through `TokenStream.prototype.parse` - which is what let
 * several hundred lines of JSX-specific parsing leave the implementation.
 */
const withJsxGrammar = (macroSource: string) => `Object.assign(${macroSource}, { capture: true })`;
const PLAIN_IMPORT = 'import { m } from "./x.js" with { preprocessor: "true" };' + NL;

/** A macro that rewrites the region's first element to a `_jsx` call. */
const JSX_MACRO = '(function (t) {'
  + ' var g; for (var i = 0; i < t.length; i++) { if (t[i].kind === "group") { g = t[i]; break; } }'
  + ' var ts = g.tokens, s = g.span;'
  + ' function k(kind, v) { return { kind: kind, value: v, span: s }; }'
  + ' function grp(v, inner) { return { kind: "group", value: v, span: s, tokens: inner }; }'
  + ' return [k("identifier", "_jsx"), grp("(", ['
  + '   k("string", JSON.stringify(ts[1].value)), k("punctuator", ","), grp("{", [])])]; })';

/** Reports the kinds a macro received, so ingestion can be asserted directly. */
const KINDS = '(function (t) {'
  + ' var s = t[0] ? t[0].span : undefined;'
  + ' function walk(ts) { return ts.map(function (x) {'
  + '   return x.kind === "group" ? "G(" + walk(x.tokens || []) + ")" : x.kind[0] + ":" + String(x.value); }).join(" "); }'
  + ' return [{ kind: "string", value: JSON.stringify(walk(t)), span: s }]; })';

function expandWith(macroName: string, source: string, macroSource: string): string {
  // The macro comes from a MODULE the host loads, which is how
  // `sec-preprocessor-modules` says a decoration is resolved: fetched and
  // evaluated before the importing module is parsed, and named by one of its
  // exports.
  const realm = realmWithMacro(macroName, macroSource);
  const compiled = realm.compileModule(source) as {
    Type: string, Value?: { ECMAScriptCode?: { sourceText?: string } };
  };
  if (compiled.Type !== 'normal') {
    return 'REFUSED';
  }
  const text = compiled.Value?.ECMAScriptCode?.sourceText ?? '';
  return text.slice(text.indexOf(NL) + 1).trim();
}

const jsx = (body: string, macroSource = JSX_MACRO) => expandWith('jsx', JSX_IMPORT + body, withJsxGrammar(macroSource));


test('`do` carries a region wherever a value is wanted', () => {
  // `do` yields a value, which is what an element expression is, so it composes
  // in every expression position rather than only where a statement may stand.
  expect(jsx('f(@jsx do { <br/> });')).toBe('f(_jsx ("br" , {}));');
  expect(jsx('function A() { return @jsx do { <p/> }; }')).toBe('function A() { return _jsx ("p" , {}); }');
  expect(jsx('const a = [@jsx do { <i/> }];')).toBe('const a = [_jsx ("i" , {})];');
  expect(jsx('const f = () => @jsx do { <b/> };')).toBe('const f = () => _jsx ("b" , {});');
});

test('two regions in one module expand independently', () => {
  expect(jsx('const a = @jsx do { <a/> }; const b = @jsx do { <b/> };'))
    .toBe('const a = _jsx ("a" , {}); const b = _jsx ("b" , {});');
});

test('a grammar follows the decoration NAME, including a renamed import', () => {
  // The mode has to be readable at the decoration site rather than resolved
  // through the import, because that is what lets a highlighter recognise a
  // region: a TextMate grammar cannot follow an import. Keying on the bound name
  // is what `lit-html` and `graphql-tag` are highlighted by today.
  // `mode:` is gone, and the alias is the point: the module EXPORTS `jsx` and the
  // decoration is spelled `@h`, so resolution has to ask for one and recognise
  // the other. The pre-scan keeps both for exactly this.
  const renamed = 'import { jsx as h } from "./x.js" with { preprocessor: "true" };' + NL;
  expect(expandWith('jsx', `${renamed}const v = @h do { <div/> }; v;`, withJsxGrammar(JSX_MACRO)))
    .toBe('const v = _jsx ("div" , {}); v;');
});

test('a macro declaring no grammar takes an ordinary ECMAScript region', () => {
  // The DEFAULT is a parsed region, not a captured one - so its tokens come from
  // the parse, and a regular expression in it is one token rather than four.
  // Making the default captured re-lexed everything and undid the threading.
  expect(expandWith('m', `${PLAIN_IMPORT}@m { const r = /ab/g; }`, KINDS))
    .toBe('"G(i:const i:r p:= r:/ab/g p:;)";');
  // Its contents must therefore BE ECMAScript. A macro whose region is not -
  // a query language - declares `grammar: "opaque"` and is captured instead.
  expect(expandWith('m', `${PLAIN_IMPORT}@m { a b c }`, KINDS)).toBe('REFUSED');
  expect(expandWith('m', `${PLAIN_IMPORT}@m { a b c }`,
    `Object.assign(${KINDS}, { capture: true })`)).toBe('"G(i:a i:b i:c)";');
});


test('a region ends where its delimiters balance, not at the first brace', () => {
  // Braces inside a string or a substitution do not end the region. A naive
  // count would stop at the first `}` and splice the wrong range, which surfaces
  // much later as a parse failure on the re-parse.
  expect(jsx('@jsx { <a title="}">t</a> }', KINDS))
    .toBe('"G(p:< i:a i:title p:= s:\\"}\\" p:> i:t p:< p:/ i:a p:>)";');
  expect(jsx('@jsx { <a id={ { k: 1 } }>t</a> }', KINDS))
    .toBe('"G(p:< i:a i:id p:= G(G(i:k p:: n:1)) p:> i:t p:< p:/ i:a p:>)";');
});

test('what the macro returns is ordinary ECMAScript', () => {
  // A mode governs the region going IN. Coming out, a macro returns the same
  // token kinds any other macro does, so the re-parse needs to know nothing
  // about modes.
  expect(jsx('const v = @jsx do { <div/> }; v;')).toBe('const v = _jsx ("div" , {}); v;');
});

test('`capture` is a boolean, so there is no unknown value to refuse', () => {
  // One question, and it is binary: is this region's text ECMAScript? A macro
  // saying nothing gets a parsed region; one declaring `capture: true` reads the
  // text itself. There is no set of grammar names for the engine to recognise,
  // so there is no unknown one - the check that policed them went with them.
  const captured = `Object.assign(${KINDS}, { capture: true })`;
  expect(expandWith('m', `${PLAIN_IMPORT}@m { a b c }`, captured)).toBe('"G(i:a i:b i:c)";');
  // Anything other than `true` leaves the region parsed, so its text must be
  // ECMAScript - and a nonsense value is not an error, merely not a capture.
  const odd = `Object.assign(${KINDS}, { capture: "yes" })`;
  expect(expandWith('m', `${PLAIN_IMPORT}@m { a b c }`, odd)).toBe('REFUSED');
  expect(expandWith('m', `${PLAIN_IMPORT}@m { const r = /ab/g; }`, odd))
    .toBe('"G(i:const i:r p:= r:/ab/g p:;)";');
});

test('a preprocessor name need not be callable unless it decorates', () => {
  // `sec-preprocessor-modules` says a preprocessor module's exports MAY be used
  // as replacement decorators - so a bound name that is never used as one has no
  // reason to be a function, and importing a constant beside a macro works.
  expect(expandWith('m', `${PLAIN_IMPORT}const a = 1;`, '({ notCallable: true })'))
    .toBe('const a = 1;');
});

test('declaring a mode does not require every use to take a region', () => {
  // A mode says how a REGION is scanned, not that the name may only decorate
  // one. `@jsx class C {}` is an ordinary decoration on a class.
  expect(jsx('@jsx class C { x = 1; }', '(function (t) { return t; })')).toBe('class C { x = 1; }');
  expect(jsx('@jsx function f() { return 1; }', '(function (t) { return t; })')).toBe('function f() { return 1; }');
});


// -- The mixed mode: ECMAScript with JSX admitted where an operand is expected --
//
// A pure-JSX region works because it never has to decide: the whole region is
// JSX by declaration. A component's body is mostly ordinary code, so the
// decision comes back - and it is the parser's, not a scanner's. The parser
// admits a JSX element at exactly the position it would otherwise try a regular
// expression literal, which is the only place the question can be answered.


// -- An ARGUMENTED moded decoration ---------------------------------------------
//
// `@jsx(...)` resolves its name through a different node than `@jsx` does:
// decoratorreplacement.md's argumented form puts the identifier in
// [[CallExpression]].[[CallExpression]] and leaves [[MemberExpression]] empty.
// Reading only the latter is why an argumented decoration was once never
// collected for expansion at all - and, measured, why every argumented MODED
// decoration failed to find its mode and fell through to being lexed as
// ECMAScript, so `@jsx(1) { <div/> }` stopped at the `<`.
//
// The same shape twice, in two places, years apart. These tests exist so it is
// not three.
const both = (source: string) => expandWith('jsx', JSX_IMPORT + source, withJsxGrammar(
  '(function (t, c, a) {'
  + ' var s = t[0] ? t[0].span : undefined;'
  + ' function walk(ts) { return (ts || []).map(function (x) {'
  + '   return x.kind === "group" ? "G(" + walk(x.tokens || []) + ")" : x.kind[0] + ":" + String(x.value); }).join(" "); }'
  + ' return [{ kind: "string", value: JSON.stringify("T[" + walk(t) + "] A[" + walk(a) + "]"), span: s }]; })'));

test('a moded decoration may carry arguments', () => {
  const region = 'T[G(p:< i:div p:/ p:>)]';
  // The region is unaffected by the arguments, and the arguments arrive whole.
  expect(both('const v = @jsx { <div/> };')).toBe(`const v = "${region} A[]";`);
  expect(both('const v = @jsx() { <div/> };')).toBe(`const v = "${region} A[G()]";`);
  expect(both('const v = @jsx(1) { <div/> };')).toBe(`const v = "${region} A[G(n:1)]";`);
});

test('the arguments may be anything an expression may be', () => {
  const region = 'T[G(p:< i:div p:/ p:>)]';
  // Several, so a macro overloading on arity sees the shape it expects.
  expect(both('const v = @jsx(a, b) { <div/> };'))
    .toBe(`const v = "${region} A[G(i:a p:, i:b)]";`);
  // An object literal, which is the shape an options bag takes - and note it is
  // read as ECMAScript here even though the REGION is read as JSX.
  expect(both('const v = @jsx({ pretty: true }) { <div/> };'))
    .toBe(`const v = "${region} A[G(G(i:pretty p:: i:true))]";`);
  // A call, a template and a nested group, so nothing about the argument run is
  // A call, a string and a nested group, so nothing about the argument run is
  expect(both('const v = @jsx(f(1), "s", [2]) { <div/> };'))
    .toBe(`const v = "${region} A[G(i:f G(n:1) p:, s:\\"s\\" p:, G(n:2))]";`);
});

test('arguments work in every spelling and position', () => {
  // The bare block and the `do` block, an expression position and a statement
  // one, a declaration and an exported declaration - the argument run is
  // orthogonal to all of it.
  expect(both('const v = @jsx(1) do { <div/> };'))
    .toBe('const v = "T[G(p:< i:div p:/ p:>)] A[G(n:1)]";');
  expect(both('@jsx(1) { <div/> }')).toBe('"T[G(p:< i:div p:/ p:>)] A[G(n:1)]";');
  // A decoration on a DECLARATION is unchanged - what is gone is the engine
  // admitting a JSX element inside one, which was the mixed mode. The
  // declaration itself still reaches the macro whole.
  expect(both('@jsx(1) function V() { return 1; }'))
    .toBe('"T[i:function i:V G() G(i:return n:1 p:;)] A[G(n:1)]"');
  expect(both('@jsx(1) export function V() { return 1; }'))
    .toBe('"T[i:export i:function i:V G() G(i:return n:1 p:;)] A[G(n:1)]"');
});

// -- The two spellings are interchangeable --------------------------------------
//
// `@jsx { ... }` and `@jsx do { ... }` deliver the SAME tokens, in every
// position, and expand to the same text. Two changes make that true rather than
// nearly true.
//
// `do` no longer reaches the macro. It carried nothing a macro needs and cost
// every one of them a skip, so the region is now the first token of the stream
// either way - the macro below reads `t[0]` rather than hunting for a group.
//
// And a region in STATEMENT position is terminated. A macro emits an expression,
// which is what expression position requires; without a terminator the splice
// sits against whatever follows and `jsxTemplate("div") const after = 1;` does
// not parse. The position is taken from the CALLER - a region parsed from a
// primary expression is in expression position - because `do`'s presence records
// the SPELLING, and conflating the two made a bare region in expression position
// look like a statement.
const FIRST_TOKEN = '(function (t) {'
  + ' var g = t[0], s = g.span;'
  + ' function k(kind, v) { return { kind: kind, value: v, span: s }; }'
  + ' function grp(v, inner) { return { kind: "group", value: v, span: s, tokens: inner }; }'
  + ' return [k("identifier", "jsxTemplate"), grp("(", ['
  + '   k("string", JSON.stringify(String(g.tokens && g.tokens[1] ? g.tokens[1].value : "?")))])]; })';

test('either spelling expands identically, in every position', () => {
  const both = (bare: string, withDo: string, expected: string) => {
    expect(expandWith('jsx', JSX_IMPORT + bare, withJsxGrammar(FIRST_TOKEN))).toBe(expected);
    expect(expandWith('jsx', JSX_IMPORT + withDo, withJsxGrammar(FIRST_TOKEN))).toBe(expected);
  };
  both('const v = @jsx { <div/> }; const w = 2;',
    'const v = @jsx do { <div/> }; const w = 2;',
    'const v = jsxTemplate ("div"); const w = 2;');
  both('f(@jsx { <br/> });', 'f(@jsx do { <br/> });', 'f(jsxTemplate ("br"));');
  both('function A() { return @jsx { <p/> }; }', 'function A() { return @jsx do { <p/> }; }',
    'function A() { return jsxTemplate ("p"); }');
  both('const f = () => @jsx { <b/> };', 'const f = () => @jsx do { <b/> };',
    'const f = () => jsxTemplate ("b");');
  both('const a = [@jsx { <i/> }];', 'const a = [@jsx do { <i/> }];',
    'const a = [jsxTemplate ("i")];');
  both('const v = @jsx(1) { <div/> }; const w = 2;', 'const v = @jsx(1) do { <div/> }; const w = 2;',
    'const v = jsxTemplate ("div"); const w = 2;');
});

test('a region in statement position composes with what follows it', () => {
  // The case that exposed all of this: without a terminator the expansion sits
  // against the next statement, and no LineTerminator means ASI cannot help.
  expect(expandWith('jsx', `${JSX_IMPORT}@jsx { <div/> } const after = 1;`, withJsxGrammar(FIRST_TOKEN)))
    .toBe('jsxTemplate ("div"); const after = 1;');
  expect(expandWith('jsx', `${JSX_IMPORT}@jsx do { <div/> } const after = 1;`, withJsxGrammar(FIRST_TOKEN)))
    .toBe('jsxTemplate ("div"); const after = 1;');
});

test('a terminator is not added where the macro already ended one', () => {
  // A construct ending in a block, or output that already terminates, is left
  // alone - the repair is for an expression standing as a statement.
  const emitsBlock = '(function (t) { var s = t[0].span;'
    + ' function k(kind, v) { return { kind: kind, value: v, span: s }; }'
    + ' function grp(v, inner) { return { kind: "group", value: v, span: s, tokens: inner }; }'
    + ' return [k("identifier", "function"), k("identifier", "g"), grp("(", []), grp("{", [])]; })';
  expect(expandWith('jsx', `${JSX_IMPORT}@jsx { <div/> }`, withJsxGrammar(emitsBlock))).toBe('function g () {}');
});


// -- The import attributes must be SUPPORTED, not merely written ---------------
//
// `AllImportAttributesSupported` runs when a module is LOADED, and parsing one
// never reaches it - so every test that compiled a moded region passed while
// `HostGetSupportedImportAttributes` omitted `"mode"`, and the first attempt to
// actually load one failed with "Unsupported import attribute mode".
//
// The specification lists both keys. These assert the host hook agrees.
test('`preprocessor` and `mode` are supported import attribute keys', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  // A dynamic import carries the attributes through the same check a static one
  // does, and rejects with a SyntaxError where a key is unsupported.
  const supported = (key: string) => {
    const r = realm.evaluateScriptSkipDebugger(
      `import("./x.js", { with: { ${key}: "true" } }).then(() => "loaded", (e) => String(e && e.message))`,
    ) as { Type: string };
    return r.Type === 'normal';
  };
  expect(supported('preprocessor')).toBe(true);
  expect(supported('mode')).toBe(true);
});
