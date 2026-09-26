import { expect, test } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

/**
 * Narrowing established before a loop was never re-widened when the body
 * invalidated it, so the second iteration was typed with a fact that had stopped
 * being true. The minimal case typechecked and failed at RUN TIME:
 *
 *   if (v !== null) { for (…) { n = v.x; v = null; } }   // Cannot convert null to object
 *
 * Ordinary invalidation always worked - the same two statements outside a loop
 * are refused - so what was missing is a rule at the back-edge, not a rule about
 * assignment. Every name a loop can reassign now loses its narrowing before the
 * body is walked.
 *
 * The body is walked ONCE, so the fact has to be dropped before the walk rather
 * than at the assignment: a read textually before the assignment is fine on the
 * first pass and stale on the second, and one walk cannot tell them apart. The
 * rule is therefore conservative by exactly that much.
 */
const H = 'class A { x: uint8 = 1; } let v: A | null = new A(); let n: uint8 = 0; ';

test('every loop form widens a narrowing its body can invalidate', () => {
  expectThrown(`${H}if (v !== null) { for (let i: uint8 = 0; i < 2; i = i + 1) { n = v.x; v = null; } }`,
    'is not declared by every member');
  expectThrown(`${H}let k: uint8 = 0; if (v !== null) { while (k < 2) { k = k + 1; n = v.x; v = null; } }`,
    'is not declared by every member');
  expectThrown(`${H}let k: uint8 = 0; if (v !== null) { do { k = k + 1; n = v.x; v = null; } while (k < 2); }`,
    'is not declared by every member');
  expectThrown(`${H}const arr: [2].<uint8> = [1,2]; if (v !== null) { for (const e of arr) { n = v.x; v = null; } }`,
    'is not declared by every member');
  expectThrown(`${H}const o = { p: 1 }; if (v !== null) { for (const k in o) { n = v.x; v = null; } }`,
    'is not declared by every member');
});

test('an assignment nested in a block inside the body still counts', () => {
  expectThrown(`${H}if (v !== null) { for (let i: uint8 = 0; i < 2; i = i + 1) { { n = v.x; } { v = null; } } }`,
    'is not declared by every member');
});

test('typeof narrowing widens the same way', () => {
  // Asserted through an assignment rather than a member read: `s.length` on a
  // `uint8` is refused with no loop and no narrowing at all, so a test built on
  // it cannot tell the leak from the ordinary refusal. Assigning the narrowed
  // binding to a `string` is refused unguarded and allowed when guarded, so the
  // control discriminates.
  expect(evaluated('let s: string | uint8 = "hi"; let t: string = ""; if (typeof s === "string") { t = s; } t;')).toBe('hi');
  expectThrown(`let s: string | uint8 = "hi"; let t: string = "";
    if (typeof s === "string") { for (let i: uint8 = 0; i < 2; i = i + 1) { t = s; s = (1 := uint8); } }`,
  'is not assignable to');
});

test('the idioms that were always correct still are', () => {
  // A loop that does not reassign, a narrowing re-established each pass, a
  // `const` base that cannot be reassigned, and a `while` narrowed by its own
  // test - none of these is touched by the widening.
  expect(evaluated(`${H}if (v !== null) { for (let i: uint8 = 0; i < 2; i = i + 1) { n = v.x; } } String(n);`)).toBe('1');
  expect(evaluated(`${H}for (let i: uint8 = 0; i < 2; i = i + 1) { if (v !== null) { n = v.x; v = null; } } String(n);`)).toBe('1');
  expect(evaluated(`class A { x: uint8 = 1; } const v: A | null = new A(); let n: uint8 = 0;
    if (v !== null) { for (let i: uint8 = 0; i < 2; i = i + 1) { n = v.x; } } String(n);`)).toBe('1');
  expect(evaluated(`${H}while (v !== null) { n = v.x; v = null; } String(n);`)).toBe('1');
});

test('straight-line invalidation outside a loop is unchanged', () => {
  expectThrown(`${H}if (v !== null) { v = null; n = v.x; }`, 'is not declared by every member');
});

