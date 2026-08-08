import { test, expect } from 'vitest';
import {
  evaluated, evaluatedFlagOff, expectError, expectThrown, run,
} from '../harness.mts';

/**
 * proposal-runtime-types: RANGE CONFORMANCE.
 *
 * Every test here is named by the SENTENCE of the specification it checks, not
 * by the feature it exercises. That is the whole point of the file: a suite
 * organized by feature answers "was this built?", and a suite organized by
 * clause answers "does the engine say what the specification says?". The second
 * question is the one that catches drift, and the first cannot. `interval`
 * returning a string passed a feature-shaped audit for three stages while
 * failing the clause that says a range exposes an `Interval`.
 *
 * A claim the engine does not yet satisfy is NOT skipped. It gets a test that
 * asserts TODAY'S behaviour, with the clause quoted and the divergence named in
 * a DIVERGENCE comment. A skipped test is invisible in a green run, which is
 * exactly how the gaps below survived. When a later stage makes a claim true,
 * it rewrites that test to assert the claim and deletes the comment, and the
 * diff of this file is the evidence the stage is done.
 *
 * The suite is keyed to spec.emu rather than to ranges.md, because the
 * specification is normative and the design document is where a claim is
 * argued. Where the two disagree, both are recorded, so a design-side error
 * surfaces as a third state rather than being resolved silently in the engine's
 * favour.
 *
 * Clauses covered: sec-range-literals, sec-ranges, sec-matchrange, and the
 * Range row of table-metadata-values in sec-metadata-decomposition.
 */

// =============================================================================
// sec-range-literals
// =============================================================================

test('sec-range-literals: the four two-endpoint forms produce the four intervals', () => {
  expect(evaluated('const r = 1..<6; r.start + "," + r.end;')).toBe('1,6');
  expect(evaluated('const r = 1..=6; r.start + "," + r.end;')).toBe('1,6');
  expect(evaluated('const r = 1<..<6; r.start + "," + r.end;')).toBe('1,6');
  expect(evaluated('const r = 1<..=6; r.start + "," + r.end;')).toBe('1,6');
});

test('sec-range-literals: the open-ended forms omit an endpoint', () => {
  expect(evaluated('String((5..).end);')).toBe('undefined');
  expect(evaluated('String((5<..).end);')).toBe('undefined');
  expect(evaluated('String((..<6).start);')).toBe('undefined');
  expect(evaluated('String((..=6).start);')).toBe('undefined');
  expect(evaluated('String((..).start) + "," + String((..).end);')).toBe('undefined,undefined');
});

test('sec-range-literals: there is no `a..b` and no `..b`', () => {
  expectError('const a = 1, b = 2; const x = a..b;');
  expectError('const x = ..6;');
});

test('sec-range-literals: a bare `..` appears only where the endpoint it faces is absent', () => {
  expect(evaluated('String((5..).start);')).toBe('5');
  expect(evaluated('String((..).isFull);')).toBe('true');
});

test('sec-range-literals: `.<` and `..<` are told apart by their second character', () => {
  expect(evaluated('let a: [].<uint8> = [1, 2]; String(a.length);')).toBe('2');
  expect(evaluated('const r = 1..<6; String(r.end);')).toBe('6');
});

test('sec-range-literals: a bare `<` is always relational or a shift', () => {
  expect(evaluated('String(1<=2) + "," + String(1<<2) + "," + String(1 < .5);')).toBe('true,4,false');
});

test('sec-range-literals: `1..<6` is the three tokens `1`, `..<`, `6`', () => {
  expect(evaluated('String((1..<6).start) + "," + String((1..<6).end);')).toBe('1,6');
  // `1.`, `1.5`, and the spread are unchanged.
  expect(evaluated('String(1.<2);')).toBe('true');
  expect(evaluated('String((1.5..<2.5).end);')).toBe('2.5');
  expectError('const x = 1...6;');
});

test('sec-range-literals: a form that marks its start needs the numeric rule not at all', () => {
  expect(evaluated('String((1<..<6).start);')).toBe('1');
});

test('sec-range-literals: `1..toString()` is a Syntax Error, not a member access', () => {
  expectError('1..toString();');
  // And with the feature off it keeps its base meaning.
  expect(evaluatedFlagOff('1..toString();')).toBe('1');
});

test('sec-range-literals: `?.` is not the punctuator where a `.` follows it', () => {
  expect(evaluated('String((true?..:2).isFull);')).toBe('true');
  expect(evaluated('String((true?..<5:2).end);')).toBe('5');
});

test('sec-range-literals: the `?.` extension changes no program', () => {
  expect(evaluated('String(true?.5:2);')).toBe('0.5');
  expect(evaluated('const o = { b: 7 }; String(o?.b);')).toBe('7');
  expectError('const a = 1, b = 2; String(a?..b);');
});

test('sec-range-literals: operands are ShortCircuitExpressions and the family is non-associative', () => {
  expect(evaluated('const a = null, b = 1; String(((a ?? b)..<3).start);')).toBe('1');
  expectError('const x = 1..<2..<3;');
});

test('sec-range-literals: the pipeline binds looser, so `0..<10 |> f(%)` pipes the range', () => {
  expect(evaluated('String(0..<10 |> %.start);')).toBe('0');
});

test('sec-range-literals: member access binds tighter than the range', () => {
  expect(evaluated('const arr = [1, 2, 3]; String((0..<arr.length).end);')).toBe('3');
  expect(evaluated('String((0..<10).length);')).toBe('10');
});

test('sec-range-literals: a range appears in a `case` label and an argument list with no further rule', () => {
  expect(evaluated('let r = "ran"; switch (3) { case 0..<5: break; } r;')).toBe('ran');
  expect(evaluated('const f = (r) => r.end; String(f(0..<7));')).toBe('7');
});

test('sec-range-literals: a statement beginning with a family token continues the previous expression', () => {
  expect(evaluated('const r = 1\n..<6\nString(r.end);')).toBe('6');
  expect(evaluated('const s = 1\n<..\nString(s.start);')).toBe('1');
});

test('sec-range-literals: no spaced reading is a program at all', () => {
  expectError('const a = 1, b = 2; String(a.. < b);');
  expectError('const a = 1, b = 2; String(a < ..);');
  expectError('const a = 1, b = 2; String(a <.. < b);');
});

test('sec-range-literals: a parenthesized range is rejected as a relational operand', () => {
  // "Parentheses put a range back under them, and there a range is REJECTED as
  //  a relational operand: a range does not implement `Ordered`, so
  //  `(0..<3) < 5` is a *TypeError* rather than the *false* an ordinary
  //  object's comparison would yield."
  const kind = (src) => `let k = "none"; try { ${src} } catch (e) { k = e.constructor.name; } k;`;
  expect(evaluated(kind('const a = 1, b = 2; (a..) < b;'))).toBe('TypeError');
  expect(evaluated(kind('(0..<3) < 5;'))).toBe('TypeError');
  // Either operand, and all four relational operators.
  expect(evaluated(kind('5 > (0..<3);'))).toBe('TypeError');
  expect(evaluated(kind('(0..<3) <= 5;'))).toBe('TypeError');
  expect(evaluated(kind('(0..<3) >= 5;'))).toBe('TypeError');
  // Catchable rather than an early error: the unspaced spellings are the ones
  // the grammar refuses.
  expect(evaluated('try { (0..<3) < 5; "no-throw" } catch (e) { "caught" }')).toBe('caught');
  // Equality is untouched, since a range compares by identity like any value.
  expect(evaluated('const r = 0..<3; String(r === r);')).toBe('true');
});

// =============================================================================
// sec-ranges - the value and its shapes
// =============================================================================

test('sec-ranges: the four shapes and `RangeBounds` are named', () => {
  // "There are four shapes: `Range.<T, S, E>` ... `RangeFrom.<T, S>` and
  //  `RangeTo.<T, E>` ... and `RangeFull.<T>` ... Each implements
  //  `RangeBounds.<T>`, which is the interface a consumer of an arbitrary range
  //  is written against."
  expect(evaluated('let a: Range; let b: RangeFrom; let c: RangeTo; let d: RangeFull; let e: RangeBounds; "ok";')).toBe('ok');
  expect(evaluated('let r: Range = 0..<10; typeof r;')).toBe('object');
});

