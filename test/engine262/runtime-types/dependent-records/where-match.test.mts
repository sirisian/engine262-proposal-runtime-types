import { expect, test } from 'vitest';
import { evaluated, expectThrownKind, observeScript } from '../harness.mts';

/**
 * Spec: #sec-where-clauses. A `match` expression is an ordinary predicate, and in a
 * `where` position it carries an implicit `default: false;` clause: a predicate that
 * matches no clause has answered that the value is not of the type. An explicit
 * `default` overrides the implicit one.
 */

const ORDER = 'type Order = { status: "open" | "done", total: uint32 } where match (this.status) { when "open": true; }; ';

test('a value whose clause answers true is of the type', () => {
  expect(evaluated(`${ORDER} var v: any = { status: "open", total: (1 := uint32) }; String(v is Order);`)).toBe('true');
});

test('a value no clause matches is not of the type: is answers false', () => {
  expect(evaluated(`${ORDER} var v: any = { status: "done", total: (1 := uint32) }; String(v is Order);`)).toBe('false');
});

test('a value no clause matches is refused, with a TypeError, at a boundary', () => {
  expectThrownKind(`${ORDER} var v: any = { status: "done", total: (1 := uint32) }; let o: Order = v;`, 'TypeError');
});

test('an explicit default overrides the implicit one', () => {
  expect(evaluated(`type Order = { status: "open" | "done", total: uint32 } where match (this.status) { when "open": true; default: true; };
    var v: any = { status: "done", total: (1 := uint32) }; String(v is Order);`)).toBe('true');
  expect(evaluated(`type Order = { status: "open" | "done", total: uint32 } where match (this.status) { when "open": true; default: false; };
    var v: any = { status: "done", total: (1 := uint32) }; String(v is Order);`)).toBe('false');
});

// #sec-where-clauses: a `match` predicate establishes, for the clauses after
// it, the join over its arms of the subject as that arm's pattern leaves it,
// under the arm body's own facts. An arm that answers `false`, and the
// implicit default, contribute no value.
const neverSucceeds = (source: string): void => {
  expect(observeScript(source)).toMatchObject({ bodyEntered: false, errorClass: 'StaticTypeError', diagnostic: { rule: 'rt-impossible-test' } });
};

test('an arm that answers false is not a premise of a later clause', () => {
  neverSucceeds("function f(k: 'a' | 'b' | 'c') where match (k) { when 'a': true; when 'b': false } where k === 'b' { return k; }");
  neverSucceeds("type T = { k: 'a' | 'b' | 'c' } where match (this.k) { when 'a': true; when 'b': false } where this.k === 'b';");
  expect(evaluated("function f(k: 'a' | 'b' | 'c') where match (k) { when 'a': true; when 'b': false; when 'c': true } where k === 'c' { return k; } 'ok';")).toBe('ok');
});

test('a range arm bounds its subject as the same range in an is test does', () => {
  neverSucceeds('function f(x: uint8) where match (x) { when 0..=10: true } where x > 50 { return x; }');
  neverSucceeds('function f(x: uint8) where match (x) { when 0..=10: true; when 20..=30: true } where x > 15 where x < 20 { return x; }');
  neverSucceeds('function f(x: uint8) where match (x) { when 0..=10: false; default: true } where x < 5 { return x; }');
  expect(evaluated('function f(x: uint8) where match (x) { when 0..=10: true; when 20..=30: true } where x > 15 { return x; } function g(v: uint8) { return f(v); } String(g(25));')).toBe('25');
});
