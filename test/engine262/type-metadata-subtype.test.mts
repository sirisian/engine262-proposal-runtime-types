import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

// The checking pass (#sec-type-errors, src/type-system/check-pass.mts): per
// source text, after parse, before that source's evaluation. The synchronous
// parse-time checker defers a pair of same-base parameterizations with
// different metadata; the pass judges the deferred pairs with the metadata
// subtype judgment, whose `subtype` hooks are user code and therefore callable
// only from this phase. A refused pair rejects the source before its first
// statement runs.

function makeRealm() {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  return new ManagedRealm();
}

function run(source: string) {
  return makeRealm().evaluateScriptSkipDebugger(source);
}

function expectThrown(source: string) {
  expect(run(source)).toMatchObject({ Type: 'throw' });
}

function evaluated(source: string): string {
  const completion = run(source);
  expect(completion).toMatchObject({ Type: 'normal' });
  return (completion as unknown as { Value: { stringValue(): string } }).Value.stringValue();
}

// The flagship of primitivemetadata.md, in the claim form: a meta type over a
// declared shape claims its keys, and the claims are how it governs a
// parameterization it never names. `subtype` compares the exponents and
// ignores the ratio, which is exactly what lets Kilometer reach Meter while
// refusing Velocity.
const dimensions = `
  type Dim = { m: number, s: number, ratio: number };
  meta Dim {
    default = { m: 0, s: 0, ratio: 1 };
    subtype(a, b) { return a.m === b.m && a.s === b.s; }
    validate(v, c) { return true; }
    conversionFactor(a, b) { return a.ratio / b.ratio; }
  }
  type Meter = float32.<{ m: 1, ratio: 1 }>;
  type Kilometer = float32.<{ m: 1, ratio: 1000 }>;
  type Velocity = float32.<{ m: 1, s: -1, ratio: 1 }>;
`;

test('metadata subtype judgment: equal exponents admit a crossing between ratios', () => {
  // The deferred pair sits in a function that is never called, so what is
  // being observed is the pass's judgment alone, not any runtime boundary.
  expect(evaluated(`${dimensions}
    function neverCalled() { let km: Kilometer = (0 := Kilometer); let m: Meter = km; }
    "ok";
  `)).toBe('ok');
  // The same crossing stated between a parameter and a return annotation, at
  // the top level, is deferred from the return site and admitted by the pass.
  expect(evaluated(`${dimensions}
    function convert(km: Kilometer): Meter { return km; }
    "ok";
  `)).toBe('ok');
  // And the RUN crossing this test once pinned as impossible (the note here
  // used to blame ConvertParameterization's first guard, which was the wrong
  // mechanism: the construction path existed and mis-carried its record; F38
  // has the correction). The pass admits the pair, the construction admits the
  // value, and the ratio's factor scales it: two kilometres are two thousand
  // metres, at run time, through the annotation.
  expect(evaluated(`${dimensions}
    let m: Meter = (2 := Kilometer);
    String(m);
  `)).toBe('2000');
});

test('metadata subtype judgment: differing exponents refuse, before the body runs', () => {
  // `var probe` is instantiated to undefined by declaration instantiation; the
  // body would set it to 1. The pass rejects the script first, so a second
  // script in the same realm still sees undefined: the rejection preceded the
  // first statement, which is the Early Error discipline the pass keeps.
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const first = realm.evaluateScriptSkipDebugger(`${dimensions}
    var probe = 0;
    probe = 1;
    function neverCalled() { let m: Meter = (0 := Meter); let v: Velocity = m; }
    "unreachable";
  `);
  expect(first).toMatchObject({ Type: 'throw' });
  const second = realm.evaluateScriptSkipDebugger('String(probe);');
  expect(second).toMatchObject({ Type: 'normal' });
  expect((second as unknown as { Value: { stringValue(): string } }).Value.stringValue()).toBe('undefined');
});

test('metadata subtype judgment: a deferred pair inside an uncalled function still rejects the source', () => {
  expectThrown(`${dimensions}
    function neverCalled() { let m: Meter = (0 := Meter); let v: Velocity = m; }
    "unreachable";
  `);
});

