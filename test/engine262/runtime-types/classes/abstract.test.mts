import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * Spec: #sec-typed-classes (Typed Classes) - a class name in a type position.
 *
 * A class name resolves to the nominal instance type carrying its declared
 * members, which is what makes a store to a field, a call to a method, and an
 * assignment between related classes judgeable.
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


function ok(source: string): boolean {
  // `run` answers a ValueCompletion, whose NORMAL case is a bare value rather
  // than a record - `BigIntValue` has no `Type` - so the union has to be
  // narrowed before the tag is read. The shared harness's `ok` does the same.
  return (run(source) as { Type: string }).Type === 'normal';
}

function errorMessage(source: string): string {
  const completion = run(source) as unknown as { Type: string, Value: unknown };
  if (completion.Type !== 'throw') {
    return '(no error)';
  }
  const v = completion.Value as { ErrorData?: unknown, properties?: Map<unknown, { Value?: { stringValue(): string } }> };
  for (const [k, d] of (v.properties ?? new Map())) {
    if ((k as { stringValue?: () => string }).stringValue?.() === 'message') {
      return d.Value?.stringValue() ?? '';
    }
  }
  return '';
}

test('a member is abstract because it has no body', () => {
  // PLAN-signature-listings.md Part A. #sec-abstract-classes: "A member is
  // abstract because it has no body; the `abstract` keyword before it is
  // optional and says the same thing earlier."
  //
  // The keyword was required, so `m(): uint8;` - the spelling a reader reaches
  // for, and the one the design documents use - gave `Unexpected token` with a
  // caret on the semicolon. No ambiguity justified it: the parens distinguish a
  // bodiless method from a field, `;` versus `{` from one with a body, and the
  // form that would collide (a bodiless OVERLOAD signature) does not exist here
  // because overloads are declared with bodies.
  expect(evaluated('abstract class C { m(): uint8; } class D extends C { m(): uint8 { return (1 := uint8); } } String(new D().m());')).toBe('1');
  // The keyword still works and means the same thing, and the two spellings may
  // sit in one body.
  expect(evaluated('abstract class E { abstract m(): uint8; } class F extends E { m(): uint8 { return (2 := uint8); } } String(new F().m());')).toBe('2');
  expect(ok('abstract class G { m(): uint8; abstract n(): uint8; }')).toBe(true);
  // A concrete method beside an abstract one is still concrete.
  expect(evaluated('abstract class J { m(): uint8; n(): uint8 { return (3 := uint8); } } '
    + 'class K extends J { m(): uint8 { return (4 := uint8); } } const k = new K(); `${k.m()}${k.n()}`;')).toBe('43');
  // The annotation may be any type, including ones that begin with a brace -
  // which is what makes the `;`-versus-`{` decision non-trivial and worth
  // pinning.
  expect(ok('abstract class H { m(): { a: uint8 }; }')).toBe(true);
  expect(ok('abstract class I2 { m(): uint8 | string; }')).toBe(true);
  expect(ok('abstract class L { m(); }')).toBe(true);
  expect(ok('abstract class M { #m(): uint8; }')).toBe(true);
});

test('an accessor is an abstract member; four other forms are not', () => {
  // A `get`/`set` accessor has an override site and its annotation types the
  // implementations exactly as a method's does, so it IS an abstract member -
  // which the keyword form could not express at all.
  expect(ok('abstract class A { get x(): uint8; }')).toBe(true);
  expect(ok('abstract class B { set x(v: uint8); }')).toBe(true);
  // The four that are not, each refused BY NAME rather than with a caret on the
  // semicolon. This is most of the value of the change: the reader is told the
  // rule instead of the token.
  expect(errorMessage('class C { m(): uint8; }')).toMatch(/abstract method requires an abstract class/);
  expect(errorMessage('abstract class D { static m(): uint8; }')).toMatch(/static member.*requires a body/);
  expect(errorMessage('abstract class E { constructor(a: uint8); }')).toMatch(/constructor.*requires a body/);
  expect(errorMessage('abstract class F { async m(): uint8; }')).toMatch(/async method.*requires a body/);
  expect(errorMessage('abstract class G { *m(): uint8; }')).toMatch(/generator method.*requires a body/);
  // The contract an abstract async method would express stays writable.
  expect(ok('abstract class H { m(): Promise.<uint8>; }')).toBe(true);
  // A field is still a field, not a nullary method.
  expect(ok('class I2 { x: uint8; }')).toBe(true);
});