test('sec-ranges: _S_ and _E_ are values of `Bound`', () => {
  // "_S_ and _E_ are values of `Bound`, either `Range.Bound.Closed` or `Range.Bound.Open`,
  //  one for each endpoint the shape has."
  expect(evaluated('String((0..<10).startBound === Range.Bound.Closed);')).toBe('true');
  expect(evaluated('String((0..<10).endBound === Range.Bound.Open);')).toBe('true');
  expect(evaluated('String((0<..=10).startBound === Range.Bound.Open);')).toBe('true');
  // "one for each endpoint the shape has" - absent where the shape has none.
  expect(evaluated('String((..<10).startBound);')).toBe('undefined');
});

test('sec-ranges: the four pairs are the four intervals and nothing further is expressible', () => {
  // "_S_ and _E_ are values of `Bound` ... so the four intervals of a
  //  two-endpoint range, the closed, the two half-open, and the open, are the
  //  four pairs and nothing further is expressible."
  const of = (r, s, e) => `String((${r}) is Range.<uint8, Range.Bound.${s}, Range.Bound.${e}>);`;
  expect(evaluated(of('0..<10', 'Closed', 'Open'))).toBe('true');
  expect(evaluated(of('0..=10', 'Closed', 'Closed'))).toBe('true');
  expect(evaluated(of('0<..<10', 'Open', 'Open'))).toBe('true');
  expect(evaluated(of('0<..=10', 'Open', 'Closed'))).toBe('true');
  // And a range of one interval is not of a type naming another.
  expect(evaluated(of('0..<10', 'Open', 'Open'))).toBe('false');
  expect(evaluated(of('0..<10', 'Closed', 'Closed'))).toBe('false');
});

test('sec-ranges: each of the four shapes is its own type, and each implements RangeBounds', () => {
  // Decided by the value rather than by a prototype chain, since the four
  // shapes share one dynamic representation and an absent endpoint is how it
  // says which shape it has.
  expect(evaluated('String((0..<10) is Range) + "," + String((5..) is Range);')).toBe('true,false');
  expect(evaluated('String((5..) is RangeFrom) + "," + String((..<5) is RangeTo) + "," + String((..) is RangeFull);')).toBe('true,true,true');
  // "Each implements `RangeBounds.<T>`, which is the interface a consumer of an
  //  arbitrary range is written against."
  expect(evaluated('String((0..<10) is RangeBounds) + "," + String((5..) is RangeBounds) + "," + String((..) is RangeBounds);')).toBe('true,true,true');
  expect(evaluated('String(5 is RangeBounds);')).toBe('false');
  // A bound named on a one-ended shape constrains that shape's own endpoint.
  expect(evaluated('String((5..) is RangeFrom.<uint8, Range.Bound.Closed>) + "," + String((5<..) is RangeFrom.<uint8, Range.Bound.Closed>);')).toBe('true,false');
});

test('sec-ranges: an annotation naming an interval admits only that interval', () => {
  expect(evaluated('let r: Range.<uint8, Range.Bound.Closed, Range.Bound.Open> = 0..<10; "ok";')).toBe('ok');
  expectThrown('let r: Range.<uint8, Range.Bound.Open, Range.Bound.Open> = 0..<10; "ok";');
  // The shape is checked with the bounds.
  expect(evaluated('let r: RangeFrom = 5..; "ok";')).toBe('ok');
  expectThrown('let r: RangeFrom = 0..<10; "ok";');
  expect(evaluated('let r: RangeBounds = 0..<10; "ok";')).toBe('ok');
});

test('ranges.md: the four aliases name the four intervals', () => {
  // "the aliases, so no annotation is forced through the three-argument
  //  spelling", each sharing the `Interval` enum's names so the language has one
  //  vocabulary for the four intervals rather than two.
  expect(evaluated('String((0..=10) is ClosedRange.<uint8>);')).toBe('true');
  expect(evaluated('String((0..<10) is ClosedOpenRange.<uint8>);')).toBe('true');
  expect(evaluated('String((0<..=10) is OpenClosedRange.<uint8>);')).toBe('true');
  expect(evaluated('String((0<..<10) is OpenRange.<uint8>);')).toBe('true');
  // An alias IS its expansion, so it admits only its own interval.
  expect(evaluated('String((0..<10) is ClosedRange.<uint8>);')).toBe('false');
  expect(evaluated('let r: ClosedOpenRange.<uint8> = 0..<10; "ok";')).toBe('ok');
  expectThrown('let r: ClosedRange.<uint8> = 0..<10; "ok";');
});

test('ranges.md: a range and its type print as they were written', () => {
  // "A diagnostic should prefer them: `ClosedRange.<uint8>` ... reads where
  //  `Range.<uint8, Bound.Closed, Bound.Closed>` does not." And a range VALUE
  //  named "[object Object]" told a reader nothing about the one thing wrong.
  const message = (src) => {
    const c = run(src) as { Value?: { HostDefinedMessageString?: string } };
    return c.Value?.HostDefinedMessageString ?? '';
  };
  // A range VALUE names itself in a runtime diagnostic - the cast path, which
  // an annotation no longer takes now that the wrong interval is caught at
  // check time.
  expect(message('const r = ((0..<10) := RangeFrom);')).toContain('0..<10');
  // And a range TYPE names itself by its alias in a check-time diagnostic.
  expect(message('let r: ClosedRange.<uint8> = 0..<10;')).toContain('ClosedOpenRange');
  // The alias is preferred over the raw parameterization; the element prints in
  // the engine's own spelling for a width, which is not this clause's business.
  expect(message('let r: ClosedRange.<uint8> = 0..<10;')).toContain('ClosedRange.<uint');
});

test('sec-ranges: a wrong interval is reported at CHECK time, before the code runs', () => {
  // A range literal takes its contextual type apart the way an array literal
  // does: its shape and bounds are its own, its ELEMENT comes from the position.
  // That is literal propagation, and taking the element from the literal instead
  // is what made an earlier attempt at this reject correct programs.
  const dead = (src) => `if (false) { ${src} } "ran";`;
  expect(evaluated(dead('let r: ClosedOpenRange.<uint8> = 0..<10;'))).toBe('ran');
  expectThrown(dead('let r: ClosedRange.<uint8> = 0..<10;'));
  expectThrown(dead('let r: RangeFrom = 0..<10;'));
  expectThrown(dead('let r: Range = 5..;'));
  // Every shape implements `RangeBounds`, so that annotation admits them all.
  expect(evaluated('let a: RangeBounds = 5..; let b: RangeBounds = ..; let c: RangeBounds = ..<3; "ok";')).toBe('ok');
});

test('sec-ranges: DIVERGENCE - the explicit three-argument spelling is compared at run time only', () => {
  // `ClosedRange.<uint8>` is compared statically above, because an alias carries
  // its bounds as ordinals. `Range.<uint8, Range.Bound.Open, Range.Bound.Open>`
  // is not: a bound written as an enum MEMBER does not reach the record as an
  // ordinal, so the static comparison skips it and only runtime membership
  // decides.
  //
  // DIVERGENCE: the rejection is correct, just late - and the alias spelling,
  // which ranges.md prefers anyway, is early.
  expect(evaluated('if (false) { let r: Range.<uint8, Range.Bound.Open, Range.Bound.Open> = 0..<10; } "ran";')).toBe('ran');
  expect(evaluated('let k="admitted"; try { let r: Range.<uint8, Range.Bound.Open, Range.Bound.Open> = 0..<10; } catch(e){ k="threw"; } k;')).toBe('threw');
});

