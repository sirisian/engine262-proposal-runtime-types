import { expect, test } from 'vitest';
import {
  Agent, ManagedRealm, Parser, setSurroundingAgent, Token, TokenNames,
} from '#self';

/**
 * Spec: #sec-lexical-grammar-for-types (Lexical Grammar).
 *
 * Tokenization of the additions - the `.<` and `:=` TypePunctuators and the
 * imaginary-literal suffix - with the runtime-types feature on, and proof
 * that with it off every one of those spellings lexes exactly as today.
 * Maximal munch and `?.` non-fusing are pinned where the new tokens could
 * collide with existing ones.
 */

/** Evaluates a script under the feature and returns its completion value as a string. */
function evaluated(source: string): string {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const completion = realm.evaluateScriptSkipDebugger(source);
  expect(completion, `expected normal completion for: ${source}`).toMatchObject({ Type: 'normal' });
  return (completion as unknown as { Value: { stringValue(): string } }).Value.stringValue();
}

function tokenize(source: string, runtimeTypes: boolean): [string, unknown?][] {
  const agent = new Agent(runtimeTypes ? { features: ['runtime-types'] } : {});
  setSurroundingAgent(agent);
  // A realm is needed so a lexer error can construct its SyntaxError value.
  void new ManagedRealm();
  const p = new Parser({ source, specifier: 'lexer-test' });
  const out: [string, unknown?][] = [];
  while (out.length < 64) {
    const t = p.peek();
    if (t.type === Token.EOS) {
      return out;
    }
    if (t.value === undefined || t.value === null) {
      out.push([TokenNames[t.type]]);
    } else {
      out.push([TokenNames[t.type], t.value]);
    }
    p.next();
  }
  throw new Error('runaway tokenizer');
}

test('feature off: `.<` and `:=` lex as today', () => {
  expect(tokenize('a.<b>(c)', false)).toEqual([
    ['IDENTIFIER', 'a'], ['PERIOD', '.'], ['LT', '<'], ['IDENTIFIER', 'b'], ['GT', '>'], ['LPAREN', '('], ['IDENTIFIER', 'c'], ['RPAREN', ')'],
  ]);
  expect(tokenize('x := y', false)).toEqual([
    ['IDENTIFIER', 'x'], ['COLON', ':'], ['ASSIGN', '='], ['IDENTIFIER', 'y'],
  ]);
});

test('feature off: imaginary suffix stays an error', () => {
  expect(() => tokenize('1i', false)).toThrow();
});

test('TypePunctuator `.<`', () => {
  expect(tokenize('a.<b>(c)', true)).toEqual([
    ['IDENTIFIER', 'a'], ['PERIOD_LT', '.<'], ['IDENTIFIER', 'b'], ['GT', '>'], ['LPAREN', '('], ['IDENTIFIER', 'c'], ['RPAREN', ')'],
  ]);
});

test('TypePunctuator `:=`', () => {
  expect(tokenize('x := y', true)).toEqual([
    ['IDENTIFIER', 'x'], ['COLON_EQ', ':='], ['IDENTIFIER', 'y'],
  ]);
  // Adjacency in other orders is untouched.
  expect(tokenize('x =: y', true)).toEqual([
    ['IDENTIFIER', 'x'], ['ASSIGN', '='], ['COLON', ':'], ['IDENTIFIER', 'y'],
  ]);
});

test('numeric maximal munch beats `.<`: `1.<2` is `1.` `<` `2`', () => {
  expect(tokenize('1.<2', true)).toEqual([
    ['NUMBER', 1], ['LT', '<'], ['NUMBER', 2],
  ]);
});

test('`?.` never fuses with `<`', () => {
  expect(tokenize('a?.<b', true)).toEqual([
    ['IDENTIFIER', 'a'], ['OPTIONAL', '?.'], ['LT', '<'], ['IDENTIFIER', 'b'],
  ]);
});

test('member access on `i`-named properties is untouched', () => {
  expect(tokenize('a.i', true)).toEqual([
    ['IDENTIFIER', 'a'], ['PERIOD', '.'], ['IDENTIFIER', 'i'],
  ]);
});

test('imaginary literals over the decimal forms', () => {
  expect(tokenize('1i', true)).toEqual([['IMAGINARY', 1]]);
  expect(tokenize('0i', true)).toEqual([['IMAGINARY', 0]]);
  expect(tokenize('1.5i', true)).toEqual([['IMAGINARY', 1.5]]);
  expect(tokenize('.5i', true)).toEqual([['IMAGINARY', 0.5]]);
  expect(tokenize('0.i', true)).toEqual([['IMAGINARY', 0]]);
  expect(tokenize('1e3i', true)).toEqual([['IMAGINARY', 1000]]);
  expect(tokenize('1_0i', true)).toEqual([['IMAGINARY', 10]]);
});

test('imaginary suffix rejected off the decimal forms', () => {
  expect(() => tokenize('0x1i', true)).toThrow();
  expect(() => tokenize('0b1i', true)).toThrow();
  expect(() => tokenize('0o7i', true)).toThrow();
  expect(() => tokenize('08i', true)).toThrow();
  expect(() => tokenize('1if', true)).toThrow();
});

test('BigInt is unaffected', () => {
  expect(tokenize('1n', true)).toEqual([['BIGINT', 1n]]);
});

// -- The declaration lookahead must not disturb the token stream ---------------
//
// A StatementListItem under this feature is checked for the declaration forms
// introduced by a contextual keyword (`type`, `interface`, `partial interface`,
// `meta`, `primitive`), which needs the token AFTER the current one. Reading it
// where the current token opens a template literal runs the lexer over the
// template's BODY, and the template scanner reads raw source from the lexer
// position rather than from the token stream - so it then starts past its own
// opening backtick and the statement does not parse. Every position other than
// the start of a StatementListItem was unaffected, which is why a suite with no
// template in statement position saw nothing.
test('a template literal parses at the start of a statement', () => {
  expect(evaluated('`plain`;')).toBe('plain');
  expect(evaluated('`a${1}b`;')).toBe('a1b');
  // The same inside a block, which is the other StatementListItem position.
  expect(evaluated('{ `x`; }')).toBe('x');
  // And the positions that always worked, so a fix that traded one for another
  // fails here.
  expect(evaluated('const s = `x`; s;')).toBe('x');
  expect(evaluated('(`x`);')).toBe('x');
  expect(evaluated('function tag(s) { return s[0]; } tag `hi`;')).toBe('hi');
});

test('the declaration forms the lookahead exists for still parse', () => {
  expect(evaluated('type T = uint8; let x: T = 1; String(x);')).toBe('1');
  expect(evaluated('interface I { a: uint8 } let o: I = { a: 1 }; String(o.a);')).toBe('1');
  expect(evaluated('interface J { a: uint8 } partial interface J { b: uint8 } "ok";')).toBe('ok');
  expect(evaluated('type M = { m: number }; meta M { default = { m: 0 }; subtype(a, b) { return true; } } "ok";')).toBe('ok');
  expect(evaluated('primitive number { operator +(rhs: string): string { return "s"; } } "ok";')).toBe('ok');
  expect(evaluated('enum C { Zero, One } String(C.One is C);')).toBe('true');
});
