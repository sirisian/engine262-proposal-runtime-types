import { expect, test } from 'vitest';
import { expectStaticTypeError, ok } from '../harness.mts';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * Spec: #sec-primitive-metadata (Primitive Metadata) - the hooks a meta
 * declaration may supply, and what each is asked.
 */

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

test('the default hook is required', () => {
  expectThrown('meta uint8 { validate(v, c) { return true; } }');
  expect(run('meta uint8 { subtype(a, b) { return true; } default = 0; validate(v, c) { return true; } }')).toMatchObject({ Type: 'normal' });
});

test('method hooks register and compile', () => {
  // A meta declaration with all four hooks compiles and runs.
  expect(evaluated(`meta uint8 {
    default = 0;
    subtype(a, b) { return true; }
    validate(v, c) { return true; }
    narrow(cur, op, val) { return cur; }
    conversionFactor(from, to) { return 1; }
  } "ok";`)).toBe('ok');
});

test('hook names and signatures are checked', () => {
  expectThrown('meta uint8 { subtype(a, b) { return true; } default = 0; frobnicate(v) { return v; } }');
  // Wrong arity for a known hook.
  expectThrown('meta uint8 { subtype(a, b) { return true; } default = 0; validate(v) { return true; } }');
  expectThrown('meta uint8 { subtype(a, b) { return true; } default = 0; narrow(a, b) { return a; } }');
});

test('at most one meta declaration per type', () => {
  expectThrown('meta uint8 { subtype(a, b) { return true; } default = 0; } meta uint8 { subtype(a, b) { return true; } default = 1; }');
  // Distinct types are independent.
  expect(run('meta uint8 { subtype(a, b) { return true; } default = 0; } meta uint16 { subtype(a, b) { return true; } default = 1; }')).toMatchObject({ Type: 'normal' });
});

test('the default hook does NOT supply a binding of the constraint shape', () => {
  // REWRITTEN once the `meta` hook's scope was settled, and the reasoning
  // matters because this test was written to protect the old behaviour.
  //
  // It asserted that `meta uint8 { default = 7; } let x: uint8;` yields 7 - a
  // `meta` declaration redefining the zero of a PRIMITIVE. #table-meta-hooks
  // scopes the hook to metadata: "the unconstrained constraint: what a value
  // carries where it has no field of this meta type". It says nothing about
  // what a binding holds before it is assigned, and #sec-defaultvalueof gives
  // `uint8` the zero 0 whatever any meta type says.
  expect(evaluated('meta uint8 { subtype(a, b) { return true; } default = 7; } let x: uint8; x === (0 := uint8) ? "ok" : "no";')).toBe('ok');
  // And the metadata half, which is what the hook is for: an unparameterized
  // value carries the unconstrained constraint.
  expect(evaluated('meta uint8 { subtype(a, b) { return true; } default = 7; } let y: uint8.<7> = (7 := uint8.<7>); String(y);')).toBe('7');
});

test('`meet` answers what two constraints have in common', () => {
  // #table-meta-hooks `meet`. The question AreDisjoint cannot ask: it decides on
  // the BASE and never on metadata - deliberately, since two brands over one
  // string share values - so two parameterizations of one base were left
  // standing however their constraints related, and an empty one was reported
  // nowhere.
  const NB = 'type NB = { bounds?: Range }; meta NB { default = {}; '
    + 'subtype(a,b) { if (b.bounds === undefined) return true; if (a.bounds === undefined) return false; return b.bounds.contains(a.bounds); } '
    + 'meet(a,b) { if (a.bounds === undefined) return b; if (b.bounds === undefined) return a;'
    + ' const r = a.bounds.intersect(b.bounds); return r.isEmpty ? null : { bounds: r }; } } ';

  // Reported: nothing is both.
  expectStaticTypeError(`${NB} type T = uint8.<{ bounds: 1..=3 }> & uint8.<{ bounds: 8..=9 }>;`);
  // Adjacent integer ranges are disjoint too - `..=` is inclusive, and 3 < 4.
  expectStaticTypeError(`${NB} type T = uint8.<{ bounds: 1..=3 }> & uint8.<{ bounds: 4..=6 }>;`);

  // Not reported: these have a meet, and a single point is a meet rather than an
  // emptiness.
  expect(ok(`${NB} type T = uint8.<{ bounds: 1..=10 }> & uint8.<{ bounds: 5..=20 }>;`)).toBe(true);
  expect(ok(`${NB} type T = uint8.<{ bounds: 1..=3 }> & uint8.<{ bounds: 1..=10 }>;`)).toBe(true);
  expect(ok(`${NB} type T = uint8.<{ bounds: 1..=3 }> & uint8.<{ bounds: 3..=5 }>;`)).toBe(true);
  expect(ok(`${NB} type T = uint8.<{ bounds: 1..=3 }> & uint8.<{ bounds: 1..=3 }>;`)).toBe(true);

  // Through Q1's object distribution, which is what routes a shared member here
  // rather than to the arm rule - so without a deferral at the member, the object
  // form of the same mistake went unreported.
  expectStaticTypeError(`${NB} type T = { a: uint8.<{ bounds: 1..=3 }> } & { a: uint8.<{ bounds: 8..=9 }> };`);
  expect(ok(`${NB} type T = { a: uint8.<{ bounds: 1..=10 }> } & { a: uint8.<{ bounds: 5..=20 }> };`)).toBe(true);
});

