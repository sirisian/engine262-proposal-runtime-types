import { expect, test } from 'vitest';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

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

test('enums bind objects with sequential member values', () => {
  expect(evaluated('enum Color { Red, Green, Blue } Color.Red === 0 && Color.Green === 1 && Color.Blue === 2 ? "ok" : "no";')).toBe('ok');
  expect(evaluated('enum E { A, B = 10, C } E.C === 11 ? "ok" : "no";')).toBe('ok');
  expect(evaluated('enum S { A = "a", B } typeof S.A === "string" && S.B === 1 ? "ok" : "no";')).toBe('ok');
});

test('enum membership is SameValue against the members', () => {
  expect(evaluated('enum E { A, B = 10 } (0 is E) && (10 is E) && !(3 is E) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('enum E { A } try { let x: E = 5; "no"; } catch (err) { "caught"; }')).toBe('caught');
  expect(evaluated('enum E { A, B } let x: E = 1; x === 1 ? "ok" : "no";')).toBe('ok');
});

test('interfaces check structurally', () => {
  expect(evaluated(`interface Point { x: number; y: number }
    ({ x: 1, y: 2 } is Point) && !({ x: 1 } is Point) && !({ x: "a", y: 2 } is Point) ? "ok" : "no";`)).toBe('ok');
  expect(evaluated(`interface Named { name: string; greet(a) }
    ({ name: "n", greet() {} } is Named) && !({ name: "n", greet: 3 } is Named) ? "ok" : "no";`)).toBe('ok');
  // MIGRATED TO STATIC FORM. This asserted a RUNTIME throw, caught by the
  // try - which is what a mistyped object literal produced while the checker
  // could not see into a literal's contents. It is an Early Error now, so the
  // try cannot swallow it, and the runtime backstop is asserted beside it
  // through the `any` path where the checker still cannot decide (F37).
  expect(run('interface I { x: string } let p: I = { x: 300 };')).toMatchObject({ Type: 'throw' });
  // An interface member converts as an object type's does (F87): 300 has a
  // canonical text and reaches `string` losslessly, so it converts rather than
  // failing - the same rule `let s: string = 300` has always followed.
  expect(evaluated('interface I { x: string } function anyv() { return { x: 300 }; } let p: I = anyv(); p.x + "/" + typeof p.x;')).toBe('300/string');
  // A member the type cannot hold is still refused.
  expect(evaluated('interface J { x: uint8 } function anyv() { return { x: 300 }; } try { let p: J = anyv(); "no"; } catch (e) { "caught"; }')).toBe('caught');
});

test('class operators dispatch on binary expressions', () => {
  // proposal-runtime-types (spec sec-class-operators): the receiver is the left
  // operand and the declaration's parameter is the right operand.
  expect(evaluated(`class Vec {
    constructor(x) { this.x = x; }
    operator +(rhs) { return new Vec(this.x + rhs.x); }
    operator *(rhs) { return new Vec(this.x * rhs.x); }
  }
  const v = new Vec(2) + new Vec(3);
  const w = new Vec(2) * new Vec(3);
  v.x === 5 && w.x === 6 ? "ok" : "no";`)).toBe('ok');
  // Objects without operators keep today's behaviour.
  expect(evaluated('const r = {} + 1; typeof r === "string" ? "ok" : "no";')).toBe('ok');
});

test('a typed class is sealed and its prototype frozen', () => {
  // #sec-typed-storage: "A class in which AT LEAST ONE public or private field
  // is typed is automatically sealed, as if PreventExtensions had been
  // performed on each of its instances, and ITS PROTOTYPE IS FROZEN." The
  // instance half was already right; the prototype half was described in a
  // comment beside it and never performed, so a typed class's prototype was an
  // ordinary mutable object.
  expect(evaluated('class A { a: uint8; } String(Object.isFrozen(A.prototype));')).toBe('true');
  expect(evaluated('class A { a: uint8; } String(Object.isExtensible(new A()));')).toBe('false');
  // ONE typed field is the condition, not every field: sealing is what makes a
  // field's type a fact about the layout at all, which one field already asks
  // for.
  expect(evaluated('class M { a: uint8; b; } String(Object.isFrozen(M.prototype));')).toBe('true');
  // The opt-outs.
  expect(evaluated('dynamic class D { d: uint8; } String(Object.isFrozen(D.prototype));')).toBe('false');
  expect(evaluated('class U { u; } String(Object.isFrozen(U.prototype));')).toBe('false');
  // What sealing does NOT do: a field may still be written, since "a field's
  // type is what constrains it", and the store check still applies.
  expect(evaluated('class A { a: uint8; } const x = new A(); x.a = 7; String(x.a);')).toBe('7');
  expect(evaluated('class A { a: uint8; } const x = new A(); try { x.a = 300; "no"; } catch (e) { "caught"; }')).toBe('caught');
  // Methods and inheritance are undisturbed, and a subclass freezes too.
  expect(evaluated('class A { a: uint8; m() { return 1; } } String(new A().m());')).toBe('1');
  expect(evaluated('class B { a: uint8; } class S extends B { b: uint8; } String(Object.isFrozen(S.prototype)) + "/" + String(Object.isFrozen(B.prototype));')).toBe('true/true');
  // A program cannot add to the prototype afterwards, which is the point.
  expect(evaluated('class A { a: uint8; } try { Object.defineProperty(A.prototype, "z", { value: 1 }); "no"; } catch (e) { "caught"; }')).toBe('caught');
});

test('a partial class still extends a typed class', () => {
  // #sec-partial-classes: a partial declaration "adds behaviour and no cases...
  // and does not change a class's layout", so it is permitted over a typed
  // class - and the two specified features are in tension only at the
  // implementation, where a frozen prototype refuses the DefineOwnProperty a
  // merge is made of. The freeze is against a PROGRAM mutating the prototype
  // after the fact; a partial declaration is part of how the class is declared,
  // spread across modules. The merge therefore lifts the freeze and restores
  // it, evaluating no user code in between.
  expect(evaluated('class C { a: uint8; } partial class C { m() { return 1; } } String(new C().m());')).toBe('1');
  expect(evaluated('class C { a: uint8; } partial class C { m() { return 1; } } String(Object.isFrozen(C.prototype));')).toBe('true');
  expect(evaluated('class C { a: uint8; } partial class C { m() { return 1; } } try { Object.defineProperty(C.prototype, "z", { value: 1 }); "no"; } catch (e) { "caught"; }')).toBe('caught');
});
