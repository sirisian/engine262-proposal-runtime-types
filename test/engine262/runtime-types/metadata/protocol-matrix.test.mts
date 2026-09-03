import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

// Spec: #sec-primitive-metadata (Primitive Metadata) - a verification matrix
// for the metadata protocol, grouped by the property each group establishes:
// the default snapshot and portion completion, participation and the sit-out,
// the unclaimed-key error, and the whole protocol composed over one program.
//
// Triage order when one of these fails: suspect the reading of the
// specification first, the test's framing second, and the engine third.

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
// forbids uint8 + uint16. Casting the metadata is the shortest honest
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

// -- The default snapshot, and portion completion --------------------------------

test('validate sees the complete portion, so the DEFAULTED key enforces too', () => {
  // The money trio: before completion the third line failed for the wrong
  // reason (undefined comparison); now it fails for the right one.
  expect(evaluated(`${bounds} String(((50 := float64.<{ min: 10 }>)) is float64.<{ min: 10 }>);`)).toBe('true');
  expectThrown(`${bounds} (5 := float64.<{ min: 10 }>); "admitted";`);
  expectThrown(`${bounds} (150 := float64.<{ min: 10 }>); "admitted";`);
});

test('subtype sees complete portions on both sides of a deferred pair', () => {
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

test('a getter on the default runs once, at declaration, never per judgment', () => {
  // The increment carries NO initializer elsewhere: the checking pass
  // pre-evaluates meta declarations before the script body runs, so an
  // initializer at the top of the script would clobber the declaration-time
  // increment and read "0" - the engine being right and the first probe
  // being wrong. Two constructions and a crossing later, still one.
  expect(evaluated(`
    type G = { g: number };
    meta G { default = { get g() { globalThis.n = (globalThis.n || 0) + 1; return 3; } };
      subtype(a, b) { return true; } validate(v, c) { return true; } }
    (1 := float64.<{ g: 5 }>);
    ((1 := float64.<{ g: 5 }>) := float64.<{ g: 4 }>);
    String(globalThis.n);
  `)).toBe('1');
});

test('the default of an object-shaped meta type must be an object OF the shape', () => {
  // The minimal rule and the full membership rule are both asserted, and a
  // conforming default declares beside them.
  expectThrown('type B2 = { x: number }; meta B2 { default = 0; subtype(a, b) { return true; } } "declared";');
  expectThrown('type B3 = { x: number }; meta B3 { default = { wrong: 1 }; subtype(a, b) { return true; } } "declared";');
  expect(evaluated('type B4 = { x: number }; meta B4 { default = { x: 1 }; subtype(a, b) { return true; } } "declared";')).toBe('declared');
});

test('the optional-key form survives the full shape rule', () => {
  // NumberBounds' own convention: an optional-keyed shape with `default = {}`
  // declares, and validate reads the unwritten key as undefined.
  expect(evaluated(`
    type Nb = { minimum?: number };
    meta Nb { default = {}; subtype(a, b) { return true; }
      validate(v, c) { return c.minimum === undefined || Number(v) >= c.minimum; } }
    String(((5 := float64.<{ minimum: 1 }>)) is float64.<{ minimum: 1 }>);
  `)).toBe('true');
});

// The units regression is the existing suite itself:
// enforcement/boundary-check.test.mts and foundations/type-errors.test.mts run
// byte-identical through the completion rule, which is the guard against an
// `undefined === undefined` accident.

// -- Participation and the sit-out -----------------------------------------------

test('a cast into a metadata type admits, whatever the meta type declares', () => {
  // WAS: "a brand written at its own default admits, and off it refuses",
  // expecting a cast to metadata off the meta type's default to be gated by its
  // `subtype` judgment. The specification says otherwise, and the engine
  // follows it.
  //
  //   "A cast's declared parameterization names what its result BECOMES, and is
  //    not a boundary its body must already satisfy."
  //
  // and names `validate` - not `subtype` - as what a cast's boundary runs:
  // "a bare number reaches a bounded type only through a cast whose boundary
  // runs validate". `subtype` is a relation between two PARAMETERIZATIONS, and
  // a cast does consult it there; it is not a judgment about a bare value.
  //
  // Under the old expectation a brand would be uninhabitable by cast as well as
  // by assignment, since a brand declares no `validate` - which contradicts the
  // clause's own "except through the construction boundary".
  expect(evaluated(`${brand}
    const atDefault = (1 := float32.<{ tag: "" }>) is float32.<{ tag: "" }>;
    let offDefault = "refused"; try { (1 := float32.<{ tag: "A" }>); offDefault = "admitted"; } catch (e) {}
    String(atDefault) + "/" + offDefault;
  `)).toBe('true/admitted');
});

test('a cast DOES consult the judgments between two parameterizations', () => {
  // The other half of that rule, and what makes it a rule rather than a
  // hole: the bare-value entry is what a cast is for, and everything else is
  // still checked.
  expectThrown(`${brand}
    const a = (1 := float32.<{ tag: "A" }>);
    (a := float32.<{ tag: "B" }>);
  `);
  expectThrown('("zz" := string.<{ pattern: /^a+$/ }>);');
  expect(evaluated('String(("aa" := string.<{ pattern: /^a+$/ }>));')).toBe('aa');
});


test('written exactly at the default sits out; written off it enforces both keys', () => {
  expect(evaluated(`${bounds} String(((999 := float64.<{ min: 0, max: 100 }>)) is float64.<{ min: 0, max: 100 }>);`)).toBe('true');
  expectThrown(`${bounds} (150 := float64.<{ min: 10 }>); "admitted";`);
});

test('a hostile subtype riding at its default on both sides cannot veto', () => {
  // Under the specification's former all-declared quantifier this crossing
  // refused; the participation rule filters the hostile meta type out, since
  // its portions equal its default on both sides.
  expect(evaluated(`${dims}
    type H = { hk: number };
    meta H { default = { hk: 0 }; subtype(a, b) { return false; } }
    String(((2 := float32.<{ m: 1, ratio: 1000, hk: 0 }>) := float32.<{ m: 1, ratio: 1, hk: 0 }>));
  `)).toBe('2000');
});

test('an unrelated conversionFactor does not scale a crossing it has no metadata in', () => {
  // Under the former quantifier this answered 14000.
  expect(evaluated(`${dims}
    type F = { fkey: number };
    meta F { default = { fkey: 1 }; subtype(a, b) { return true; } conversionFactor(a, b) { return 7; } }
    String(((2 := Kilometer) := Meter));
  `)).toBe('2000');
});

test('a default-written key and an absent key are equivalent after completion', () => {
  // Completed portions agree, so the
  // pair is metadata-equivalent - assignable at the pass in both directions,
  // and the run crossing admits. This is also the principled remainder of the
  // vacuous-admit rider.
  const fixture = `
    type S2 = { p: number };
    meta S2 { default = { p: 0 }; subtype(a, b) { return a.p === b.p; } validate(v, c) { return true; } }
    type A = float32.<{ p: 0 }>; type Bb = float32.<{}>;
  `;
  expect(evaluated(`${fixture} function nc(a: A) { let b: Bb = a; } "ok";`)).toBe('ok');
  expect(evaluated(`${fixture} function nc(b: Bb) { let a: A = b; } "ok";`)).toBe('ok');
  expect(evaluated(`${fixture} String(((1 := A) := Bb) is Bb);`)).toBe('true');
});

test('subtype(default, default) is never consulted, so a throwing hook cannot poison the realm', () => {
  expect(evaluated(`${dims}
    type T2 = { tk: number };
    meta T2 { default = { tk: 5 }; subtype(a, b) { throw new Error("consulted"); } }
    function neverCalled(k: Kilometer) { let m2: Meter = k; }
    String(((2 := Kilometer) := Meter));
  `)).toBe('2000');
});

test('quantize fires toward a governing target and is silent toward a default one', () => {
  // A hook is only useful once the parser admits it: this one was declarable
  // nowhere until the parser matched the hook table.
  expect(evaluated(`${qs}
    type Coarse = float64.<{ step: 10 }>; type Fine = float64.<{ step: 1 }>;
    String(((26 := Fine) := Coarse));
  `)).toBe('30');
  expect(evaluated(`${qs}
    type Fine = float64.<{ step: 1 }>;
    String(((26 := Fine) := float64.<{ step: 0 }>));
  `)).toBe('26');
});

test('the parser matches the hook table in both directions', () => {
  expect(evaluated(`
    type R2 = { r: number };
    meta R2 { default = { r: 1 }; subtype(a, b) { return true; }
      rescale(c, f) { return c; } describe(c) { return "r=" + c.r; } }
    "declared";
  `)).toBe('declared');
  expectThrown('type X = { x: number }; meta X { default = { x: 0 }; subtype(a, b) { return true; } frobnicate(v) { return v; } }');
});

// The governing hostile refusing and the governing factor scaling are
// asserted by enforcement/boundary-check.test.mts (the Kilometer-to-Velocity
// refusal and the 2000 factor) and are cited rather than duplicated.

// -- The unclaimed-key error -----------------------------------------------------

test('an unclaimed key is a type error at the parameterization, naming the key', () => {
  const message = thrownMessage('function nc(x: float64.<{ claimedByNobody: 1 }>) { return x; } "ok";');
  expect(message).toContain('claimedByNobody');
  expect(message).toContain('is not claimed by any meta type');
});

test('the mistyped constraint is named at the type that writes it', () => {
  // The vacuity hazard: `mim` for `min` would otherwise be a type that admits
  // everything, silently.
  const message = thrownMessage(`${bounds} function nc(x: float64.<{ mim: 0 }>) { return x; } "ok";`);
  expect(message).toContain('mim');
});

test('a parameterization above its meta type is legal', () => {
  // Claims register at evaluation and the pass pre-evaluates the source
  // text's meta declarations before adjudicating - the ordering the whole
  // design turns on.
  expect(evaluated(`
    function nc(x: float32.<{ k: 1 }>) { return x; }
    type KS = { k: number };
    meta KS { default = { k: 0 }; subtype(a, b) { return true; } validate(v, c) { return true; } }
    "ok";
  `)).toBe('ok');
});

test('direct eval is checked like any other Script', () => {
  // The checker runs in ParseScript and eval parses through wrappedParse, so
  // both the pass and the walk have to reach it there; running them at
  // ScriptEvaluation and ExecuteModule alone leaves eval'd source unchecked,
  // and an unclaimed key inside eval admitted.
  expectThrown(`eval('type E = float32.<{ zzz: 1 }>; (1 := float32) is E');`);
  // A meta declaration and a use of it inside ONE eval still work, because the
  // pass pre-evaluates that text's own declarations before adjudicating it.
  expect(evaluated(`
    String(eval('type K = { k: number }; meta K { default = { k: 0 }; subtype(a, b) { return true; } } typeof float32.<{ k: 1 }>'));
  `)).toBe('object');
  // And claims registered by the enclosing script are visible to the eval.
  expect(evaluated(`
    type K3 = { qk: number };
    meta K3 { default = { qk: 0 }; subtype(a, b) { return true; } }
    String(eval('typeof float32.<{ qk: 1 }>'));
  `)).toBe('object');
});

test('expression positions are collected too - is and the bare cast', () => {
  // The walk has to resolve these positions as well as annotations, so the
  // parameterization is adjudicated wherever it is WRITTEN.
  expectThrown('String((1 := float64) is float64.<{ zz1: 1 }>);');
  expectThrown('(1 := float64.<{ zz2: 1 }>); "admitted";');
});

test('the base-form waiver is per-base', () => {
  // A meta registered against the base receives the whole metadata and speaks
  // for every key of that base's parameterizations - and only that base's.
  expect(evaluated(`
    meta float32 { default = {}; subtype(a, b) { return true; } }
    function nc(x: float32.<{ anyKey: 1 }>) { return x; } "ok";
  `)).toBe('ok');
  expectThrown(`
    meta float32 { default = {}; subtype(a, b) { return true; } }
    function nc(x: float64.<{ anyKey: 1 }>) { return x; } "ok";
  `);
});

test('claims from a previously evaluated script persist per agent', () => {
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

// -- The audit's own guards ------------------------------------------------------

test('completion, participation, and adjudication compose over one program', () => {
  // The protocol end to end: a two-key meta type with a real default, a
  // parameterization writing one key, the defaulted key enforcing, the
  // sit-out admitting the default-written form, the crossing scaled and
  // gated, and every key claimed - nothing in this program is vacuous.
  expect(evaluated(`${bounds} ${dims}
    const paid = (50 := float64.<{ min: 10 }>);
    const sat = (999 := float64.<{ min: 0, max: 100 }>) is float64.<{ min: 0, max: 100 }>;
    const km = (2 := Kilometer);
    String(paid is float64.<{ min: 10 }>) + "/" + String(sat) + "/" + String((km := Meter));
  `)).toBe('true/true/2000');
});
