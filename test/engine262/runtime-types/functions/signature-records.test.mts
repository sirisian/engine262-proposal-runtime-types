import { test, expect } from 'vitest';
import { evaluated, ok, expectStaticTypeError } from '../harness.mts';
import { SequenceAssignment, slotReceiving, type Slot } from '../../../../src/type-system/sequence-assignment.mts';

/**
 * Spec: #sec-signature-records (Signature Records) - a signature's parameters
 * are RECORDS.
 *
 * #sec-signature-records: "A Parameter Record has a [[Name]], a [[Type]], an
 * [[Optional]] field, a [[Rest]] field, an [[Initial]] field, and a
 * [[Reference]] field." A bare `TypeRecord[]` in its place leaves the half of
 * the engine that interns, relates, and reflects types unable to say a
 * parameter is a rest, is optional, or has a name - which pushes the
 * information into `OverloadParameter` for resolution and a PARALLEL `Shapes`
 * array beside the checker's type list. Three representations of one thing
 * disagree; the record is the one.
 *
 * The consequence this file pins is IDENTITY. Types are interned by a canonical
 * order key, and that key was built from the parameter TYPES alone - so two
 * signatures differing only in a rest, or only in an optional marker, produced
 * the same key and interned as ONE Type Object. Every later phase of the plan
 * would have been built on a model that could not tell its own cases apart.
 */

test('a rest parameter is part of a function type\'s IDENTITY', () => {
  // The whole point: these are different types, and were one Type Object.
  expect(evaluated(`
    type A = (...[].<uint8>) => void;
    type B = ([].<uint8>) => void;
    String(A === B);
  `)).toBe('false');

  // Interning still works: the same shape written twice is one object, which is
  // what makes the assertion above a distinction rather than a broken key.
  expect(evaluated(`
    type A = (...[].<uint8>) => void;
    type B = (...[].<uint8>) => void;
    String(A === B);
  `)).toBe('true');
});

test('an optional marker is part of a function type\'s identity', () => {
  expect(evaluated(`
    type A = (a?: uint8) => void;
    type B = (a: uint8) => void;
    String(A === B);
  `)).toBe('false');
});

test('a rest parameter in a function type keeps its declared type', () => {
  // A rest is the UNNAMED parameter form, storing its type in [[Type]] rather
  // than behind a [[TypeAnnotation]]. Reading only the annotation left the type
  // `any`, which made every typed rest in a function type indistinguishable
  // from every other - a second way for two types to collapse into one.
  expect(evaluated(`
    type A = (...[].<uint8>) => void;
    type B = (...[].<string>) => void;
    String(A === B);
  `)).toBe('false');
});

test('a parameter\'s name does not affect identity', () => {
  // #sec-signature-records: "A parameter's name is carried because the design's
  // named arguments select by it, and is not part of the signature's identity."
  // The record now carries [[Name]], so this is worth pinning: carrying it must
  // not have made two spellings of one signature into two types.
  expect(evaluated(`
    type A = (a: uint8) => void;
    type B = (b: uint8) => void;
    String(A === B);
  `)).toBe('true');
});

test('existing signature behaviour is unchanged by the model change', () => {
  // The record model has no behaviour of its own; these are the surfaces that
  // read a parameter list, asserted so a regression shows up here rather than
  // downstream.
  expect(ok('function f(a: uint8) { return a; } f(1);')).toBe(true);
  expect(ok('function f(a: uint8, b: string = "b") { return b; } f(1);')).toBe(true);
  expect(ok('function f(a?: uint8) { return a; } f();')).toBe(true);
  expect(evaluated('function f(a: uint8, b: uint8) { return a + b; } String(f(1, 2));')).toBe('3');

  // Overload resolution reads the same records now; both rows must still be
  // reachable, which is what tells us the Shapes sidecar was removed without
  // losing what it carried.
  expect(evaluated(`
    function g(a: uint8): string { return "int"; }
    function g(a: string): string { return "str"; }
    g(1) + g("x");
  `)).toBe('intstr');

  // A defaulted parameter is an OPTIONAL one now (HasDefault was folded into
  // Optional per the clause), so a signature's minimum arity must not have
  // changed: the call below supplies neither optional argument.
  expect(evaluated(`
    function h(a: uint8, b: uint8 = 2, c?: uint8): uint8 { return a + b; }
    String(h(1));
  `)).toBe('3');
});

