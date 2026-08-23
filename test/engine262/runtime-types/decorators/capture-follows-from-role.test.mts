import { expect, test } from 'vitest';
import { realmWithMacro } from '../harness.mts';
import { Agent, setSurroundingAgent } from '#self';

/**
 * Capture follows from BEING a replacement decorator.
 *
 * `#sec-preprocessor-modules`: "A replacement decorator's region is captured,
 * always, because it is a replacement decorator … Capture is not a mode a macro
 * selects; it follows from what a replacement decorator is. A decoration whose
 * imported binding is NOT one — a function that does not take a `TokenStream`
 * and return a token sequence — takes a Block, parsed."
 *
 * The context TYPE used to decide it, and that made declaring the MODE the same
 * act as declaring which POSITIONS a macro takes: a macro annotating
 * `Reflect.Block` could not decorate a class, because the annotation is enforced
 * where the macro is called. The workaround was a union enumerating every
 * position — measured at EIGHTEEN in `syntax-context.mts`, and one more whenever
 * the language gains a position. `PLAN-region-context-removal` §20.
 */

const TOKENS = '[{ kind: "identifier", value: "X", span: t[0].span, tokens: undefined },'
  + ' { kind: "punctuator", value: ";", span: t[0].span, tokens: undefined }]';

function expand(macro: string, body: string): string {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] } as never));
  const realm = realmWithMacro('m', macro);
  const compiled = realm.compileModule(
    `import { m } from "./x.js" with { preprocessor: "true" };\n${body}`,
  ) as { Type: string, Value?: { ECMAScriptCode?: { sourceText?: string } } };
  if (compiled.Type !== 'normal') {
    return 'REFUSED';
  }
  const text = compiled.Value?.ECMAScriptCode?.sourceText ?? '';
  return text.slice(text.indexOf('\n') + 1).trim();
}

/** A replacement decorator by SIGNATURE, annotating no context at all. */
const ANY_POSITION = `(function (t: TokenStream, c, a?): [].<Token> { return ${TOKENS}; })`;

test('a macro annotating NO context captures its region', () => {
  // The signature is what identifies it: a TokenStream in, a token sequence out.
  // Nothing about the context is consulted.
  expect(expand(ANY_POSITION, '@m { <<< not ecmascript >>> }')).toContain('X');
});

test('… and the SAME macro decorates a class', () => {
  // The coupling this removes. While the context type decided capture, a macro
  // that declared the mode could not appear anywhere else, and saying "also a
  // class" meant naming the class in a union.
  expect(expand(ANY_POSITION, '@m class C { x = 1; }')).toContain('X');
});

test('a decorator that is NOT one by signature takes a parsed Block', () => {
  // The other half of the clause. This macro takes no TokenStream, so it is not
  // a replacement decorator, and its region is PARSED - which is what gives it
  // the parser's reading of an ambiguous `/`.
  //
  // `expansion.test.mts` asserts the reading itself; this asserts only that such
  // a macro still runs and is handed its region.
  expect(expand('(function (t) { return t; })', '@m { const r = /ab/g; }'))
    .toContain('/ab/g');
});

test('a captured macro recovers ECMAScript tokens by DELEGATING', () => {
  // What makes capture-always sound: `TokenStream.prototype.parse` gives back
  // exactly what a parsed region would have. Without it, capture would lose the
  // parser's regex-versus-division decision, which is the objection this answers.
  const delegating = '(function (t: TokenStream, c, a?): [].<Token> {'
    + ' var text = t.toString();'
    + ' var open = text.indexOf("{"), close = text.lastIndexOf("}");'
    + ' var inner = t.parse(open + 1, close, "statements");'
    + ' function walk(ts) { return (ts || []).map(function (x) {'
    + '   return x.kind === "group" ? "G(" + walk(x.tokens || []) + ")" : x.kind[0] + ":" + String(x.value); }).join(" "); }'
    + ' return [{ kind: "string", value: JSON.stringify(walk(inner)), span: t[0].span, tokens: undefined },'
    + '         { kind: "punctuator", value: ";", span: t[0].span, tokens: undefined }]; })';
  // The regex is ONE token, as the parser reads it - not the four a raw lexing
  // gives.
  expect(expand(delegating, '@m { const r = /ab/g; }')).toContain('r:/ab/g');
});
