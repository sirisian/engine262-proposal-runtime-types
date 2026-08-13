import { expect, test } from 'vitest';
import { expectThrown, expectThrownKind } from '../harness.mts';
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
  // An enum with no `: Type` has the underlying type int32, so a string
  // enumeration must say so - and #sec-enums gives `B` a value equal to `A`,
  // "where the underlying type declares no prefix increment", rather than 1.
  expect(evaluated('enum S: string { A = "a", B } typeof S.A === "string" && S.B === S.A ? "ok" : "no";')).toBe('ok');
  expectThrownKind('enum S { A = "a" } S.A;', 'TypeError');
});

test('a bare underlying value is not of the enum type; the enum call is the way in', () => {
  // #sec-enums makes the reverse direction explicit: "calling the enum type
  // with a value of the underlying type returns the enumerator whose value it
  // is, and throws a TypeError when it is not one of them". If a bare 0 were
  // already of type E that conversion would have nothing to validate, and the
  // one-way rule would not be one-way. This is the rule of C#, Rust, and Swift,
  // which the clause names.
  expect(evaluated('enum E { A, B = 10 } !(0 is E) && !(10 is E) && !(3 is E) ? "ok" : "no";')).toBe('ok');
  // What IS of the type: the enumerators, and what the enum call returns.
  expect(evaluated('enum E { A, B = 10 } (E.A is E) && (E.B is E) ? "ok" : "no";')).toBe('ok');
  expect(evaluated('enum E { A, B = 10 } E(10) === E.B ? "ok" : "no";')).toBe('ok');
  expectThrownKind('enum E { A, B = 10 } E(3);', 'TypeError');
  // MIGRATED TO STATIC FORM. This asserted a RUNTIME throw, caught by the try -
  // which is what a value outside the enum produced while the checker's enum
  // record carried no member VALUES to compare against. It carries them now, so
  // a non-member is an Early Error the try cannot swallow, and the runtime
  // backstop is asserted beside it through the `any` path where the checker
  // still cannot decide.
  expect(run('enum E { A } let x: E = 5;')).toMatchObject({ Type: 'throw' });
  expect(evaluated('enum E { A } function anyv() { return 5; } try { let x: E = anyv(); "no"; } catch (err) { "caught"; }')).toBe('caught');
  // An enum-typed binding is initialized by an enumerator or by the enum call,
  // and reads back as its underlying value: the one-way rule again, from the
  // other side.
  expect(evaluated('enum E { A, B } let x: E = E.B; x === 1 ? "ok" : "no";')).toBe('ok');
  expect(evaluated('enum E { A = 5, B } let x: E = E(6); x === 6 ? "ok" : "no";')).toBe('ok');
  expect(evaluated('enum S: string { A = "a" } let x: S = S.A; x === "a" ? "ok" : "no";')).toBe('ok');
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

// -- The one-way subtype rule at a value boundary -------------------------------
//
// #sec-enums: "An enum type is a subtype of its underlying type, so a value of
// an enum type is usable wherever the underlying type is required and no
// conversion is written [...] it is why an enum can be used for arithmetic,
// indexing, and comparison without a cast." The rule has no algorithmic home in
// the clause, so an operand of an enum type is read at its UNDERLYING type
// wherever a numeric type is required.
test('an enum operand is read at its underlying type in arithmetic', () => {
  // The clause's own example: a bitmask index reads directly.
  expect(evaluated('enum Comp { A = 64, B = 96 } String(Comp.B / 32);')).toBe('3');
  expect(evaluated('enum C { Zero, One } String(C.One + 1);')).toBe('2');
  expect(evaluated('enum C { Zero, One } String(C.One * 2);')).toBe('2');
  expect(evaluated('enum C { Zero, One } String(-C.One);')).toBe('-1');
  // Against a value of the underlying type, not only against a literal.
  expect(evaluated('enum C { Zero, One } String(C.One + (1 := int32));')).toBe('2');
  // Relational too - the clause names "arithmetic, bitwise, shift, or
  // relational" as one rule.
  expect(evaluated('enum C { Zero, One, Two } String(C.Two > 1);')).toBe('true');
  // The underlying type is the enum's, not always int32, and its width rules
  // apply: a uint8 enum wraps where uint8 wraps.
  expect(evaluated('enum C: uint8 { Zero, Max = 255 } String(C.Max + (1 := uint8));')).toBe('0');
  expect(evaluated('enum C: float32 { Zero, One, Two } String(C.Two / 2);')).toBe('1');
});

test('the result of enum arithmetic is of the UNDERLYING type, not the enum', () => {
  // An enum's values are exactly its enumerators, so a sum that is not one of
  // them cannot be of the enum type. Reporting it as the enum makes
  // Reflect.typeOf and the membership test contradict each other on one value,
  // and leaves `toString` unable to name what typeOf claims to have.
  const C = 'enum C { Zero, One, Two } ';
  expect(evaluated(`${C}String(Reflect.typeOf(C.One + C.Two) === int32);`)).toBe('true');
  expect(evaluated(`${C}String(Reflect.typeOf(C.One + C.Two) === C);`)).toBe('false');
  expect(evaluated(`${C}String((C.One + C.Two) is C);`)).toBe('false');
});

test('the enum rule does not weaken the operand rule or the enum\'s own identity', () => {
  // #sec-arithmetic-never-promotes still holds of the underlying types: two
  // different widths do not mix just because one of them came from an enum.
  expectThrownKind('enum C: uint8 { Zero, One } C.One + (1 := uint16);', 'TypeError');
  // And an enumerator is still a value of its enum: the decay is a reading at a
  // value boundary, not a change to what the value IS.
  const C = 'enum C { Zero, One } ';
  expect(evaluated(`${C}String(Reflect.typeOf(C.One) === C);`)).toBe('true');
  expect(evaluated(`${C}String(C.One is C);`)).toBe('true');
  expect(evaluated(`${C}String(C.One is int32);`)).toBe('true');
  expect(evaluated(`${C}String(C.toString(C.One));`)).toBe('One');
  // A switch over an enum still dispatches on the enumerators.
  expect(evaluated(`${C}let r = "x"; switch (C.One) { case C.Zero: r = "z"; break; case C.One: r = "o"; break; } r;`)).toBe('o');
});

// -- The underlying type may be any type ---------------------------------------
//
// #sec-enums: "Any type may be an underlying type, including a function type and
// `symbol`." The sequence rule is stated over the type rather than over numbers:
// a later enumerator with no initializer "takes the result of applying the
// underlying type's prefix increment operator to the previous enumerator's
// value [...] where the underlying type declares no prefix increment, it takes a
// value equal to the previous one."
test('an enum over symbol, and a type with no prefix increment repeats', () => {
  expect(evaluated('enum S: symbol { A = Symbol("a"), B = Symbol("b") } typeof S.A;')).toBe('symbol');
  // `symbol` declares no prefix increment, so B equals A rather than erroring.
  expect(evaluated('enum S: symbol { A = Symbol("a"), B } String(S.B === S.A);')).toBe('true');
});

test('an enum over a function type holds callable enumerators', () => {
  const F = 'type F = (float32) => float32; ';
  expect(evaluated(`${F}enum C: F { Zero = x => 0, One = x => x } typeof C.Zero;`)).toBe('function');
  expect(evaluated(`${F}enum C: F { Zero = x => 0, One = x => x } String(Number(C.One(5)));`)).toBe('5');
});

test('an enum over string takes sequential functions, and needs a starting value', () => {
  // The design document's own example, including the rule that a sequential
  // function applies to every following enumerator until an initializer replaces
  // it, and that a non-numeric enumeration must define its starting value.
  expect(evaluated('enum S: string { Zero = (i, n) => n, One, Two = (i, n) => n.toLowerCase(), Three } '
    + 'S.Zero + "," + S.One + "," + S.Two + "," + S.Three;')).toBe('Zero,One,two,three');
  expectThrownKind('enum S: string { A } S.A;', 'TypeError');
  // `string` has no prefix increment either, so an explicit start repeats.
  expect(evaluated('enum S: string { A = "x", B } String(S.B === S.A);')).toBe('true');
});

test('a later enumerator applies the underlying type\'s prefix increment', () => {
  // #sec-enums: a later enumerator with no initializer "takes the result of
  // applying the underlying type's prefix increment operator `operator++` to the
  // previous enumerator's value, with the previous enumerator itself
  // unmodified". The rule is stated over the TYPE, so it reaches every type that
  // declares one - not only the Number family.
  expect(evaluated('enum B: bigint { A = 1n, B, C } String(B.C);')).toBe('3');
  // The design document's own example: a user-defined operator++ on the class
  // the enumeration is over.
  const A = 'class A { constructor(v) { this.v = v; } operator++() { return new A(this.v + 1); } } ';
  expect(evaluated(`${A}enum E: A { Zero = new A(0), One, Two } String(E.Two.v);`)).toBe('2');
  // "with the previous enumerator itself unmodified" - the operator returns a
  // new value rather than mutating the one it is given.
  expect(evaluated(`${A}enum E: A { Zero = new A(0), One } String(E.Zero.v);`)).toBe('0');
});

test('the underlying type\'s range and precision are the enum\'s', () => {
  // A signed type carries negative enumerators and continues through zero.
  expect(evaluated('enum N: int8 { Neg = -128, Next } String(N.Next);')).toBe('-127');
  // Continuing past the type's range is the RangeError writing the value would
  // be.
  expectThrownKind('enum U: uint8 { A = 255, B } U.B;', 'RangeError');
  // A binary float continues by one from a fractional value rather than from
  // the next integer.
  expect(evaluated('enum F: float32 { A = 0.5, B } String(F.B);')).toBe('1.5');
  // And an explicit bigint enumeration holds bigints.
  expect(evaluated('enum B: bigint { A = 1n, B = 2n } String(B.B);')).toBe('2');
});

test('an enumerator initializer meets the underlying type, as an annotated binding does', () => {
  // #sec-enums: an enumerator's value is a value of the underlying type, so its
  // initializer stands in a position of that type and a literal there takes it -
  // #sec-literal-propagation's rule, which nothing applied here because the
  // checker never gave the initializers a contextual type.
  //
  // A decimal is where it shows: the type "reads its cohort member from the
  // SOURCE TEXT rather than from the mathematical value, since 1.0 and 1.00 have
  // the same mathematical value", and by evaluation time a literal is a double,
  // so a decimal enumeration could not be written at all.
  expect(evaluated('enum D: decimal64 { A = 1.5 } String(D.A);')).toBe('1.5');
  expect(evaluated('enum D: decimal32 { A = 2.5 } String(D.A);')).toBe('2.5');
  expect(evaluated('enum D: decimal64 { A = 1 } String(D.A);')).toBe('1');
  // The cohort member survives, which is the whole reason the literal has to be
  // read at the type rather than converted to it.
  expect(evaluated('enum D: decimal64 { A = 1.00 } String(D.A);')).toBe('1.00');
  // A bigint enumerator takes a plain integer literal for the same reason a
  // `let x: bigint = 65` does: "where a type is written it carries no
  // information the annotation does not".
  expect(evaluated('enum B: bigint { A = 1, B = 2 } String(B.B);')).toBe('2');
});

test('the sequence step is taken IN the underlying type, not through a Number', () => {
  // A decimal declares a prefix increment, but the value it produces cannot be
  // reached through a double - converting one to a decimal is refused for the
  // cohort reason above. So the step adds the decimal one at the previous
  // enumerator's own width, and the cohort carries through the sequence.
  expect(evaluated('enum D: decimal64 { A = 1.0, B, C } String(D.C);')).toBe('3.0');
  expect(evaluated('enum D: decimal64 { A = 1.00, B } String(D.B);')).toBe('2.00');
  expect(evaluated('enum D: decimal32 { A = 2.5, B } String(D.B);')).toBe('3.5');
  // The result is a value of the underlying type, and the enum call finds it.
  expect(evaluated('enum D: decimal64 { A = 1.0, B } String(D.B is decimal64);')).toBe('true');
  expect(evaluated('enum D: decimal64 { A = 1.0, B } String(D(D.B) === D.B);')).toBe('true');
});
test('two enumerators of one declaration may not share a name', () => {
  expectThrownKind('enum E { A, A } E.A;', 'TypeError');
});

// -- Enums against the rest of the language -------------------------------------

test('an enum\'s enumerator NAMES are reached through `keyof typeof`', () => {
  // `keyof T` is the key set of a VALUE of T, and a value of an enum type is a
  // value of the underlying type, which has no keys - so `keyof C` is the error
  // `keyof uint8` is, and enums are not singled out. The member names are
  // properties of the enum OBJECT, and `typeof` names that object's type. This
  // is the line TypeScript draws, where `keyof Color` gives a number's methods
  // and `keyof typeof Color` gives the names.
  const C = 'enum C { Zero, One } ';
  expect(evaluated(`${C}type K = keyof typeof C; String(("Zero" is K) && ("One" is K));`)).toBe('true');
  expect(evaluated(`${C}type K = keyof typeof C; String("Nope" is K);`)).toBe('false');
  // The parenthesized and two-step spellings agree with it.
  expect(evaluated(`${C}type K = keyof (typeof C); String("Zero" is K);`)).toBe('true');
  expect(evaluated(`${C}type T = typeof C; type K = keyof T; String("Zero" is K);`)).toBe('true');
});

// -- An enumerator belongs to ITS enum ------------------------------------------
//
// #sec-enums: an enum is "a ~nominal~ type whose values are its enumerators",
// and "Reflect.typeOf(Count.Zero) reports Count". Both are claims about the
// VALUE, and only a Number-family enumerator carried its enum: every other kind
// was stored as the bare underlying value, so membership compared CONTENT and
// could not tell one declaration's value from another's.
test('two enums over one underlying type do not share their values', () => {
  const pairs = [
    ['enum A: string { X = "s" } enum B: string { Y = "s" } ', 'string'],
    ['enum A: bigint { X = 1n } enum B: bigint { Y = 1n } ', 'bigint'],
    ['enum A: decimal64 { X = 1.0 } enum B: decimal64 { Y = 1.0 } ', 'decimal64'],
    ['enum A { X } enum B { Y } ', 'int32 (the control - correct before this)'],
  ];
  for (const [decl, what] of pairs) {
    expect(evaluated(`${decl}String(A.X is B);`), what).toBe('false');
    expect(evaluated(`${decl}String(A.X is A);`), what).toBe('true');
  }
});

test('the three consequences of sharing, each refused', () => {
  const S = 'enum A: string { X = "s" } enum B: string { Y = "s" } ';
  // A B-typed parameter took an A value.
  expectThrown(`${S}function f(v: B) { return "took"; } f(A.X);`);
  // A switch over B selected on one.
  expect(evaluated(`${S}function f(b: B) { switch (b) { case B.Y: return "y"; } return "none"; } `
    + 'let r = "no"; try { r = f(A.X); } catch (e) { r = "refused"; } r;')).toBe('refused');
  // And its runtime type was the underlying one rather than the enum.
  expect(evaluated(`${S}String(Reflect.typeOf(A.X) === A);`)).toBe('true');
});

test('an enumerator reports its enum whatever the underlying type', () => {
  expect(evaluated('enum S: string { A = "x" } String(Reflect.typeOf(S.A) === S);')).toBe('true');
  expect(evaluated('enum B: bigint { A = 1n } String(Reflect.typeOf(B.A) === B);')).toBe('true');
  expect(evaluated('enum D: decimal64 { A = 1.0 } String(Reflect.typeOf(D.A) === D);')).toBe('true');
  expect(evaluated('enum N { Zero } String(Reflect.typeOf(N.Zero) === N);')).toBe('true');
  // And membership in the underlying type still follows from the subtype
  // relation rather than from a second runtime type.
  expect(evaluated('enum B: bigint { A = 1n } String(B.A is bigint);')).toBe('true');
});

test('the one-way rule now holds for every underlying type', () => {
  // #sec-enums makes the reverse direction explicit, and it was only ever
  // enforced for the Number family: a bare "x" was of the enum type, where a
  // bare 0 was not.
  expect(evaluated('enum S: string { A = "x" } String("x" is S);')).toBe('false');
  expect(evaluated('enum B: bigint { A = 1n } String(1n is B);')).toBe('false');
  expect(evaluated('enum N { Zero } String(0 is N);')).toBe('false');
  // The enum call remains the way in, for each of them.
  expect(evaluated('enum S: string { A = "x" } String(S("x") === S.A);')).toBe('true');
  expect(evaluated('enum B: bigint { A = 1n } String(B(1n) === B.A);')).toBe('true');
});

test('carrying the enum leaves the value usable as its underlying type', () => {
  // Each carrier is a SUBCLASS or a fresh instance rather than a wrapper, so the
  // one-way subtype rule is untouched: the value compares, keys, interpolates,
  // and serializes as what it is.
  expect(evaluated('enum S: string { A = "x" } String(S.A === "x");')).toBe('true');
  expect(evaluated('enum B: bigint { A = 1n } String(B.A === 1n);')).toBe('true');
  expect(evaluated('enum D: decimal64 { A = 1.0 } String(D.A === decimal64("1.0"));')).toBe('true');
  expect(evaluated('enum S: string { A = "k" } const o = {}; o[S.A] = 1; String(o.k);')).toBe('1');
  expect(evaluated('enum S: string { A = "x" } S.toString(S.A);')).toBe('A');
  expect(evaluated('enum S: string { A = "x" } type T = { s: S }; '
    + 'let o = JSON.parse.<T>(\'{"s":"x"}\'); String(o.s === S.A);')).toBe('true');
  expect(evaluated('enum S: string { A = "x", B = "y" } let r = "no"; '
    + 'switch (S.B) { case S.A: r = "a"; break; case S.B: r = "b"; break; } r;')).toBe('b');
});

// -- An underlying type whose values carry their own identity -------------------
//
// A symbol, a class instance, and a function are compared by IDENTITY, so an
// enumerator of an enum over one of them IS the value the program wrote. That is
// what keeps `A.X === k`, `A.X.v`, and `A.X instanceof K` true - and it is also
// why the enum cannot be carried on the value: one object, two enums, one slot.
// The claim is recorded outside the value, and a value may be claimed once.
test('a value may be an enumerator of at most one enum', () => {
  const K = 'class K { constructor(v) { this.v = v; } } ';
  expectThrownKind(`${K}const k = new K(1); enum A: K { X = k } enum B: K { Y = k } "ran";`, 'TypeError');
  expectThrownKind('const s = Symbol("s"); enum A: symbol { X = s } enum B: symbol { Y = s } "ran";', 'TypeError');
  expectThrownKind('type F = (uint8) => uint8; const g = (x) => x; '
    + 'enum A: F { X = g } enum B: F { Y = g } "ran";', 'TypeError');
  // A distinct value per enum is the ordinary way to write it, and is unaffected.
  expect(evaluated(`${K}enum A: K { X = new K(1) } enum B: K { Y = new K(1) } String(A.X is B);`)).toBe('false');
  // Two enumerators of ONE declaration may share a value, as they may for any
  // other underlying type.
  expect(evaluated(`${K}const k = new K(1); enum A: K { X = k, Y = k } String(A.X === A.Y);`)).toBe('true');
});

test('a claim reaches the realms of its agent, and no further', () => {
  // The claim is held on the AGENT. A value two realms of one agent can both
  // name - a well-known symbol is the reachable case - must have one answer from
  // Reflect.typeOf, so the claim reaches across them. It must not reach further:
  // two agents share no value a program can observe, and holding the table at
  // module scope made a claim in one of them refuse the declaration in the other,
  // so two unrelated embeddings interfered.
  //
  // Each `evaluated` call runs in its own Agent, which is what makes the first
  // two lines a test at all.
  expect(evaluated('enum A: symbol { X = Symbol.iterator } "ok";')).toBe('ok');
  expect(evaluated('enum B: symbol { Y = Symbol.iterator } "ok";')).toBe('ok');
  // A fresh symbol is distinct per realm and was never affected - the control.
  expect(evaluated('const s = Symbol("s"); enum A: symbol { X = s } "ok";')).toBe('ok');
  expect(evaluated('const s = Symbol("s"); enum B: symbol { Y = s } "ok";')).toBe('ok');

  // Within ONE agent, two realms may not both claim one value. Written against
  // the Agent directly, since the helper above makes a fresh agent per call.
  setSurroundingAgent(new Agent({ features: ['runtime-types'] }));
  const first = new ManagedRealm();
  expect(first.evaluateScriptSkipDebugger('enum C: symbol { X = Symbol.iterator } "ok";'))
    .toMatchObject({ Type: 'normal' });
  const second = new ManagedRealm();
  expect(second.evaluateScriptSkipDebugger('enum D: symbol { Y = Symbol.iterator } "ok";'))
    .toMatchObject({ Type: 'throw' });
});

test('the reverse conversion is by value, for every underlying type', () => {
  // #sec-enums: "calling the enum type with a value of the underlying type
  // returns the enumerator whose value it is, and throws a TypeError when it is
  // not one of them". That is deliberately BY VALUE, and it has to keep working
  // now that an enumerator carries its enum or is claimed by it - the call
  // compares what the values hold, and returns the MEMBER, so the result carries
  // the enum rather than being the bare argument.
  expect(evaluated('enum N { Zero, One } String(N(1) === N.One);')).toBe('true');
  expect(evaluated('enum S: string { A = "x" } String(S("x") === S.A);')).toBe('true');
  expect(evaluated('enum B: bigint { A = 1n } String(B(1n) === B.A);')).toBe('true');
  expect(evaluated('enum D: decimal64 { A = 1.0 } String(D(decimal64("1.0")) === D.A);')).toBe('true');
  expect(evaluated('const s = Symbol("s"); enum Y: symbol { A = s } String(Y(s) === Y.A);')).toBe('true');
  expect(evaluated('class K {} const k = new K(); enum A: K { X = k } String(A(k) === A.X);')).toBe('true');
  expect(evaluated('type F = (uint8) => uint8; const g = (x) => x; enum A: F { X = g } '
    + 'String(A(g) === A.X);')).toBe('true');
  // The result is the enumerator, so it reports the enum.
  expect(evaluated('enum S: string { A = "x" } String(Reflect.typeOf(S("x")) === S);')).toBe('true');
  // A value matching no enumerator is a TypeError, per family.
  expectThrownKind('enum N { Zero } N(5);', 'TypeError');
  expectThrownKind('enum S: string { A = "x" } S("z");', 'TypeError');
  expectThrownKind('const s = Symbol("s"); enum Y: symbol { A = s } Y(Symbol("t"));', 'TypeError');
  expectThrownKind('class K {} enum A: K { X = new K() } A(new K());', 'TypeError');
});

// -- What a declaration may claim -----------------------------------------------
//
// These pin a DECISION rather than a law. The rule is stated over values, not
// over the form of an initializer: an initializer that constructs its value
// cannot conflict, but one that calls a factory to construct it is equally
// sound, and no syntactic test separates the two. So a declaration may claim a
// value the program obtained elsewhere, including a shared or built-in one. If
// the clause is ever narrowed to restrict that, these are the tests that change.
test('a declaration may claim a value the program obtained elsewhere', () => {
  expect(evaluated('enum A: any { X = Math } String(Reflect.typeOf(Math) === A);')).toBe('true');
  expect(evaluated('enum A: any { X = uint8 } String(Reflect.typeOf(uint8) === A);')).toBe('true');
  expect(evaluated('enum A: symbol { X = Symbol.iterator } '
    + 'String(Reflect.typeOf(Symbol.iterator) === A);')).toBe('true');
  expect(evaluated('class K {} enum A: any { X = K } String(Reflect.typeOf(K) === A);')).toBe('true');
});

test('claiming a value changes nothing but the type reported for it', () => {
  // Bounded by the subtype rule rather than by luck: an enum is a subtype of its
  // underlying type, so a claimed value stays assignable everywhere it was.
  // Overload resolution is the case most likely to break, since it types its
  // arguments through RuntimeTypeOf.
  const K = 'class K { constructor(v) { this.v = v; } } const k = new K(1); ';
  const OV = 'function f(x: K): string { return "K"; } function f(x: string): string { return "s"; } ';
  expect(evaluated(`${K}${OV}f(k);`)).toBe('K');
  expect(evaluated(`${K}enum A: K { X = k } ${OV}f(k);`)).toBe('K');
  // Iteration still works once Symbol.iterator is an enumerator.
  expect(evaluated('enum A: symbol { X = Symbol.iterator } const a = [1, 2]; String([...a].length);')).toBe('2');
  // A claimed Type Object still annotates, still interns, and still reflects -
  // getReflection reads the Type Object's own record rather than RuntimeTypeOf.
  expect(evaluated('enum A: any { X = uint8 } let v: uint8 = 1; String(v);')).toBe('1');
  expect(evaluated('enum A: any { X = uint8 } String(uint8 === (type uint8));')).toBe('true');
  expect(evaluated('enum A: any { X = uint8 } Reflect.getReflection(uint8).kind;')).toBe('primitive');
  // And a claimed object still satisfies a structural parameter.
  expect(evaluated('const o = { a: (1 := uint8) }; enum A: any { X = o } type O = { a: uint8 }; '
    + 'function g(x: O): string { return "O"; } g(o);')).toBe('O');
});

test('an identity-compared enumerator reports its enum, and stays itself', () => {
  const K = 'class K { constructor(v) { this.v = v; } } const k = new K(7); enum A: K { X = k } ';
  expect(evaluated(`${K}String(Reflect.typeOf(A.X) === A);`)).toBe('true');
  expect(evaluated(`${K}String(A.X is A);`)).toBe('true');
  // The reason the claim is held outside the value rather than on it: a wrapper
  // would cost all three of these.
  expect(evaluated(`${K}String(A.X === k);`)).toBe('true');
  expect(evaluated(`${K}String(A.X.v);`)).toBe('7');
  expect(evaluated(`${K}String(A.X instanceof K);`)).toBe('true');
  // A symbol and a function keep their identity for the same reason.
  expect(evaluated('const s = Symbol("s"); enum Y: symbol { A = s } String(Y.A === s);')).toBe('true');
  expect(evaluated('type F = (uint8) => uint8; const g = (x) => x; enum A: F { X = g } '
    + 'String(Number(A.X(5)));')).toBe('5');
  // And the reverse conversion still finds it.
  expect(evaluated(`${K}String(A(k) === A.X);`)).toBe('true');
});

test('claiming a value changes what the ORIGINAL binding reports', () => {
  // The surprising consequence, asserted rather than left to be discovered.
  // Because the enumerator IS `k`, declaring the enum makes `k` an enumerator of
  // it - so #sec-runtimetypeof's "the most specific type of which it is a value"
  // answers with the enum for the binding the program already had. Nothing was
  // copied or replaced; the same value simply has a more specific type than it
  // did on the line above.
  const K = 'class K { constructor(v) { this.v = v; } } const k = new K(1); ';
  expect(evaluated(`${K}String(Reflect.typeOf(k) === (type K));`)).toBe('true');
  expect(evaluated(`${K}enum A: K { X = k } String(Reflect.typeOf(k) === A);`)).toBe('true');
});

test('an enumerator keys a Map and a Set by its own identity', () => {
  // An enumerator is a value of the enum, so it keys by that - and a raw value
  // of the underlying type is a different key, which is the one-way rule showing
  // up where it is easiest to trip over.
  const C = 'enum C { Zero, One } ';
  expect(evaluated(`${C}const m = new Map(); m.set(C.One, "x"); m.get(C.One);`)).toBe('x');
  expect(evaluated(`${C}const m = new Map(); m.set(C.One, "x"); String(m.get(1));`)).toBe('undefined');
  expect(evaluated(`${C}const s = new Set([C.Zero, C.One, C.Zero]); String(s.size);`)).toBe('2');
});

test('an enum types a class field, and lays out as its underlying type', () => {
  expect(evaluated('enum C { Zero, One } class K { c: C = C.One; } String(new K().c === 1);')).toBe('true');
  // #sec-memory-layout: the field costs what the underlying type costs.
  expect(evaluated('enum C: uint8 { Zero } class K { c: C; } String((type K).byteLength);')).toBe('1');
  expect(evaluated('enum C: uint32 { Zero } class K { c: C; } String((type K).byteLength);')).toBe('4');
});

test('an enum types an array element, and a bare literal does not reach it', () => {
  const C = 'enum C { Zero, One } ';
  expect(evaluated(`${C}let a: [].<C> = [C.Zero, C.One]; String(a[1] is C);`)).toBe('true');
  // The element boundary is the binding boundary: a literal is not of the enum
  // type, so an array of them is refused rather than silently converted.
  expectThrown(`${C}let a: [].<C> = [0, 1];`);
});

test('an enum reaches generics, unions, and narrowing', () => {
  const C = 'enum C { Zero, One } ';
  expect(evaluated(`${C}function id<T>(x: T): T { return x; } String(id.<C>(C.One) === C.One);`)).toBe('true');
  // In a union, `is` narrows to the enum arm.
  expect(evaluated(`${C}function f(x: C | string) { if (x is C) { return "enum"; } return "str"; } f(C.One);`)).toBe('enum');
  expect(evaluated(`${C}function f(x: C | string) { if (x is C) { return "enum"; } return "str"; } f("s");`)).toBe('str');
  // And an enumerator is a legal match subject and pattern.
  expect(evaluated(`${C}match (C.One) { when C.One: "one"; default: "other"; }`)).toBe('one');
});

test('the enumeration surface iterates in declaration order', () => {
  const C = 'enum C { Zero, One } ';
  // @@iterator is `entries`, which is what a `for..of` over the enum yields.
  expect(evaluated(`${C}let out = ""; for (const [k, v] of C) { out += k + "=" + v + ";"; } out;`)).toBe('Zero=0;One=1;');
  expect(evaluated(`${C}[...C.values()].join("|");`)).toBe('0|1');
  expect(evaluated(`${C}[...C.keys()].join("|");`)).toBe('Zero|One');
});

// sec-enums: an enum whose underlying type is ordered is itself ordered,
// "everywhere ordering applies". A `string` underlying type orders by
// DECLARATION POSITION, "because a sequence of named steps like time units or
// severities is meant to compare in the order it's written, not alphabetically".
//
// It compared alphabetically, inverting the rule. The type comes from the
// enumerator being a TypedStringValue carrying its record - NOT from the enum
// registry, which is keyed on object identity and does not hold string
// enumerators; an attempt through it found nothing and failed silently.

test('a string enum compares by declaration position', () => {
  // "z" before "a" by declaration, which is the reverse of alphabetical - an
  // enum whose values happened to be alphabetical would prove nothing.
  const S = 'enum S: string { Alpha = "z", Beta = "a" } ';
  expect(evaluated(`${S}String(S.Alpha < S.Beta);`)).toBe('true');
  expect(evaluated(`${S}String(S.Beta < S.Alpha);`)).toBe('false');
  expect(evaluated(`${S}String(S.Beta > S.Alpha);`)).toBe('true');
  expect(evaluated(`${S}String(S.Alpha <= S.Alpha);`)).toBe('true');
  // A numeric enum was already correct and is untouched.
  expect(evaluated('enum L: uint8 { Low, High } String(L.Low < L.High);')).toBe('true');
});

test('the ordering reaches only enumerators of one enum', () => {
  const S = 'enum S: string { Alpha = "z", Beta = "a" } ';
  // Bare strings keep the ordinary comparison.
  expect(evaluated('String("a" < "z");')).toBe('true');
  // An enumerator against a bare string has no single declaration order.
  expect(evaluated(`${S}String(S.Alpha < "zz");`)).toBe('true');
  // Two different enums likewise.
  expect(evaluated('enum A: string { X = "b" } enum B: string { Y = "a" } String(A.X < B.Y);')).toBe('false');
});