test('a rest parameter is reported by reflection', () => {
  // typeprogramming.md asks for `rest` on a parameter record; the record model
  // is what gives the reflection write path something to report it from.
  expect(evaluated(`
    type A = (...[].<uint8>) => void;
    const node = Reflect.getReflection.<Reflect.Type>(A);
    String(node.signatures[0].parameters[0].rest);
  `)).toBe('true');
  expect(evaluated(`
    type A = ([].<uint8>) => void;
    const node = Reflect.getReflection.<Reflect.Type>(A);
    String(node.signatures[0].parameters[0].rest);
  `)).toBe('false');
});

// -- SequenceAssignment --------------------------------------------------------

/*
 * SequenceAssignment: #sec-sequenceassignment.
 *
 * The operation the parameter-matching rules rest on, tested directly at the
 * module rather than through a script. That is deliberate: the clause's
 * acceptance criterion is a property of the ALGORITHM (the assignment returned
 * is the lexicographically greatest count list), and a property is easier to
 * pin at the module than through the two callers that will consume it.
 *
 * The design's worked examples are the cases that matter, since they are what
 * the README prints and what a reader will check the engine against.
 */

const fixed: Slot = { Rest: false, Optional: false };
const optional: Slot = { Rest: false, Optional: true };
const rest: Slot = { Rest: true, Optional: false };
const all = () => true;

test('an empty pattern matches an empty sequence and nothing else', () => {
  expect(SequenceAssignment([], 0, all)).toEqual([]);
  expect(SequenceAssignment([], 1, all)).toBe('unmatched');
});

test('fixed slots take exactly one each', () => {
  expect(SequenceAssignment([fixed, fixed], 2, all)).toEqual([1, 1]);
  expect(SequenceAssignment([fixed, fixed], 1, all)).toBe('unmatched');
  expect(SequenceAssignment([fixed, fixed], 3, all)).toBe('unmatched');
});

test('an optional slot takes one or none', () => {
  expect(SequenceAssignment([fixed, optional], 2, all)).toEqual([1, 1]);
  expect(SequenceAssignment([fixed, optional], 1, all)).toEqual([1, 0]);
});

test('a rest is greedy, and gives back for the slots after it', () => {
  // The design's worked example: `f(...a: [].<uint32>, ...b: [].<uint32>,
  // c: uint32)` called `f(0, 1, 2)` binds a to [0, 1], b to [], c to 2.
  //
  // The path is the one the clause's note describes: the first rest takes all
  // three, the tail cannot be satisfied, it yields to two, the second rest then
  // takes the one remaining and `c` cannot be satisfied, it yields to none, and
  // the assignment settles.
  expect(SequenceAssignment([rest, rest, fixed], 3, all)).toEqual([2, 0, 1]);

  // Greedy from the LEFT is observable when nothing forces a give-back: the
  // first rest takes everything and the second takes none.
  expect(SequenceAssignment([rest, rest], 3, all)).toEqual([3, 0]);
});

test('the types decide where one run ends and the next begins', () => {
  // `f(a: string, ...args: [].<uint32>, ...args2: [].<string>, callback)`
  // called with ('a', 0, 1, 2, 'a', 'b', fn). No rule about precedence is
  // needed: the admits predicate stops each rest at the first item it cannot
  // take, which is the whole of what splits the runs.
  const kinds = ['string', 'uint32', 'uint32', 'uint32', 'string', 'string', 'fn'];
  const want = ['string', 'uint32', 'string', 'fn'];
  const slots: Slot[] = [fixed, rest, rest, fixed];
  expect(SequenceAssignment(slots, kinds.length, (i, k) => kinds[i] === want[k])).toEqual([1, 3, 2, 1]);
});

