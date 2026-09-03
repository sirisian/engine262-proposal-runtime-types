// PLAN-variadic-and-named-generic-arguments.md 2.6 / spec.emu
// #sec-inference-through-results, #sec-declared-inverses: the ladder's last two
// rungs, for scalars and packs alike (OQ-8, no carve-outs). Rung two: a
// parameter reached only through a BUILDER, with a CLOSED constraint, binds by
// trialling the constraint's inhabitants forward - exactly one must pass. Rung
// three: with an open constraint, the parameter binds only through the
// builder's declared inverse - and none exists here yet - so the call is
// refused NAMING THE BUILDER, which is the diagnostic contract (G34, G37).
// Before this, such a parameter bound silently to `any` and the builder ran
// over nothing.
import { test, expect } from 'vitest';
import { evaluated, expectThrown } from '../harness.mts';

const WRAP = 'function wrapOf(T) { return T; }';

test('rung three: a builder with no inverse refuses the call, naming the builder and the parameter (G34, F-Y)', () => {
  expectThrown(`${WRAP} function j<T>(x: wrapOf(T)): uint32 { return 1; } j(1);`, 'wrapOf declares no inverse');
  expectThrown(`${WRAP} function j3<...Ts>(...ps: wrapOf(Ts)): uint32 { return ps.length; } j3(1, "a");`, 'wrapOf declares no inverse, so Ts');
});

test('rung three: explicit arguments bind through the builder; a direct mention elsewhere still binds (G36 shape)', () => {
  expect(evaluated(`${WRAP} function j<T>(x: wrapOf(T)): uint32 { return 1; } String(j.<uint8>(1));`)).toBe('1');
  expect(evaluated(`${WRAP} function j3<...Ts>(...ps: wrapOf(Ts)): uint32 { return ps.length; } String(j3.<uint8, string>(1, "a"));`)).toBe('2');
  expect(evaluated(`${WRAP} function k<T>(x: T, y: wrapOf(T)): uint32 { return 1; } String(k(1, 2));`)).toBe('1');
});

test('the forward-declaration pattern needs no rung beyond the first (G35 shape)', () => {
  expect(evaluated('function all<...Ps extends [].<any>>(...ps: Ps): uint32 { return ps.length; } String(all(1, "a"));')).toBe('2');
});

// A builder whose result distinguishes every inhabitant of `[2].<boolean>`.
const MASK = 'function maskOf(Bs) { const es = Reflect.getReflection(Bs).elements; const a = es[0].type === type true; const b = es[1].type === type true; return a ? (b ? uint8 : uint16) : (b ? int8 : string); }';

test('rung two: a closed SCALAR constraint proposes its inhabitants and exactly one verifies (F-X, scalar)', () => {
  // The call succeeding is the proof: only the candidate `true` makes `pick`
  // yield `uint8`, which the argument satisfies; the candidate `false` yields
  // `string`, which it does not. With no candidate passing the call would be
  // refused (the test below).
  expect(evaluated('function pick(B) { return B === type true ? uint8 : string; } function one<B extends boolean>(x: pick(B)): string { return "bound"; } one(1 := uint8);')).toBe('bound');
  expect(evaluated('function pick(B) { return B === type true ? uint8 : string; } function one<B extends boolean>(x: pick(B)): string { return "bound"; } one("s");')).toBe('bound');
});

// F-AD, pinned: a candidate literal record the trial builds does not intern to
// the Type Object a written `type true` does, so `B === type true` inside the
// body reads false although B is bound to the literal `true`. The candidates
// must be built by the path a written literal type takes.
test.fails('rung two: a trial-bound literal is the same Type Object as its written spelling (F-AD)', () => {
  expect(evaluated('function pick(B) { return B === type true ? uint8 : string; } function one<B extends boolean>(x: pick(B)): string { return String(B === type true); } one(1 := uint8);')).toBe('true');
});

// F-X (pack half), pinned on F-AD: the trial enumerates `[2].<boolean>` as
// four candidate tuples and verifies each forward, but the builder's
// `es[0].type === type true` reads false for every candidate for the reason
// above, so no candidate passes.
test.fails('rung two: a closed PACK constraint proposes its tuples and exactly one verifies (F-X, pack)', () => {
  expect(evaluated(`${MASK} function withFlags<...Bs extends [2].<boolean>>(m: maskOf(Bs)): string { return String(Reflect.getReflection(Bs).elements.map((e) => e.type === type true).join(",")); } withFlags(1 := uint16);`)).toBe('true,false');
});

test('rung two: no inhabitant, or more than one, refuses naming the builder', () => {
  expectThrown(`${MASK} function withFlags<...Bs extends [2].<boolean>>(m: maskOf(Bs)): uint32 { return 1; } withFlags(true);`, 'no inhabitant');
  expectThrown('function same(B) { return uint8; } function amb<B extends boolean>(x: same(B)): uint32 { return 1; } amb(1 := uint8);', 'inhabitants of');
});
