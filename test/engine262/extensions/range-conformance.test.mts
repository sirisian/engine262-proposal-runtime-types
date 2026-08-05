import { test, expect } from 'vitest';
import {
  evaluated, evaluatedFlagOff, expectError, expectThrown, run,
} from '../readme/harness.mts';

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
  expect(message('let r: RangeFrom = 0..<10;')).toContain('0..<10');
  expect(message('let r: RangeTo = 0<..=10;')).toContain('0<..=10');
  // The alias is preferred over the raw parameterization; the element prints in
  // the engine's own spelling for a width, which is not this clause's business.
  expect(message('let r: ClosedRange.<uint8> = 0..<10;')).toContain('ClosedRange.<uint');
});

test('sec-ranges: DIVERGENCE - a range literal has no static type, so the rejection is at run time', () => {
  // `staticType` has no case for a range literal. Adding one is not merely
  // missing work: an endpoint literal's base is `number`, so a naive static type
  // makes `let r: ClosedOpenRange.<uint8> = 0..<10` fail as
  // "ClosedOpenRange.<number> is not assignable to ClosedOpenRange.<uint8>" -
  // a FALSE rejection. The element must follow literal propagation into the
  // annotation's element type first, which is the rule this needs and does not
  // yet have.
  //
  // DIVERGENCE (plan item F1, the inference half of R2b). Every rejection above
  // is correct; it just happens when the declaration runs.
  expect(evaluated('if (false) { let r: Range.<uint8, Range.Bound.Open, Range.Bound.Open> = 0..<10; } "ran";')).toBe('ran');
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
  // DIVERGENCE (D6): `scale` is unconditional. Vacuous today, because every
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

test('sec-ranges: DIVERGENCE - the element type is Number only, not any ordered type', () => {
  // "A range is a value type class over an ORDERED element type."
  //
  // DIVERGENCE (F2): endpoints must be Numbers. bigint is rejected, and with it
  // `Temporal.Instant` and dimensioned quantities, which is what makes the D6
  // `scale` divergence vacuous for now.
  expectThrown('const r = 0n..<10n; r;');
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
  // DIVERGENCE (F5): not implemented. Blocked on `Bound` (D4).
  expect(evaluated('String(typeof Range.of);')).toBe('undefined');
});

// =============================================================================
// random.md - the range form of Math.random
// =============================================================================

test('random.md: a range bound is consumed rather than ignored', () => {
  // Before R1 the single argument fell through to the ordinary `Math.random()`,
  // which takes none: a written bound was DROPPED and the call answered with a
  // draw from [0, 1). Silently wrong is worse than unimplemented, which is why
  // this row exists even though the form is the feature and not the defect.
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
  for (const b of ['0..<10', '1..=6', '0<..<10', '0<..=10', '0..', '0<..', '..<10', '..=10', '..']) {
    expect(evaluated(`type T = float64.<{ bounds: ${b} }>; "ok";`)).toBe('ok');
  }
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

test('table-metadata-values: DIVERGENCE - the value language is not closed', () => {
  // "Nothing else is a metadata value. A function, an object other than the
  //  forms above, and *undefined* are not." And of ranges specifically: "A range
  //  is admitted as a VALUE and not as an implementation of `RangeBounds.<T>` ...
  //  A class of a program's own that implements the interface has no structural
  //  comparison, could not be written into an expansion artifact, and would give
  //  interning no answer."
  //
  // DIVERGENCE (plan item D7): a claimed key accepts ANY type in its value
  // position - a user class implementing the interface, a built-in like `Date`,
  // and even a function type - so the closure the clause states is not
  // enforced. Found through the Range row but not range-specific: the three
  // reasons the clause gives (structural comparison, artifact, interning) apply
  // to every admitted form.
  const meta = `type NB = { bounds?: Range };
    meta NB { default = {}; subtype(a,b){return true;} validate(v,c){return true;} }`;
  expect(evaluated(`${meta} class MyR { contains(v){return true;} } type T = float64.<{ bounds: MyR }>; "ok";`)).toBe('ok');
  expect(evaluated(`${meta} type T = float64.<{ bounds: Date }>; "ok";`)).toBe('ok');
  expect(evaluated(`${meta} type T = float64.<{ bounds: () => void }>; "ok";`)).toBe('ok');
});

test('sec-meta-declarations: DIVERGENCE - a meta default cannot hold a range', () => {
  // "a meta type whose key means an unconstrained bound says so in its
  //  `default`", which is what makes an omitted key and a written full range one
  //  portion. primitivemetadata.md writes `default = { bounds: .., nonZero: false }`.
  //
  // DIVERGENCE (Q6): the default is judged by ordinary membership against the
  // constraint shape, and that judgement admits neither a Range against a
  // `Range` field nor a RegExp against a `RegExp` one. So the total default the
  // design adopted -- to delete every absence check from the hooks -- cannot be
  // written, and the optional-key form above is what the engine can host. A
  // general meta-type limit rather than a range-specific one.
  expectThrown('type X = { bounds: Range }; meta X { default = { bounds: .. }; subtype(a,b){return true;} } "ok";');
  expectThrown('type X = { p: RegExp }; meta X { default = { p: /x/ }; subtype(a,b){return true;} } "ok";');
  // The optional-key shape is what works.
  expect(evaluated('type X = { bounds?: Range }; meta X { default = {}; subtype(a,b){return true;} } "ok";')).toBe('ok');
});

test('sec-metadata-narrowing: DIVERGENCE - no comparison narrows through a metadata hook', () => {
  // The narrowing clause has a comparison give a value a bounded type inside a
  // branch, which primitivemetadata.md's `narrow` implements as an intersection.
  //
  // DIVERGENCE (F4): the engine invokes `subtype`, `validate`,
  // `conversionFactor`, `quantize`, and `describe`, and neither `narrow` nor
  // `rescale`. A `narrow` hook is therefore never called, which is asserted here
  // by its absence having no observable effect.
  expect(evaluated(`
    type NB2 = { bounds?: Range };
    let called = false;
    meta NB2 {
      default = {};
      subtype(a, b) { return true; }
      validate(v, c) { return true; }
      narrow(cur, op, val) { called = true; return cur; }
    }
    let x := float64 = 5;
    if (x >= 0) { x; }
    String(called);`)).toBe('false');
});