/**
 * A CALL is the other way a narrowing goes stale, and it is not a loop problem:
 *
 *   function clob() { v = null; }
 *   if (v !== null) { clob(); v.x; }      // typechecked, crashed at run time
 *
 * The walk cannot see into the callee, so the conservative fact is whether ANY
 * function body assigns the name. One that none does is untouched, which is what
 * keeps an ordinary call from widening anything.
 *
 * Inside a loop the call-site widening is not enough on its own: it fires when
 * the walk REACHES the call, and `for (…) { n = v.x; clob(); }` reads first. So
 * a loop body containing a call widens those names up front, for the same
 * single-pass reason the assigned set does.
 */
const C = 'class A { x: uint8 = 1; } let v: A | null = new A(); let n: uint8 = 0; ';

test('a call widens a narrowing of a name some function assigns', () => {
  expectThrown(`${C}function clob(): uint8 { v = null; return 0; }
    if (v !== null) { clob(); n = v.x; }`, 'is not declared by every member');
});

test('a loop whose body calls such a function widens it before the body', () => {
  expectThrown(`${C}function clob(): uint8 { v = null; return 0; }
    if (v !== null) { for (let i: uint8 = 0; i < 2; i = i + 1) { n = v.x; clob(); } }`,
  'is not declared by every member');
});

test('a call that cannot touch the binding widens nothing', () => {
  // The rule is name-specific: `pure` assigns nothing, and `bump` assigns `z`,
  // so neither reaches `v`. A blanket drop-at-every-call would have broken both.
  expect(evaluated(`${C}function pure(k: uint8): uint8 { return k; }
    if (v !== null) { pure(1); n = v.x; } String(n);`)).toBe('1');
  expect(evaluated(`${C}let z: uint8 = 0; function bump(): uint8 { z = z + 1; return z; }
    if (v !== null) { for (let i: uint8 = 0; i < 2; i = i + 1) { n = v.x; bump(); } } String(n);`)).toBe('1');
});

test('a const base survives any call', () => {
  expect(evaluated(`class A { x: uint8 = 1; } const v: A | null = new A(); let n: uint8 = 0;
    function clob(): uint8 { return 0; }
    if (v !== null) { clob(); n = v.x; } String(n);`)).toBe('1');
});

test('a narrowing re-established after the call holds', () => {
  expect(evaluated(`${C}function clob(): uint8 { v = null; return 0; }
    clob(); if (v !== null) { n = v.x; } String(n);`)).toBe('0');
});

/**
 * A GUARD CLAUSE carries its narrowing to the rest of the function, and did so
 * only for a binding. `carriedGuardFact` bailed when `lookup(fact.name)` found
 * nothing, and a path is not in the bindings map until something narrows it - so
 * `if (c.a === null) return 0; return c.a.x;` was refused while the `else`
 * spelling of the same test narrowed the same path. It falls back the way
 * `walkGuardedBranches` already does.
 *
 * The rule stays exit-sensitive: a guard whose branch does not leave carries
 * nothing, since control joins and no fact holds after it.
 */
test('a guard clause carries its narrowing over a path as well as a binding', () => {
  const B = 'class A { x: uint8 = 1; } class B { a: A | null = null; } const b = new B(); b.a = new A(); ';
  expect(evaluated(`${B}function f(c: B): uint8 { if (c.a === null) return 0; return c.a.x; } String(f(b));`)).toBe('1');
  expect(evaluated(`class A { x: uint8 = 1; }
    function f(v: A | null): uint8 { if (v === null) return 0; return v.x; } String(f(new A()));`)).toBe('1');
  // `throw` leaves as surely as `return` does.
  expect(evaluated(`class A { x: uint8 = 1; }
    function f(v: A | null): uint8 { if (v === null) throw new Error("x"); return v.x; } String(f(new A()));`)).toBe('1');
});

test('a guard whose branch does not leave carries nothing', () => {
  expectThrown(`class A { x: uint8 = 1; }
    function f(v: A | null): uint8 { if (v === null) { } return v.x; } f(new A());`,
  'is not declared by every member');
});