test('a brand refuses a crossing between different tags and admits its own', () => {
  // The base form: hooks registered against the base type object, no claims,
  // consulted by the judgment with the whole metadata, mirroring IsOfType's
  // base fallback.
  const brand = `
    meta uint32 { default = {}; subtype(a, b) { return a.tag === b.tag; } }
    type UserId = uint32.<{ tag: "user" }>;
    type OrderId = uint32.<{ tag: "order" }>;
    type AlsoUserId = uint32.<{ tag: "user" }>;
  `;
  expectThrown(`${brand}
    function neverCalled() { let u: UserId = (1 := UserId); let o: OrderId = u; }
    "unreachable";
  `);
  // The same tag written twice is one type by metadata equivalence; nothing is
  // deferred and nothing is refused.
  expect(evaluated(`${brand}
    function neverCalled() { let u: UserId = (1 := UserId); let v: AlsoUserId = u; }
    "ok";
  `)).toBe('ok');
});

test('a where-shaped meta type: identical admits, differing refuses, unconstrained admits', () => {
  // The two-`where` relation's shape, stated as metadata: a supertype that
  // does not constrain the key admits anything, and one that does admits only
  // the identical constraint.
  const whereish = `
    meta float64 {
      default = {};
      subtype(sub, sup) { if (!("p" in sup)) return true; return ("p" in sub) && sub.p === sup.p; }
    }
    type P1 = float64.<{ p: 1 }>;
    type AlsoP1 = float64.<{ p: 1 }>;
    type P2 = float64.<{ p: 2 }>;
    type Q7 = float64.<{ q: 7 }>;
  `;
  expect(evaluated(`${whereish}
    function neverCalled() { let a: P1 = (0 := P1); let b: AlsoP1 = a; }
    "ok";
  `)).toBe('ok');
  expectThrown(`${whereish}
    function neverCalled() { let a: P1 = (0 := P1); let b: P2 = a; }
    "unreachable";
  `);
  expect(evaluated(`${whereish}
    function neverCalled() { let a: P1 = (0 := P1); let b: Q7 = a; }
    "ok";
  `)).toBe('ok');
});

test('a meta declaration from an earlier script governs a later script\'s judgment', () => {
  // Claims and hooks are held per agent, so a declaration evaluated by one
  // script's pass governs a deferred pair in the next script's pass: the
  // judgment quantifies over the meta types declared as of its application.
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const first = realm.evaluateScriptSkipDebugger(`
    type Dim = { m: number, s: number, ratio: number };
    meta Dim {
      default = { m: 0, s: 0, ratio: 1 };
      subtype(a, b) { return a.m === b.m && a.s === b.s; }
      validate(v, c) { return true; }
    }
    "declared";
  `);
  expect(first).toMatchObject({ Type: 'normal' });
  const second = realm.evaluateScriptSkipDebugger(`
    type M2 = float32.<{ m: 1, ratio: 1 }>;
    type V2 = float32.<{ m: 1, s: -1, ratio: 1 }>;
    function neverCalled() { let m: M2 = (0 := M2); let v: V2 = m; }
    "unreachable";
  `);
  expect(second).toMatchObject({ Type: 'throw' });
});

test('with no meta type declared, a deferred pair is vacuously admitted (rides F24)', () => {
  // The judgment quantifies over the declared meta types; with none declared
  // it holds vacuously, and the runtime admits the same pair today for the
  // same reason (empty governing set, no base hook). The spec closes this by
  // making an unclaimed metadata key a type error at the parameterization,
  // which is F24's not-yet-enforced item; when that lands, this program is
  // rejected earlier and for that reason, and this test should move with it.
  expect(evaluated(`
    type A = float32.<{ zork: 1 }>;
    type B = float32.<{ zork: 2 }>;
    function neverCalled() { let a: A = (0 := A); let b: B = a; }
    "ok";
  `)).toBe('ok');
});
