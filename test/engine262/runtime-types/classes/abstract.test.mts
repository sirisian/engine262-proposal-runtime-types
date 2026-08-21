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
  return run(source).Type === 'normal';
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
