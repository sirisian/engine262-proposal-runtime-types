import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

// The metadata protocol's verification matrix (METADATA-PROTOCOL-PLAN.md,
// Phase 5): the probe ledger of cycles 36 through 39, committed. Each test
// names the phase it guards; the plan's audit findings (C1 through C9) are
// cited where a test exists BECAUSE of one. Failure triage order, from the
// plan: suspect the plan's reading of the spec first, the probe's framing
// second, the engine third — the order that paid F38, F39, and F40.

function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

function evaluated(source: string): string {
  const completion = run(source);
  expect(completion).toMatchObject({ Type: 'normal' });
  return (completion as unknown as { Value: { stringValue(): string } }).Value.stringValue();
}

function expectThrown(source: string) {
  expect(run(source)).toMatchObject({ Type: 'throw' });
}

function thrownMessage(source: string): string {
  const completion = run(source);
  expect(completion).toMatchObject({ Type: 'throw' });
  return ((completion as { Value?: { HostDefinedMessageString?: string } }).Value?.HostDefinedMessageString) ?? '';
}

const bounds = `
  type B = { min: number, max: number };
  meta B {
    default = { min: 0, max: 100 };
    subtype(a, b) { return b.min <= a.min && a.max <= b.max; }
    validate(v, c) { return Number(v) >= c.min && Number(v) <= c.max; }
  }
`;

const brand = `
  type Tag = { tag: string };
  meta Tag { default = { tag: "" }; subtype(a, b) { return a.tag === b.tag; } }
`;

const dims = `
  type Dim = { m: number, s: number, ratio: number };
  meta Dim {
    default = { m: 0, s: 0, ratio: 1 };
    subtype(a, b) { return a.m === b.m && a.s === b.s; }
    validate(v, c) { return true; }
    conversionFactor(a, b) { return a.ratio / b.ratio; }
  }
  type Meter = float32.<{ m: 1, ratio: 1 }>;
  type Kilometer = float32.<{ m: 1, ratio: 1000 }>;
`;

// The quantize hook receives a TYPED value and plain metadata numbers, so the
// arithmetic between them must say which type it is in - the same rule that
// forbids uint8 + uint16 (F52). Casting the metadata is the shortest honest
// spelling, and it is worth seeing here: every hook that computes with both a
// value and its constraint pays this.
const qs = `
  type Qs = { step: number };
  meta Qs {
    default = { step: 0 };
    subtype(a, b) { return true; }
    validate(v, c) { return true; }
    quantize(v, c) { return c.step > 0 ? (Math.round(Number(v) / c.step) * c.step := float64) : v; }
  }
`;

// -- Phase 1: the default snapshot, and portion completion (C2) ---------------

test('P1a: validate sees the complete portion, so the DEFAULTED key enforces too', () => {
  // The money trio: before completion the third line failed for the wrong
  // reason (undefined comparison); now it fails for the right one.
  expect(evaluated(`${bounds} String(((50 := float64.<{ min: 10 }>)) is float64.<{ min: 10 }>);`)).toBe('true');
  expectThrown(`${bounds} (5 := float64.<{ min: 10 }>); "admitted";`);
  expectThrown(`${bounds} (150 := float64.<{ min: 10 }>); "admitted";`);
});

test('P1b: subtype sees complete portions on both sides of a deferred pair', () => {
  expect(evaluated(`
    type S = { lo: number, hi: number };
    meta S { default = { lo: 0, hi: 9 };
      subtype(a, b) { globalThis.k = Object.keys(a).sort().join("+") + "|" + Object.keys(b).sort().join("+"); return true; }
      validate(v, c) { return true; } }
    type P = float64.<{ lo: 5 }>; type Q = float64.<{ hi: 7 }>;
    function neverCalled(p: P) { let q: Q = p; }
    String(globalThis.k);
  `)).toBe('hi+lo|hi+lo');
});

test('P1c: a getter on the default runs once, at declaration, never per judgment', () => {
  // The increment carries NO initializer elsewhere: the checking pass
  // pre-evaluates meta declarations before the script body runs, so an
  // initializer at the top of the script would clobber the declaration-time
  // increment and read "0" — the engine being right and the first probe
  // being wrong (F42). Two constructions and a crossing later, still one.
  expect(evaluated(`
    type G = { g: number };
    meta G { default = { get g() { globalThis.n = (globalThis.n || 0) + 1; return 3; } };
      subtype(a, b) { return true; } validate(v, c) { return true; } }
    (1 := float64.<{ g: 5 }>);
    ((1 := float64.<{ g: 5 }>) := float64.<{ g: 4 }>);
    String(globalThis.n);
  `)).toBe('1');
});

