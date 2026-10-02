import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-checked-code: any syntax this proposal adds makes its unit checked. Each
// row is refused only for its dead test: without it, the program is accepted.

test.each([
  ["an annotation", "function t() { let v: number = 1; if ([]) {} }"],
  ["a return type", "function t(): void { if ([]) {} }"],
  ["a conversion", "function t() { const v = (1 := uint8); if ([]) {} }"],
  ["do", "function t() { const v = do { 1; }; if ([]) {} }"],
  ["match", "function t(a) { const v = match (a) { when 1: 2; default: 3; }; if ([]) {} }"],
  ["enum", "enum E { A, B } function t() { if ([]) {} }"],
  ["a type alias", "type T = number; function t() { if ([]) {} }"],
  ["a range", "function t() { for (const i of 0..<3) {} if ([]) {} }"],
  ["a decorator", "function m(c) { return c; } @m class D { n() { if ([]) {} } }"],
])("%s makes its unit checked", (_name, source) => {
  expectStaticTypeError(source);
  expect(ok(`${source.replace(' if ([]) {}', '')} 'ok';`)).toBe(true);
});
