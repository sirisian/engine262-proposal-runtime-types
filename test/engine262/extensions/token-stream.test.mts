import { test, expect } from 'vitest';
import {
  Agent, ManagedRealm, setSurroundingAgent, tokenizeText, TokenStreamText,
} from '#self';
import { evaluated } from '../readme/harness.mts';

/**
 * PLAN-engine-decorator-replacement stage B: `sec-tokenstream-objects`.
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
  // the last one's end, so everything between them comes back — which is why a
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
  // dropped comments — as Rust's does, by convention rather than necessity —
  // could not do this, and a `source: string` field would have been needed.
  expect(roundTrip('a /* one */ + /* two */ b')).toBe('a /* one */ + /* two */ b');
  expect(roundTrip('/* lead */ a + b')).toBe('a + b');
  expect(roundTrip('x // trailing\n')).toBe('x');
});

test('PINNED: trivia OUTSIDE the tokens is not part of the stream', () => {
  // A stream spans its first token's start to its last token's end, so a comment
  // BEFORE the first token or AFTER the last is not in it. That is what "the gap
  // BETWEEN adjacent spans is the trivia" means precisely, and the imprecise
  // reading — "toString returns the source" — is wrong at both ends.
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

test('PINNED: gensym does not solve REFERENTIAL transparency', () => {
  // It governs identifiers a macro CREATES. A macro that REFERENCES `Date` still
  // meets a user's shadowing `Date`, which no mechanism short of syntax contexts
  // on every binding addresses — and which the spans make detectable even where
  // they do not prevent it.
  //
  // Recorded as a limit rather than discovered as a bug.
  expect(evaluated('function outer() { const Date = () => "LOCAL"; return Date(); } outer();')).toBe('LOCAL');
});

test('the constructor refuses; a stream comes from the engine', () => {
  expect(evaluated('try { new TokenStream(); "OK"; } catch (e) { e.constructor.name; }')).toBe('TypeError');
  expect(evaluated('String(typeof TokenStream.gensym);')).toBe('function');
});