test('a concrete class must implement what it inherits with no body', () => {
  // PLAN-abstract-implementation.md phase 2b. #sec-abstract-classes: "a type
  // error if a class not declared `abstract` leaves an inherited abstract
  // method unimplemented". Until now the class declared, constructed, and
  // reported only when the missing member was CALLED - "h.m is not a function",
  // which names the symptom rather than the contract.
  //
  // Newly reachable at all: `m(): uint8;` without the keyword, and accessors as
  // abstract members, both arrived with PLAN-signature-listings Part A.
  const G = 'abstract class G { m(): uint8; } ';
  expect(errorMessage(`${G} class H extends G { }`)).toMatch(/inherits "m" with no body/);
  // Both accessor forms, which a kind-filtered walk is likeliest to miss - an
  // abstract getter recorded under the method kind is invisible to the walk that
  // asks for getters.
  expect(errorMessage('abstract class P { get x(): uint8; } class Q extends P { }'))
    .toMatch(/inherits "x" with no body/);
  expect(errorMessage('abstract class R { set x(v: uint8); } class S extends R { }'))
    .toMatch(/inherits "x" with no body/);
  // Through two levels, and the message names the CONCRETE class rather than the
  // one that declared the member.
  expect(errorMessage(`${G} abstract class K extends G { } class H2 extends K { }`))
    .toMatch(/"H2" inherits "m"/);
});

test('the branches that already worked still do', () => {
  // These are what the check must not break, and each was measured as accepted
  // before it went in.
  const G = 'abstract class G { m(): uint8; } ';
  // An abstract subclass may leave it - it is still a contract, not a gap.
  expect(ok(`${G} abstract class K extends G { }`)).toBe(true);
  // A concrete subclass that implements it is accepted and callable.
  expect(evaluated(`${G} class J extends G { m(): uint8 { return (1 := uint8); } } String(new J().m());`)).toBe('1');
  // Implementing at a MIDDLE level satisfies everything below: the walk stops at
  // the nearest declaration, so K2's body is what H2 inherits.
  expect(evaluated(`${G} abstract class K2 extends G { m(): uint8 { return (1 := uint8); } } `
    + 'class H2 extends K2 { } String(new H2().m());')).toBe('1');
  // A class with no abstract ancestor is untouched.
  expect(ok('class A { m(): uint8 { return (0 := uint8); } } class B extends A { }')).toBe(true);
  // And a static cannot be abstract at all, so none can reach the walk - refused
  // at parse by Part A rather than here.
  expect(errorMessage('abstract class T { static s(): uint8; }')).toMatch(/static member.*requires a body/);
});

test('an implementation must have a signature the declaration accepts', () => {
  // PLAN-abstract-implementation.md phase 3, rule 1. #sec-abstract-classes: an
  // abstract method's "annotation types the implementations: it is a type error
  // if a subclass implements an inherited abstract method with a signature the
  // abstract declaration does not accept".
  //
  // The SUBTYPE relation (D3), which is what interface satisfaction already uses
  // for the same question - `class C implements I { m(): uint8 }` for an `I`
  // declaring `m(): number` is refused, and an abstract `m(): number` accepting
  // it was the engine answering one question two ways.
  const G = 'abstract class G { m(): uint8; } ';
  expect(errorMessage(`${G} class L extends G { m(): string { return "s"; } }`))
    .toMatch(/signature the declaration does not accept/);
  expect(errorMessage(`${G} class N extends G { m(a: uint8): uint8 { return a; } }`))
    .toMatch(/signature the declaration does not accept/);
  // `uint8` is NOT a narrower `number` in this design: the numeric families are
  // mutually unrelated, no boundary admits the value, and the override that is
  // accepted today produces a result every `number` position rejects. This case
  // is why D3 was reopened, and it is refused rather than preserved.
  expect(errorMessage('abstract class R { m(): number; } class S extends R { m(): uint8 { return (1 := uint8); } }'))
    .toMatch(/signature the declaration does not accept/);
  // Where the design DOES have a subtype, it is accepted: a literal type sits
  // under its base, so `m(): 3` implements `m(): number`.
  expect(evaluated('abstract class P { m(): number; } class Q extends P { m(): 3 { return 3; } } String(new Q().m());'))
    .toBe('3');
  // And an exact match is untouched.
  expect(evaluated(`${G} class M extends G { m(): uint8 { return (2 := uint8); } } String(new M().m());`)).toBe('2');
});

