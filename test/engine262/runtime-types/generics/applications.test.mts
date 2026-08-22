import { test, expect } from 'vitest';
import { evaluated, expectThrown, run, ok } from '../harness.mts';

// -- A deferred application as a binding's type (#sec-deferred-applications) --
//
// "an application over an unbound parameter is carried as an ~application~ Type
// Record and evaluated at specialization". The closed alias form always worked;
// these are the forms inside a generic body, where the parameter is bound by the
// call rather than by the declaration.

const pairOf = 'function pairOf(T) { return Reflect.makeType({ kind: "tuple", '
  + 'elements: [{ type: T, rest: false }, { type: T, rest: false }] }); } ';

test('a deferred application annotates a binding and specializes per call', () => {
  // The default is the specialization's, which is what distinguishes a real
  // deferral from a lucky one: the same generic gives typed zeros at uint8 and
  // empty strings at string.
  expect(evaluated(`${pairOf} function make<T>(x: T) { let p: pairOf(T); return p; }`
    + ' const r = make((1 := uint8)); `${r.length}:${r[0]}:${r[0] is uint8}`;')).toBe('2:0:true');
  expect(evaluated(`${pairOf} function make<T>(x: T) { let p: pairOf(T); return p; }`
    + ' const r = make("a"); `${r.length}:${JSON.stringify(r[0])}`;')).toBe('2:""');
});

test('a deferred application enforces its annotation', () => {
  expect(evaluated(`${pairOf} function init<T>(x: T) { let p: pairOf(T) = [x, x]; return p; }`
    + ' String(init((7 := uint8)));')).toBe('7,7');
  expectThrown(`${pairOf} function bad<T>(x: T) { let p: pairOf(T) = ["wrong", "wrong"]; return p; }`
    + ' bad((1 := uint8));');
  // And the store into it is checked, with either initializer shape - the
  // already-conforming one is what the tuple stamp above is for.
  expectThrown(`${pairOf} function f<T>(x: T) { let p: pairOf(T) = [1, 2]; p[0] = "bad"; return p; }`
    + ' f((1 := uint8));');
  expectThrown(`${pairOf} function f<T>(x: T) { let p: pairOf(T) = [x, x]; p[0] = "bad"; return p; }`
    + ' f((1 := uint8));');
});

test('a deferred application works in every position a parameter is bound', () => {
  expect(evaluated(`${pairOf} function nested<T>(x: T) { let p: pairOf(pairOf(T)); return p; }`
    + ' const r = nested((1 := uint8)); `${r.length}:${r[0].length}`;')).toBe('2:2');
  expect(evaluated(`${pairOf} function param<T>(x: T, p: pairOf(T)) { return p.length; }`
    + ' String(param((1 := uint8), [1, 2]));')).toBe('2');
  expect(evaluated(`${pairOf} function ret<T>(x: T): pairOf(T) { return [x, x]; }`
    + ' String(ret((3 := uint8)));')).toBe('3,3');
});

test('a class field reaches it too', () => {
  // This was the one position a deferred application did NOT reach: a field's
  // type was resolved over a frame that bound each parameter to a fresh unbound
  // record, shadowing the specialization's own bindings, so the application was
  // still over `T` when the field was defined and the declaration was refused
  // for having no default. With the field deferring to an active binding, the
  // application specializes here as it does everywhere else.
  expect(evaluated(`${pairOf} class Box<T> { p: pairOf(T); }`
    + ' const b = new Box.<uint8>(); `${b.p.length}:${b.p[0]}`;')).toBe('2:0');
  // And the positions substituted, so a store into one is checked.
  expectThrown(`${pairOf} class Box<T> { p: pairOf(T); }`
    + ' const b = new Box.<uint8>(); b.p[0] = "wrong";');
});

