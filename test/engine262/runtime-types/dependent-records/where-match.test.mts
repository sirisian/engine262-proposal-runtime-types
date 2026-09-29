import { expect, test } from 'vitest';
import { evaluated, expectThrownKind } from '../harness.mts';

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

// Pinned as `test.fails`: the engine does not apply the implicit `default: false;`, so the
// `match` throws "matched no clause of this match" out of the predicate and `is` throws
// instead of answering false. (A value that is structurally invalid answers false only
// because the predicate is never reached.) Flips to `test` when the implicit default applies.
test.fails('a value no clause matches is not of the type: is answers false', () => {
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
