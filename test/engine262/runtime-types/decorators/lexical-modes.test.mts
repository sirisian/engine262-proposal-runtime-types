import { expect, test } from 'vitest';
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

/** Wraps a macro so it declares the `jsx` grammar, as a real one would. */
const withJsxGrammar = (macroSource: string) => `Object.assign(${macroSource}, { grammar: "jsx" })`;
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
  const macro: { current?: unknown } = {};
  setSurroundingAgent(new Agent({
    features: ['runtime-types'],
    hostHooks: {
      HostResolveReplacementDecorator: (n: string) => (n === macroName ? macro.current : undefined),
    },
  } as never));
  const realm = new ManagedRealm();
  macro.current = (realm.evaluateScriptSkipDebugger(macroSource) as { Value?: unknown }).Value;
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

test('a mode lets a region reach a macro that ECMAScript could not scan', () => {
  // Without a mode this is `Unexpected token` at the `<`, before any macro runs.
  expect(jsx('@jsx { <div/> }')).toBe('_jsx ("div" , {});');
  expect(jsx('const v = @jsx do { <span/> }; v;')).toBe('const v = _jsx ("span" , {}); v;');
});

test('the region arrives as tokens of its mode', () => {
  // Tag punctuation and names, an attribute string, and - the part that makes a
  // macro able to pass an interpolated expression through untouched - a `{ ... }`
  // substitution as a GROUP whose contents are ordinary ECMAScript tokens.
  expect(jsx('@jsx { <a href="/x" id={y}>t</a> }', KINDS))
    .toBe('"G(p:< i:a i:href p:= s:\\"/x\\" i:id p:= G(i:y) p:> j:t p:< p:/ i:a p:>)";');
  // Text between tags is one string rather than a run of identifiers, which is
  // what makes a Deno-style static/dynamic split expressible.
  expect(jsx('@jsx { <div>hi there</div> }', KINDS))
    .toBe('"G(p:< i:div p:> j:hi there p:< p:/ i:div p:>)";');
});

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
  const renamed = 'import { jsx as h } from "./x.js" with { preprocessor: "true", mode: "jsx" };' + NL;
  expect(expandWith('h', `${renamed}const v = @h do { <div/> }; v;`, withJsxGrammar(JSX_MACRO)))
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
    `Object.assign(${KINDS}, { grammar: "opaque" })`)).toBe('"G(i:a i:b i:c)";');
});

test('a mode changes ingestion only, and nothing outside a region', () => {
  // `<` and the proposal's own `.<T>` are untouched, which is the whole reason a
  // scoped mode is preferable to a global JSX grammar.
  expect(jsx('const z = 1 < 2;')).toBe('const z = 1 < 2;');
  expect(jsx('function g(x) { return x; } const w = g.<uint8>(1);')).toBe('function g(x) { return x; } const w = g.<uint8>(1);');
  // A moded import does not make ordinary decorated code behave differently.
  expect(jsx('@jsx { let a = 1; }', '(function (t) { return t; })')).toBe('{ let a = 1; }');
});

test('a region ends where its delimiters balance, not at the first brace', () => {
  // Braces inside a string or a substitution do not end the region. A naive
  // count would stop at the first `}` and splice the wrong range, which surfaces
  // much later as a parse failure on the re-parse.
  expect(jsx('@jsx { <a title="}">t</a> }', KINDS))
    .toBe('"G(p:< i:a i:title p:= s:\\"}\\" p:> j:t p:< p:/ i:a p:>)";');
  expect(jsx('@jsx { <a id={ { k: 1 } }>t</a> }', KINDS))
    .toBe('"G(p:< i:a i:id p:= G(G(i:k p:: n:1)) p:> j:t p:< p:/ i:a p:>)";');
});

test('what the macro returns is ordinary ECMAScript', () => {
  // A mode governs the region going IN. Coming out, a macro returns the same
  // token kinds any other macro does, so the re-parse needs to know nothing
  // about modes.
  expect(jsx('const v = @jsx do { <div/> }; v;')).toBe('const v = _jsx ("div" , {}); v;');
});