test('a method may carry a where clause naming its class\'s parameters', () => {
  // PLAN-where-on-methods.md D2. #sec-type-annotations, as amended: a method
  // takes |WhereClauses| the same way a function declaration does. The rule
  // needs no restatement - "checked at each specialization once its parameters
  // are bound" - because a generic method specializes as a generic function
  // does.
  //
  // The part that is NEW: a method's clause may name the parameters of its CLASS
  // as well as its own. `N` is bound at the instantiation and `I` at the call,
  // and no clause before this one had to resolve across two scopes.
  const V = 'class V<N: uint32> { lane<I: uint32>(): uint32 where I < N { return (1 := uint32); } } ';
  expect(evaluated(`${V} String(new V.<4>().lane.<1>());`)).toBe('1');
  expectThrown(`${V} new V.<4>().lane.<9>();`);
  // The class frame is pushed UNDER the method's, so a method parameter shadows
  // a class parameter of the same name - `N > 2` reads the method's 5, not the
  // class's 0.
  expect(evaluated('class X<N: uint32> { m<N: uint32>(): uint32 where N > 2 { return (1 := uint32); } } '
    + 'String(new X.<0>().m.<5>());')).toBe('1');
  // A non-generic class contributes no frame, and a method-only clause still
  // works - which is the case that would break if the frame were pushed
  // unconditionally.
  expect(evaluated('class Y { m<I: uint32>(): uint32 where I < 3 { return (1 := uint32); } } '
    + 'String(new Y().m.<1>());')).toBe('1');
  // The two positions that already worked are untouched.
  expect(evaluated('function f<N: uint32>(): uint32 where N > 0 { return (1 := uint32); } String(f.<3>());')).toBe('1');
  expectThrown('function g<N: uint32>(): uint32 where N > 0 { return (1 := uint32); } g.<0>();');
});

test('a checked contract names the builder, the arguments and the clause', () => {
  // PLAN-where-on-methods.md D1, the VERIFIED half. #sec-checked-contracts: "a
  // clause that is falsy is a type error naming the builder, the arguments it
  // was given, and the clause" - THREE things, and a DIFFERENT requirement from
  // the generic bound's, which is "reported against the clause's source".
  //
  // The first implementation reused the bound's message and named none of them.
  const src = 'function widen(n: uint32): uint32 where return > 10 { return n; } widen((3 := uint32));';
  const completion = run(src) as unknown as { Type: string, Value: { properties?: Map<unknown, { Value?: { stringValue(): string } }> } };
  expect(completion.Type).toBe('throw');
  let message = '';
  for (const [k, d] of (completion.Value.properties ?? new Map())) {
    if ((k as { stringValue?: () => string }).stringValue?.() === 'message') {
      message = d.Value?.stringValue() ?? '';
    }
  }
  expect(message).toMatch(/widen/);            // the builder
  expect(message).toMatch(/3/);                // the arguments it was given
  expect(message).toMatch(/where return > 10/); // the clause, as written
  // A satisfied contract is silent, and `return` outside a clause is still a
  // Syntax Error - the clause says that costs nothing "since the token is
  // ungrammatical in expression position today".
  expect(evaluated('function ok(): uint32 where return > 0 { return (5 := uint32); } String(ok());')).toBe('5');
  expectThrown('const x = return;');
});

test('the where positions the plan claimed were covered', () => {
  // PLAN-where-on-methods.md §6, audited. Three of its required tests had no
  // assertion, and writing them found one behaviour it had asserted wrongly.
  //
  // An ABSTRACT method carries a clause, since `simd.md` writes them bodiless.
  expect(ok('abstract class V<N: uint32> { lane<I: uint32>(): uint32 where I < N; }')).toBe(true);
  // A class-level `where` is still refused - nothing writes one, and D3 leaves
  // the dependent-record form to its extension.
  expectThrown('class C<N: uint32> where N > 0 { }');
  // A TYPE ALIAS clause parses.
  expect(evaluated('type P<N: uint32> = uint32 where N > 0; let x: P.<3> = (1 := uint32); String(x);')).toBe('1');
  // RECORDED, not asserted as correct: a VIOLATED alias clause is admitted,
  // where the function position refuses. #sec-generic-where: "checked at each
  // specialization once its parameters are bound. Where the expression is false
  // for an application's bindings, that application is a type error" - and an
  // alias application is a specialization.
  //
  // The engine's own comment at the function site names this failure mode:
  // "parsing the clause without checking it would let `where U < 4` be written
  // and silently ignored, which is worse than the Syntax Error it replaced."
  expect(ok('type Q<N: uint32> = uint32 where N > 0; let y: Q.<0> = (1 := uint32);')).toBe(true);
  expectThrown('function g<N: uint32>(): uint32 where N > 0 { return (1 := uint32); } g.<0>();');
});

