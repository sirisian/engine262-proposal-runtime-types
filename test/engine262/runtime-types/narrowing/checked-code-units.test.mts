import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-checked-code: a unit is a Script, a Module, a function-like unit or a
// class. Proposal syntax checks its own unit and everything nested in it,
// whatever its position, and never its parent or siblings. A decorator and a
// member's computed name belong to the enclosing unit.

test.each([
  "function outer() { if ([]) {} function inner(p: number) {} }",
  "function a(p: number) {} function b() { if ([]) {} }",
  "class K { m() { if ([]) {} } }",
  "class R { m(p: number) {} n() { if ([]) {} } }",
])("an unchecked unit keeps its behaviour: %s", (source) => {
  expect(ok(`${source} 'ok';`)).toBe(true);
});

test.each([
  "function t() { if ([]) {} const y: number = 1; }",
  "function outer(p: number) { function inner() { if ([]) {} } }",
  "function outer(p: number) { const inner = () => { if ([]) {} }; }",
  "let z: number = 1; function u() { if ([]) {} }",
  "class K { a: number = 1; m() { if ([]) {} } }",
  "function m(c) { return c; } @m class D { n() { if ([]) {} } }",
  "class P { @m q() {} r() { if ([]) {} } } function m(v) { return v; }",
])("a checked unit is refused: %s", expectStaticTypeError);
