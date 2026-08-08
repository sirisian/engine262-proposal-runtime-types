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
