import { test, expect } from 'vitest';
import {
  Agent, ManagedRealm, setSurroundingAgent, tokenizeText,
  TokenStreamText, type TokenRecord,
} from '#self';
import { evaluated } from '../harness.mts';

/**
 * Spec: #sec-token-records (Token Records) and
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

test('a REGULAR EXPRESSION does not tokenize as one', () => {
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

// -- Tokens through the reflection read path -------------------------------------

/**
 * The reflection fields a token carries.
 *
 * decorators.md gave twelve block contexts an `Expression` it declined to
 * define, and gave ten declarations an `initial` that captures constants only.
 * decoratorreplacement.md defines `Expression` as a TokenStream; this is where
 * both land.
 */

test('a block context carries its BLOCK as tokens', () => {
  expect(evaluated('let f=""; function g(c){ f=Object.getOwnPropertyNames(c).join(","); } @g { let x = 1; } f;'))
    .toBe('kind,label,block');
  expect(evaluated('let t=""; function g(c){ t=c.block.toString(); } @g { let x = 1; } t;'))
    .toBe('{ let x = 1; }');
  // A block is ONE group token whose contents are the statements, so a macro
  // cannot emit an unbalanced body by losing a brace.
  expect(evaluated('let k=""; function g(c){ k=c.block.map(t=>t.kind).join(","); } @g { let x = 1; } k;'))
    .toBe('group');
  expect(evaluated('let k=""; function g(c){ k=c.block[0].tokens.map(t=>t.value).join(" "); } @g { let x = 1; } k;'))
    .toBe('let x = 1 ;');
});

test('the forms that HAVE a condition carry one', () => {
  expect(evaluated('let t=""; function g(c){ t=c.condition.toString(); } if (1 < 2) @g { 1; } t;'))
    .toBe('1 < 2');
  expect(evaluated('let t=""; let n=0; function g(c){ t=c.condition.toString(); } while (n < 1) @g { n+=1; } t;'))
    .toBe('n < 1');
  // The condition belongs to the OWNING statement, which the block node cannot
  // reach - the parser records it beside the block kind, where both are in hand.
  expect(evaluated('let f=""; function g(c){ f=Object.getOwnPropertyNames(c).join(","); } if (true) @g { 1; } f;'))
    .toBe('kind,label,block,condition');
});

test('a form WITHOUT a condition does not carry one', () => {
  // Absent, not *undefined*. **A property that always answers undefined is worse
  // than an absent one** - it claims to report something it never reports.
  expect(evaluated('let h=""; function g(c){ h=String("condition" in c); } @g { 1; } h;')).toBe('false');
  expect(evaluated('let h=""; function g(c){ h=String("condition" in c); } if (true) @g { 1; } h;')).toBe('true');
});

test('`initial` and `initializer` are a VALUE and the EXPRESSION that produced it', () => {
  // Not two spellings of one thing.
  expect(evaluated('let t; function g(c){ t=c.initial+"|"+c.initializer.toString(); } class A { @g x: uint8 = 3; } String(t);'))
    .toBe('3|3');
  // **The whole point of the pair**: decorators.md calls the constants-only
  // limit "a limitation" and defers the Expression that would fix it. A
  // non-constant initializer has no `initial` and a perfectly readable
  // `initializer`.
  expect(evaluated('let t; function g(c){ t=String(c.initial)+"|"+c.initializer.toString(); } class A { @g x: uint8 = f(); } t;'))
    .toBe('undefined|f()');
  expect(evaluated('let t; function g(c){ t=String(c.initial)+"|"+c.initializer.toString(); } class A { m(@g p: uint32 = f()) {} } t;'))
    .toBe('undefined|f()');
});

test('no initializer means no tokens, at both positions', () => {
  // An absent initializer is null in the parse node rather than undefined, and
  // both answer *undefined* here rather than throwing.
  expect(evaluated('let t; function g(c){ t=String(c.initial)+"|"+String(c.initializer); } class A { @g x: uint8; } t;'))
    .toBe('0|undefined');
  expect(evaluated('let t; function g(c){ t=String(c.initial)+"|"+String(c.initializer); } class A { m(@g p: uint32) {} } t;'))
    .toBe('undefined|undefined');
});

