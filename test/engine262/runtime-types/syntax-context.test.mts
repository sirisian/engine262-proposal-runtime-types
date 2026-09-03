import { expect, test } from 'vitest';
import { realmWithMacro } from './harness.mts';

/**
 * A replacement decorator's context.
 *
 * `{ kind }` and nothing else. The reason is the one `decoratorreplacement.md`
 * gives in 3.1 for having no `source` field beside the tokens: a field beside a
 * token stream is two ways to say one thing, and they must agree forever. A
 * replacement decorator receives the TOKENS OF WHAT IT DECORATES, so a name,
 * `static`, a `for`'s binding and a match arm's pattern are already in them. A
 * runtime decorator needs those in its context because it gets no tokens.
 *
 * The `kind` vocabulary is `decorators.md`'s: "Every reflection below carries a
 * `kind`, a string naming the context it came from - `'ClassField'`,
 * `'FunctionParameter'`, and so on." A captured region reports `'Block'`: it IS
 * a block, and the engine not parsing its text is a fact about the DECORATOR.
 */
const NL = String.fromCharCode(10);
const REPORT = '(function (t, c) { return [{ kind: "string",'
  + ' value: JSON.stringify(c === undefined ? "NONE" : (c.kind + "|" + Object.keys(c).join(","))),'
  + ' span: t[0] && t[0].span }]; })';

function reported(source: string, macro = REPORT): string {
  const realm = realmWithMacro('m', macro);
  const compiled = realm.compileModule(
    'import { m } from "./m.js" with { preprocessor: "true" };' + NL + source,
  ) as { Type: string, Value?: { ECMAScriptCode?: { sourceText?: string } } };
  if (compiled.Type !== 'normal') {
    return 'REFUSED';
  }
  const text = compiled.Value?.ECMAScriptCode?.sourceText ?? '';
  return text.slice(text.indexOf(NL) + 1).trim();
}

test('the context names the position it decorates', () => {
  expect(reported('const v = @m { x };')).toBe('const v = "Block|kind";');
  expect(reported('@m class C {}')).toBe('"Class|kind"');
  expect(reported('@m function f() {}')).toBe('"Function|kind"');
  expect(reported('@m if (c) { y; }')).toBe('"IfBlock|kind"');
  expect(reported('@m while (c) { y; }')).toBe('"WhileBlock|kind"');
  expect(reported('@m for (const a of b) { y; }')).toBe('"ForOfBlock|kind"');
  expect(reported('class C { @m foo() {} }')).toBe('class C { "ClassMethod|kind" }');
  expect(reported('class C { @m foo = 1; }')).toBe('class C { "ClassField|kind"; }');
});

test('a decoration followed by `{` is a REGION, whatever the position', () => {
  // `@m { y; }` in statement position is not a Block and `@m do { y; }` is not a
  // DoBlock: a preprocessor name's `{` always begins a region, which is the cost
  // the specification states for not requiring `do`. So those two kinds are
  // unreachable for a preprocessor decoration, by the same rule that makes
  // `@m { a: 1 }` a region rather than an object literal.
  expect(reported('@m { y; }')).toBe('"Block|kind";');
  expect(reported('const v = @m do { y; };')).toBe('const v = "Block|kind";');
});

test('the context carries NOTHING but kind', () => {
  // Asserted by name rather than by count, so a field added later fails here
  // rather than silently becoming part of the contract.
  const keys = '(function (t, c) { return [{ kind: "string",'
    + ' value: JSON.stringify(Object.keys(c).sort().join(",")), span: t[0] && t[0].span }]; })';
  expect(reported('const v = @m { x };', keys)).toBe('const v = "kind";');
});

test('the context is frozen', () => {
  // A context is a report, not a channel. A macro that writes to it does not
  // influence what the next expansion is handed.
  const writes = '(function (t, c) { var threw = false;'
    + ' try { c.kind = "Other"; } catch (e) { threw = true; }'
    + ' return [{ kind: "string", value: JSON.stringify(threw + ":" + c.kind), span: t[0] && t[0].span }]; })';
  expect(reported('const v = @m { x };', writes)).toMatch(/"(true|false):Block"/);
});

test('arguments move to the THIRD parameter', () => {
  // `(tokens, context, args?)`, matching a runtime decorator's `(value, context)`
  // in the slot that carries the context. Arguments are present only where the
  // decoration has any.
  const arity = '(function (t, c, a) { return [{ kind: "string",'
    + ' value: JSON.stringify(arguments.length + ":" + (a === undefined ? "none" : "args")),'
    + ' span: t[0] && t[0].span }]; })';
  expect(reported('const v = @m { x };', arity)).toBe('const v = "2:none";');
  expect(reported('const v = @m(Serialize) { x };', arity)).toBe('const v = "3:args";');
});

test('a label reaches the macro, being the one thing the tokens cannot carry', () => {
  // Everything else a runtime context reports syntactically is IN the tokens a
  // replacement decorator receives. A label is not: it PRECEDES the decoration -
  // `lbl:` then `@m` then `{ ... }` - so a span reaching back for it would
  // contain the decoration being expanded. decorators.md already declares
  // `label?: string` on every block reflection.
  const report = '(function (t, c) { return [{ kind: "string",'
    + ' value: JSON.stringify(c.kind + "/" + String(c.label)), span: t[0] && t[0].span }]; })';
  expect(reported('lbl: @m { y; }', report)).toBe('lbl: "Block/lbl";');
  expect(reported('lbl: @m while (c) { y; }', report)).toBe('lbl: "WhileBlock/lbl"');
});

test('an unlabelled decoration reports no label at all', () => {
  // Absent rather than *undefined*: a field that is present and empty is the
  // shape this project has been bitten by, and `Object.keys` is what says which.
  const keys = '(function (t, c) { return [{ kind: "string",'
    + ' value: JSON.stringify(Object.keys(c).sort().join(",")), span: t[0] && t[0].span }]; })';
  expect(reported('@m { y; }', keys)).toBe('"kind";');
  expect(reported('lbl: @m { y; }', keys)).toBe('lbl: "kind,label";');
});

test('a labelled decoration is not a different POSITION from an unlabelled one', () => {
  // `lbl: @m { y; }` used to report a DIFFERENT kind from `@m { y; }`, because
  // the labelled path reached the statement parser by a different route and the
  // region rule did not apply. A label is not a position.
  //
  // Both report `Block` now - a captured region IS a block - so the two
  // spellings can no longer disagree by naming different things. That they
  // AGREE is still the subject,
  // and the assertion still fails if the labelled route diverges again.
  const kindOnly = '(function (t, c) { return [{ kind: "string",'
    + ' value: JSON.stringify(c.kind), span: t[0] && t[0].span }]; })';
  expect(reported('@m { y; }', kindOnly)).toBe('"Block";');
  expect(reported('lbl: @m { y; }', kindOnly)).toBe('lbl: "Block";');
});