test('P1e: the default of an object-shaped meta type must be an object OF the shape', () => {
  // The minimal half landed in Phase 1, the full membership rule in Phase 4
  // (the relocated edit 5): both are asserted, and a conforming default
  // declares beside them.
  expectThrown('type B2 = { x: number }; meta B2 { default = 0; subtype(a, b) { return true; } } "declared";');
  expectThrown('type B3 = { x: number }; meta B3 { default = { wrong: 1 }; subtype(a, b) { return true; } } "declared";');
  expect(evaluated('type B4 = { x: number }; meta B4 { default = { x: 1 }; subtype(a, b) { return true; } } "declared";')).toBe('declared');
});

test('P1f: the optional-key form survives the full shape rule', () => {
  // NumberBounds' own convention: an optional-keyed shape with `default = {}`
  // declares, and validate reads the unwritten key as undefined.
  expect(evaluated(`
    type Nb = { minimum?: number };
    meta Nb { default = {}; subtype(a, b) { return true; }
      validate(v, c) { return c.minimum === undefined || Number(v) >= c.minimum; } }
    String(((5 := float64.<{ minimum: 1 }>)) is float64.<{ minimum: 1 }>);
  `)).toBe('true');
});

// P1d, the units regression, is the existing suite itself:
// type-construction-boundary.test.mts and type-metadata-subtype.test.mts ran
// byte-identical through the completion change, which is the guard against the
// `undefined === undefined` accident F40 documented.

// -- Phase 2: participation and the sit-out (C1, C3, C4) ----------------------

test('P2a: a brand written at its own default admits, and off it refuses, in one program', () => {
  // Both halves in one test, per the plan's Phase 2 risk note: a regression
  // that drops the meta type from the judgment reads as a failure, not a pass.
  expect(evaluated(`${brand}
    const atDefault = (1 := float32.<{ tag: "" }>) is float32.<{ tag: "" }>;
    let offDefault = "refused"; try { (1 := float32.<{ tag: "A" }>); offDefault = "admitted"; } catch (e) { }
    String(atDefault) + "/" + offDefault;
  `)).toBe('true/refused');
});

test('P2b: written exactly at the default sits out; written off it enforces both keys', () => {
  expect(evaluated(`${bounds} String(((999 := float64.<{ min: 0, max: 100 }>)) is float64.<{ min: 0, max: 100 }>);`)).toBe('true');
  expectThrown(`${bounds} (150 := float64.<{ min: 10 }>); "admitted";`);
});

test('P2c: a hostile subtype riding at its default on both sides cannot veto (C1)', () => {
  // Under the specification's former all-declared quantifier this crossing
  // refused; the participation rule filters the hostile meta type out, since
  // its portions equal its default on both sides.
  expect(evaluated(`${dims}
    type H = { hk: number };
    meta H { default = { hk: 0 }; subtype(a, b) { return false; } }
    String(((2 := float32.<{ m: 1, ratio: 1000, hk: 0 }>) := float32.<{ m: 1, ratio: 1, hk: 0 }>));
  `)).toBe('2000');
});

test('P2d: an unrelated conversionFactor does not scale a crossing it has no metadata in (C1)', () => {
  // Under the former quantifier this answered 14000.
  expect(evaluated(`${dims}
    type F = { fkey: number };
    meta F { default = { fkey: 1 }; subtype(a, b) { return true; } conversionFactor(a, b) { return 7; } }
    String(((2 := Kilometer) := Meter));
  `)).toBe('2000');
});

test('P2e: a default-written key and an absent key are equivalent after completion', () => {
  // h5, the false rejection Phase 1 fixed: completed portions agree, so the
  // pair is metadata-equivalent — assignable at the pass in both directions,
  // and the run crossing admits. This is also the principled remainder of the
  // vacuous-admit rider (F44).
  const fixture = `
    type S2 = { p: number };
    meta S2 { default = { p: 0 }; subtype(a, b) { return a.p === b.p; } validate(v, c) { return true; } }
    type A = float32.<{ p: 0 }>; type Bb = float32.<{}>;
  `;
  expect(evaluated(`${fixture} function nc(a: A) { let b: Bb = a; } "ok";`)).toBe('ok');
  expect(evaluated(`${fixture} function nc(b: Bb) { let a: A = b; } "ok";`)).toBe('ok');
  expect(evaluated(`${fixture} String(((1 := A) := Bb) is Bb);`)).toBe('true');
});

test('P2g: subtype(default, default) is never consulted, so a throwing hook cannot poison the realm (C1)', () => {
  expect(evaluated(`${dims}
    type T2 = { tk: number };
    meta T2 { default = { tk: 5 }; subtype(a, b) { throw new Error("consulted"); } }
    function neverCalled(k: Kilometer) { let m2: Meter = k; }
    String(((2 := Kilometer) := Meter));
  `)).toBe('2000');
});

test('P2h: quantize fires toward a governing target and is silent toward a default one (C4)', () => {
  // The first consultation of a hook that was implemented in cycle 25 and
  // undeclarable until the parser matched the table.
  expect(evaluated(`${qs}
    type Coarse = float64.<{ step: 10 }>; type Fine = float64.<{ step: 1 }>;
    String(((26 := Fine) := Coarse));
  `)).toBe('30');
  expect(evaluated(`${qs}
    type Fine = float64.<{ step: 1 }>;
    String(((26 := Fine) := float64.<{ step: 0 }>));
  `)).toBe('26');
});