test('sec-ranges: the four-way name of a pair is an `Interval`', () => {
  // "The four-way name of a pair is an `Interval`, which a range exposes and a
  //  diagnostic prefers over the parameterization."
  expect(evaluated('String((0..=10).interval === Range.Interval.Closed);')).toBe('true');
  expect(evaluated('String((0..<10).interval === Range.Interval.ClosedOpen);')).toBe('true');
  expect(evaluated('String((0<..=10).interval === Range.Interval.OpenClosed);')).toBe('true');
  expect(evaluated('String((0<..<10).interval === Range.Interval.Open);')).toBe('true');
  // A member of the enum, which is what lets a `switch` over it be exhaustive -
  // the reason the four-way name exists rather than the two bounds alone.
  expect(evaluated('const f=(r)=>{switch(r.interval){case Range.Interval.Closed: return "cc"; case Range.Interval.ClosedOpen: return "co"; case Range.Interval.OpenClosed: return "oc"; case Range.Interval.Open: return "oo";} return "?";}; f(0..=1)+","+f(0..<1)+","+f(0<..=1)+","+f(0<..<1);'))
    .toBe('cc,co,oc,oo');
  // A shape with one endpoint has no pair to name.
  expect(evaluated('String((5..).interval);')).toBe('undefined');
});

test('sec-ranges: a range is an expression and appears wherever one does', () => {
  expect(evaluated('const o = { r: 0..<3 }; String(o.r.end);')).toBe('3');
  expect(evaluated('String([0..<3][0].end);')).toBe('3');
});

test('sec-ranges: DIVERGENCE - a range is a value, but does not compare as one', () => {
  // "A range is a value, so it allocates nothing and copies."
  //
  // DIVERGENCE, recorded and NOT this plan's to fix: two equal ranges are not
  // `===`. This is engine-wide rather than range-specific -- two equal vectors
  // are not `===` either, while typed numbers are -- so object-backed value
  // types generally lack value equality. Fixing it for ranges alone would make
  // ranges the odd type out.
  expect(evaluated('const a = 0..<3, b = 0..<3; String(a === b);')).toBe('false');
  expect(evaluated('const a = float32x4(1,2,3,4), b = float32x4(1,2,3,4); String(a === b);')).toBe('false');
  expect(evaluated('const a := uint8 = 5, b := uint8 = 5; String(a === b);')).toBe('true');
});

// =============================================================================
// sec-ranges - the RangeBounds operations
// =============================================================================

test('sec-ranges: `contains` takes either a value or a range', () => {
  expect(evaluated('String((0..<10).contains(5));')).toBe('true');
  expect(evaluated('String((0..<10).contains(2..<5));')).toBe('true');
});

test('sec-ranges: an empty range is contained in every range, and the full range contains every range', () => {
  expect(evaluated('String((0..<10).contains(7..<7));')).toBe('true');
  expect(evaluated('String((..).contains(0..<10));')).toBe('true');
});

test('sec-ranges: intersect is commutative and associative with the full range as identity', () => {
  expect(evaluated('const a = 0<..<10, b = 5..=20; const x = a.intersect(b), y = b.intersect(a); x.start + "," + x.end + "|" + y.start + "," + y.end;'))
    .toBe('5,10|5,10');
  expect(evaluated('const r = (2..<7).intersect(..); r.start + "," + r.end;')).toBe('2,7');
  // Associativity.
  expect(evaluated('const a = 0..<10, b = 2..<8, c = 4..<6; const l = a.intersect(b).intersect(c), r = a.intersect(b.intersect(c)); l.start + "," + l.end + "|" + r.start + "," + r.end;'))
    .toBe('4,6|4,6');
});

test('sec-ranges: where two ranges share an endpoint the exclusive bound is the one the result carries', () => {
  expect(evaluated('String((0..<10).intersect(0..=10).interval === Range.Interval.ClosedOpen);')).toBe('true');
  expect(evaluated('String((0<..<10).intersect(0..<10).interval === Range.Interval.Open);')).toBe('true');
});

test('sec-ranges: a disjoint intersection is descending and therefore empty', () => {
  expect(evaluated('String((0..<5).intersect(10..<20).isEmpty);')).toBe('true');
});

test('sec-ranges: the shape of an intersection follows from its operands', () => {
  expect(evaluated('const r = (5..).intersect(..<9); r.start + "," + r.end + "," + String(r.interval === Range.Interval.ClosedOpen);')).toBe('5,9,true');
  expect(evaluated('const r = (0..<5).intersect(..); r.start + "," + r.end;')).toBe('0,5');
});

test('sec-ranges: DIVERGENCE - `scale` is present on every range, not only where the element type scales', () => {
  // "`scale` ... is present on the instantiations whose element type defines
  //  scalar multiplication, which an ordering does not imply: a range over
  //  `Temporal.Instant` has an order and no arithmetic, and has no `scale`."
  //
  // DIVERGENCE: `scale` is unconditional. Vacuous today, because every
  // range is over Number (see the element-type test below), and it stops being
  // vacuous the moment an ordering-only element type is admitted.
  expect(evaluated('String(typeof (0..<3).scale);')).toBe('function');
});

test('sec-ranges: a negative factor exchanges the endpoints and their bounds', () => {
  expect(evaluated('const r = (0..<10).scale(-1); r.start + "," + r.end + "," + String(r.interval === Range.Interval.OpenClosed);')).toBe('-10,0,true');
  // And exchanges RangeFrom with RangeTo.
  expect(evaluated('const r = (5..).scale(-1); String(r.start) + "," + r.end;')).toBe('undefined,-5');
});

test('sec-ranges: a zero factor yields the closed range at zero, and leaves an empty range empty', () => {
  expect(evaluated('const r = (0..<10).scale(0); r.start + "," + r.end + "," + String(r.interval === Range.Interval.Closed);')).toBe('0,0,true');
  expect(evaluated('String((5..<5).scale(0).isEmpty);')).toBe('true');
});

// =============================================================================
// sec-ranges - the value's members and iteration
// =============================================================================

test('sec-ranges: `start` and `end` are the endpoints, absent for an omitted one', () => {
  expect(evaluated('(0..<10).start + "," + (0..<10).end;')).toBe('0,10');
  expect(evaluated('String((..<10).start);')).toBe('undefined');
});

test('sec-ranges: `length` is one more than the difference, less one per excluding bound, never below zero', () => {
  expect(evaluated('String((0..=10).length);')).toBe('11');
  expect(evaluated('String((0..<10).length);')).toBe('10');
  expect(evaluated('String((0<..=10).length);')).toBe('10');
  expect(evaluated('String((0<..<10).length);')).toBe('9');
  expect(evaluated('String((5<..<5).length);')).toBe('0');
});

test('sec-ranges: a descending range is empty, and equal endpoints are empty unless both bounds are closed', () => {
  expect(evaluated('String((10..<0).isEmpty);')).toBe('true');
  expect(evaluated('String((5..=5).isEmpty);')).toBe('false');
  expect(evaluated('String((5..<5).isEmpty) + "," + String((5<..=5).isEmpty) + "," + String((5<..<5).isEmpty);'))
    .toBe('true,true,true');
});

test('sec-ranges: the nth value is counted from 0 for a closed start and from 1 for an open one', () => {
  expect(evaluated('[...0..<4].join(",");')).toBe('0,1,2,3');
  expect(evaluated('[...0<..<4].join(",");')).toBe('1,2,3');
  expect(evaluated('[...(0<..<1).step(0.25)].join(",");')).toBe('0.25,0.5,0.75');
});

test('sec-ranges: over a bounded integer interval the step is 1 and implicit', () => {
  expect(evaluated('let s = 0; for (const i of 0..<5) { s += i; } String(s);')).toBe('10');
});

test('sec-ranges: `step` supplies a step where an implicit one does not fit, or widens the stride', () => {
  expect(evaluated('[...(0..<10).step(2)].join(",");')).toBe('0,2,4,6,8');
  expect(evaluated('[...(0.0..<1.0).step(0.25)].join(",");')).toBe('0,0.25,0.5,0.75');
});

test('sec-ranges: a range with no start is not iterable', () => {
  expectThrown('[...(..<5)];');
});

test('sec-ranges: a non-integer interval is a TypeError to iterate without an explicit step', () => {
  expectThrown('[...(0.5..<2.5)];');
});

