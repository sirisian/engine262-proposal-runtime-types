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
  expect(evaluated('meta uint8 { default = 7; } let x: uint8; x === (7 := uint8) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('type T = uint8 | string; meta T { default = "d"; } let s: T; s === "d" ? "ok" : "no";')).toBe('ok');
  // Without a registered meta-default, a binding still takes its type's
  // structural default per #sec-default-values: a string is '', not undefined.
  // (A registered `default` hook, when present, takes precedence over this.)
  expect(evaluated('let y: uint8 = 3; let z: string; z === "" && y === (3 := uint8) ? "ok" : "no";')).toBe('ok');
  // An initializer wins over the default.
  expect(evaluated('meta uint8 { default = 7; } let x: uint8 = 2; x === (2 := uint8) ? "ok" : "no";')).toBe('ok');
});

test('method hooks are name-checked at parse time', () => {
  expect(run('meta uint8 { default = 0; validate(v, c) { return true; } }')).toMatchObject({ Type: 'normal' });
  expect(run('meta uint8 { default = 0; subtype(a, b) { return true; } narrow(c, o, v) { return c; } }')).toMatchObject({ Type: 'normal' });
  expect(run('meta uint8 { default = 0; frobnicate(v) { return v; } }')).toMatchObject({ Type: 'throw' });
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
    meta float32 { default = 0; validate(v, m) { return true; } }
    String((1 := float32) is float32.<{ a: 1 }>);
  `)).toBe('true');
  expect(evaluated(`
    meta float32 { default = 0; validate(v, m) { return false; } }
    String((1 := float32) is float32.<{ a: 1 }>);
  `)).toBe('false');
});

test('meta: the hook receives the value and the metadata as an object', () => {
  // the metadata reaches the hook as an ordinary object, not as the host record
  expect(evaluated(`
    let seen = "";
    meta float32 { default = 0; validate(v, m) { seen = typeof m; return true; } }
    let q = (1 := float32) is float32.<{ a: 1 }>;
    seen;
  `)).toBe('object');
  // and its fields are readable, so the verdict can depend on them
  expect(evaluated(`
    meta float32 { default = 0; validate(v, m) { return m.a === 1; } }
    String(((1 := float32) is float32.<{ a: 1 }>) + "/" + ((1 := float32) is float32.<{ a: 2 }>));
  `)).toBe('true/false');
});

test('meta: bounded numerics, the case six capabilities were waiting on', () => {
  // a refinement that reads both the value and the metadata, which is what
  // `float32.<{ min, max }>` is for
  expect(evaluated(`
    meta float32 { default = 0; validate(v, m) { return Number(v) >= m.min && Number(v) <= m.max; } }
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
    meta Dimensions { default = 0; validate(v, m) { return false; } }
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
    meta Bounds { default = 0; validate(v, m) { return Number(v) >= m.min && Number(v) <= m.max; } }
    String(((5 := float32) is float32.<{ min: 0, max: 10 }>) + "/" + ((50 := float32) is float32.<{ min: 0, max: 10 }>));
  `)).toBe('true/false');
});

test('meta: one meta type governs every base that uses its keys', () => {
  // the claim is on the KEYS, so the same meta type judges a different base
  expect(evaluated(`
    type Bounds = { min: float64, max: float64 };
    meta Bounds { default = 0; validate(v, m) { return Number(v) <= m.max; } }
    String((5 := int32) is int32.<{ min: 0, max: 10 }>);
  `)).toBe('true');
});

test('meta: two meta types both govern when the metadata uses both their keys', () => {
  expect(evaluated(`
    type Lower = { lo: float64 };
    type Upper = { hi: float64 };
    meta Lower { default = 0; validate(v, m) { return Number(v) >= m.lo; } }
    meta Upper { default = 0; validate(v, m) { return Number(v) <= m.hi; } }
    String(((5 := float32) is float32.<{ lo: 0, hi: 10 }>) + "/" + ((50 := float32) is float32.<{ lo: 0, hi: 10 }>));
  `)).toBe('true/false');
});

test('meta: two meta types may not claim one key', () => {
  // reported at the second declaration, which is where the collision is, and not
  // at the unlucky program that parameterized on the key last
  expectThrown(`
    type A = { unit: float64, a: int32 };
    type B = { unit: float64, b: int32 };
    meta A { default = 0; }
    meta B { default = 0; }
  `);
  // distinct keys are fine
  expect(evaluated(`
    type P = { pp: float64 };
    type Q2 = { qq: float64 };
    meta P { default = 0; }
    meta Q2 { default = 0; }
    "ok";
  `)).toBe('ok');
});

test('meta: a hook declared against the base still applies', () => {
  // the two routes coexist: a meta declared against the base judges by the base,
  // and one declared against a metadata type judges by its claimed keys
  expect(evaluated(`
    meta float32 { default = 0; validate(v, m) { return false; } }
    String((1 := float32) is float32.<{ zzz: 1 }>);
  `)).toBe('false');
});
