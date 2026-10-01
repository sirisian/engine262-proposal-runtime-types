import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-narrowfrom: an untagged template literal with non-empty text is a non-empty
// String, so it is always truthy; one that can be empty, and a tagged template, are not judged.

test.each([
  "function f(a: uint8) { if (`x${a}`) {} }",
  "function f(a: uint8) { return `x${a}` || 'y'; }",
])("a test of a template with text is refused: %s", expectStaticTypeError);

test.each([
  "function f(a: uint8) { if (`${a}`) {} } 'ok';",
  "function tag(s: any, v: any) { return ''; } function f(a: uint8) { if (tag`x${a}`) {} } 'ok';",
])("a template that can be empty is accepted: %s", (source) => expect(ok(source)).toBe(true));
