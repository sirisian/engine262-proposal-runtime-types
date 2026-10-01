import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-pattern-static-semantics: a sub-pattern that can match nothing at its
// position is a type error, and a Composite object's members are positions of their
// declared types (#sec-composite-types). A structural object type stays outside
// (#sec-narrowfrom).

test.each([
  "function f(c: Composite.<{ x: uint8, y: uint8 }>) { if (c is { x: string, y: _ }) {} }",
  "function f(c: Composite.<{ x: uint8, y: uint8 }>) { return match (c) { when { x: null, y: _ }: 1; default: 2; }; }",
])("an impossible sub-pattern at a Composite member is refused: %s", expectStaticTypeError);

test.each([
  "function f(c: Composite.<{ x: uint8 | string, y: uint8 }>) { if (c is { x: string, y: _ }) {} } 'ok';",
  "function f(o: { x: uint8 }) { if (o is { x: string }) {} } 'ok';",
])("a sub-pattern that can match is accepted: %s", (source) => expect(ok(source)).toBe(true));
