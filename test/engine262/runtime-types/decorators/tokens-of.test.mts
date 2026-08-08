import { test, expect } from 'vitest';
import {
  Agent, ManagedRealm, setSurroundingAgent, tokenizeText, type TokenRecord,
} from '#self';

/**
 * PLAN-engine-decorator-replacement stage A: `sec-token-records` and
 * `sec-tokensof`.
 */

const SOURCE = { URL: 't', Macro: undefined, Generation: 0 };

function tokens(text: string): readonly TokenRecord[] {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  void new ManagedRealm();
  return tokenizeText(text, SOURCE);
}

const kinds = (ts: readonly TokenRecord[]): string[] => ts.map((t) => t.Kind);
const show = (ts: readonly TokenRecord[]): string => ts
  .map((t) => (t.Kind === 'group' ? `${t.Value}[${show(t.Tokens!)}]` : t.Value))
  .join(' ');

test('a token carries its kind, its text, and where it came from', () => {
  const ts = tokens('let x = 1;');
  expect(kinds(ts)).toEqual(['identifier', 'identifier', 'punctuator', 'numeric', 'punctuator']);
  expect(ts.map((t) => t.Value)).toEqual(['let', 'x', '=', '1', ';']);
  // A span slices back to exactly the token's text, which is the property every
  // later diagnostic rests on.
  const text = 'let x = 1;';
  for (const t of ts) {
    expect(text.slice(t.Span.Start, t.Span.End)).toBe(t.Value);
  }
});

test('a keyword is an IDENTIFIER lexically, and that is deliberate', () => {
  // `class` and `x` are one kind. A macro that cares compares the value; a macro
  // that only moves tokens does not have to carry the keyword list, which is the
  // list most likely to grow.
  expect(kinds(tokens('class'))).toEqual(['identifier']);
  expect(kinds(tokens('x'))).toEqual(['identifier']);
});

test('DELIMITED RUNS ARE GROUPED, not flat', () => {
  // The delimiters belong to the record, so a producer cannot emit an unbalanced
  // stream by forgetting to pair them.
  const ts = tokens('class A { m() { return 1; } }');
  expect(kinds(ts)).toEqual(['identifier', 'identifier', 'group']);
  // `show` renders a group as `Value[contents]`, so an empty `()` is `([]`.
  expect(show(ts)).toBe('class A {[m ([] {[return 1 ;]]');
  const body = ts[2];
  expect(body.Value).toBe('{');
  expect(body.Tokens).toBeDefined();
  // A group's span covers the whole run including both delimiters.
  const text = 'class A { m() { return 1; } }';
  expect(text.slice(body.Span.Start, body.Span.End)).toBe('{ m() { return 1; } }');
  // An empty group is a group with no contents, not an absent one.
  const params = body.Tokens!.find((t) => t.Value === '(')!;
  expect(params.Kind).toBe('group');
  expect(params.Tokens).toEqual([]);
});

test('type annotations tokenize, which is what a derive needs', () => {
  expect(show(tokens('x: uint8 = 3'))).toBe('x : uint8 = 3');
  expect(kinds(tokens('x: uint8 = 3'))).toEqual(['identifier', 'punctuator', 'identifier', 'punctuator', 'numeric']);
});

test('PINNED: a REGULAR EXPRESSION does not tokenize as one', () => {
  // `/ab+/g` becomes six tokens rather than one `regexp`, because this
  // tokenizer RE-LEXES text that has no parse context, and the lexical grammar
  // is not context-free: `InputElementDiv` and `InputElementRegExp` resolve `/`
  // differently, and only the enclosing parse knows which applied.
  //
  // **This is the `/` problem the specification predicted, and measuring it here
  // settles a design question for expansion**: `sec-tokensof` says "the lexical
  // goal symbol at each position is the one the enclosing parse used", which a
  // re-lex cannot honour. So the tokens a decorator receives must be THREADED
  // FROM THE PARSE rather than re-derived from source text - which is the same
  // conclusion `sec-expansion` reaches from the other direction when it says
  // nothing is re-lexed.
  expect(show(tokens('const r = /ab+/g;'))).toBe('const r = / ab + / g ;');
  expect(kinds(tokens('const r = /ab+/g;'))).not.toContain('regexp');
  // Division tokenizes identically, which is the whole ambiguity in one line.
  expect(show(tokens('a / b'))).toBe('a / b');
});
