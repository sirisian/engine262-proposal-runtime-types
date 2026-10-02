import { expect, test } from 'vitest';
import { expectThrown, ok } from '../harness.mts';

// #sec-checked-code: direct eval code inherits its caller's classification, as
// it inherits the caller's strictness, since it sees the caller's typed
// bindings. Indirect eval and a dynamically constructed function classify their
// own source, and a unit inside either still classifies itself.

test.each([
  "eval('if ([]) {}');",
  "function f(p: number) { (0, eval)('if ([]) {}'); } f(1);",
  "function f(p: number) { new Function('if ([]) {}'); } f(1);",
])("code whose own source is unchecked keeps its behaviour: %s", (source) => {
  expect(ok(`${source} 'ok';`)).toBe(true);
});

test.each([
  "function f(p: number) { eval('if ([]) {}'); } f(1);",
  "eval('function g(p: number) { if ([]) {} }');",
  "new Function('p: number', 'if ([]) {}');",
  "new Function('let z: number = 1; if ([]) {}');",
  "new Function('function g(q: number) { if ([]) {} }');",
])("checked eval or function code is refused when it runs: %s", (source) => {
  expectThrown(source, 'so the branch it guards is dead code');
});