test('sec-ranges: the element type is any ORDERED type, not Number alone', () => {
  // "A range is a value type class over an ORDERED element type." bigint is
  // ordered, and its endpoints reach the value model through the same `R` that
  // Number's do, so the ORDERING operations are polymorphic over both.
  expect(evaluated('const r = 0n..<10n; String(r.start) + "," + String(r.end);')).toBe('0,10');
  expect(evaluated('String((0n..<10n).contains(5n)) + "," + String((0n..<10n).contains(10n)) + "," + String((0n..=10n).contains(10n));')).toBe('true,false,true');
  expect(evaluated('String((5n..<5n).isEmpty) + "," + String((5n..=5n).isEmpty);')).toBe('true,false');
  expect(evaluated('String((0n<..=10n).startBound === Range.Bound.Open);')).toBe('true');
  // Both endpoints must be the SAME kind: a range mixing them has no element
  // type, and comparing across them is the error a range exists to prevent.
  expectThrown('const r = 0..<10n; r;');
});

test('sec-ranges: length and iteration count in the element type', () => {
  // The ordering operations generalize by comparison; these generalize by
  // ARITHMETIC - the implicit step of one is `1` or `1n` by the element type,
  // and a bigint range's count is a BigInt, which a Number could not always
  // hold.
  expect(evaluated('String((0n..<10n).length) + "," + String((0n..=10n).length) + "," + String((0n<..<10n).length);')).toBe('10,11,9');
  expect(evaluated('[...(0n..<4n)].join(",");')).toBe('0,1,2,3');
  expect(evaluated('[...(0n<..<4n)].join(",");')).toBe('1,2,3');
  expect(evaluated('[...(0n..<4n).reverse()].join(",");')).toBe('3,2,1,0');
  expect(evaluated('let s = 0n; for (const i of 0n..<5n) { s += i; } String(s);')).toBe('10');
  expect(evaluated('String((5n..<5n).length);')).toBe('0');
  // The same answers a Number range gives, which is the point: the element type
  // changes the arithmetic and nothing else.
  expect(evaluated('String((0..<10).length) + "," + String((0..=10).length) + "," + String((0<..<10).length);')).toBe('10,11,9');
  // A non-integer endpoint still has no implicit step.
  expectThrown('(0.5..<2.5).length;');
});

test('sec-ranges: `reverse` iterates the same members in the opposite order', () => {
  expect(evaluated('[...(0..<10).reverse()].join(",");')).toBe('9,8,7,6,5,4,3,2,1,0');
  expect(evaluated('[...(0..=3).reverse()].join(",");')).toBe('3,2,1,0');
  // Each endpoint's bound is respected from the other side.
  expect(evaluated('[...(0<..<4).reverse()].join(",");')).toBe('3,2,1');
  expect(evaluated('[...(0<..=4).reverse()].join(",");')).toBe('4,3,2,1');
  // "how a descending traversal is written given that a descending range is
  //  empty" -- the same members, not exchanged endpoints.
  expect(evaluated('String([...(5..<5).reverse()].length);')).toBe('0');
  // A range with no end has no last member, mirroring a range with no start
  // not iterating forward.
  expectThrown('(5..).reverse();');
});

test('sec-ranges: DIVERGENCE - `Range.of` is declared by the design and absent from the engine', () => {
  // ranges.md declares `static of<T, S: Bound, E: Bound>(start, end)`, which is
  // the only way to construct a range in code generic over its bounds.
  //
  // DIVERGENCE: not implemented. Blocked on `Range.Bound`.
  expect(evaluated('String(typeof Range.of);')).toBe('undefined');
});

// =============================================================================
// random.md - the range form of Math.random
// =============================================================================

test('random.md: a range bound is consumed rather than ignored', () => {
  // Falling through to the ordinary `Math.random()`, which takes none, would
  // DROP a written bound and answer with a draw from [0, 1). Silently wrong is
  // worse than unimplemented, which is why this row exists even though the form
  // is the feature and not the defect.
  expect(evaluated('let ok = true; for (let i = 0; i < 400; i += 1) { const v = Number(Math.random.<uint8>(1..=6)); if (v < 1 || v > 6) ok = false; } String(ok);')).toBe('true');
});

test('random.md: each of the four intervals is a different draw', () => {
  // "A die. 1 through 6" -- both endpoints attainable.
  expect(evaluated('let lo = 99, hi = -1; for (let i = 0; i < 400; i += 1) { const v = Number(Math.random.<uint8>(1..=6)); if (v < lo) lo = v; if (v > hi) hi = v; } lo + "," + hi;')).toBe('1,6');
  // "0 through 99" -- the end is excluded.
  expect(evaluated('let hi = -1; for (let i = 0; i < 800; i += 1) { const v = Number(Math.random.<uint32>(0..<100)); if (v > hi) hi = v; } String(hi);')).toBe('99');
  // An open start excludes its own endpoint too.
  expect(evaluated('let lo = 99, hi = -1; for (let i = 0; i < 800; i += 1) { const v = Number(Math.random.<uint8>(0<..<10)); if (v < lo) lo = v; if (v > hi) hi = v; } lo + "," + hi;')).toBe('1,9');
  // The float intervals, on float16's grid where an endpoint is observable.
  expect(evaluated('let n = 0; for (let i = 0; i < 40000; i += 1) { if (Number(Math.random.<float16>(0..=1)) === 1) n += 1; } String(n > 0);')).toBe('true');
  expect(evaluated('let bad = 0; for (let i = 0; i < 20000; i += 1) { const v = Number(Math.random.<float16>(0..<1)); if (v >= 1) bad += 1; } String(bad);')).toBe('0');
  expect(evaluated('let bad = 0; for (let i = 0; i < 20000; i += 1) { const v = Number(Math.random.<float16>(0<..<1)); if (v <= 0 || v >= 1) bad += 1; } String(bad);')).toBe('0');
});

test('random.md: an open-ended range takes its missing endpoint from T', () => {
  expect(evaluated('let ok = true; for (let i = 0; i < 600; i += 1) { const v = Number(Math.random.<uint8>(..)); if (v < 0 || v > 255) ok = false; } String(ok);')).toBe('true');
  expect(evaluated('let ok = true; for (let i = 0; i < 300; i += 1) { if (Number(Math.random.<int32>(0..)) < 0) ok = false; } String(ok);')).toBe('true');
});

test('random.md: an empty range produces no value', () => {
  // "a RangeError when the call is made".
  expect(evaluated('let k = "no"; try { Math.random.<uint8>(5..<5); } catch (e) { k = e.constructor.name; } k;')).toBe('RangeError');
  // "5, the only value the range contains".
  expect(evaluated('String(Number(Math.random.<uint8>(5..=5)));')).toBe('5');
});

test('random.md: the no-argument form is unchanged', () => {
  expect(evaluated('let ok = true; for (let i = 0; i < 200; i += 1) { const v = Number(Math.random.<float32>()); if (v < 0 || v >= 1) ok = false; } String(ok);')).toBe('true');
  expect(evaluated('let ok = true; for (let i = 0; i < 200; i += 1) { const v = Math.random(); if (v < 0 || v >= 1) ok = false; } String(ok);')).toBe('true');
});

// =============================================================================
// sec-metadata-narrowing
// =============================================================================

// A meta type that narrows, written as primitivemetadata.md writes it: each
// comparison is a one-sided range and narrowing is intersection.
const NARROWS = `type NBn = { bounds?: RangeBounds };
meta NBn { default = {};
  subtype(sub, sup) { return sup.bounds === undefined || (sub.bounds !== undefined && sup.bounds.contains(sub.bounds)); }
  validate(v, c) { return c.bounds === undefined || c.bounds.contains(Number(v)); }
  narrow(cur, op, val) {
    const b = cur.bounds === undefined ? .. : cur.bounds;
    if (op === ">=") return { bounds: b.intersect(val..) };
    if (op === ">") return { bounds: b.intersect(val<..) };
    if (op === "<=") return { bounds: b.intersect(..=val) };
    if (op === "<") return { bounds: b.intersect(..<val) };
    return cur;
  } }`;

test('sec-metadata-narrowing: a comparison narrows the metadata inside the branch', () => {
  // "This is what lets `if (v >= 0)` give `v` the type
  //  `float32.<{ ..., bounds: 0.. }>` inside the branch ... so that a `return v`
  //  into a type requiring both bounds passes `subtype` and needs no check at
  //  all." The unguarded call is the control: it is the same call, and it fails.
  const g = 'function g(w: float64.<{ bounds: 0.. }>) { return 1; }';
  expect(evaluated(`${NARROWS} ${g}
    function f(v: float64.<{ bounds: ..<100 }>) { if (v >= 0) { return g(v); } return 0; } "ok";`)).toBe('ok');
  expectThrown(`${NARROWS} ${g}
    function f(v: float64.<{ bounds: ..<100 }>) { return g(v); } "ok";`);
});