test('an unknown grammar is refused at the DECORATION', () => {
  // The grammar comes from the macro, so a name may declare one and never be
  // used as a decoration - which is not an error. The parser needs the answer
  // where a region is written, and that is where it reports.
  const bad = (macro: string) => `Object.assign(${macro}, { grammar: "nope" })`;
  expect(expandWith('m', `${PLAIN_IMPORT}@m { x }`, bad(KINDS))).toBe('REFUSED');
  // Never decorated, so never a problem.
  expect(expandWith('m', `${PLAIN_IMPORT}const a = 1;`, bad(KINDS))).toBe('const a = 1;');
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

test('whitespace between children is content, and survives', () => {
  // Trimming child text was lossy in a way nothing downstream could repair.
  // `<p>Hi {name}!</p>` is an ordinary line of JSX, and losing the space after
  // `Hi` made a macro render `Hiname!` with no way to do otherwise.
  expect(jsx('@jsx { <p>Hi {name}!</p> }', KINDS))
    .toBe('"G(p:< i:p p:> j:Hi  G(i:name) j:! p:< p:/ i:p p:>)";');
  // A whitespace-only run between two substitutions is content too: these two
  // render differently, so they must not tokenize identically.
  expect(jsx('@jsx { <p>{a} {b}</p> }', KINDS))
    .toBe('"G(p:< i:p p:> G(i:a) j:  G(i:b) p:< p:/ i:p p:>)";');
  expect(jsx('@jsx { <p>{a}{b}</p> }', KINDS))
    .toBe('"G(p:< i:p p:> G(i:a) G(i:b) p:< p:/ i:p p:>)";');
  // Text is emitted exactly as written, newlines and indentation included.
  // WHICH whitespace is significant is JSX's rule, not the scanner's: a mode
  // says what the tokens are and a macro says what they mean.
  expect(jsx(`@jsx { <p>one${NL}  two</p> }`, KINDS))
    .toBe('"G(p:< i:p p:> j:one\\n  two p:< p:/ i:p p:>)";');
});

test('whitespace at the region\'s own edges is formatting, not content', () => {
  // The region's delimiters are not an element, so the space inside `{ ... }` is
  // formatting around the expression - the same way it is around a parenthesized
  // one - and is dropped once rather than reaching the macro as a text token.
  expect(jsx('@jsx { <div/> }', KINDS)).toBe('"G(p:< i:div p:/ p:>)";');
  expect(jsx('@jsx {<div/>}', KINDS)).toBe('"G(p:< i:div p:/ p:>)";');
  // Whitespace INSIDE a tag separates its parts and is not content either.
  expect(jsx('@jsx { <a  href="/x"  id={y}/> }', KINDS))
    .toBe('"G(p:< i:a i:href p:= s:\\"/x\\" i:id p:= G(i:y) p:/ p:>)";');
});

// -- The mixed mode: ECMAScript with JSX admitted where an operand is expected --
//
// A pure-JSX region works because it never has to decide: the whole region is
// JSX by declaration. A component's body is mostly ordinary code, so the
// decision comes back - and it is the parser's, not a scanner's. The parser
// admits a JSX element at exactly the position it would otherwise try a regular
// expression literal, which is the only place the question can be answered.
const jsxDecl = (body: string, macroSource = KINDS) => expandWith('jsx', JSX_IMPORT + body, withJsxGrammar(macroSource));

test('a decorated declaration may contain JSX in expression position', () => {
  // The shape a component macro is written in, and the one that could not be
  // written at all before: `@jsx function View()` took no region, so its body
  // lexed as ordinary ECMAScript and the `<` stopped it.
  expect(jsxDecl('@jsx function View() { return <div/>; }'))
    .toBe('"i:function i:View G() G(i:return p:< i:div p:/ p:> p:;)"');
  // JavaScript and JSX in one body, which a captured region cannot express - a
  // statement beside JSX in a pure region becomes TEXT.
  expect(jsxDecl('@jsx function V() { const q = 1; return <div/>; }'))
    .toBe('"i:function i:V G() G(i:const i:q p:= n:1 p:; i:return p:< i:div p:/ p:> p:;)"');
});

test('the element arrives as structure, not as an opaque run', () => {
  expect(jsxDecl('@jsx function V() { return <a href="/x">t</a>; }'))
    .toBe('"i:function i:V G() G(i:return p:< i:a i:href p:= s:\\"/x\\" p:> j:t p:< p:/ i:a p:> p:;)"');
});

test('JSX nested inside an interpolation is scanned as JSX', () => {
  // The commonest idiom in JSX, and the one that degraded quietly: an
  // interpolation is handed to the ECMAScript tokenizer, so `<li>` arrived as
  // punctuation and identifiers with its text fidelity already gone. The parser
  // re-enters at any depth, so it does not.
  expect(jsxDecl('@jsx function V() { return <ul>{xs.map(x => <li/>)}</ul>; }'))
    .toBe('"i:function i:V G() G(i:return p:< i:ul p:> G(i:xs p:. i:map G(i:x p:=> p:< i:li p:/ p:>)) p:< p:/ i:ul p:> p:;)"');
});

test('an exported declaration takes the mode too', () => {
  // Set on the module-item path as well as the statement one: they reach the
  // declaration by different routes, and this is the shape that lets a macro
  // emit a constant beside what it replaces.
  expect(jsxDecl('@jsx export function View() { return <p/>; }'))
    .toBe('"i:export i:function i:View G() G(i:return p:< i:p p:/ p:> p:;)"');
});

test('the mode changes nothing outside a decorated declaration', () => {
  // The whole argument for a scoped mode over a grammar that admits JSX
  // everywhere and disambiguates `<` per occurrence.
  expect(jsxDecl('const z = 1 < 2;', '(function (t) { return t; })')).toBe('const z = 1 < 2;');
  expect(jsxDecl('function g(x) { return x; } const w = g.<uint8>(1);', '(function (t) { return t; })'))
    .toBe('function g(x) { return x; } const w = g.<uint8>(1);');
});

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
  '(function (t, a) {'
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
  expect(both('@jsx(1) function V() { return <div/>; }'))
    .toBe('"T[i:function i:V G() G(i:return p:< i:div p:/ p:> p:;)] A[G(n:1)]"');
  expect(both('@jsx(1) export function V() { return <div/>; }'))
    .toBe('"T[i:export i:function i:V G() G(i:return p:< i:div p:/ p:> p:;)] A[G(n:1)]"');
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

// -- Control flow between tags --------------------------------------------------
//
// An element is PARSED rather than scanned, so its children may be statements.
// The `@` sigil marks them, because child TEXT is possible here and a bare
// `if (` could be either - Angular 17 reached the same answer with the same
// spelling. At the region's statement level no sigil is needed, since there is
// no text there to be ambiguous with.
test('a construct may stand between tags, marked by a sigil', () => {
  expect(jsx('const v = @jsx { <panel>@if (c) { <a t="1" />; }</panel>; };', KINDS))
    .toBe('const v = "G(p:< i:panel p:> i:if G(i:c) G(p:< i:a i:t p:= s:\\"1\\" p:/ p:> p:;)'
      + ' p:< p:/ i:panel p:> p:;)";');
  // The loop binding is in scope where `@key` is written, which is the whole
  // reason the decoration goes on the BLOCK rather than before the construct.
  expect(jsx('const v = @jsx { <panel>@for (const s of xs) @key(s.id) { <a t="1" />; }</panel>; };', KINDS))
    .toBe('const v = "G(p:< i:panel p:> i:for G(i:const i:s i:of i:xs) p:@ i:key G(i:s p:. i:id)'
      + ' G(p:< i:a i:t p:= s:\\"1\\" p:/ p:> p:;) p:< p:/ i:panel p:> p:;)";');
});

test('a parsed element keeps what the scanner used to lose', () => {
  // A close tag carries its `<` and `/`, so it cannot be read as a child named
  // `panel`.
  expect(jsx('const v = @jsx { <panel><label text="a" /></panel>; };', KINDS))
    .toBe('const v = "G(p:< i:panel p:> p:< i:label i:text p:= s:\\"a\\" p:/ p:>'
      + ' p:< p:/ i:panel p:> p:;)";');
  // A prop's interpolation is a group, so `{n}` is not a bare identifier.
  expect(jsx('const v = @jsx { <label text={n} />; };', KINDS))
    .toBe('const v = "G(p:< i:label i:text p:= G(i:n) p:/ p:> p:;)";');
  // And a template literal in a prop is ONE token, because it came from the
  // parse rather than from a re-lex.
  expect(jsx('const v = @jsx { <label text={`${n} x`} />; };', KINDS))
    .toBe('const v = "G(p:< i:label i:text p:= G(t:`${n} x`) p:/ p:> p:;)";');
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
