import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #sec-match-exhaustiveness: a lone composite type is its own atom, covered by an
// object pattern naming its required members with covering sub-patterns, so a
// `default` after such a clause can never run. A structural object stays outside,
// since `delete` can take a member from it.

test.each([
  "function f(c: Composite.<{ x: uint8 }>) { return match (c) { when { x: let v }: 1; default: 2; }; }",
])("a default after a covering object pattern is refused: %s", expectStaticTypeError);

test.each([
  "function f(c: Composite.<{ x: uint8 }>) { return match (c) { when { x: let v }: 1; }; } 'ok';",
  "function f(c: Composite.<{ x: uint8 }>) { return match (c) { when { x: 1 }: 1; default: 2; }; } 'ok';",
  "function f(o: { x: uint8 }) { return match (o) { when { x: let v }: 1; default: 2; }; } 'ok';",
])("a match an object pattern covers or leaves open is accepted: %s", (source) => expect(ok(source)).toBe(true));
