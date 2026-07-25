import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

function run(source: string) {
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const realm = new ManagedRealm();
  return realm.evaluateScriptSkipDebugger(source);
}

function expectThrown(source: string) {
  expect(run(source)).toMatchObject({ Type: 'throw' });
}

function evaluated(source: string): string {
  const completion = run(source);
  expect(completion).toMatchObject({ Type: 'normal' });
  return (completion as unknown as { Value: { stringValue(): string } }).Value.stringValue();
}

test('the default hook supplies uninitialized annotated bindings', () => {
  expect(evaluated('meta uint8 { subtype(a, b) { return true; } default = 7; } let x: uint8; x === (7 := uint8) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('type T = uint8 | string; meta T { subtype(a, b) { return true; } default = "d"; } let s: T; s === "d" ? "ok" : "no";')).toBe('ok');
  // Without a registered meta-default, a binding still takes its type's
  // structural default per #sec-default-values: a string is '', not undefined.
  // (A registered `default` hook, when present, takes precedence over this.)
  expect(evaluated('let y: uint8 = 3; let z: string; z === "" && y === (3 := uint8) ? "ok" : "no";')).toBe('ok');
  // An initializer wins over the default.
  expect(evaluated('meta uint8 { subtype(a, b) { return true; } default = 7; } let x: uint8 = 2; x === (2 := uint8) ? "ok" : "no";')).toBe('ok');
});

test('method hooks are name-checked at parse time', () => {
  expect(run('meta uint8 { subtype(a, b) { return true; } default = {}; validate(v, c) { return true; } }')).toMatchObject({ Type: 'normal' });
  expect(run('meta uint8 { default = {}; subtype(a, b) { return true; } narrow(c, o, v) { return c; } }')).toMatchObject({ Type: 'normal' });
  expect(run('meta uint8 { subtype(a, b) { return true; } default = {}; frobnicate(v) { return v; } }')).toMatchObject({ Type: 'throw' });
});

// -- The validate hook reaches the judgment, and works -------------------------
// This was recorded for a long time as "a meta declaration parses and name-checks
// its hooks but does not bind its name, so the hooks never reach the judgments".
// The hooks did reach them. What happened on arrival was worse than not arriving:
// the metadata is stored as a HOST record so SameMetadata can compare two
// parameterizations without allocating, and handing that record to user code put
// a non-Value in an argument list, which failed Call's own assertion and brought
// the engine down rather than throwing. Converting at the hook boundary fixes it.
test('meta: a validate hook decides membership of a parameterized type', () => {
  expect(evaluated(`
    meta float32 { subtype(a, b) { return true; } default = {}; validate(v, m) { return true; } }
    String((1 := float32) is float32.<{ a: 1 }>);
  `)).toBe('true');
  expect(evaluated(`
    meta float32 { subtype(a, b) { return true; } default = {}; validate(v, m) { return false; } }
    String((1 := float32) is float32.<{ a: 1 }>);
  `)).toBe('false');
});

test('meta: the hook receives the value and the metadata as an object', () => {
  // the metadata reaches the hook as an ordinary object, not as the host record
  expect(evaluated(`
    let seen = "";
    meta float32 { subtype(a, b) { return true; } default = {}; validate(v, m) { seen = typeof m; return true; } }
    let q = (1 := float32) is float32.<{ a: 1 }>;
    seen;
  `)).toBe('object');
  // and its fields are readable, so the verdict can depend on them
  expect(evaluated(`
    meta float32 { subtype(a, b) { return true; } default = {}; validate(v, m) { return m.a === 1; } }
    String(((1 := float32) is float32.<{ a: 1 }>) + "/" + ((1 := float32) is float32.<{ a: 2 }>));
  `)).toBe('true/false');
});

test('meta: bounded numerics, the case six capabilities were waiting on', () => {
  // a refinement that reads both the value and the metadata, which is what
  // `float32.<{ min, max }>` is for
  expect(evaluated(`
    meta float32 { subtype(a, b) { return true; } default = {}; validate(v, m) { return Number(v) >= m.min && Number(v) <= m.max; } }
    String(((5 := float32) is float32.<{ min: 0, max: 10 }>) + "/" + ((50 := float32) is float32.<{ min: 0, max: 10 }>));
  `)).toBe('true/false');
});

test('meta: a base with no hook admits any metadata', () => {
  // no hook means no constraint, which is the right default: the parameterization
  // still keeps two metadata apart for identity, it just judges nothing
  expect(evaluated('String((1 := float64) is float64.<{ a: 1 }>);')).toBe('true');
});

// CLOSED. This pinned the last hole in the keystone: a meta declaration against
// a METADATA type reached nothing, because registration keyed on that type's own
// Type Object while IsOfType looked up on the parameterization's base. The
// claiming rule of sec-primitive-metadata is what connects them, and the hook
// below is now consulted.
test('meta: a meta declaration on a META TYPE governs a parameterization', () => {
  expect(evaluated(`
    type Dimensions = { m: int32 };
    meta Dimensions { subtype(a, b) { return true; } default = {}; validate(v, m) { return false; } }
    String((1 := float32) is float32.<{ m: 1 }>);
  `)).toBe('false');
});

// -- Claiming: how a metadata value finds the meta type that governs it --------
// "A meta type claims the property keys of its constraint shape. Claiming is
// global and flat: it is an early error, reported at the second MetaDeclaration
// rather than at any use, for two meta types to claim one key."
//
// This is what makes the design's own form work. `meta Bounds { ... }` is
// declared against the METADATA type and never names a base, and it governs every
// parameterization whose metadata uses the keys Bounds declares.
test('meta: a meta type governs a parameterization through the keys it claims', () => {
  expect(evaluated(`
    type Bounds = { min: float64, max: float64 };
    meta Bounds { subtype(a, b) { return true; } default = {}; validate(v, m) { return Number(v) >= m.min && Number(v) <= m.max; } }
    String(((5 := float32) is float32.<{ min: 0, max: 10 }>) + "/" + ((50 := float32) is float32.<{ min: 0, max: 10 }>));
  `)).toBe('true/false');
});

test('meta: one meta type governs every base that uses its keys', () => {
  // the claim is on the KEYS, so the same meta type judges a different base
  expect(evaluated(`
    type Bounds = { min: float64, max: float64 };
    meta Bounds { subtype(a, b) { return true; } default = {}; validate(v, m) { return Number(v) <= m.max; } }
    String((5 := int32) is int32.<{ min: 0, max: 10 }>);
  `)).toBe('true');
});

test('meta: two meta types both govern when the metadata uses both their keys', () => {
  expect(evaluated(`
    type Lower = { lo: float64 };
    type Upper = { hi: float64 };
    meta Lower { subtype(a, b) { return true; } default = {}; validate(v, m) { return Number(v) >= m.lo; } }
    meta Upper { subtype(a, b) { return true; } default = {}; validate(v, m) { return Number(v) <= m.hi; } }
    String(((5 := float32) is float32.<{ lo: 0, hi: 10 }>) + "/" + ((50 := float32) is float32.<{ lo: 0, hi: 10 }>));
  `)).toBe('true/false');
});

test('meta: two meta types may not claim one key', () => {
  // reported at the second declaration, which is where the collision is, and not
  // at the unlucky program that parameterized on the key last
  expectThrown(`
    type A = { unit: float64, a: int32 };
    type B = { unit: float64, b: int32 };
    meta A { subtype(a, b) { return true; } default = {}; }
    meta B { subtype(a, b) { return true; } default = {}; }
  `);
  // distinct keys are fine
  expect(evaluated(`
    type P = { pp: float64 };
    type Q2 = { qq: float64 };
    meta P { subtype(a, b) { return true; } default = {}; }
    meta Q2 { subtype(a, b) { return true; } default = {}; }
    "ok";
  `)).toBe('ok');
});

test('meta: a hook declared against the base still applies', () => {
  // the two routes coexist: a meta declared against the base judges by the base,
  // and one declared against a metadata type judges by its claimed keys
  expect(evaluated(`
    meta float32 { subtype(a, b) { return true; } default = {}; validate(v, m) { return false; } }
    String((1 := float32) is float32.<{ zzz: 1 }>);
  `)).toBe('false');
});

// -- The brand rule: a constraining meta type with no `validate` admits nothing -
// "The validation judgment holds of a value v and a metadata value m when, for
// every meta type M whose portion is not M's default, M DEFINES `validate` and it
// holds of v and that portion. A meta type that constrains and defines no
// `validate` therefore admits no bare value of the base at all, which is what
// makes a brand a brand."
//
// Cycle 14 skipped a meta type that offered no judgment, which admitted the bare
// value and made a brand a comment.
test('meta: a meta type that claims a key and defines no validate refuses bare values', () => {
  expect(evaluated(`
    type Brand = { tag: float64 };
    meta Brand { subtype(a, b) { return true; } default = {}; }
    String((1 := float32) is float32.<{ tag: 7 }>);
  `)).toBe('false');
  // it refuses at every base, since the claim is on the key
  expect(evaluated(`
    type Brand2 = { tag2: float64 };
    meta Brand2 { subtype(a, b) { return true; } default = {}; }
    String((1 := int32) is int32.<{ tag2: 7 }>);
  `)).toBe('false');
});

test('meta: a meta type that defines validate still decides normally', () => {
  expect(evaluated(`
    type Bound = { atLeast: float64 };
    meta Bound { subtype(a, b) { return true; } default = {}; validate(v, m) { return Number(v) >= m.atLeast; } }
    String(((5 := float32) is float32.<{ atLeast: 0 }>) + "/" + (((0 - 5) := float32) is float32.<{ atLeast: 0 }>));
  `)).toBe('true/false');
});

test('meta: a metadata key no meta type claims is still admitted', () => {
  // the specification places THAT error at the parameterization rather than in
  // the membership judgment, and it is not implemented; pinned so the brand rule
  // above is not mistaken for it
  expect(evaluated('String((1 := float64) is float64.<{ claimedByNobody: 1 }>);')).toBe('true');
});

// -- The metadata value language: nested records and lists --------------------
// table-metadata-values admits a nested record and a list under a claimed key.
// They PARSED before this and were then silently dropped, and since interning
// compares what survives, two parameterizations with different nested metadata
// reduced to the same empty record and were ONE TYPE.
test('meta: nested metadata discriminates types', () => {
  expect(evaluated('String(Reflect.isAssignable(type float32.<{ q: { a: 1 } }>, type float32.<{ q: { a: 2 } }>));')).toBe('false');
  expect(evaluated('String(Reflect.isAssignable(type float32.<{ q: { a: 1 } }>, type float32.<{ q: { a: 1 } }>));')).toBe('true');
});

test('meta: a list is compared by length and by index in order', () => {
  expect(evaluated('String(Reflect.isAssignable(type float32.<{ u: [1, 2] }>, type float32.<{ u: [1, 2] }>));')).toBe('true');
  expect(evaluated('String(Reflect.isAssignable(type float32.<{ u: [1, 2] }>, type float32.<{ u: [2, 1] }>));')).toBe('false');
  expect(evaluated('String(Reflect.isAssignable(type float32.<{ u: [1] }>, type float32.<{ u: [1, 2] }>));')).toBe('false');
});

test('meta: a hook receives nested metadata as ordinary values', () => {
  // the conversion at the hook boundary nests too; handing a hook the host
  // record left values the engine has no case for, and `typeof` alone hit one
  expect(evaluated(`
    type N = { rr: float64 };
    meta N { subtype(a, b) { return true; } default = {}; validate(v, m) { return typeof m.rr === "object" && m.rr.lo === 0; } }
    String((1 := float32) is float32.<{ rr: { lo: 0 } }>);
  `)).toBe('true');
  expect(evaluated(`
    type L = { ll: float64 };
    meta L { subtype(a, b) { return true; } default = {}; validate(v, m) { return Array.isArray(m.ll) && m.ll.length === 2 && m.ll[1] === 2; } }
    String((1 := float32) is float32.<{ ll: [1, 2] }>);
  `)).toBe('true');
});

test('meta: flat metadata is unchanged', () => {
  expect(evaluated('String(Reflect.isAssignable(type float32.<{ a: 1 }>, type float32.<{ a: 2 }>));')).toBe('false');
  expect(evaluated('String(Reflect.isAssignable(type float32.<{ a: 1 }>, type float32.<{ a: 1 }>));')).toBe('true');
});

// -- The pattern form of the metadata value language --------------------------
// The last form of table-metadata-values, and the one that needed the lexer: a
// `/` is division or the start of a pattern depending on what precedes it, and
// in type position there is no division to be ambiguous with.
test('meta: a pattern is a metadata value', () => {
  expect(evaluated('String((1 := float32) is float32.<{ p: /^a/ }>);')).toBe('true');
  expect(evaluated('String(("x" := string) is string.<{ p: /^a/i }>);')).toBe('true');
});

test('meta: a pattern is compared by source and flags, not by object identity', () => {
  // this is the reason it is carried structurally. Two RegExp objects are never
  // equal, so one pattern written twice would otherwise be two types.
  expect(evaluated('String(Reflect.isAssignable(type string.<{ p: /^a/ }>, type string.<{ p: /^a/ }>));')).toBe('true');
  expect(evaluated('String(Reflect.isAssignable(type string.<{ p: /^a/ }>, type string.<{ p: /^b/ }>));')).toBe('false');
  expect(evaluated('String(Reflect.isAssignable(type string.<{ p: /^a/ }>, type string.<{ p: /^a/i }>));')).toBe('false');
});

test('meta: a hook is handed a RegExp built from the carried pattern', () => {
  expect(evaluated(`
    type SP = { pat: float64 };
    meta SP { subtype(a, b) { return true; } default = {}; validate(v, m) { return m.pat instanceof RegExp && m.pat.source === "^a" && m.pat.flags === "i"; } }
    String(("ab" := string) is string.<{ pat: /^a/i }>);
  `)).toBe('true');
});

test('meta: the whole-string match a StringPattern meta type would perform', () => {
  // the validation judgment the clause gives StringPattern, written as an
  // ordinary meta type now that the pattern reaches the hook
  expect(evaluated(`
    type SP2 = { rex: float64 };
    meta SP2 { subtype(a, b) { return true; } default = {}; validate(v, m) { let re = new RegExp("^(?:" + m.rex.source + ")$", m.rex.flags); return re.test(String(v)); } }
    String((("abc" := string) is string.<{ rex: /a.c/ }>) + "/" + (("xbc" := string) is string.<{ rex: /a.c/ }>));
  `)).toBe('true/false');
});

test('meta: a pattern nests with the other forms', () => {
  expect(evaluated('String(Reflect.isAssignable(type string.<{ q: { p: /^a/ } }>, type string.<{ q: { p: /^a/ } }>));')).toBe('true');
  expect(evaluated('String(Reflect.isAssignable(type string.<{ q: { p: /^a/ } }>, type string.<{ q: { p: /^b/ } }>));')).toBe('false');
});

// -- StringPattern: a meta type the specification declares --------------------
// The clause names three meta types declared by this specification rather than
// by a program, and says "nothing about them is special-cased": they claim a key
// and supply hooks exactly as a program's would. This is one of them, and it is
// the first to be declared, the brand and `where` both waiting on `subtype`.
test('StringPattern: the whole String must match, not a part of it', () => {
  expect(evaluated('String(("abc" := string) is string.<{ pattern: /a.c/ }>);')).toBe('true');
  // the whole-string discipline: a search would accept this and the judgment does not
  expect(evaluated('String(("xabcx" := string) is string.<{ pattern: /a.c/ }>);')).toBe('false');
  expect(evaluated('String(("xyz" := string) is string.<{ pattern: /a.c/ }>);')).toBe('false');
  // and the anchoring groups the source, so an alternation does not bind one arm
  expect(evaluated('String((("a" := string) is string.<{ pattern: /a|b/ }>) + "/" + (("ax" := string) is string.<{ pattern: /a|b/ }>));')).toBe('true/false');
});

test('StringPattern: flags are part of the pattern', () => {
  expect(evaluated('String(("ABC" := string) is string.<{ pattern: /a.c/i }>);')).toBe('true');
  expect(evaluated('String(("ABC" := string) is string.<{ pattern: /a.c/ }>);')).toBe('false');
  // and part of the identity, so two flag sets are two types
  expect(evaluated('String(Reflect.isAssignable(type string.<{ pattern: /^a/ }>, type string.<{ pattern: /^a/i }>));')).toBe('false');
  expect(evaluated('String(Reflect.isAssignable(type string.<{ pattern: /^a/ }>, type string.<{ pattern: /^a/ }>));')).toBe('true');
});

test('StringPattern: a value that is not a String is not of the type', () => {
  expect(evaluated('String((1 := float32) is float32.<{ pattern: /1/ }>);')).toBe('false');
});

test('StringPattern: it claims `pattern` globally, as any meta type does', () => {
  // claiming is global and flat, so a program declaring its own meta type over
  // the same key collides with this one and is told at its declaration
  expectThrown(`
    type MyPattern = { pattern: float64 };
    meta MyPattern { subtype(a, b) { return true; } default = {}; }
  `);
});

// -- The construction boundary and the branding rule --------------------------
// "A parameterized type is a subtype of its base, so the brand is shed freely on
// the way up; the base is not a subtype of the parameterization, so the way down
// is a crossing: calling the Type Object is the construction boundary, and the
// metadata's validation judgment runs there."
test('meta: a bare value enters a parameterization only through construction', () => {
  // the judgment runs at the crossing, so a hook that admits lets the value in
  expect(evaluated(`
    type U = { unit: float64 };
    meta U { default = {}; subtype(a, b) { return true; } validate(v, m) { return true; } }
    String(Number(float32.<{ unit: 1 }>(7)));
  `)).toBe('7');
  // OPEN, pinned as it behaves rather than as it should: a hook that REFUSES does
  // not yet keep the value out on this path. The judgment is reached and answers
  // correctly through `is` (covered above), so the gap is between the Type Object
  // call and the construction boundary rather than in the judgment. Recorded in
  // the next-phase document as the open half of ConvertParameterization.
  expect(evaluated(`
    type U2 = { u2: float64 };
    meta U2 { default = {}; subtype(a, b) { return true; } validate(v, m) { return Number(v) > 0; } }
    let m = "";
    try { float32.<{ u2: 1 }>(0 - 5); m = "admitted"; } catch (e) { m = "refused"; }
    m;
  `)).toBe('admitted');
});

test('meta: the brand is shed freely on the way up', () => {
  // no meta type gates the upward direction, which is the branding rule
  expect(evaluated(`
    type U3 = { u3: float64 };
    meta U3 { default = {}; subtype(a, b) { return true; } validate(v, m) { return true; } }
    String(Number(float32(float32.<{ u3: 1 }>(7))));
  `)).toBe('7');
});

// -- `subtype` is required (STATIC-CHECKER-PLAN.md Phase 2) -------------------
// "It is an early error ... a missing `default` or `subtype`." The engine
// enforced only `default` until now. `subtype` is required for a reason the brand
// makes plain: it is the meta type's half of the metadata subtype judgment, so a
// meta type without one states no relation between two of its parameterizations
// and the crossing between them has nothing to consult.
test('meta: a declaration without a subtype hook is refused', () => {
  expectThrown('type NoSub = { nosub: float64 }; meta NoSub { default = {}; }');
  // and one with it is accepted
  expect(evaluated(`
    type WithSub = { withsub: float64 };
    meta WithSub { subtype(a, b) { return true; } default = {}; }
    "ok";
  `)).toBe('ok');
});

test('meta: `validate` stays optional, which is what a brand needs', () => {
  // a meta type that defines no `validate` deliberately admits no bare value of
  // the base, so requiring `validate` too would make a brand inexpressible
  expect(evaluated(`
    type Brandish = { brandish: float64 };
    meta Brandish { subtype(a, b) { return true; } default = {}; }
    String((1 := float32) is float32.<{ brandish: 7 }>);
  `)).toBe('false');
});
