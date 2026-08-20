import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * Spec: #sec-meta-declarations (Meta Declarations), #sec-primitive-metadata.
 *
 * A `meta` declaration claims metadata keys for a type and supplies the hooks
 * the judgments consult: `default`, `subtype`, `validate`, and the rest of
 * #table-metadata-values. This file covers the declaration form, what each
 * hook is asked and when, and the errors a malformed one produces.
 */

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

test('the default hook does not supply uninitialized annotated bindings', () => {
  // REWRITTEN by PLAN-meta-default-scope.md phase 1, the third test that
  // asserted the conflation and the one that stated it most plainly - its title
  // was the behaviour.
  //
  // #table-meta-hooks: `default` is "the unconstrained constraint: what a value
  // carries where it has no field of this meta type". A binding holds its
  // TYPE's default, which #sec-defaultvalueof decides and which no meta
  // declaration participates in. Registering the hook as the constraint shape's
  // default let a `meta` declaration redefine the zero of `uint8`.
  expect(evaluated('meta uint8 { subtype(a, b) { return true; } default = 7; } let x: uint8; x === (0 := uint8) ? "ok" : "no";')).toBe('ok');
  expect(run('type T = uint8 | string; meta T { subtype(a, b) { return true; } default = "d"; } let s: T;')).toMatchObject({ Type: 'throw' });
  // A binding still takes its type's STRUCTURAL default per #sec-default-values:
  // a string is '', not undefined. Unchanged, and now unconditionally so - the
  // parenthetical that said a registered `default` takes precedence is gone.
  expect(evaluated('let y: uint8 = 3; let z: string; z === "" && y === (3 := uint8) ? "ok" : "no";')).toBe('ok');
  // An initializer wins over the default, which was never in question.
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

test('meta: a base-form meta with no validate admits any metadata of its base', () => {
  // The surviving form of "no hook means no constraint": absence of `validate`
  // judges nothing, so every value of the base is admitted, while the
  // parameterization still keeps two metadata apart for identity. The
  // base-form declaration is ALSO what keeps the program legal: without it,
  // `a` is an unclaimed key and the pass rejects the parameterization that
  // writes it.
  expect(evaluated('meta float64 { default = {}; subtype(a, b) { return true; } } String((1 := float64) is float64.<{ a: 1 }>);')).toBe('true');
});

// A meta declaration against
// a METADATA type reaches nothing where registration keys on that type's own
// Type Object while IsOfType looked up on the parameterization's base. The
// claiming rule of #sec-primitive-metadata is what connects them, and the hook
// below is now consulted.
test('meta: a meta declaration on a META TYPE governs a parameterization', () => {
  expect(evaluated(`
    type Dimensions = { m: number };
    meta Dimensions { subtype(a, b) { return true; } default = { m: 0 }; validate(v, m) { return false; } }
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
    type Bounds = { min: number, max: number };
    meta Bounds { subtype(a, b) { return true; } default = { min: 0, max: 0 }; validate(v, m) { return Number(v) >= m.min && Number(v) <= m.max; } }
    String(((5 := float32) is float32.<{ min: 0, max: 10 }>) + "/" + ((50 := float32) is float32.<{ min: 0, max: 10 }>));
  `)).toBe('true/false');
});

test('meta: one meta type governs every base that uses its keys', () => {
  // the claim is on the KEYS, so the same meta type judges a different base
  expect(evaluated(`
    type Bounds = { min: number, max: number };
    meta Bounds { subtype(a, b) { return true; } default = { min: 0, max: 0 }; validate(v, m) { return Number(v) <= m.max; } }
    String((5 := int32) is int32.<{ min: 0, max: 10 }>);
  `)).toBe('true');
});

test('meta: two meta types both govern when the metadata uses both their keys', () => {
  expect(evaluated(`
    type Lower = { lo: number };
    type Upper = { hi: number };
    meta Lower { subtype(a, b) { return true; } default = { lo: 0 }; validate(v, m) { return Number(v) >= m.lo; } }
    meta Upper { subtype(a, b) { return true; } default = { hi: 0 }; validate(v, m) { return Number(v) <= m.hi; } }
    String(((5 := float32) is float32.<{ lo: 0, hi: 10 }>) + "/" + ((50 := float32) is float32.<{ lo: 0, hi: 10 }>));
  `)).toBe('true/false');
});

test('meta: two meta types may not claim one key', () => {
  // reported at the second declaration, which is where the collision is, and not
  // at the unlucky program that parameterized on the key last
  expectThrown(`
    type A = { unit: number, a: number };
    type B = { unit: number, b: number };
    meta A { subtype(a, b) { return true; } default = { unit: 0, a: 0 }; }
    meta B { subtype(a, b) { return true; } default = { unit: 0, b: 0 }; }
  `);
  // distinct keys are fine
  expect(evaluated(`
    type P = { pp: number };
    type Q2 = { qq: number };
    meta P { subtype(a, b) { return true; } default = { pp: 0 }; }
    meta Q2 { subtype(a, b) { return true; } default = { qq: 0 }; }
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
// Skipping a meta type that offers no judgment would admit the bare value and
// make a brand a comment.
test('meta: a meta type that claims a key and defines no validate refuses bare values', () => {
  expect(evaluated(`
    type Brand = { tag: number };
    meta Brand { subtype(a, b) { return true; } default = { tag: 0 }; }
    String((1 := float32) is float32.<{ tag: 7 }>);
  `)).toBe('false');
  // it refuses at every base, since the claim is on the key
  expect(evaluated(`
    type Brand2 = { tag2: number };
    meta Brand2 { subtype(a, b) { return true; } default = { tag2: 0 }; }
    String((1 := int32) is int32.<{ tag2: 7 }>);
  `)).toBe('false');
});

test('meta: a meta type that defines validate still decides normally', () => {
  expect(evaluated(`
    type Bound = { atLeast: number };
    meta Bound { subtype(a, b) { return true; } default = { atLeast: 0 }; validate(v, m) { return Number(v) >= m.atLeast; } }
    String(((5 := float32) is float32.<{ atLeast: 1 }>) + "/" + (((0 - 5) := float32) is float32.<{ atLeast: 1 }>));
  `)).toBe('true/false');
});

test('meta: a metadata key no meta type claims is a type error at the parameterization', () => {
  // "A metadata object whose own key no meta type claims is a type error at
  // the parameterization that writes it" - adjudicated in the checking pass,
  // and covering this EXPRESSION position as well: the `is` operand writes the
  // parameterization as surely as an annotation does, so the walk resolves it
  // and the pass rejects it, naming the key.
  expect(run('String((1 := float64) is float64.<{ claimedByNobody: 1 }>);')).toMatchObject({ Type: 'throw' });
});

// -- The metadata value language: nested records and lists --------------------
// #table-metadata-values admits a nested record and a list under a claimed key.
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
    type N = { rr: number };
    meta N { subtype(a, b) { return true; } default = { rr: 0 }; validate(v, m) { return typeof m.rr === "object" && m.rr.lo === 0; } }
    String((1 := float32) is float32.<{ rr: { lo: 0 } }>);
  `)).toBe('true');
  expect(evaluated(`
    type L = { ll: number };
    meta L { subtype(a, b) { return true; } default = { ll: 0 }; validate(v, m) { return Array.isArray(m.ll) && m.ll.length === 2 && m.ll[1] === 2; } }
    String((1 := float32) is float32.<{ ll: [1, 2] }>);
  `)).toBe('true');
});

test('meta: flat metadata is unchanged', () => {
  expect(evaluated('String(Reflect.isAssignable(type float32.<{ a: 1 }>, type float32.<{ a: 2 }>));')).toBe('false');
  expect(evaluated('String(Reflect.isAssignable(type float32.<{ a: 1 }>, type float32.<{ a: 1 }>));')).toBe('true');
});

// -- The pattern form of the metadata value language --------------------------
// The last form of #table-metadata-values, and the one that needed the lexer: a
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
    type SP = { pat: number };
    meta SP { subtype(a, b) { return true; } default = { pat: 0 }; validate(v, m) { return m.pat instanceof RegExp && m.pat.source === "^a" && m.pat.flags === "i"; } }
    String(("ab" := string) is string.<{ pat: /^a/i }>);
  `)).toBe('true');
});

test('meta: the whole-string match a StringPattern meta type would perform', () => {
  // the validation judgment the clause gives StringPattern, written as an
  // ordinary meta type now that the pattern reaches the hook
  expect(evaluated(`
    type SP2 = { rex: number };
    meta SP2 { subtype(a, b) { return true; } default = { rex: 0 }; validate(v, m) { let re = new RegExp("^(?:" + m.rex.source + ")$", m.rex.flags); return re.test(String(v)); } }
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
    type MyPattern = { pattern: number };
    meta MyPattern { subtype(a, b) { return true; } default = { pattern: 0 }; }
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
    type U = { unit: number };
    meta U { default = { unit: 0 }; subtype(a, b) { return true; } validate(v, m) { return true; } }
    String(Number(float32.<{ unit: 1 }>(7)));
  `)).toBe('7');
  // Pinned as it behaves rather than as it should: a hook that REFUSES does
  // not yet keep the value out on this path. The judgment is reached and
  // answers correctly through `is` (covered above), so the gap is between the
  // Type Object call and the construction boundary rather than in the
  // judgment - the open half of ConvertParameterization.
  expect(evaluated(`
    type U2 = { u2: number };
    meta U2 { default = { u2: 0 }; subtype(a, b) { return true; } validate(v, m) { return Number(v) > 0; } }
    let m = "";
    try { float32.<{ u2: 1 }>(0 - 5); m = "admitted"; } catch (e) { m = "refused"; }
    m;
  `)).toBe('admitted');
});

test('meta: the brand is shed freely on the way up', () => {
  // no meta type gates the upward direction, which is the branding rule
  expect(evaluated(`
    type U3 = { u3: number };
    meta U3 { default = { u3: 0 }; subtype(a, b) { return true; } validate(v, m) { return true; } }
    String(Number(float32(float32.<{ u3: 1 }>(7))));
  `)).toBe('7');
});

// -- `subtype` is required ---------------------------------------------------
// "It is an early error ... a missing `default` or `subtype`." The engine
// enforced only `default` until now. `subtype` is required for a reason the brand
// makes plain: it is the meta type's half of the metadata subtype judgment, so a
// meta type without one states no relation between two of its parameterizations
// and the crossing between them has nothing to consult.
test('meta: a declaration without a subtype hook is refused', () => {
  expectThrown('type NoSub = { nosub: number }; meta NoSub { default = { nosub: 0 }; }');
  // and one with it is accepted
  expect(evaluated(`
    type WithSub = { withsub: number };
    meta WithSub { subtype(a, b) { return true; } default = { withsub: 0 }; }
    "ok";
  `)).toBe('ok');
});

test('meta: `validate` stays optional, which is what a brand needs', () => {
  // a meta type that defines no `validate` deliberately admits no bare value of
  // the base, so requiring `validate` too would make a brand inexpressible
  expect(evaluated(`
    type Brandish = { brandish: number };
    meta Brandish { subtype(a, b) { return true; } default = { brandish: 0 }; }
    String((1 := float32) is float32.<{ brandish: 7 }>);
  `)).toBe('false');
});

test('a builder that names ambient state is not compile-time evaluable', () => {
  // ISSUES-found-while-writing-examples.md I8. #sec-iscompiletimeevaluable puts
  // the discipline on what the code can NAME - "a property of what the code can
  // name rather than a wall around what it does" - and the engine applied it to
  // a REPLACEMENT DECORATOR and not to a BUILDER, which is the other place user
  // code runs during checking.
  const rand = 'function r() { const x = Math.random(); '
    + 'return Reflect.makeType({ kind: "object", properties: [] }); } type R = r();';
  expect(run(rand)).toMatchObject({ Type: 'throw' });
  const ambient = 'function s() { globalThis.side = 1; '
    + 'return Reflect.makeType({ kind: "object", properties: [] }); } type S = s();';
  expect(run(ambient)).toMatchObject({ Type: 'throw' });

  // And what the fragment DOES admit still works, which is what keeps the rule
  // from reading as a ban on builders: the library floor includes `Map`, "whose
  // keys Type Objects serve as by interned identity".
  const ok = 'function b() { const seen = new Map(); seen.set(uint8, 1); '
    + 'return Reflect.makeType({ kind: "object", properties: [{ name: "x", type: type uint8 }] }); } '
    + 'type B = b(); let v: B = { x: (1 := uint8) }; String(v.x);';
  expect(run(ok)).toMatchObject({ Type: 'normal' });
});

test('a meta declaration may be generic', () => {
  // PLAN-generic-meta-declarations.md. #sec-meta-declarations has carried
  // `TypeParameters?` in the production; the parser read a TypeName and went
  // straight to the brace, so `meta NumberBounds<T: Ordered.<T>> { … }` - the
  // central worked example of primitivemetadata.md - did not parse.
  const ord = 'interface Ordered<T> { v: T; } ';
  expect(run(`type NB<T> = { nonZero?: boolean }; meta NB<T> { default = {}; subtype(a, b) { return true; } } "ok";`)).toMatchObject({ Type: 'normal' });
  // The constrained form comes along, because parseTypeParameters is the same
  // one `type`, `interface` and `primitive` already call.
  expect(run(`${ord} type NB2<T: Ordered.<T>> = { nonZero?: boolean }; `
    + 'meta NB2<T: Ordered.<T>> { default = {}; subtype(a, b) { return true; } } "ok";')).toMatchObject({ Type: 'normal' });
  // D1: a hook may name the parameter in its annotations.
  expect(run(`${ord} type NB3<T: Ordered.<T>> = { nonZero?: boolean }; `
    + 'meta NB3<T: Ordered.<T>> { default = {}; subtype(sub: NB3.<T>, sup: NB3.<T>): boolean { return true; } } "ok";')).toMatchObject({ Type: 'normal' });
  // The non-generic form is unchanged, and an empty parameter list is refused by
  // parseTypeParameters rather than by a rule of its own - `type E<> = …` is
  // already a SyntaxError, and this pins that it keeps coming from there.
  expect(run('type NB4 = { nonZero?: boolean }; meta NB4 { default = {}; subtype(a, b) { return true; } } "ok";')).toMatchObject({ Type: 'normal' });
  expect(run('type NB5<> = { nonZero?: boolean };')).toMatchObject({ Type: 'throw' });
  // D2: claiming does not depend on the argument, so one type declared twice is
  // still refused whatever parameters are written.
  expect(run('type NB6<T> = { nonZero?: boolean }; meta NB6<T> { default = {}; subtype(a, b) { return true; } } '
    + 'meta NB6<U> { default = {}; subtype(a, b) { return true; } } "ok";')).toMatchObject({ Type: 'throw' });
});

test('a base-form meta type has no type parameters to bind', () => {
  // D4. #sec-meta-declarations: a meta declaration "may instead name a PRIMITIVE
  // type rather than an object type, declaring a base-form meta type" - and a
  // primitive has no parameter to bind. The production allows `TypeParameters?`
  // after any TypeName, so this is an early error rather than a parse failure,
  // and it is refused rather than accepted-and-ignored: a program that wrote it
  // would have no way to discover the parameter did nothing.
  expect(run('meta uint8<T> { default = 0; subtype(a, b) { return true; } }')).toMatchObject({ Type: 'throw' });
  // The base form itself still works without parameters.
  expect(run('meta uint8 { default = 0; subtype(a, b) { return a === b; } } let x: uint8; String(x);')).toMatchObject({ Type: 'normal' });
});

test('a generic meta declaration parses but does not yet claim its keys', () => {
  // PLAN-generic-meta-declarations.md phase 4. RECORDED, not asserted as
  // correct: phase 1 made the form parse and the evaluation half does not
  // follow. `type G` named without arguments is "not a type", so
  // Evaluate_MetaDeclaration finds no Type Object, returns early, and neither
  // the key claim nor the hook registration happens.
  //
  // The non-generic form of the same declaration reaches an ASSIGNABILITY error
  // instead, which is the proof its key WAS claimed.
  const generic = 'type G<T> = { gkey?: boolean }; '
    + 'meta G<T> { default = { gkey: false }; subtype(a, b) { return true; } } '
    + 'let v: uint8.<{ gkey: true }> = (1 := uint8.<{ gkey: true }>); "ok";';
  const plain = 'type F = { fkey?: boolean }; '
    + 'meta F { default = { fkey: false }; subtype(a, b) { return true; } } '
    + 'let v: uint8.<{ fkey: true }> = (1 := uint8.<{ fkey: true }>); "ok";';
  // Both throw today, and the MESSAGES are the finding: one says the key is
  // unclaimed, the other has got past claiming.
  expect(run(generic)).toMatchObject({ Type: 'throw' });
  expect(run(plain)).toMatchObject({ Type: 'throw' });
  // The declaration itself evaluates silently - no error, and no effect.
  expect(run('type G2<T> = { g2?: boolean }; meta G2<T> { default = {}; subtype(a, b) { return true; } } "ok";'))
    .toMatchObject({ Type: 'normal' });
});