test('the deferred application record kind exists and relates by identity', () => {
  // Steps 1, 3 and 4 of five: the ~application~ kind, its IsSubtype arm, and its
  // CanonicalizeType case. Step 4 is what makes step 3's `s.Builder ===
  // t.Builder` meaningful - "two mentions of one deferred call are one type by
  // interning, and two different calls are unrelated until they evaluate" -
  // since without interning two spellings of one call would compare unequal.
  //
  // Nothing PRODUCES one yet (step 2, see the plan), so what is asserted here is
  // that the kind's arrival disturbs nothing: every existing relation holds, and
  // a computed type over a BOUND parameter still evaluates rather than
  // deferring, which is the case step 2 must not capture.
  // PLAN-where-on-methods.md, unblocking D1's assumed half. Steps 1 and 3 of the
  // five: the ~application~ Type Record kind, and the IsSubtype arm.
  //
  // #sec-computed-types: "A deferred ~application~ is a subtype only of itself
  // and of the `any` type. Before specialization nothing finer than identity is
  // known about its result, so nothing finer is assumed."
  //
  // Nothing PRODUCES one yet (step 2), so this asserts what the kind's arrival
  // must not disturb: every existing relation is unchanged, and the
  // exhaustiveness check in displayType - which caught the new kind as a compile
  // error, exactly as its own comment says it should - still has a case for it.
  expect(evaluated('String(Reflect.isAssignable(type uint8, type uint8));')).toBe('true');
  expect(evaluated('String(Reflect.isAssignable(type uint8, type number));')).toBe('false');
  expect(evaluated('String(Reflect.isAssignable(type 3, type number));')).toBe('true');
  // A computed type over a BOUND parameter still evaluates rather than
  // deferring, which is the case the producing site must not capture.
  expect(evaluated('function widen(T: type): type { return T; } '
    + 'function f<T>(v: T): widen(T) { return v; } String(f.<uint8>((1 := uint8)));')).toBe('1');
});

test('a checked contract is ASSUMED before specialization', () => {
  // PLAN-where-on-methods.md D1, the assumed half. #sec-checked-contracts: a
  // contract "is ASSUMED: before specialization, where the application is
  // deferred and no result exists, the checker takes each clause as a known fact
  // about the ~application~ Type Record. The second is sound because of the
  // first: any specialization that would falsify an assumption is stopped at the
  // builder, before the code that relied on it runs."
  //
  // The fact is a SUBTYPE EDGE and its direction is the whole point -
  // `typeprogramming.md` §6.2: "checking a generic body that PRODUCES the result
  // needs a lower bound, and for `omit` the true one is `T <: return`".
  const omit = 'function omit(T: type, k: string): type where Reflect.isAssignable(T, return) { return T; } ';
  // ADMITTED by the fact: a body returning a `T` where `omit(T, …)` is declared.
  // Nothing structural relates them - `omit(T, "password")` cannot be evaluated
  // with `T` unbound - so this passes only because the contract says so.
  expect(ok(`${omit} function good<T>(value: T): omit(T, "password") { return value; }`)).toBe(true);
  // REFUSED at the DECLARATION, never instantiated - which is what the assumed
  // half buys. Before it, a body contradicting its declared return was accepted
  // until someone called it.
  expectThrown(`${omit} function bad<T>(value: T): omit(T, "password") { return "no"; }`);
  // A builder with NO contract is untouched: it produces no record, `resolveType`
  // answers null, and the boundary is left to specialization - which is what the
  // corpus showed is correct for a deferred call nothing is assumed about.
  const pairOf = 'function pairOf(T) { return Reflect.makeType({ kind: "tuple", '
    + 'elements: [{ type: T, rest: false }, { type: T, rest: false }] }); } ';
  expect(ok(`${pairOf} function f<T>(a: pairOf(T)): pairOf(T) { return a; }`)).toBe(true);
});
