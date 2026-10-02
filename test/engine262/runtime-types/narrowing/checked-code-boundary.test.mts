import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-checked-code: the judgments that read a type inferred from code apply
// only in checked code. A program using none of the proposal's syntax keeps its
// behaviour, and the same code inside an annotated function is refused.

const untyped = [
  "if ([]) {}",
  "if ({}) {}",
  "if ('a') {}",
  "if (void 0) {}",
  "for (const x of []) {}",
  "function f(x) { if (typeof x) {} }",
  "function f(a, b) { if (a < b) return 1; else if (a < b) return 2; return 3; }",
  "function g() { return 1; } if (g) {}",
  "class C {} if (new C() instanceof C) {}",
  "if (typeof 1 === 'string') {}",
  "let x = 1; if (x === 1) {} else if (x === 1) {}",
];

test.each(untyped)("code without proposal syntax is accepted: %s", (source) => {
  expect(ok(`${source} 'ok';`)).toBe(true);
});

test.each(untyped.map((source) => `function checked(p: number) { ${source} }`))(
  "the same code in checked code is refused: %s", expectStaticTypeError);