test('sec-metadata-narrowing: a further comparison intersects the bound it already has', () => {
  // The clause's own second step: `if (v >= 0)` then "a further `if (v <= 343)`
  // intersect that bound to `0..=343`". Resolving each comparison against the
  // DECLARED type would give the inner branch `..=343` and fail this.
  const g = 'function g(w: float64.<{ bounds: 0..=343 }>) { return 1; }';
  expect(evaluated(`${NARROWS} ${g}
    function f(v: float64.<{ bounds: .. }>) { if (v >= 0) { if (v <= 343) { return g(v); } } return 0; } "ok";`)).toBe('ok');
  // The outer guard alone is not enough, which is what makes the nesting matter.
  expectThrown(`${NARROWS} ${g}
    function f(v: float64.<{ bounds: .. }>) { if (v >= 0) { return g(v); } return 0; } "ok";`);
});

test('sec-metadata-narrowing: the false branch narrows by the negation', () => {
  // "The false branch narrows by the negation of _op_, pairing `>=` with `<`."
  const g = 'function g(w: float64.<{ bounds: ..<0 }>) { return 1; }';
  // An explicit `else`: the false BRANCH is what the clause narrows. The code
  // after an `if` that returns is a continuation, not the false branch, and
  // narrowing it is control-flow analysis this does not claim to do.
  expect(evaluated(`${NARROWS} ${g}
    function f(v: float64.<{ bounds: .. }>) { if (v >= 0) { return 0; } else { return g(v); } } "ok";`)).toBe('ok');
});

test('sec-metadata-narrowing: narrowing is monotone, so a looser comparison changes nothing', () => {
  // Intersection is monotone, so `if (v < 1000)` over a value already bounded
  // by `0..<100` neither widens it nor loses it. This is the property the
  // intersection design exists to guarantee.
  const g = 'function g(w: float64.<{ bounds: 0..<100 }>) { return 1; }';
  expect(evaluated(`${NARROWS} ${g}
    function f(v: float64.<{ bounds: 0..<100 }>) { if (v < 1000) { return g(v); } return 0; } "ok";`)).toBe('ok');
});

test('sec-metadata-narrowing: a meta type defining no `narrow` keeps the constraint it had', () => {
  // "a meta type that defines no `narrow` learns nothing from a comparison and
  //  keeps the constraint it had, which costs a check at the next boundary and
  //  nothing else". Participation is by hook DEFINITION, not by portion.
  const quiet = `type NBq = { bounds?: RangeBounds };
    meta NBq { default = {};
      subtype(sub, sup) { return sup.bounds === undefined || (sub.bounds !== undefined && sup.bounds.contains(sub.bounds)); }
      validate(v, c) { return true; } }`;
  const g = 'function g(w: float64.<{ bounds: 0.. }>) { return 1; }';
  expectThrown(`${quiet} ${g}
    function f(v: float64.<{ bounds: ..<100 }>) { if (v >= 0) { return g(v); } return 0; } "ok";`);
});

test('sec-metadata-narrowing: a `narrow` hook that throws leaves the binding un-narrowed', () => {
  // Q3. `subtype` answers a JUDGMENT, so one that cannot be made must refuse;
  // `narrow` produces KNOWLEDGE, and the clause already sanctions learning
  // nothing. Not hypothetical: this pass runs BEFORE evaluation, so a hook
  // touching anything the script initializes throws a TDZ ReferenceError.
  const boom = `type NBb = { bounds?: RangeBounds };
    meta NBb { default = {};
      subtype(sub, sup) { return sup.bounds === undefined || (sub.bounds !== undefined && sup.bounds.contains(sub.bounds)); }
      validate(v, c) { return true; }
      narrow(cur, op, val) { throw new Error("boom"); } }`;
  // The program is not failed by the throw; it is refused for the ordinary
  // reason, that an un-narrowed `..<100` is not assignable to `0..`.
  expectThrown(`${boom} function g(w: float64.<{ bounds: 0.. }>) { return 1; }
    function f(v: float64.<{ bounds: ..<100 }>) { if (v >= 0) { return g(v); } return 0; } "ok";`);
  // And a program that needs no narrowing still runs.
  expect(evaluated(`${boom}
    function f(v: float64.<{ bounds: ..<100 }>) { if (v >= 0) { return 1; } return 0; } "ok";`)).toBe('ok');
});

test('sec-metadata-narrowing: an assignment invalidates a narrowing', () => {
  // Recorded through `declareNarrowed`, so a metadata narrowing is invalidated
  // exactly as a type-level one is.
  const g = 'function g(w: float64.<{ bounds: 0.. }>) { return 1; }';
  expectThrown(`${NARROWS} ${g}
    function f(v: float64.<{ bounds: ..<100 }>) { if (v >= 0) { v = -1; return g(v); } return 0; } "ok";`);
});

test('sec-narrowing: an empty narrowed bound is NOT reported as dead code', () => {
  // Q4. The dead-branch rule is defined operationally - "These are the branches
  // for which NarrowTo or NarrowFrom returns ~empty~" - over the two TYPE-level
  // operations. Metadata narrowing goes through NarrowMetadata, which is
  // neither, so an empty bound is outside the rule as written and not reporting
  // it is CONFORMING.
  //
  // Extending the rule would need a way to ask a meta type whether a portion is
  // inhabited, and none of the protocol's hooks answers that: `validate` is the
  // closest and needs a VALUE, which is what a dead branch has none of. If that
  // hook is ever proposed, this row is what has to change.
  expect(evaluated(`${NARROWS}
    function f(v: float64.<{ bounds: 0..<10 }>) { if (v >= 100) { return 1; } return 0; } "ok";`)).toBe('ok');
});

test('sec-metadata-narrowing: a program that narrows nothing is untouched', () => {
  // The second walk runs only where a comparison was recorded, so a program
  // with no parameterized comparison keeps reporting at parse time and pays
  // none of it. The cost control, asserted rather than assumed.
  expect(evaluated('function f(z: float64) { if (z >= 0) { return 1; } return 0; } "ok";')).toBe('ok');
  expectThrown('const x: uint8 = 300; "ok";');
});

test('ranges.md: DIVERGENCE - the range index operator awaits the view substrate', () => {
  // "`array[a..<b]` and `array.window(a, b)` are the same operation, and the
  //  range form should be the one people write" - and it produces a VIEW, which
  //  is the whole of why it is an operator rather than a method.
  //
  // DIVERGENCE: neither `window` nor any view type exists, so the
  // operator cannot. What it must NOT do meanwhile is what it did: a range
  // coerced to a property key is a string no object has, so `a[1..<3]` answered
  // *undefined* - a quiet non-answer to a question the language will answer.
  // It refuses now, which says the same thing without the silence.
  expectThrown('let a: [].<uint8> = [1,2,3,4,5]; a[1..<3];');
  expectThrown('const a = [1,2,3]; a[0..<2];');
  // Ordinary keys are untouched, which is what keeps the refusal narrow.
  expect(evaluated('const a=[1,2,3]; String(a[1]);')).toBe('2');
  expect(evaluated('const o={x:7}; String(o["x"]);')).toBe('7');
  expect(evaluated('const s=Symbol("k"); const o={}; o[s]=1; String(o[s]);')).toBe('1');
});

test('sec-range-literals: an endpoint is any expression, not only a literal', () => {
  // The operands are ShortCircuitExpressions, so a call, a member access, a
  // conditional, and a parenthesized sum are all endpoints. And a range binds
  // LOOSER than the additive operators, so the parentheses in `(1+2)..<10` are
  // optional - which is the row that would break first if that precedence moved.
  expect(evaluated('const r = (1+2)..<10; String(r.start) + "/" + String(r.end);')).toBe('3/10');
  expect(evaluated('const r = 1+2..<10; String(r.start) + "/" + String(r.end);')).toBe('3/10');
  expect(evaluated('function f(x){ return x*2; } const r = f(3)..=1; String(r.start) + "/" + String(r.end);')).toBe('6/1');
  expect(evaluated('const a = [1,2,3]; String((0..<a.length).end);')).toBe('3');
  // In TYPE position an endpoint is a compile-time constant, so the same
  // expression is a Syntax Error - a range is an expression in value position
  // and a constant in type position.
  expectError('type T = float64.<{ bounds: (1+2)..<10 }>; "ok";');
});

