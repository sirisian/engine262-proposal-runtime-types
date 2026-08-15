import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * The `linq` mode: query comprehensions as a replacement decorator, from
 * examples/linq.md in the ecmascript-types repository.
 *
 * This is the case a scoped mode exists for, and a sharper one than JSX. JSX
 * fails LOUDLY - `<` cannot begin an expression - while a query fails quietly in
 * parts: `from p` is two adjacent identifiers and an error, but
 * `where p.age >= 18` is a valid expression statement, `orderby a, b` is a comma
 * expression, and `x in xs` is a RelationalExpression that already means
 * something else. A grammar admitting queries everywhere would not reject a
 * malformed one; it would read it as something the author did not write.
 *
 * `linq` needs no scanner of its own, which is the finding worth recording: a
 * query is lexically ORDINARY ECMAScript and differs only grammatically, so the
 * mode's whole job is to keep the parser out of the region. A scanner is needed
 * only where the lexical grammar differs too, as JSX's child text does.
 *
 * The macro below is a real implementation - a fold over the clause list - and
 * the tests are its output, so what they check is that the document's examples
 * compile to what the document says they compile to.
 */
const NL = String.fromCharCode(10);
// A query is not ECMAScript grammatically, so its region is CAPTURED - which
// the macro declares with `grammar: "opaque"`. The import declares nothing: being
// a preprocessor decoration is what makes the braces a region.
const LINQ_IMPORT = 'import { linq } from "./linq.js" with { preprocessor: "true" };' + NL;