test('the three answers of `meet` are distinguished', () => {
  const decl = (body: string) => `type Tag = { tag?: string }; meta Tag { default = {};`
    + ` subtype(a,b) { return true; }${body} } `;
  const pair = "type T = string.<{ tag: 'A' }> & string.<{ tag: 'C' }>;";

  // A meta type declaring NO `meet` declines, and the intersection stands.
  expect(ok(decl('') + pair)).toBe(true);
  // *undefined* is the same answer written out - a pattern-constrained meta type
  // cannot generally decide whether two patterns share a string, and must be
  // able to say so without claiming emptiness.
  expect(ok(decl(' meet(a,b) { return undefined; }') + pair)).toBe(true);
  // *null* is a PROOF, and only it is reported.
  expectStaticTypeError(decl(' meet(a,b) { return a.tag === b.tag ? a : null; }') + pair);
  // ...and the same hook says nothing about an equal pair.
  expect(ok(decl(' meet(a,b) { return a.tag === b.tag ? a : null; }')
    + "type T = string.<{ tag: 'A' }> & string.<{ tag: 'A' }>;")).toBe(true);
});

test('`meet` is declarable and its signature is checked', () => {
  // Declarable and CONSUMED in one change: a hook that can be written and is
  // never called is the state `rescale` is in, and the parser table's own
  // comment records what that cost.
  expect(ok('type M = { k?: uint8 }; meta M { default = {}; subtype(a,b) { return true; }'
    + ' meet(a,b) { return a; } }')).toBe(true);
  // Refused as EARLY errors, so the script never runs and a `try` cannot see
  // them - the same treatment the other seven hooks get from the table.
  expect(ok('type M = { k?: uint8 }; meta M { default = {}; subtype(a,b) { return true; }'
    + ' meet(a) { return a; } }')).toBe(false);
  expect(ok('type M = { k?: uint8 }; meta M { default = {}; subtype(a,b) { return true; }'
    + ' meet = 5; }')).toBe(false);
});

test('a non-empty `meet` becomes the TYPE', () => {
  // Stage 2 reported an empty meet; a non-empty one was computed and discarded,
  // so `1..=10 & 5..=20` was diagnosed as fine and then stood as an unreduced
  // intersection, which is neither range.
  //
  // The ordering this needed is the whole of why it took three attempts. A type
  // alias is canonicalized by the pass's pre-evaluation loop; a `meet` hook is
  // registered by a `meta` declaration, which that same loop evaluates AFTER the
  // aliases, because a meta names its constraint shape and needs the alias. So
  // the alias is built before the hook exists, and the only way through is to
  // build it twice.
  const NB = 'type NB = { bounds?: Range }; meta NB { default = {}; '
    + 'subtype(a,b) { if (b.bounds === undefined) return true; if (a.bounds === undefined) return false; return b.bounds.contains(a.bounds); } '
    + 'meet(a,b) { if (a.bounds === undefined) return b; if (b.bounds === undefined) return a;'
    + ' const r = a.bounds.intersect(b.bounds); return r.isEmpty ? null : { bounds: r }; } } ';

  // The reduction itself.
  expect(evaluated(`${NB} type T = uint8.<{bounds: 1..=10}> & uint8.<{bounds: 5..=20}>; String(T);`))
    .toBe('uint.<8>.<{ bounds: 5..=10 }>');
  // ...and it is ONE type, not two spellings of one: the interning invariant this
  // exists to satisfy.
  expect(evaluated(`${NB} type A = uint8.<{bounds: 1..=10}> & uint8.<{bounds: 5..=20}>;`
    + ' type B = uint8.<{bounds: 5..=10}>; String(A === B);')).toBe('true');
  // Containment reduces to the narrower.
  expect(evaluated(`${NB} type T = uint8.<{bounds: 1..=3}> & uint8.<{bounds: 1..=10}>; String(T);`))
    .toBe('uint.<8>.<{ bounds: 1..=3 }>');
  // The same at a shared member, which Q1's distribution routes here rather than
  // to the arm rule - one rule, one answer.
  expect(evaluated(`${NB} type T = { a: uint8.<{bounds: 1..=10}> } & { a: uint8.<{bounds: 5..=20}> }; String(T);`))
    .toBe('{ a: uint.<8>.<{ bounds: 5..=10 }> }');
  // Reflection reports the reduced type, not the pair. Stage 0 restored this
  // invariant for the subtype judgment and the reduction must not break it.
  expect(evaluated(`${NB} type T = uint8.<{bounds: 1..=10}> & uint8.<{bounds: 5..=20}>;`
    + ' String(Reflect.getReflection(T).kind);')).toBe('parameterized');

  // The empty case still reports rather than reducing.
  expectStaticTypeError(`${NB} type T = uint8.<{bounds: 1..=3}> & uint8.<{bounds: 8..=9}>;`);
  // A meta type that declines still leaves the intersection standing.
  expect(evaluated('type Tag = { tag?: string }; meta Tag { default = {}; subtype(a,b) { return true; } }'
    + " type T = string.<{tag: 'A'}> & string.<{tag: 'C'}>;"
    + ' String(Reflect.getReflection(T).kind);')).toBe('intersection');
});