test('sec-ranges: an endpoint is a value of an ORDERED type', () => {
  // A typed number is ordered with Number by #sec-matchrange's rule - the same
  // rule `contains` uses - so it is an endpoint too. Refusing it while
  // `contains` admitted it was a contradiction reached by `0..<a.length` over a
  // typed array, which is the first place a reader meets it.
  expect(evaluated('const x = (3 := uint8), y = (9 := uint8); const r = x..<y; String(r.start) + "/" + String(r.end);')).toBe('3/9');
  expect(evaluated('let a: [].<uint8> = [1,2,3]; const r = 0..<a.length; String(r.end) + "/" + String(r.contains(2));')).toBe('3/true');
  // NaN is refused. It is the value for which the ordering is UNDEFINED, so a
  // range holding one reported itself non-empty while containing nothing - a
  // value claiming inhabitants it cannot produce. Refused where an endpoint
  // ENTERS, so no ordering operation downstream has to test for it.
  expectThrown('NaN..<9;');
  expectThrown('0..<NaN;');
  expectThrown('function f(){ return 0/0; } f()..<9;');
  // An infinite endpoint is admitted; see the row below for how it differs from
  // an absent one.
  expect(evaluated('String((0..<Infinity).contains(1e9));')).toBe('true');
  // Everything that was refused stays refused: no coercion, no mixed kinds.
  expectThrown('"3"..<9;');
  expectThrown('true..<9;');
  expectThrown('3n..<9;');
  expectThrown('const o = { valueOf() { return 3; } }; o..<9;');
});

test('sec-ranges: an infinite endpoint is not the same as an absent one', () => {
  // "An endpoint may be INFINITE, and an infinite endpoint is not the same as an
  //  absent one: `0..<Infinity` has an end and `0..` has none, so they report
  //  different `endBound` and `interval` and only the latter is `isFull` when
  //  both sides are absent."
  expect(evaluated('const r = 0..<Infinity; String(r.end) + "/" + String(r.endBound === Range.Bound.Open) + "/" + String(r.interval === Range.Interval.ClosedOpen);'))
    .toBe('Infinity/true/true');
  expect(evaluated('const r = 0..; String(r.end) + "/" + String(r.endBound) + "/" + String(r.interval);'))
    .toBe('undefined/undefined/undefined');
  expect(evaluated('String((..).isFull) + "/" + String((-Infinity..<Infinity).isFull);')).toBe('true/false');

  // "They contain the same values and iterate the same, an infinite end
  //  stopping the iteration nowhere exactly as an absent end does." Without
  //  this, containment agreed while iteration disagreed - `0..` counted forever
  //  and `0..<Infinity` refused - which is the incoherence the rule removes.
  expect(evaluated('String((0..<Infinity).contains(1e9)) + "/" + String((0..).contains(1e9));')).toBe('true/true');
  expect(evaluated('Iterator.from(0..<Infinity).take(4).toArray().join(",");')).toBe('0,1,2,3');
  expect(evaluated('const a = Iterator.from(0..<Infinity).take(4).toArray().join(","); const b = Iterator.from(0..).take(4).toArray().join(","); String(a === b);')).toBe('true');
  // The bounds still apply: an open start begins one step in either way.
  expect(evaluated('Iterator.from(0<..<Infinity).take(3).toArray().join(",");')).toBe('1,2,3');
  expect(evaluated('Iterator.from((0..<Infinity).step(2)).take(3).toArray().join(",");')).toBe('0,2,4');
  // A non-integer endpoint still has no implicit step; Infinity is not one.
  expectThrown('[...(0.5..<2.5)];');
});

test('ranges.md: a range carries the iterator helpers, delegating to a fresh iterator', () => {
  // The nine that LEAVE the family, each forwarding to the built-in method on a
  // freshly constructed iterator.
  expect(evaluated('(0..<5).map(v => v * 2).toArray().join(",");')).toBe('0,2,4,6,8');
  expect(evaluated('(0..<10).filter(v => v % 2 === 0).toArray().join(",");')).toBe('0,2,4,6,8');
  expect(evaluated('(0..<3).flatMap(v => [v, v]).toArray().join(",");')).toBe('0,0,1,1,2,2');
  expect(evaluated('String((1..=4).reduce((a, b) => a + b, 0));')).toBe('10');
  expect(evaluated('(0..<4).toArray().join(",");')).toBe('0,1,2,3');
  expect(evaluated('let s = 0; (1..=4).forEach(v => { s += v; }); String(s);')).toBe('10');
  expect(evaluated('String((0..<5).some(v => v === 3)) + "/" + String((0..<5).some(v => v === 9));')).toBe('true/false');
  expect(evaluated('String((0..<5).every(v => v < 5)) + "/" + String((0..<5).every(v => v < 3));')).toBe('true/false');
  expect(evaluated('String((0..<9).find(v => v > 4));')).toBe('5');
});

test('ranges.md: delegating keeps a range a VALUE, which is the whole design', () => {
  // A fresh iterator per call, so a range is traversable twice where an iterator
  // is not - and still answers `contains` afterwards. Making a range BE an
  // iterator would make `[...r]` consume it.
  expect(evaluated('const r = 0..<3; r.map(v => v).toArray().join("") + "/" + r.map(v => v).toArray().join("");')).toBe('012/012');
  expect(evaluated('const r = 0..<3; r.toArray(); String(r.contains(1)) + "/" + String(r.end);')).toBe('true/3');
  expect(evaluated('const r = 0..<3; String(typeof r.next) + "/" + [...r].join("") + "/" + [...r].join("");')).toBe('undefined/012/012');
  // And the chain is lazy: `take(3)` over a thousand-element range pulls three.
  expect(evaluated('let n = 0; const r = 0..<1000; String(r.map(v => { n += 1; return v; }).take(3).toArray().length) + "/" + String(n);')).toBe('3/3');
});

test('ranges.md: `take` and `drop` stay in the family, because they are CLOSED', () => {
  // The first n values of a contiguous range are a contiguous range, and so are
  // the rest - the same test `intersect` passes and `step` fails. So these two
  // return a `Range` where `map` returns an `Iterator`: closure, not uniformity.
  expect(evaluated('const t = (0..<10).take(3); String(t is Range) + "/" + String(t.start) + "/" + String(t.end);')).toBe('true/0/3');
  expect(evaluated('const d = (0..<10).drop(7); String(d is Range) + "/" + String(d.start) + "/" + String(d.end);')).toBe('true/7/10');
  // An open start shifts which values are taken, as it shifts the first index.
  // The result normalizes to CLOSED-OPEN: `1..<4`, not `0<..=3`, both being {1,2,3}.
  expect(evaluated('const t = (0<..<10).take(3); String(t.start) + "/" + String(t.end) + "/" + t.toArray().join("");')).toBe('1/4/123');
  // Unbounded, over-take, over-drop, and zero.
  expect(evaluated('const t = (0..).take(3); String(t.start) + "/" + String(t.end);')).toBe('0/3');
  expect(evaluated('const d = (0..).drop(3); String(d.start) + "/" + String(d.end);')).toBe('3/undefined');
  expect(evaluated('const t = (0..<3).take(10); t.toArray().join("");')).toBe('012');
  expect(evaluated('String((0..<3).drop(10).isEmpty);')).toBe('true');
  expect(evaluated('String((0..<5).take(0).isEmpty);')).toBe('true');
  // Closure is the point: the result is still a range, so it still intersects.
  expect(evaluated('const r = (0..<10).take(5).intersect(3..<8); String(r.start) + "/" + String(r.end);')).toBe('3/5');
  expect(evaluated('String((0..<10).take(3).contains(1)) + "/" + String((0..<10).take(3).contains(5));')).toBe('true/false');
  // The element type's arithmetic, so a bigint range takes in bigint.
  expect(evaluated('const t = (0n..<10n).take(3); t.toArray().join("");')).toBe('012');
  // Where there is no implicit step, or no first value to count from, they
  // refuse with the message iteration gives.
  expectThrown('(0.5..<2.5).take(2);');
  expectThrown('(..<5).take(2);');
});

