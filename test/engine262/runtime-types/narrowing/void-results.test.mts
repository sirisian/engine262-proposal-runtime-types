import { test, expect } from 'vitest';
import { expectStaticTypeError, ok, evaluated } from '../harness.mts';

// #sec-void-type: a program must not depend on a `void` result, so one that is
// tested or computed with is refused, while discarding it, returning it from a
// `void` function or binding it untyped stays legal.

test.each([
  "function g(): void {} function f() { if (g()) {} }",
  "function g(): void {} function f() { while (g()) {} }",
  "function g(): void {} function f() { return g() ? 1 : 2; }",
  "function g(): void {} function f() { if (!g()) {} }",
  "function g(): void {} function f() { return g() || 1; }",
  "function g(): void {} function f() { return g() ?? 1; }",
  "function g(): void {} function f() { return g() + 1; }",
  "function g(): void {} function f() { return `${g()}`; }",
  "const h: () => void = () => 'str'; function f() { return h() + 'x'; }",
])("a void result tested or computed with is refused: %s", expectStaticTypeError);

test.each([
  "function g(): void {} function f(): void { g(); void g(); let x = g(); (g(), 1); return g(); } let c = true; c && g(); 'ok';",
])("a void result discarded or passed on is accepted: %s", (source) => expect(ok(source)).toBe(true));