const MACRO = `Object.assign((function (tokens, args) {
  var KEYWORDS = ["from", "let", "where", "join", "orderby", "index", "take",
    "skip", "takewhile", "skipwhile", "distinct", "select", "group", "into"];
  var fresh = 0;
  function gensym(base) { fresh += 1; return "$" + base + fresh; }

  var region;
  for (var i = 0; i < tokens.length; i++) {
    if (tokens[i].kind === "group" && tokens[i].value === "{") { region = tokens[i]; break; }
  }
  var ts = region ? region.tokens : tokens;
  var span = region ? region.span : (tokens[0] && tokens[0].span);

  function k(kind, v) { return { kind: kind, value: v, span: span }; }
  function g(v, inner) { return { kind: "group", value: v, span: span, tokens: inner }; }
  function isWord(t, w) { return t && t.kind === "identifier" && t.value === w; }
  function isKeyword(t) {
    if (!t || t.kind !== "identifier") { return false; }
    for (var j = 0; j < KEYWORDS.length; j++) { if (t.value === KEYWORDS[j]) { return true; } }
    return false;
  }

  // -- split the region into clauses, each a keyword and the token run after it
  var clauses = [];
  var at = 0;
  while (at < ts.length) {
    if (!isKeyword(ts[at])) { throw new SyntaxError("expected a query clause, found " + String(ts[at].value)); }
    var word = ts[at].value;
    at += 1;
    var body = [];
    while (at < ts.length && !isKeyword(ts[at])) { body.push(ts[at]); at += 1; }
    clauses.push({ word: word, body: body });
  }
  if (clauses.length === 0 || clauses[0].word !== "from") { throw new SyntaxError("a query begins with \`from\`"); }

  // -- helpers over a clause body
  function splitOn(body, word) {
    // Matches an identifier OR a punctuator: \`in\`, \`by\` and \`equals\` are words,
    // and \`=\` in a \`let\` is not.
    for (var j = 0; j < body.length; j++) {
      var t = body[j];
      if (t.kind !== "group" && t.value === word) { return [body.slice(0, j), body.slice(j + 1)]; }
    }
    return null;
  }
  function splitCommas(body) {
    var parts = [[]], depth = 0;
    for (var j = 0; j < body.length; j++) {
      var t = body[j];
      if (t.kind === "group") { parts[parts.length - 1].push(t); continue; }
      if (t.kind === "punctuator" && t.value === "," && depth === 0) { parts.push([]); continue; }
      parts[parts.length - 1].push(t);
    }
    return parts;
  }

  // -- the frame: which names are in scope, and how a lambda destructures them
  var frame = null;    // null = use the binding token itself; otherwise a list of names
  var single = null;   // the binding TOKEN, which may be a destructuring pattern

  // The names a binding introduces: itself, or the identifiers a pattern binds.
  function bindingNames(t) {
    if (t.kind !== "group") { return [t.value]; }
    var out = [];
    for (var j = 0; j < t.tokens.length; j++) {
      if (t.tokens[j].kind === "identifier") { out.push(t.tokens[j].value); }
    }
    return out;
  }

  function param() {
    if (frame === null) { return single; }
    var inner = [];
    for (var j = 0; j < frame.length; j++) {
      if (j > 0) { inner.push(k("punctuator", ",")); }
      inner.push(k("identifier", frame[j]));
    }
    return g("{", inner);
  }
  function lambda(bodyTokens) {
    return [g("(", [param()]), k("punctuator", "=>"), g("(", bodyTokens)];
  }
  function call(name, args2) {
    var inner = [];
    for (var j = 0; j < args2.length; j++) {
      if (j > 0) { inner.push(k("punctuator", ",")); }
      inner = inner.concat(args2[j]);
    }
    return [k("identifier", name), g("(", inner)];
  }

  var source = null;
  var pendingGroup = null;

  for (var c = 0; c < clauses.length; c++) {
    var clause = clauses[c], body = clause.body;
    if (clause.word === "from") {
      var parts = splitOn(body, "in");
      if (!parts) { throw new SyntaxError("\`from\` needs \`in\`"); }
      var bound = parts[0][0];
      var name = bound.kind === "group" ? null : bound.value;
      if (source === null) { source = parts[1]; single = bound; frame = null; continue; }
      // a second \`from\` is flatMap, and both bindings stay in scope
      var outer = param();
      var names = frame === null ? bindingNames(single) : frame.slice();
      names = names.concat(bindingNames(bound));
      var built = [];
      for (var q = 0; q < names.length; q++) {
        if (q > 0) { built.push(k("punctuator", ",")); }
        built.push(k("identifier", names[q]));
      }
      source = call("_flatMap", [source,
        [g("(", [outer]), k("punctuator", "=>"),
          k("identifier", "_map"), g("(", parts[1].concat([k("punctuator", ",")],
            [g("(", [bound]), k("punctuator", "=>"), g("(", [g("{", built)])]))]]);
      frame = names;
      continue;
    }
    if (clause.word === "let") {
      var lp = splitOn(body, "=");
      if (!lp) { throw new SyntaxError("\`let\` needs \`=\`"); }
      var letName = lp[0][0].value;
      var before = param();
      var names2 = frame === null ? bindingNames(single) : frame.slice();
      var built2 = [];
      for (var r = 0; r < names2.length; r++) { built2.push(k("identifier", names2[r])); built2.push(k("punctuator", ",")); }
      built2.push(k("identifier", letName));
      built2.push(k("punctuator", ":"));
      built2 = built2.concat(lp[1]);
      source = call("_map", [source, [g("(", [before]), k("punctuator", "=>"), g("(", [g("{", built2)])]]);
      names2.push(letName);
      frame = names2;
      continue;
    }
    if (clause.word === "where") { source = call("_filter", [source, lambda(body)]); continue; }
    if (clause.word === "takewhile") { source = call("_takeWhile", [source, lambda(body)]); continue; }
    if (clause.word === "skipwhile") { source = call("_skipWhile", [source, lambda(body)]); continue; }
    if (clause.word === "take") { source = call("_take", [source, body]); continue; }
    if (clause.word === "skip") { source = call("_skip", [source, body]); continue; }
    if (clause.word === "index") {
      var idx = body[0].value;
      var beforeIdx = param();
      var names3 = frame === null ? bindingNames(single) : frame.slice();
      var built3 = [];
      for (var s = 0; s < names3.length; s++) { built3.push(k("identifier", names3[s])); built3.push(k("punctuator", ",")); }
      built3.push(k("identifier", idx));
      source = call("_mapIndexed", [source, [g("(", [beforeIdx, k("punctuator", ","), k("identifier", idx)]),
        k("punctuator", "=>"), g("(", [g("{", built3)])]]);
      names3.push(idx);
      frame = names3;
      continue;
    }
    if (clause.word === "distinct") {
      var dp = splitOn(body, "by");
      source = call("_distinct", dp ? [source, lambda(dp[1])] : [source]);
      continue;
    }
    if (clause.word === "orderby") {
      // the plan is closed data: hoisted into a \`constant { }\`
      var orderings = splitCommas(body), planInner = [];
      for (var o = 0; o < orderings.length; o++) {
        var ord = orderings[o], dir = "asc";
        if (isWord(ord[ord.length - 1], "descending")) { dir = "desc"; ord = ord.slice(0, -1); }
        else if (isWord(ord[ord.length - 1], "ascending")) { ord = ord.slice(0, -1); }
        if (o > 0) { planInner.push(k("punctuator", ",")); }
        planInner.push(g("[", lambda(ord).concat([k("punctuator", ","), k("string", JSON.stringify(dir))])));
      }
      source = call("_order", [source,
        [k("identifier", "constant"), g("{", [g("(", [g("[", planInner)]), k("punctuator", ";")])]]);
      continue;
    }
    if (clause.word === "group") {
      var gp = splitOn(body, "by");
      if (!gp) { throw new SyntaxError("\`group\` needs \`by\`"); }
      source = call("_group", [source, lambda(gp[1]), lambda(gp[0])]);
      pendingGroup = true;
      continue;
    }
    if (clause.word === "select") { source = call("_map", [source, lambda(body)]); continue; }
    if (clause.word === "into") {
      // a continuation rebinds the stream to one name and starts a new body
      single = body[0]; frame = null; pendingGroup = null;
      continue;
    }
    throw new SyntaxError("clause \`" + clause.word + "\` is not implemented");
  }

  if (args !== undefined && args.length > 0) {
    // a provider takes the query as a plan rather than as calls
    var provider = args[0].tokens && args[0].tokens[0] ? args[0].tokens[0].value : "provider";
    return [k("identifier", String(provider)), g("(", [k("punctuator", "..."), k("identifier", "_plan")].concat(
      [k("punctuator", ","), g("(", source)]))];
  }
  return source;
}), { capture: true })
`;