test('a stream is an ARRAY, so a macro uses array operations', () => {
  // That is the reason the representation is a flat list with delimited runs
  // grouped: the operations a macro performs are `map`, `find` and `filter`.
  expect(evaluated('let n=-1; function g(c){ n=c.condition.filter(t=>t.kind==="numeric").length; } if (1 < 2) @g { 1; } String(n);'))
    .toBe('2');
  expect(evaluated('let v=""; function g(c){ v=c.condition.find(t=>t.kind==="punctuator").value; } if (1 < 2) @g { 1; } v;'))
    .toBe('<');
});

// -- TokenStream objects ---------------------------------------------------------

/**
 * #sec-tokenstream-objects (TokenStream Objects).
 */

function roundTrip(text: string): string {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  void new ManagedRealm();
  const source = {
    URL: 't', Macro: undefined, Generation: 0, Text: text,
  };
  return TokenStreamText(tokenizeText(text, source));
}

test('toString recovers the source text EXACTLY, trivia included', () => {
  // A run of tokens from one buffer is sliced from the first token's start to
  // the last one's end, so everything between them comes back - which is why a
  // reflection needs no separate source-text field. **A second field would be a
  // second way to say one thing, and the two would have to agree forever.**
  expect(roundTrip('let x = 1;')).toBe('let x = 1;');
  expect(roundTrip('function f() { /* keep me */ return 1; }')).toBe('function f() { /* keep me */ return 1; }');
  expect(roundTrip('function g(  a,   b  ) { return a; }')).toBe('function g(  a,   b  ) { return a; }');
  expect(roundTrip('class A { m(): uint8 { return uint8(1); } }')).toBe('class A { m(): uint8 { return uint8(1); } }');
  expect(roundTrip('')).toBe('');
});

test('a comment BETWEEN tokens survives, which is the whole claim', () => {
  // The gap between two adjacent spans IS the trivia. A token stream that
  // dropped comments - as Rust's does, by convention rather than necessity -
  // could not do this, and a `source: string` field would have been needed.
  expect(roundTrip('a /* one */ + /* two */ b')).toBe('a /* one */ + /* two */ b');
  expect(roundTrip('/* lead */ a + b')).toBe('a + b');
  expect(roundTrip('x // trailing\n')).toBe('x');
});

test('trivia OUTSIDE the tokens is not part of the stream', () => {
  // A stream spans its first token's start to its last token's end, so a comment
  // BEFORE the first token or AFTER the last is not in it. That is what "the gap
  // BETWEEN adjacent spans is the trivia" means precisely, and the imprecise
  // reading - "toString returns the source" - is wrong at both ends.
  //
  // It matters for a macro: a trailing comment on a decorated construct's last
  // line is not something the macro can see or preserve.
  expect(roundTrip('x // trailing\n')).toBe('x');
  expect(roundTrip('/* lead */ x')).toBe('x');
  expect(roundTrip('  x  ')).toBe('x');
});

test('gensym mints an identifier no source text can contain', () => {
  expect(evaluated('const t = TokenStream.gensym("start"); t.kind;')).toBe('identifier');
  // Two calls never agree, so a macro's temporaries cannot collide with each
  // other however many times it runs.
  expect(evaluated('String(TokenStream.gensym("a").value !== TokenStream.gensym("a").value);')).toBe('true');
  // And the name is not a valid IdentifierName, so collision with WRITTEN code
  // is impossible by construction rather than by counting.
  expect(evaluated('const t = TokenStream.gensym("a"); String(/^[A-Za-z_$]/.test(t.value));')).toBe('false');
  // The hint appears, so a diagnostic naming the identifier is readable.
  expect(evaluated('String(TokenStream.gensym("start").value.includes("start"));')).toBe('true');
});

test('gensym does not solve REFERENTIAL transparency', () => {
  // It governs identifiers a macro CREATES. A macro that REFERENCES `Date` still
  // meets a user's shadowing `Date`, which no mechanism short of syntax contexts
  // on every binding addresses - and which the spans make detectable even where
  // they do not prevent it.
  //
  // Recorded as a limit rather than discovered as a bug.
  expect(evaluated('function outer() { const Date = () => "LOCAL"; return Date(); } outer();')).toBe('LOCAL');
});

test('the constructor refuses; a stream comes from the engine', () => {
  expect(evaluated('try { new TokenStream(); "OK"; } catch (e) { e.constructor.name; }')).toBe('TypeError');
  expect(evaluated('String(typeof TokenStream.gensym);')).toBe('function');
});
