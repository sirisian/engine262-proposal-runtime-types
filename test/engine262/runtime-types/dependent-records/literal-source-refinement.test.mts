import { expect, test } from 'vitest';
import { evaluated, observeScript } from '../harness.mts';

/**
 * Round 5, Gap 5: #sec-where-clauses requires a refinement predicate to be
 * compile-time evaluable as a function of this, and a fresh object literal
 * of literal values supplies this; a value failing the refinement is refused
 * where it is written, including in an uncalled body, rather than by the
 * boundary at run time. A source the checker cannot value keeps the boundary.
 */

const refused = (source: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-assignability' } });
};

test('a literal source failing a refinement is refused before the body', () => {
  refused('type Pos = { a: uint8 } where this.a > 0; let p: Pos = { a: 0 };');
  refused('type Pos = { a: uint8 } where this.a > 0; function h() { let p: Pos = { a: 0 }; }');
  refused('type Q = { p: { a: uint8 } } where this.p.a > 0; let q: Q = { p: { a: 0 } };');
  refused('type T = { a: uint8 } where this.a > 5 where this.a < 5; let t: T = { a: 1 };');
  refused('type D = { c: "A" | "B" } where if (this.c == "A") { this is { p: string } } else { this is { q: string } }; let d: D = { c: "A", q: "s" };');
});

test('a literal source satisfying the refinement, and a source the checker cannot value, are unchanged', () => {
  expect(evaluated('type Pos = { a: uint8 } where this.a > 0; let p: Pos = { a: 1 }; String(p.a);')).toBe('1');
  expect(evaluated('type D = { c: "A" | "B" } where if (this.c == "A") { this is { p: string } } else { this is { q: string } }; let d: D = { c: "A", p: "s" }; "ok";')).toBe('ok');
  expect(evaluated('const limit: uint8 = 0; type Q = { a: uint8 } where this.a > limit; let q: Q = { a: 1 }; String(q.a);')).toBe('1');
  expect(observeScript('type Pos = { a: uint8 } where this.a > 0; let v: any = { a: 0 }; let p: Pos = v;')).toMatchObject({ bodyEntered: true, errorClass: 'TypeError' });
});