/** The text a query compiles to, whitespace collapsed, or `REFUSED`. */
function compiled(query: string): string {
  const macro: { current?: unknown } = {};
  setSurroundingAgent(new Agent({
    features: ['runtime-types'],
    hostHooks: { HostResolveReplacementDecorator: () => macro.current },
  } as never));
  const realm = new ManagedRealm();
  macro.current = (realm.evaluateScriptSkipDebugger(MACRO) as { Value?: unknown }).Value;
  const module = realm.compileModule(LINQ_IMPORT + query) as {
    Type: string, Value?: { ECMAScriptCode?: { sourceText?: string } };
  };
  if (module.Type !== 'normal') {
    return 'REFUSED';
  }
  const text = module.Value?.ECMAScriptCode?.sourceText ?? '';
  return text.slice(text.indexOf(NL) + 1).trim().replace(/\s+/g, ' ');
}

test('a preprocessor import needs no mode, and an unknown grammar is refused', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  // No `mode:` anywhere. Being a preprocessor decoration is what makes a region.
  expect(realm.compileModule(`${LINQ_IMPORT}const a = 1;`).Type).toBe('normal');
  // An unrecognised attribute is refused when the module is LOADED rather than
  // parsed, so `compileModule` accepts it - which is the same distinction that
  // hid a missing `mode` key for an entire feature.
  expect(realm.compileModule(
    'import { q } from "./q.js" with { preprocessor: "true", nonsense: "x" };' + NL + 'const a = 1;',
  ).Type).toBe('normal');
});

test('a query does not parse as ECMAScript, but its parts do', () => {
  // The reason a mode is required, and why the case is sharper than JSX's.
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(realm.compileModule('const q = from x in xs select x;').Type).toBe('throw');
  expect(realm.compileModule('const q = from x;').Type).toBe('throw');
  // These three are the hazard: each is a legal program meaning something else.
  expect(realm.compileModule('const xs = [], x = 1; const q = x in xs;').Type).toBe('normal');
  expect(realm.compileModule('const a = 1, b = 2; const q = (a, b);').Type).toBe('normal');
  expect(realm.compileModule('const where = 1; const q = where;').Type).toBe('normal');
});

test('filter and project', () => {
  expect(compiled('const r = @linq { from u in users where u.active select u.email };'))
    .toBe('const r = _map (_filter (users , (u) => (u.active)) , (u) => (u.email));');
});

test('a second `from` is a flatten, and both bindings stay in scope', () => {
  expect(compiled('const r = @linq { from o in orders from li in o.lines select li.sku };'))
    .toBe('const r = _map (_flatMap (orders , (o) => _map (o.lines , (li) => ({o , li}))) , ({o , li}) => (li.sku));');
});

test('`let` introduces a frame, and later clauses destructure it', () => {
  // The transparent identifier: after a `let`, two range variables are in scope
  // and every later clause closes over both.
  expect(compiled('const r = @linq { from p in people let full = p.first where full.length < 30 select full };'))
    .toBe('const r = _map (_filter (_map (people , (p) => ({p , full :p.first})) , '
      + '({p , full}) => (full.length < 30)) , ({p , full}) => (full));');
});