test('P2i: the parser matches the hook table in both directions (C4)', () => {
  expect(evaluated(`
    type R2 = { r: number };
    meta R2 { default = { r: 1 }; subtype(a, b) { return true; }
      rescale(c, f) { return c; } describe(c) { return "r=" + c.r; } }
    "declared";
  `)).toBe('declared');
  expectThrown('type X = { x: number }; meta X { default = { x: 0 }; subtype(a, b) { return true; } frobnicate(v) { return v; } }');
});

// P2f, the governing hostile refusing and the governing factor scaling, is
// asserted by type-construction-boundary.test.mts (the Kilometer-to-Velocity
// refusal and the 2000 factor) and is cited rather than duplicated.

// -- Phase 3: the unclaimed-key error (C6, C9) --------------------------------

test('P3a: an unclaimed key is a type error at the parameterization, naming the key', () => {
  const message = thrownMessage('function nc(x: float64.<{ claimedByNobody: 1 }>) { return x; } "ok";');
  expect(message).toContain('claimedByNobody');
  expect(message).toContain('is not claimed by any meta type');
});

test('P3b: the mistyped constraint is named at the type that writes it', () => {
  // The vacuity hazard F40 led with: `mim` for `min` used to be a type that
  // admitted everything, silently.
  const message = thrownMessage(`${bounds} function nc(x: float64.<{ mim: 0 }>) { return x; } "ok";`);
  expect(message).toContain('mim');
});

test('P3c: a parameterization above its meta type is legal', () => {
  // Claims register at evaluation and the pass pre-evaluates the source
  // text's meta declarations before adjudicating — the ordering the whole
  // design turns on.
  expect(evaluated(`
    function nc(x: float32.<{ k: 1 }>) { return x; }
    type KS = { k: number };
    meta KS { default = { k: 0 }; subtype(a, b) { return true; } validate(v, c) { return true; } }
    "ok";
  `)).toBe('ok');
});

test('P3d: direct eval is the pinned boundary — the pass does not run there', () => {
  // One boundary written down beats two half-boundaries with different
  // ordering rules (the plan's D4): a runtime throw in TypeNodeToTypeRecord
  // would fire on eval text whose meta declaration has not run yet, while
  // the static check never sees that text at all.
  expect(evaluated(`String(eval('type E = float32.<{ zzz: 1 }>; (1 := float32) is E'));`)).toBe('true');
});

test('P3f: expression positions are collected too — is and the bare cast (F45)', () => {
  // F44 claimed the type-meta pin had flipped; it had not, because the walk
  // never resolved these positions. It does now, so the parameterization is
  // adjudicated wherever it is WRITTEN.
  expectThrown('String((1 := float64) is float64.<{ zz1: 1 }>);');
  expectThrown('(1 := float64.<{ zz2: 1 }>); "admitted";');
});

test('P3g: the base-form waiver is per-base (C9)', () => {
  // A meta registered against the base receives the whole metadata and speaks
  // for every key of that base's parameterizations — and only that base's.
  expect(evaluated(`
    meta float32 { default = {}; subtype(a, b) { return true; } }
    function nc(x: float32.<{ anyKey: 1 }>) { return x; } "ok";
  `)).toBe('ok');
  expectThrown(`
    meta float32 { default = {}; subtype(a, b) { return true; } }
    function nc(x: float64.<{ anyKey: 1 }>) { return x; } "ok";
  `);
});

test('P3e: claims from a previously evaluated script persist per agent', () => {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  const first = realm.evaluateScriptSkipDebugger(`
    type KS2 = { pk: number };
    meta KS2 { default = { pk: 0 }; subtype(a, b) { return true; } validate(v, c) { return true; } }
    "declared";
  `);
  expect(first).toMatchObject({ Type: 'normal' });
  const second = realm.evaluateScriptSkipDebugger('function nc(x: float32.<{ pk: 3 }>) { return x; } "ok";');
  expect(second).toMatchObject({ Type: 'normal' });
});

// -- Phase 4: the audit's own guards ------------------------------------------

test('P4: completion, participation, and adjudication compose over one program', () => {
  // The protocol end to end: a two-key meta type with a real default, a
  // parameterization writing one key, the defaulted key enforcing, the
  // sit-out admitting the default-written form, the crossing scaled and
  // gated, and every key claimed — nothing in this program is vacuous.
  expect(evaluated(`${bounds} ${dims}
    const paid = (50 := float64.<{ min: 10 }>);
    const sat = (999 := float64.<{ min: 0, max: 100 }>) is float64.<{ min: 0, max: 100 }>;
    const km = (2 := Kilometer);
    String(paid is float64.<{ min: 10 }>) + "/" + String(sat) + "/" + String((km := Meter));
  `)).toBe('true/true/2000');
});
