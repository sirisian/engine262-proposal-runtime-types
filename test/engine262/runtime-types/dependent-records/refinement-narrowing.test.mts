import { expect, test } from 'vitest';
import { evaluated, expectStaticTypeError } from '../harness.mts';

/**
 * Spec: #sec-refinement-narrowing. Where the Static Type of `v` is a dependent record
 * type whose predicate is the conditional form, and the narrowing facts in force at a
 * position decide that predicate's condition, the branch so taken contributes its
 * narrowing facts there, reading `this` as `v`: `this.p !== undefined` contributes what
 * `v.p !== undefined` does, and `this is T` what `v is T` does. Where the facts leave the
 * predicate open nothing is narrowed and the boundary check stands.
 *
 * This is what lets a test on a discriminating member narrow the member it governs
 * without the program writing a discriminated union.
 */

const CONTACT = 'type Contact = { kind: "email" | "none", email: string | null } where if (this.kind === "email") { this.email !== null } else { true }; ';
const CONTACT_IS = 'type Contact = { kind: "email" | "none", email: string | null } where if (this.kind === "email") { this is { email: string } } else { true }; ';

test('the discriminating test gives the member its literal type, which is the fact the refinement reads', () => {
  expect(evaluated(`${CONTACT} function f(c: Contact): string { if (c.kind === "email") { const k: "email" = c.kind; return k; } return "none"; }
    String(f({ kind: "email", email: "a@b" }));`)).toBe('email');
});

test('without the refinement the discriminating test narrows nothing else', () => {
  // The control for the tests below: it is the predicate that would make the
  // difference, so a type with the same members and no predicate must refuse.
  expectStaticTypeError(`type Plain = { kind: "email" | "none", email: string | null };
    function f(c: Plain): string { if (c.kind === "email") { const s: string = c.email; return s; } return "none"; }`);
});

test('where no test decides the predicate, the member stays nullable', () => {
  expectStaticTypeError(`${CONTACT} function f(c: Contact): string { const s: string = c.email; return s; }`);
});

// Pinned as `test.fails`: the checker does not read a conditional refinement as a
// source of narrowing facts, so the member keeps its declared type inside the branch
// and the assignment is refused. Each flips to `test` when the refinement's branch
// contributes its facts.
test.fails('a conditional refinement narrows the member it constrains: `!== null`', () => {
  expect(evaluated(`${CONTACT} function f(c: Contact): string { if (c.kind === "email") { const s: string = c.email; return s; } return "none"; }
    String(f({ kind: "email", email: "a@b" })) + '/' + String(f({ kind: "none", email: null }));`)).toBe('a@b/none');
});

test.fails('a conditional refinement narrows the member it constrains: `this is { ... }`', () => {
  expect(evaluated(`${CONTACT_IS} function f(c: Contact): string { if (c.kind === "email") { const s: string = c.email; return s; } return "none"; }
    String(f({ kind: "email", email: "a@b" }));`)).toBe('a@b');
});