test('ranges.md: a helper that must consume every value refuses a range with no end', () => {
  // `toArray`, `reduce`, and `forEach` each read the WHOLE sequence, so on `0..`
  // they would not return. Refusing says so, in the way `sec-ranges` already
  // makes a range with no START not iterable - the mirror rule.
  expectThrown('(0..).toArray();');
  expectThrown('(0..).reduce((a, b) => a + b, 0);');
  expectThrown('(0..).forEach(v => {});');
  // An infinite end is an absent one here too, as it is for iteration.
  expectThrown('(0..<Infinity).toArray();');

  // `some`, `every`, and `find` are exempt, and the reason is SHORT-CIRCUITING
  // rather than which verdict they return: `every` stops at the first value that
  // fails exactly as `some` stops at the first that passes. Grouping `every`
  // with `toArray` would refuse a call that answers immediately.
  expect(evaluated('String((0..).every(v => v < 5));')).toBe('false');
  expect(evaluated('String((0..).some(v => v === 5));')).toBe('true');
  expect(evaluated('String((0..).find(v => v > 5));')).toBe('6');

  // The lazy helpers are untouched - nothing is consumed until something asks.
  expect(evaluated('(0..).map(v => v * 2).take(3).toArray().join(",");')).toBe('0,2,4');
  expect(evaluated('(0..).filter(v => v % 2 === 0).take(3).toArray().join(",");')).toBe('0,2,4');
  // And `take` is how an endless range becomes consumable.
  expect(evaluated('(0..).take(4).toArray().join(",");')).toBe('0,1,2,3');
  // A bounded range is unaffected.
  expect(evaluated('(0..<4).toArray().join(",") + "/" + String((1..=4).reduce((a, b) => a + b, 0));')).toBe('0,1,2,3/10');
});

test('ranges.md: a range helper answers exactly as the iterator it delegates to', () => {
  // The claim delegation actually makes. Testing that `filter` filters would
  // pass for a reimplementation; testing that it agrees with
  // `Iterator.from(r).filter` is what pins it to the built-in.
  const same = (helper) => `const r = 0..<6; String(r.${helper} === Iterator.from(r).${helper});`;
  expect(evaluated(same('filter(v => v % 2 === 0).toArray().join(",")'))).toBe('true');
  expect(evaluated(same('map(v => v * 3).toArray().join(",")'))).toBe('true');
  expect(evaluated(same('flatMap(v => [v]).toArray().join(",")'))).toBe('true');
  expect(evaluated(same('reduce((a, b) => a + b, 0)'))).toBe('true');
  expect(evaluated(same('toArray().join(",")'))).toBe('true');
  expect(evaluated(same('some(v => v === 3)'))).toBe('true');
  expect(evaluated(same('every(v => v < 6)'))).toBe('true');
  expect(evaluated(same('find(v => v > 3)'))).toBe('true');
  // `reduce` carries both overloads, so the no-initial form comes along.
  expect(evaluated('String((1..=4).reduce((a, b) => a + b));')).toBe('10');
  // The callback's second argument is the ITERATION index, not the value - the
  // one iterable where a reader might expect them to coincide.
  expect(evaluated('(10..<13).map((v, i) => v + ":" + i).toArray().join(",");')).toBe('10:0,11:1,12:2');
  // A helper is a range method, so it refuses a receiver that is not one.
  expectThrown('Range.prototype.map.call(5, v => v);');
});

test('ranges.md: helper chains compose, and keep the element type', () => {
  // `map` changes the element type and the chain carries it with no annotation
  // at any step - the type comes from the range literal (R2b) and flows.
  expect(evaluated('const a = (0..<3).map(v => String(v)).toArray(); String(a.length) + "/" + a.join("");')).toBe('3/012');
  // Leaving the family and staying in it compose in either order.
  expect(evaluated('(0..<10).filter(v => v % 2 === 0).map(v => v * 10).take(2).toArray().join(",");')).toBe('0,20');
  expect(evaluated('(0..<10).take(5).drop(2).toArray().join(",");')).toBe('2,3,4');
  expect(evaluated('(0..<10).drop(2).take(3).toArray().join(",");')).toBe('2,3,4');
  // An open start and a bigint element type both flow through unchanged.
  expect(evaluated('(0<..<5).map(v => v * 2).toArray().join(",");')).toBe('2,4,6,8');
  expect(evaluated('(0n..<5n).filter(v => v % 2n === 0n).toArray().join(",");')).toBe('0,2,4');
  // `find` answers undefined where nothing matches, as it does on an iterator.
  expect(evaluated('String((0..<3).find(v => v > 9));')).toBe('undefined');
});

// =============================================================================
// sec-matchrange
// =============================================================================

test('sec-matchrange: a range pattern matches by containment', () => {
  expect(evaluated('String(5 is 1..<10);')).toBe('true');
  expect(evaluated('String(50 is 1..<10);')).toBe('false');
  expect(evaluated('String(10 is 1..<10) + "," + String(10 is 1..=10);')).toBe('false,true');
});

test('sec-matchrange: a range `case` label matches by containment', () => {
  // ranges.md's own example, which fell through to `default` before.
  const f = 'const f = (c) => { switch (c) { case 200..<300: return "Ok"; case 400..<500: return "ClientError"; case 500..<600: return "ServerError"; default: return "Unknown"; } };';
  expect(evaluated(`${f} f(204) + "," + f(404) + "," + f(503) + "," + f(302);`))
    .toBe('Ok,ClientError,ServerError,Unknown');
  // Each endpoint's own bound decides.
  expect(evaluated('const g=(x)=>{switch(x){case 0..<5: return "in";} return "out";}; g(0)+","+g(4)+","+g(5);'))
    .toBe('in,in,out');
  // A label agrees with the same range used as an `is` pattern.
  expect(evaluated('let ok=true; for (let i=-2;i<8;i++){ const s=(()=>{switch(i){case 0..<5: return true;} return false;})(); if (s !== (i is 0..<5)) ok=false; } String(ok);'))
    .toBe('true');
  // Ordinary labels are unaffected.
  expect(evaluated('const h=(x)=>{switch(x){case 1: return "one"; case "a": return "A";} return "other";}; h(1)+","+h("a")+","+h(2);'))
    .toBe('one,A,other');
});

// =============================================================================
// table-metadata-values - the Range row
// =============================================================================

const NB = `
type NumberBounds = { bounds?: Range };
meta NumberBounds {
  default = {};
  subtype(sub, sup) { return sup.bounds === undefined || (sub.bounds !== undefined && sup.bounds.contains(sub.bounds)); }
  validate(v, c) { return c.bounds === undefined || c.bounds.contains(Number(v)); }
}
`;

test('table-metadata-values: a range of any of the four shapes is a metadata value', () => {
  // The meta type must be DECLARED: "a metadata object whose own key no meta
  // type claims is a type error at the parameterization that writes it". This
  // row asserted the nine shapes without one and passed only because the
  // checker could not resolve a range-bearing annotation and so never
  // adjudicated the key - the hole A0 closed.
  for (const b of ['0..<10', '1..=6', '0<..<10', '0<..=10', '0..', '0<..', '..<10', '..=10', '..']) {
    expect(evaluated(`${NB} type T = float64.<{ bounds: ${b} }>; "ok";`)).toBe('ok');
  }
  // And without one, the unclaimed key is the error the clause requires.
  expectThrown('type T = float64.<{ bounds: 0..<10 }>; "ok";');
});

test('table-metadata-values: equivalence is shape, bound at each endpoint, and SameValue endpoints', () => {
  // The same spelling is the same type.
  expect(evaluated(`${NB} type A = float64.<{ bounds: 1..=6 }>; type B = float64.<{ bounds: 1..=6 }>; const a = (3 := A); String(Number(a := B));`)).toBe('3');
  // A differing bound is a differing type.
  expectThrown(`${NB} type A = float64.<{ bounds: 1..=6 }>; type B = float64.<{ bounds: 1..<6 }>; const a = (6 := A); (a := B);`);
});