test('`orderby` takes several keys with independent directions', () => {
  // And the plan is a `constant { }`: closed data, identical on every
  // evaluation, so it is built once per site rather than once per call.
  expect(compiled('const r = @linq { from e in emp orderby e.dept, e.salary descending select e };'))
    .toBe('const r = _map (_order (emp , constant {([[(e) => (e.dept) , "asc"] , '
      + '[(e) => (e.salary) , "desc"]]) ;}) , (e) => (e));');
});

test('paging, distinctness by a key, and the positional binding', () => {
  expect(compiled('const r = @linq { from p in posts skip 20 take 10 select p };'))
    .toBe('const r = _map (_take (_skip (posts ,20) ,10) , (p) => (p));');
  expect(compiled('const r = @linq { from v in visits distinct by v.userId select v.userId };'))
    .toBe('const r = _map (_distinct (visits , (v) => (v.userId)) , (v) => (v.userId));');
  // `index` is XQuery's `count` clause, which C# has not at all.
  expect(compiled('const r = @linq { from line in lines index i select line };'))
    .toBe('const r = _map (_mapIndexed (lines , (line , i) => ({line , i})) , ({line , i}) => (line));');
});

test('`group by`, and `into` continuing the query past it', () => {
  expect(compiled('const r = @linq { from s in sales group s by s.region };'))
    .toBe('const r = _group (sales , (s) => (s.region) , (s) => (s));');
  // `into` rebinds the stream to one name and starts a new body - which is how
  // HAVING is written without a second keyword.
  expect(compiled('const r = @linq { from w in words select w.toLowerCase() '
    + 'into lower where lower.length > 3 select lower };'))
    .toBe('const r = _map (_filter (_map (words , (w) => (w.toLowerCase())) , '
      + '(lower) => (lower.length > 3)) , (lower) => (lower));');
});

test('a binding may be a destructuring pattern', () => {
  expect(compiled('const r = @linq { from { name, age } in people where age >= 18 select name };'))
    .toBe('const r = _map (_filter (people , ({ name, age }) => (age >= 18)) , ({ name, age }) => (name));');
});

test('`takewhile` and `skipwhile`', () => {
  expect(compiled('const r = @linq { from n in ns takewhile n < 10 select n };'))
    .toBe('const r = _map (_takeWhile (ns , (n) => (n < 10)) , (n) => (n));');
});

test('a clause operand is ordinary ECMAScript', () => {
  // The mixed mode's benefit: a template literal in a `select` behaves as it
  // does anywhere, rather than being three tokens and an identifier that exists
  // in no source.
  expect(compiled('const r = @linq { from f in files select `${f.name}` };'))
    .toBe('const r = _map (files , (f) => (`${f.name}`));');
});

test('an argumented decoration selects a provider', () => {
  // `@linq(sql) { ... }` hands the provider the query rather than evaluating it,
  // which is what lets one syntax serve an array and a database.
  expect(compiled('const r = @linq(sql) { from o in orders where o.total > 100 select o.id };'))
    .toBe('const r = sql (... _plan , (_map (_filter (orders , (o) => (o.total > 100)) , (o) => (o.id))));');
});

test('either spelling of the region works', () => {
  // `do` is optional and means nothing to the macro, so the two are the same
  // query.
  const bare = compiled('const r = @linq { from u in users select u.id };');
  const withDo = compiled('const r = @linq do { from u in users select u.id };');
  expect(bare).toBe('const r = _map (users , (u) => (u.id));');
  expect(withDo).toBe(bare);
});

test('a malformed query is refused by the macro, at compile time', () => {
  // A query must begin with `from`, and a clause word must be one the macro
  // knows. Both are the macro's rules rather than the grammar's, and both are
  // reported before the program runs.
  expect(compiled('const r = @linq { where u.active select u };')).toBe('REFUSED');
  expect(compiled('const r = @linq { from p in people orderwise p select p };')).toBe('REFUSED');
  expect(compiled('const r = @linq { from p people select p };')).toBe('REFUSED');
});

test('query words are ordinary identifiers outside a region', () => {
  // The whole benefit of a scoped mode: declaring one changes no existing
  // program.
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  expect(realm.compileModule(`${LINQ_IMPORT}const from = 1, select = 2, where = 3;`).Type).toBe('normal');
  expect(realm.compileModule(`${LINQ_IMPORT}const o = { from: 1, group: 2 }; const v = o.from;`).Type).toBe('normal');
  expect(realm.compileModule(`${LINQ_IMPORT}function orderby(x) { return x; } orderby(1);`).Type).toBe('normal');
});
