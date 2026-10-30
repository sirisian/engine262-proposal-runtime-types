import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * Round 5 follow-up, Q15: JSON.parse converts its text with ToString before
 * parsing, so a `symbol` text is a conversion no value can satisfy, refused
 * before the body as the other proved ToString stages are, in the plain and
 * the explicitly applied form. Every other argument keeps its JavaScript
 * meaning, and a JSON the program declares or replaces is not the built-in.
 */

test('a symbol text is refused before the body', () => {
  expect(observeScript('let s: symbol = Symbol(); JSON.parse.<uint8>(s);')).toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-conversion-protocol', phase: 'static' } });
  expect(observeScript('let s: symbol = Symbol(); JSON.parse(s);')).toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-conversion-protocol', phase: 'static' } });
});

test('other texts, and a JSON that is not the built-in, keep their meaning', () => {
  expect(evaluated('String(JSON.parse.<uint8>(5));')).toBe('5');
  expect(evaluated("String(JSON.parse.<uint8>('7'));")).toBe('7');
  expect(observeScript('JSON.parse.<uint8>({});')).toMatchObject({ bodyEntered: true, errorClass: 'SyntaxError' });
  expect(evaluated('const JSON = { parse: (x) => 1 }; let s: symbol = Symbol(); String(JSON.parse(s));')).toBe('1');
  expect(evaluated('JSON.parse = (x) => 1; let s: symbol = Symbol(); String(JSON.parse(s));')).toBe('1');
});
