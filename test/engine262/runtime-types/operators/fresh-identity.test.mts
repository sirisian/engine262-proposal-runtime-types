import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';

// #table-narrowing-forms, the `v === w` row: an object, array, function, arrow,
// class or regular-expression literal, or a `new` of a class binding the program
// never writes whose constructor returns no value, holds a value no other operand
// holds, so a strict comparison with it can never succeed.

test.each([
  "function f(a: [].<uint8>) { if (a === []) {} }",
  "function f(o: object) { if (o !== {}) {} }",
  "function f(g: () => void) { if (g === (() => {})) {} }",
  "function f(o: object) { switch (o) { case {}: return 1; } return 0; }",
  "class C { x: uint8 = 1; } function f(c: C) { if (c === new C()) {} }",
])("a strict comparison with a fresh value is refused: %s", expectStaticTypeError);

test.each([
  "function f(c: Composite.<{ x: uint8 }>) { if (c === Composite.<{ x: uint8 }>({ x: (1 := uint8) })) {} } 'ok';",
  "class D { constructor() { return {}; } } function f(d: D) { if (d === new D()) {} } 'ok';",
  "function f(x) { return x === []; } 'ok';",
])("a comparison with a value that may already exist is accepted: %s", (source) => expect(ok(source)).toBe(true));
