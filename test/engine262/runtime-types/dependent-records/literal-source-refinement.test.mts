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
  // Two contradictory clauses are refused at the declaration since round 5, Q5
  // (narrowing/interval-narrowing.test.mts), before any value reaches them.
  expect(observeScript('type T = { a: uint8 } where this.a > 5 where this.a < 5; let t: T = { a: 1 };')).toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-impossible-test' } });
  refused('type D = { c: "A" | "B" } where if (this.c == "A") { this is { p: string } } else { this is { q: string } }; let d: D = { c: "A", q: "s" };');
  // A refined parameter type decides a literal argument the same way.
  refused('type Pos = { a: uint8 } where this.a > 0; function g(p: Pos) {} g({ a: 0 });');
  expect(evaluated('type Pos = { a: uint8 } where this.a > 0; function g(p: Pos) { return p.a; } String(g({ a: 1 }));')).toBe('1');
  // A const bound to a fresh literal supplies this as the literal does (round 5, Q9).
  refused('type Pos = { a: uint8 } where this.a > 0; function g(p: Pos) {} const q = { a: 0 }; g(q);');
  expect(evaluated('type Pos = { a: uint8 } where this.a > 0; function g(p: Pos) { return p.a; } const q = { a: 1 }; String(g(q));')).toBe('1');
});

test('a refinement predicate is walked with this typed as the base (round 5, Gap 4 and Q4)', () => {
  expect(observeScript('type Pos = { a: uint8 } where this.a > 300;')).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-numeric-range', phase: 'static' } });
  expect(observeScript('type Z = { a: uint8 } where this.a >= 0;')).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-impossible-test', phase: 'static' } });
  expect(observeScript('type S = uint8 where this > 300;')).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-numeric-range', phase: 'static' } });
  // An open object base admits a member it does not declare, and a chain is left to its arms.
  expect(evaluated('type Pos = { a: uint8 } where this.b > 0; "ok";')).toBe('ok');
  expect(evaluated('type D = { c: "A" | "B" } where if (this.c == "A") { this is { p: string } } else { this is { q: string } }; "ok";')).toBe('ok');
  expect(evaluated('const limit: uint8 = 10; type Q = { a: uint8 } where this.a > limit; let q: Q = { a: 11 }; String(q.a);')).toBe('11');
});

test('a literal source satisfying the refinement, and a source the checker cannot value, are unchanged', () => {
  expect(evaluated('type Pos = { a: uint8 } where this.a > 0; let p: Pos = { a: 1 }; String(p.a);')).toBe('1');
  expect(evaluated('type D = { c: "A" | "B" } where if (this.c == "A") { this is { p: string } } else { this is { q: string } }; let d: D = { c: "A", p: "s" }; "ok";')).toBe('ok');
  expect(evaluated('const limit: uint8 = 0; type Q = { a: uint8 } where this.a > limit; let q: Q = { a: 1 }; String(q.a);')).toBe('1');
  expect(observeScript('type Pos = { a: uint8 } where this.a > 0; let v: any = { a: 0 }; let p: Pos = v;')).toMatchObject({ bodyEntered: true, errorClass: 'TypeError' });
});

test('a literal into a refined primitive type is judged by the refinement (round 5 follow-up, Q17)', () => {
  // A literal already of the base is a value of the refined type when it
  // satisfies the predicate, and refused naming the clause when it does not.
  expect(evaluated("type S = string where this.length > 2; let s: S = 'abc'; s;")).toBe('abc');
  refused("type S = string where this.length > 2; let s: S = 'a';");
  expect(evaluated('type N = number where this > 2; let n: N = 5; String(n);')).toBe('5');
  refused('type N = number where this > 2; let n: N = 1;');
  expect(evaluated('type B = boolean where this === true; let b: B = true; String(b);')).toBe('true');
  refused('type B = boolean where this === true; let b: B = false;');
  // A const bound to a literal, and a call argument, the same.
  expect(evaluated("type S = string where this.length > 2; const c = 'abc'; let s: S = c; s;")).toBe('abc');
  refused("type S = string where this.length > 2; const c = 'a'; let s: S = c;");
  refused("type S = string where this.length > 2; function g(s: S) { return s; } g('a');");
  // A literal of another base, a non-literal source, and a number under a
  // refined value type (which would need a conversion the run time does not
  // perform into a refined value type) stay refused as before.
  expect(observeScript("type S = string where this.length > 2; let s: S = 5;")).toMatchObject({ bodyEntered: false, diagnostic: { rule: 'rt-assignability', phase: 'static' } });
  expect(observeScript("type S = string where this.length > 2; let x: string = 'abc'; let s: S = x;")).toMatchObject({ bodyEntered: false, diagnostic: { phase: 'static' } });
  expect(observeScript('type P = uint8 where this > 2; let p: P = 5;')).toMatchObject({ bodyEntered: false, diagnostic: { phase: 'static' } });
});