test('the signature rule is an Early Error too', () => {
  // PLAN-abstract-implementation.md, the checking-pass migration, rule 1. It was
  // evaluation-time only after phase 3: the marker before the class ran, then
  // the override threw. Both rules of #sec-abstract-classes are now Early
  // Errors, which is what D1's recorded deviation asked for.
  //
  // The assertion is TIMING - both behaviours throw.
  expect(evaluated('globalThis.ran = 0; try { eval("abstract class G { m(): uint8; } '
    + 'class L extends G { m(): string { return String(globalThis.ran = 1); } }"); } catch (e) { } '
    + 'String(globalThis.ran);')).toBe('0');
  // It runs whether or not the overriding class is itself abstract: a wrong
  // override is wrong at ITS declaration, not at the first concrete class below.
  expectThrown('abstract class G { m(): uint8; } abstract class K extends G { m(): string { return "s"; } }');
  // And the accepted branches are untouched - an exact match, and a genuine
  // subtype where the design has one.
  expect(ok('abstract class G { m(): uint8; } class M extends G { m(): uint8 { return (2 := uint8); } }')).toBe(true);
  expect(ok('abstract class P { m(): number; } class Q extends P { m(): 3 { return 3; } }')).toBe(true);
});

test('the unimplemented rule is an Early Error', () => {
  // PLAN-abstract-implementation.md, the checking-pass migration. D1 recorded a
  // deviation: both rules refused at class definition EVALUATION, so a marker
  // before the class ran and a class in dead code was never checked.
  // #sec-type-errors wants "a source text that contains one is rejected rather
  // than evaluated", which is what PLAN-default-timing settled for the
  // no-default rule.
  //
  // The assertion is TIMING, not that an error occurs - both behaviours throw.
  expect(evaluated('globalThis.ran = 0; try { eval("abstract class G { m(): uint8; } class H extends G { }"); } '
    + 'catch (e) { } String(globalThis.ran);')).toBe('0');
  // A class in DEAD CODE is now checked, which is the point of an Early Error.
  expectThrown('abstract class G { m(): uint8; } if (false) { class H extends G { } }');
  // The evaluation-time check stays as the backstop, which is the same division
  // the neighbouring rule uses: `new C()` on an abstract class is both a static
  // type error and a [[Construct]] refusal.
  expect(ok('abstract class G { m(): uint8; } class J extends G { m(): uint8 { return (1 := uint8); } }')).toBe(true);
});

test('both rules follow a chain of any depth', () => {
  // PLAN-abstract-implementation.md. The plan's own tests went two levels; these
  // are A / B extends A / C extends B and deeper, which is where the two walks
  // stop being obviously equivalent.
  //
  // An obligation survives any number of ABSTRACT links.
  expectThrown('abstract class A { m(): uint8; } abstract class B extends A { } class C extends B { }');
  expectThrown('abstract class A { m(): uint8; } abstract class B extends A { } '
    + 'abstract class C extends B { } class D extends C { }');
  // An implementation anywhere in the chain discharges it for everything below.
  expect(evaluated('abstract class A { m(): uint8; } abstract class B extends A { m(): uint8 { return (1 := uint8); } } '
    + 'class C extends B { } String(new C().m());')).toBe('1');
  expect(evaluated('abstract class A { m(): uint8; } class B extends A { m(): uint8 { return (1 := uint8); } } '
    + 'class C extends B { } String(new C().m());')).toBe('1');
  // A middle link may ADD an obligation, and the concrete class owes both.
  expect(errorMessage('abstract class A { m(): uint8; } abstract class B extends A { n(): uint8; } '
    + 'class C extends B { m(): uint8 { return (1 := uint8); } }')).toMatch(/inherits "n" with no body/);
  expect(ok('abstract class A { m(): uint8; } abstract class B extends A { n(): uint8; } '
    + 'class C extends B { m(): uint8 { return (1 := uint8); } n(): uint8 { return (2 := uint8); } }')).toBe(true);
  // Rule 1 reaches past an intermediate that adds nothing.
  expect(errorMessage('abstract class A { m(): uint8; } abstract class B extends A { } '
    + 'class C extends B { m(): string { return "s"; } }')).toMatch(/signature the declaration does not accept/);
});

test('a re-declared abstract member is governed by the nearest declaration', () => {
  // The case that made the first chain walk wrong. `B` re-declares `m` narrower
  // than `A` does, and `C` implements what B declared. Comparing against every
  // ancestor blamed C for a narrowing B wrote - the error named the wrong class.
  //
  // The nearest declaration governs, which mirrors rule 2 stopping at the first
  // implementation.
  expect(evaluated('abstract class A { m(): number; } abstract class B extends A { m(): uint8; } '
    + 'class C extends B { m(): uint8 { return (1 := uint8); } } String(new C().m());')).toBe('1');
  // A wrong override at an ABSTRACT middle link is still reported, and at that
  // link rather than at the concrete class below it.
  expect(errorMessage('abstract class A { m(): uint8; } abstract class B extends A { m(): string { return "s"; } } '
    + 'class C extends B { }')).toMatch(/"B" implements an inherited "m"/);
});
