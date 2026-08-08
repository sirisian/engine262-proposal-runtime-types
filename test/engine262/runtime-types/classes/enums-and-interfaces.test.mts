import { expect, test } from 'vitest';
import { expectThrownKind } from '../harness.mts';
import { Agent, ManagedRealm, setSurroundingAgent } from '#self';

/**
 * Spec: #sec-enums (Enums), #sec-interfaces-semantics (Interfaces).
 *
 * The runtime side of the two declaration forms: what an enum and an interface
 * evaluate to, how their members are checked and converted, and the operator
 * declarations that ride alongside them.
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

test('enums bind objects with sequential member values', () => {
  expect(evaluated('enum Color { Red, Green, Blue } Color.Red === 0 && Color.Green === 1 && Color.Blue === 2 ? "ok" : "no";')).toBe('ok');
  expect(evaluated('enum E { A, B = 10, C } E.C === 11 ? "ok" : "no";')).toBe('ok');
  expect(evaluated('enum S { A = "a", B } typeof S.A === "string" && S.B === 1 ? "ok" : "no";')).toBe('ok');
});

test('enum membership is SameValue against the members', () => {
  expect(evaluated('enum E { A, B = 10 } (0 is E) && (10 is E) && !(3 is E) ? "ok" : "no";')).toBe('ok');
  // MIGRATED TO STATIC FORM. This asserted a RUNTIME throw, caught by the try -
  // which is what a value outside the enum produced while the checker's enum
  // record carried no member VALUES to compare against. It carries them now, so
  // a non-member is an Early Error the try cannot swallow, and the runtime
  // backstop is asserted beside it through the `any` path where the checker
  // still cannot decide.
  expect(run('enum E { A } let x: E = 5;')).toMatchObject({ Type: 'throw' });
  expect(evaluated('enum E { A } function anyv() { return 5; } try { let x: E = anyv(); "no"; } catch (err) { "caught"; }')).toBe('caught');
  // A member of the enum is accepted, which is the other half of the same rule:
  // membership is SameValue against the members, statically as at run time.
  expect(evaluated('enum E { A, B } let x: E = 1; x === 1 ? "ok" : "no";')).toBe('ok');
  expect(evaluated('enum E { A = 5, B } let x: E = 6; x === 6 ? "ok" : "no";')).toBe('ok');
  expect(evaluated('enum S { A = "a" } let x: S = "a"; x === "a" ? "ok" : "no";')).toBe('ok');
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
  // through the `any` path where the checker cannot decide.
  expect(run('interface I { x: string } let p: I = { x: 300 };')).toMatchObject({ Type: 'throw' });
  // An interface member converts as an object type's does: 300 has a
  // canonical text and reaches `string` losslessly, so it converts rather than
  // failing - the same rule `let s: string = 300` has always followed.
  expect(evaluated('interface I { x: string } function anyv() { return { x: 300 }; } let p: I = anyv(); p.x + "/" + typeof p.x;')).toBe('300/string');
  // A member the type cannot hold is still refused.
  expect(evaluated('interface J { x: uint8 } function anyv() { return { x: 300 }; } try { let p: J = anyv(); "no"; } catch (e) { "caught"; }')).toBe('caught');
});

test('class operators dispatch on binary expressions', () => {
  // #sec-operator-declarations: the receiver is the left
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

test('the two decorator proposals are mutually exclusive', () => {
  // `runtime-types` and `decorators` are COMPETING decorator proposals. They
  // share the `@` grammar and nothing else: TC39's calls a decorator with the
  // `(value, context)` convention and expects a replacement function, while
  // this proposal identifies a decorator by the TYPE of its context parameter,
  // resolves overloads, and replaces by return value. One `@f` on one field
  // cannot mean both, so enabling both is refused at the Agent rather than
  // silently resolved in favour of whichever evaluation path a class happens to
  // take - which is what it was doing, since the two paths disagreed.
  expect(() => new Agent({ features: ['runtime-types', 'decorators'] })).toThrow();
  expect(() => new Agent({ features: ['runtime-types'] })).not.toThrow();
  expect(() => new Agent({ features: ['decorators'] })).not.toThrow();
});

// -- Enumerator values, continuation, and names ----------------------------------

test('an enumerator value passes its underlying type', () => {
  // #sec-enums. The declaration resolved the underlying
  // type and stored it, and nothing checked a value against it - so an enum
  // whose annotation said uint8 accepted 300 and a string, and a program that
  // wrote `enum Flags: uint8` LOOKED checked.
  // Out of range is a RangeError and a wrong kind a TypeError, which is what
  // the same value assigned to a `uint8` field gives - the enumerator passes
  // the boundary rather than a check of its own.
  expectThrownKind('enum E: uint8 { A = 300 } E.A;', 'RangeError');
  expectThrownKind('enum E: uint8 { A = "s" } E.A;', 'TypeError');
  // "The first enumerator, when it has no initializer, takes 0, and it is a
  // type error when the underlying type is not numeric, since a non-numeric
  // enumeration must define its starting value."
  expectThrownKind('enum E: string { A } E.A;', 'TypeError');
  expect(evaluated('enum E: string { A = "x" } String(E.A);')).toBe('x');
  // The values that fit are unchanged.
  expect(evaluated('enum E: uint8 { A, B } String(E.B);')).toBe('1');
  expect(evaluated('enum C: float32 { Zero, One } String(C.One);')).toBe('1');
});

test('an enumerator reports its ENUM as its type and belongs to the underlying one', () => {
  // #sec-enums: "`Reflect.typeOf(Count.Zero)` reports `Count`, by the rule that
  // a value's runtime type is the most specific type of which it is a value.
  // This does not make the enumerator anything other than a value the
  // underlying type also accepts: membership in `int32` follows from `Count`
  // being a subtype of it, not from a second runtime type."
  //
  // Both halves are easy to get wrong in opposite directions. Leaving the
  // underlying type on the converted value made typeOf report `uint8`; tagging
  // the enum without routing membership through the subtype relation made
  // `E.A is uint8` false.
  expect(evaluated('enum E: uint8 { A } String(Reflect.typeOf(E.A) === E);')).toBe('true');
  expect(evaluated('enum E: uint8 { A } String(Reflect.typeOf(E.A) === uint8);')).toBe('false');
  expect(evaluated('enum E: uint8 { A } String(E.A is E);')).toBe('true');
  expect(evaluated('enum E: uint8 { A } String(E.A is uint8);')).toBe('true');
  expect(evaluated('enum D { A } String(Reflect.typeOf(D.A) === D);')).toBe('true');
  expect(evaluated('enum E: uint8 { A, B } let v: uint8 = E.B; String(v);')).toBe('1');
  // The reverse conversion still works, and now compares two values of one
  // type: it converts its argument to the underlying type before looking.
  expect(evaluated('enum E: uint8 { A, B } String(E(1));')).toBe('1');
  expectThrownKind('enum E: uint8 { A, B } E(99);', 'TypeError');
});

test('an enumerator without an initializer continues from the one before', () => {
  // #sec-enums: "A later enumerator with no initializer takes the result of
  // applying the underlying type's prefix increment operator to the one
  // before." Continuing from a COUNTER rather than from the value made an
  // initialized enumerator lose its effect on the next: `{ A = 10, B }`
  // reported 1, because a converted enumerator is a TypedNumberValue and the
  // counter only read the Number case.
  expect(evaluated('enum E: uint8 { A = 10, B, C } String(E.B) + "," + String(E.C);')).toBe('11,12');
  expect(evaluated('enum D { A = 5, B } String(D.B);')).toBe('6');
  // The increment is the underlying type's, so a float32 enum continues by one
  // from a fractional value rather than from the next integer.
  expect(evaluated('enum C: float32 { Zero = 0.5, One } String(C.One);')).toBe('1.5');
  // And continuing past the type's range is the RangeError it would be if
  // written out - which the counter reset had hidden.
  expectThrownKind('enum E: uint8 { A = 255, B } E.B;', 'RangeError');
});

test('an enumerator initialized with a function of two parameters is computed', () => {
  // #sec-enums: such an enumerator "is given the result of calling that function
  // with the enumerator's index and its name as a String, and a following
  // enumerator with no initializer is given the result of calling the most
  // recently given such function with its own index and name, until an
  // initializer replaces it". The function was being converted as a VALUE and
  // refused, so the design's own example did not run.
  expect(evaluated('enum C: float32 { Zero = (index, name) => index * 100, One, Two } String(C.Zero) + "," + String(C.One) + "," + String(C.Two);')).toBe('0,100,200');
  expect(evaluated('enum N: string { A = (i, name) => name, B } String(N.A) + "," + String(N.B);')).toBe('A,B');
  // "an initializer that is not such a function sets its enumerator's value
  // without disturbing the function for those after it"
  expect(evaluated('enum R { A = (i, n) => i * 10, B, C = 7, D } String(R.A) + "," + String(R.B) + "," + String(R.C) + "," + String(R.D);')).toBe('0,10,7,30');
});

test('a non-numeric enum continues by repeating where the type has no increment', () => {
  // #sec-enums: "where the underlying type declares no prefix increment, it
  // takes a value equal to the previous one". Only the FIRST enumerator of a
  // non-numeric enum needs an initializer; refusing every one of them made
  // `enum E: string { A = "x", B }` an error where the clause gives B the value
  // of A.
  expect(evaluated('enum E: string { A = "x", B } String(E.B);')).toBe('x');
  expectThrownKind('enum E: string { A } E.A;', 'TypeError');
});

test('two enumerators of one declaration may not share a name', () => {
  // #sec-enums: "It is a type error if two enumerators of one declaration have
  // the same name." Nothing checked it, so `enum E { A, A }` was accepted and
  // the later enumerator silently won - the same failure the interface
  // duplicate-member check exists to prevent, where the meaning of a
  // declaration depends on which member is read.
  expectThrownKind('enum E { A, A } E.A;', 'TypeError');
  expectThrownKind('enum E { A = 1, B, A = 3 } E.A;', 'TypeError');
  // Distinct names are unaffected, and two enumerators MAY share a value - it is
  // the name that must be unique.
  expect(evaluated('enum E { A, B, C } String(E.C);')).toBe('2');
  expect(evaluated('enum E { A = 1, B = 1 } String(E.B);')).toBe('1');
});