test('untyped rests are bounded by the typed parameters around them', () => {
  // `f(...args1, callback1: () => void, ...args2, callback2: () => void)` called
  // with ('a', 1, 1.0, fn, 'b', 2, 2.0, fn). The design once explained this with
  // a rule that "dynamic types have less precedence than typed parameters";
  // no such rule exists or is needed. An untyped rest admits everything, and
  // greedy matching with backtracking produces the documented binding anyway,
  // because a longer first run leaves no function for the last slot.
  const kinds = ['string', 'num', 'num', 'fn', 'string', 'num', 'num', 'fn'];
  const slots: Slot[] = [rest, fixed, rest, fixed];
  expect(SequenceAssignment(slots, kinds.length, (i, k) => (slots[k].Rest || kinds[i] === 'fn'))).toEqual([3, 1, 3, 1]);
});

test('a sequence no distribution admits is unmatched', () => {
  // A required slot the item cannot satisfy.
  expect(SequenceAssignment([fixed], 1, () => false)).toBe('unmatched');
  // More items than the pattern can hold.
  expect(SequenceAssignment([fixed, optional], 3, all)).toBe('unmatched');
  // A rest cannot rescue a required slot that follows it and admits nothing.
  const slots: Slot[] = [rest, fixed];
  expect(SequenceAssignment(slots, 2, (_i, k) => slots[k].Rest)).toBe('unmatched');
});

test('the assignment is the lexicographically greatest one that matches', () => {
  // The clause's determinism claim, which is what lets an implementation use
  // any method that agrees. With three rests over four items every distribution
  // matches, and the greatest is the one that gives the first slot everything.
  expect(SequenceAssignment([rest, rest, rest], 4, all)).toEqual([4, 0, 0]);

  // And with a fixed slot at the end, the greatest that still matches.
  expect(SequenceAssignment([rest, rest, rest, fixed], 4, all)).toEqual([3, 0, 0, 1]);
});

test('the search is bounded rather than exponential', () => {
  // Memoization is a bound, not a tuning: eight rests over sixty items is
  // astronomically many distributions, and the memo visits each (slot, item)
  // state once. A naive matcher does not return from this.
  const slots: Slot[] = Array.from({ length: 8 }, () => rest);
  const started = Date.now();
  expect(SequenceAssignment([...slots, fixed], 60, all)).toEqual([59, 0, 0, 0, 0, 0, 0, 0, 1]);
  expect(Date.now() - started).toBeLessThan(1000);
});

test('slotReceiving reads which slot took an item', () => {
  // The two questions asked of one assignment: how many each took, and which
  // one took this item. Computing the second from the first keeps the callers
  // from drifting apart.
  const counts = [2, 0, 1];
  expect(slotReceiving(counts, 0)).toBe(0);
  expect(slotReceiving(counts, 1)).toBe(0);
  expect(slotReceiving(counts, 2)).toBe(2);
  expect(slotReceiving(counts, 3)).toBe(-1);
});

test('a non-arrow literal adopts the `this` its contextual signature declares', () => {
  // PLAN-declarative-checker-facts.md phase 1. #sec-this-adoption: "Where a
  // non-arrow function literal's contextual type is a ~function~ type whose
  // applicable signature has a [[ThisType]], the literal adopts it: `this`
  // within the body has that type ... An ARROW adopts nothing, since it has no
  // `this` of its own to give a type to, and the `this` it closes over is
  // already typed where it was written."
  //
  // An interface method's signature carries a [[ThisType]] - the self marker -
  // so an object literal satisfying that interface is a contextual position
  // with a SOURCE spelling, which a constructed signature is not. The marker
  // has no members, deliberately, so what is observable is that `this` has a
  // type at all: it had none before, and the assignment below was accepted.
  const iface = 'interface I { v: uint8; m(): uint8; } ';
  expectStaticTypeError(`${iface} let o: I = { v: (1 := uint8), m: function () { let s: string = this; return (0 := uint8); } };`);
  // An arrow nested inside an adopting literal CLOSES OVER that `this`, so it
  // sees the adopted type rather than starting a frame of its own - which is
  // the same rule read from the other side.
  expectStaticTypeError(`${iface} let o: I = { v: (1 := uint8), m: function () { const f = () => { let s: string = this; return 0; }; return (0 := uint8); } };`);
  // Adoption does not leak past the literal: a program after it is unaffected.
  expect(evaluated(`${iface} let o: I = { v: (1 := uint8), m: function () { return (0 := uint8); } }; String(o.v);`)).toBe('1');
});