test('table-metadata-values: a hook receives a Range, while the carried form stays structural', () => {
  const probe = NB.replace('return c.bounds === undefined || c.bounds.contains(Number(v));',
    'return String(c.bounds.start) === "0" && c.bounds.contains(3);');
  expect(evaluated(`${probe} type A = float64.<{ bounds: 0..<10 }>; (3 := A); "ok";`)).toBe('ok');
});

test('table-metadata-values: an empty range constrains its parameterization to no value at all', () => {
  expectThrown(`${NB} type E = float64.<{ bounds: 5..<5 }>; (5 := E);`);
  expectThrown(`${NB} type E = float64.<{ bounds: 5..<5 }>; (0 := E);`);
});

test('table-metadata-values: a range prints as written rather than as its carrier', () => {
  const message = (source: string) => {
    const c = run(source) as { Value?: { HostDefinedMessageString?: string } };
    return c.Value?.HostDefinedMessageString ?? '';
  };
  expect(message(`${NB} type D = float64.<{ bounds: 1..=6 }>; (99 := D);`)).toContain('float64.<{ bounds: 1..=6 }>');
});

test('table-metadata-values: each endpoint a shape has is a compile-time constant', () => {
  // A non-constant endpoint is not a metadata value, and the type grammar
  // admits only a literal there, so this is rejected at the parse.
  expectError('const n = 5; type T = float64.<{ bounds: 0..<n }>; "ok";');
});

test('table-metadata-values: the value language is closed', () => {
  // "Nothing else is a metadata value. A function, an object other than the
  //  forms above, and *undefined* are not." And of ranges: a range "is admitted
  //  as a VALUE and not as an implementation of `RangeBounds.<T>` ... A class of
  //  a program's own that implements the interface has no structural
  //  comparison, could not be written into an expansion artifact, and would
  //  give interning no answer."
  const meta = `type NBc = { bounds?: RangeBounds };
    meta NBc { default = {}; subtype(a,b){return true;} validate(v,c){return true;} }`;
  expectThrown(`${meta} class MyR { contains(v){return true;} } type T = float64.<{ bounds: MyR }>; "ok";`);
  expectThrown(`${meta} type T = float64.<{ bounds: Date }>; "ok";`);
  expectThrown(`${meta} type T = float64.<{ bounds: () => void }>; "ok";`);
  // Every ADMITTED form still is one.
  expect(evaluated(`${meta} type T = float64.<{ bounds: 0..<10 }>; "ok";`)).toBe('ok');
  expect(evaluated('type N = { n?: number }; meta N { default={}; subtype(a,b){return true;} } type T = float64.<{ n: 5 }>; "ok";')).toBe('ok');
  expect(evaluated('type S = { s?: string }; meta S { default={}; subtype(a,b){return true;} } type T = float64.<{ s: "x" }>; "ok";')).toBe('ok');
  expect(evaluated('type B = { b?: boolean }; meta B { default={}; subtype(a,b){return true;} } type T = float64.<{ b: true }>; "ok";')).toBe('ok');
  expect(evaluated('type P = { p?: RegExp }; meta P { default={}; subtype(a,b){return true;} } type T = string.<{ p: /abc/ }>; "ok";')).toBe('ok');
});

test('table-metadata-values: the closure reaches a metadata record, not a type argument', () => {
  // A parameterization's object-typed argument is two things in one shape: a
  // metadata RECORD written inline, whose properties must be metadata values,
  // and a TYPE ARGUMENT to a generic, whose properties are ordinary types. The
  // parser tells them apart - an inline record is an `ObjectType` and a name a
  // `TypeReference` - and closing over both refused `Composite.<K>`, which is
  // not metadata at all.
  expect(evaluated('type K = { x: uint8 }; let c: Composite.<K>; "ok";')).toBe('ok');
  expect(evaluated('let c: Composite = Composite({ x: 1 }); "ok";')).toBe('ok');
});

test('sec-meta-declarations: a meta default may hold a range, and a pattern', () => {
  // "a meta type whose key means an unconstrained bound says so in its
  //  `default`", which is what makes a parameterization that omits the key and
  //  one that writes the full range under it one portion.
  //
  // The snapshot a default is judged against walks own enumerable keys, and a
  // range's endpoints are internal slots behind prototype accessors - so a
  // default holding one snapshotted as an EMPTY record and the declaration was
  // rejected. Carried structurally now, in the same markers the metadata value
  // language uses, which is the same fix the pattern case needs, for the
  // identical reason.
  expect(evaluated('type X = { bounds: RangeBounds }; meta X { default = { bounds: .. }; subtype(a,b){return true;} } "ok";')).toBe('ok');
  expect(evaluated('type X = { p: RegExp }; meta X { default = { p: /x/ }; subtype(a,b){return true;} } "ok";')).toBe('ok');
  // primitivemetadata.md's own total default, the one adopted so that no hook
  // tests for absence.
  expect(evaluated('type NB = { bounds?: RangeBounds, nonZero?: boolean }; meta NB { default = { bounds: .., nonZero: false }; subtype(a,b){return true;} validate(v,c){return true;} } "ok";')).toBe('ok');
  // And a hook receives the default's range as a range.
  expect(evaluated('type NB = { bounds?: RangeBounds }; meta NB { default = { bounds: .. }; subtype(a,b){return true;} validate(v,c){ return c.bounds.isFull; } } type A = float64.<{ }>; "ok";')).toBe('ok');
});

test('sec-metadata-narrowing: both hooks the protocol defines are now invoked', () => {
  // Both `narrow` and `rescale` have to be called, and each is asserted by its
  // own rows: the narrowing rows above, and the conversion row below.
  //
  // `rescale` translates a constraint across a unit conversion -
  // sec-metadata-conversion: "`rescale` on the portions that flow, so a bound
  // stated in metres arrives stated in kilometres". Without it a sum of bounds
  // "would have added a metre-space number to a kilometre-space one and
  // produced a bound that means nothing".
  const dims = `type Dim2 = { m?: number, ratio?: number };
    meta Dim2 { default = { m: 0, ratio: 1 };
      subtype(a, b) { return a.m === b.m; }
      validate(v, c) { return true; }
      conversionFactor(from, to) { return (from.ratio ?? 1) / (to.ratio ?? 1); } }
    type NBr = { bounds?: RangeBounds };
    meta NBr { default = {};
      subtype(a, b) { return b.bounds === undefined || (a.bounds !== undefined && b.bounds.contains(a.bounds)); }
      validate(v, c) { return c.bounds === undefined || c.bounds.contains(Number(v)); }
      rescale(c, f) { return c.bounds === undefined ? c : { bounds: c.bounds.scale(f) }; } }`;
  // A bound stated in metres arrives stated in kilometres, and the value with it.
  expect(evaluated(`${dims}
    const d = (300 := float64.<{ m: 1, ratio: 1, bounds: 100..=500 }>);
    String((d := float64.<{ m: 1, ratio: 1000 }>) is float64.<{ m: 1, ratio: 1000, bounds: 0.1..=0.5 }>);`)).toBe('true');
  expect(evaluated(`${dims}
    const d = (300 := float64.<{ m: 1, ratio: 1, bounds: 100..=500 }>);
    String(Number(d := float64.<{ m: 1, ratio: 1000 }>));`)).toBe('0.3');
  // A meta type defining no `rescale` has declined to say what its constraint
  // means after a factor, so its portion is DROPPED rather than assumed
  // unchanged - carrying it would keep `100..=500` on a value that is now 0.3.
  const noHook = dims.replace('rescale(c, f) { return c.bounds === undefined ? c : { bounds: c.bounds.scale(f) }; }', '');
  expect(evaluated(`${noHook}
    const d = (300 := float64.<{ m: 1, ratio: 1, bounds: 100..=500 }>);
    String((d := float64.<{ m: 1, ratio: 1000 }>) is float64.<{ m: 1, ratio: 1000 }>);`)).toBe('true');
  // And a conversion that produces no factor changes nothing.
  expect(evaluated(`${dims}
    const d = (300 := float64.<{ m: 1, ratio: 1, bounds: 100..=500 }>);
    String(Number(d := float64.<{ m: 1, ratio: 1 }>));`)).toBe('300');
});
