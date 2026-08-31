import { test, expect } from 'vitest';
import {
  evaluated, expectThrown, expectStaticTypeError,
} from '../harness.mts';

/**
 * Spec: #sec-decorator-metadata (Decorator Metadata). Design: decorators.md.
 *
 * decorators.md, Metadata Inheritance: "Each member's metadata is inherited
 * through the PROTOTYPE CHAIN ... If B redeclares the field and applies its own
 * decorators, B gets a new metadata object (PROTOTYPICALLY INHERITING FROM A'S)
 * where B's decorators write their values, SHADOWING A'S WITHOUT MUTATING
 * THEM."
 *
 * So a metadata object is an ORDINARY OBJECT whose [[Prototype]] is the base
 * declaration's - which makes "symbol key lookups fall through the prototype"
 * true by construction rather than by a lookup rule written for it. It is also
 * why the metadata channel is a `partial interface` rather than a `partial
 * class`: an instance of a class with a typed field is not extensible and
 * could not be prototypically linked at all.
 */

test('a class context carries a metadata object', () => {
  expect(evaluated('let t = "?"; function f(c) { t = typeof c.metadata; } @f class A {} t;')).toBe('object');
});

test('the object PERSISTS, so decorators of one declaration share it', () => {
  // The object a decorator receives IS the one that persists, not a copy - two
  // decorators on one class see one object, which is what makes metadata a
  // channel rather than a per-call scratch space.
  expect(evaluated('const k = Symbol("k"); function write(c) { c.metadata[k] = "set"; } '
    + 'let seen = "?"; function read(c) { seen = String(c.metadata[k]); } '
    + '@read @write class A {} seen;')).toBe('set');
});

test('a subclass INHERITS its base\'s metadata through the prototype', () => {
  // "If A declares a field with metadata, and B extends A without redeclaring
  // that field, B inherits A's metadata as-is."
  expect(evaluated('const k = Symbol("k"); function base(c) { c.metadata[k] = "A"; } '
    + 'let seen = "?"; function derived(c) { seen = String(c.metadata[k]); } '
    + '@base class A {} @derived class B extends A {} seen;')).toBe('A');
});

test('a subclass SHADOWS without mutating, which is the assertion that matters', () => {
  // A write in B must not reach A. The discriminating form is a THIRD class
  // that also extends A and reads the key: if B's write had mutated A's object,
  // C would see "B". Reading through A itself would be weaker, since an
  // implementation could special-case the base.
  expect(evaluated('const k = Symbol("k"); function base(c) { c.metadata[k] = "A"; } '
    + 'function derived(c) { c.metadata[k] = "B"; } '
    + 'let seen = "?"; function read(c) { seen = String(c.metadata[k]); } '
    + '@base class A {} @derived class B extends A {} @read class C extends A {} seen;')).toBe('A');
  // And B genuinely has its own value, so the shadowing is real rather than the
  // write being dropped.
  expect(evaluated('const k = Symbol("k"); function base(c) { c.metadata[k] = "A"; } '
    + 'let seen = "?"; function derived(c) { c.metadata[k] = "B"; seen = String(c.metadata[k]); } '
    + '@base class A {} @derived class B extends A {} seen;')).toBe('B');
});

test('a class with no base still has a metadata object', () => {
  expect(evaluated('const k = Symbol("k"); let seen = "?"; '
    + 'function f(c) { c.metadata[k] = "own"; seen = String(c.metadata[k]); } @f class A {} seen;')).toBe('own');
  // An unrelated class shares nothing with it.
  expect(evaluated('const k = Symbol("k"); function f(c) { c.metadata[k] = "A"; } '
    + 'let seen = "none"; function g(c) { seen = String(c.metadata[k]); } '
    + '@f class A {} @g class B {} seen;')).toBe('undefined');
});

test('every class-family context carries metadata, and it READS BACK', () => {
  // decorators.md gives `metadata` to every context of the Class, Function,
  // Object and Enum families. The class family is wired here.
  const t = 'let t = "?"; function f(c) { t = typeof c.metadata; } ';
  expect(evaluated(`${t} class A { @f a: uint8 = 1; } t;`)).toBe('object');
  expect(evaluated(`${t} class A { @f m() {} } t;`)).toBe('object');
  expect(evaluated(`${t} class A { @f accessor a: uint8 = 1; } t;`)).toBe('object');

  // `Reflect.getMetadata` reads back what a decorator wrote - THE SAME OBJECT,
  // not a copy, which is what makes metadata a channel rather than a snapshot.
  expect(evaluated('const k = Symbol("k"); function f(c) { c.metadata[k] = "written"; } '
    + '@f class A {} String(Reflect.getMetadata.<Reflect.Class, A>()[k]);')).toBe('written');
  expect(evaluated('const k = Symbol("k"); let seen; function f(c) { seen = c.metadata; } '
    + '@f class A {} String(seen === Reflect.getMetadata.<Reflect.Class, A>());')).toBe('true');
  expect(evaluated('const k = Symbol("k"); function f(c) { c.metadata[k] = "field"; } '
    + 'class A { @f a: uint8 = 1; } String(Reflect.getMetadata.<Reflect.ClassField, A>("a")[k]);')).toBe('field');

  // A MEMBER's metadata is keyed by the CONSTRUCTOR, not by the home object it
  // was defined on - an instance member's home object is the prototype, so
  // storing it there wrote where nothing would read.
  expect(evaluated('const k = Symbol("k"); function f(c) { c.metadata[k] = "A"; } '
    + 'class A { @f a: uint8 = 1; } class B extends A { a: uint8 = 2; } '
    + 'String(Reflect.getMetadata.<Reflect.ClassField, B>("a")[k]);')).toBe('A');
  // And two members do not share one object.
  expect(evaluated('const k = Symbol("k"); function f(c) { c.metadata[k] = "a"; } '
    + 'class A { @f a: uint8 = 1; b: uint8 = 2; } String(Reflect.getMetadata.<Reflect.ClassField, A>("b")[k]);')).toBe('undefined');
  // The untyped call names no context and so names no metadata object.
  expect(evaluated('try { Reflect.getMetadata(); "ACCEPTED"; } catch (e) { e.constructor.name; }')).toBe('TypeError');
});

test('the FUNCTION, OBJECT and ENUM families carry metadata too', () => {
  // decorators.md gives `metadata` to every context of the Class, Function,
  // Object and Enum families. The class family landed first; these three
  // complete it.
  const t = 'let t = "?"; function f(c) { t = typeof c.metadata; } ';
  expect(evaluated(`${t} @f function g() {} t;`)).toBe('object');
  expect(evaluated(`${t} const o = { @f a: 1 }; t;`)).toBe('object');
  expect(evaluated(`${t} const o = { @f m() {} }; t;`)).toBe('object');
  expect(evaluated(`${t} @f enum E { A } t;`)).toBe('object');
  expect(evaluated(`${t} enum E { @f A } t;`)).toBe('object');
});

test('each declaration gets its OWN object, which is what keying is for', () => {
  // Two members of one object literal do not share. "For objects the metadata
  // is on the INSTANCE", so two objects of the same shape do not share either -
  // the case a shape-keyed store would get wrong.
  const write = 'const k = Symbol("k"); function w(c) { c.metadata[k] = "written"; } ';
  const read = 'let seen = "?"; function r(c) { seen = String(c.metadata[k]); } ';
  expect(evaluated(`${write}${read} const o = { @w a: 1, @r b: 2 }; seen;`)).toBe('undefined');
  expect(evaluated(`${write}${read} const o1 = { @w a: 1 }; const o2 = { @r a: 1 }; seen;`)).toBe('undefined');
  // An enum's own metadata is not its enumerator's.
  expect(evaluated(`${write}${read} @w enum E { @r A } seen;`)).toBe('undefined');
  // And a function's is its own.
  expect(evaluated(`${write} let seen2 = "?"; function r2(c) { seen2 = String(c.metadata[k]); } `
    + '@w function g() {} @r2 function h() {} seen2;')).toBe('undefined');
});

test('getMetadata serves every class-family MEMBER context', () => {
  // A declaration is a field or a method or an accessor and never two of them,
  // so every member context reads the same per-declaration store: the context
  // decides the metadata's TYPE and the name decides which object. That is why
  // these need no cases of their own.
  const w = 'const k = Symbol("k"); function f(c) { c.metadata[k] = "v"; } ';
  expect(evaluated(`${w} class A { @f m() {} } String(Reflect.getMetadata.<Reflect.ClassMethod, A>("m")[k]);`)).toBe('v');
  expect(evaluated(`${w} class A { @f accessor v: uint8 = 1; } String(Reflect.getMetadata.<Reflect.ClassAccessor, A>("v")[k]);`)).toBe('v');
  expect(evaluated(`${w} class A { @f get v(): uint8 { return 1; } } String(Reflect.getMetadata.<Reflect.ClassGetter, A>("v")[k]);`)).toBe('v');
  expect(evaluated(`${w} class A { @f set v(x: uint8) {} } String(Reflect.getMetadata.<Reflect.ClassSetter, A>("v")[k]);`)).toBe('v');
  // A context that names no class declaration is refused rather than answered
  // with an empty object.
  expect(evaluated('try { eval("Reflect.getMetadata.<Reflect.Let, uint8>();"); "ACCEPTED"; } catch (e) { e.constructor.name; }')).toBe('TypeError');
});

test('getMetadata reaches the class family only', () => {
  // The Function, Object and Enum families CARRY metadata and cannot be read
  // back through `getMetadata` yet: its target type argument names a class, and
  // a function or an object literal has no such type to name. decorators.md's
  // signatures for those take an instance rather than a type, which is a
  // different interception than the one the class family uses.
  expect(evaluated('const k = Symbol("k"); let seen = "?"; function f(c) { c.metadata[k] = "fn"; seen = String(c.metadata[k]); } '
    + '@f function g() {} seen;')).toBe('fn');
});

// -- The intrinsic metadata interfaces -------------------------------------------

/**
 * proposal-runtime-types #sec-decorator-metadata: the intrinsic metadata
 * interfaces, `%ClassMetadata%`, `%ClassFieldMetadata%`, and one per
 * metadata-carrying context.
 *
 * "A program adds to one by declaring a `partial interface` over it whose
 * members are typed and Symbol-keyed, and the members it adds are the only
 * ones there are: THE INTRINSIC INTERFACES DECLARE NONE."
 *
 * The set is decorators.md's, read off the reflection structures: a context
 * has a metadata interface exactly where its reflection carries a `metadata`
 * member - the Class family (twelve), the Function family (three), the Object
 * family (nine), and the Enum family (two). The design says of the rest, in as
 * many words: "No `getMetadata` overloads exist for `Reflect.Let`,
 * `Reflect.Const`, `Reflect.Tuple`, `Reflect.Record`, or block contexts, as
 * their reflection structures do not carry metadata." `Reflect.Type`'s
 * reflection carries none either.
 */

const names = [
  // The Class family.
  'ClassMetadata', 'ClassFieldMetadata', 'ClassAccessorMetadata',
  'ClassGetterMetadata', 'ClassGetterReturnMetadata', 'ClassSetterMetadata',
  'ClassSetterParameterMetadata', 'ClassMethodMetadata',
  'ClassMethodParameterMetadata', 'ClassMethodReturnMetadata',
  'ClassOperatorMetadata', 'ClassOperatorParameterMetadata',
  // The Function family.
  'FunctionMetadata', 'FunctionParameterMetadata', 'FunctionReturnMetadata',
  // The Object family.
  'ObjectMetadata', 'ObjectFieldMetadata', 'ObjectGetterMetadata',
  'ObjectGetterReturnMetadata', 'ObjectSetterMetadata',
  'ObjectSetterParameterMetadata', 'ObjectMethodMetadata',
  'ObjectMethodParameterMetadata', 'ObjectMethodReturnMetadata',
  // The Enum family.
  'EnumMetadata', 'EnumEnumeratorMetadata',
];

test('all twenty-six metadata interfaces resolve, and to twenty-six types', () => {
  // Every name resolves to a Type Object. The joined report reads as the list,
  // so a missing name fails by NAMING itself rather than by a count.
  const report = names.map((n) => `(typeof ${n})`).join(' + "," + ');
  expect(evaluated(`${report};`)).toBe(names.map(() => 'object').join(','));
  // And they are twenty-six DISTINCT types. Resolution alone passes with all
  // names bound to one interned object, which is the interning mistake this
  // asserts against.
  expect(evaluated(`String(new Set([${names.join(', ')}]).size);`)).toBe('26');
});

test('an intrinsic metadata interface declares nothing', () => {
  // An interface declaring no members admits any object: before a partial has
  // contributed, there is nothing for a value to lack.
  expect(evaluated('let m: ClassMetadata = {}; "admitted";')).toBe('admitted');
  // And it is still an OBJECT type, so a value of the wrong kind is refused.
  // Refused STATICALLY since `PLAN-checker-type-resolution.md stage A` taught the
  // checker the intrinsic names: no partial can make `5` an object, so the kind
  // is decidable from the source text however the shape later completes.
  expectStaticTypeError('let m: ClassMetadata = 5;');
});

test('a partial interface completes an intrinsic, and the members are required', () => {
  // THE ASSERTION THAT MATTERS is the negative, at the
  // intrinsics: `{ b: "x" }` passes whether or not the merge took, so the
  // proof the intrinsic took the same merge path a user interface does is
  // that an object WITHOUT the member is now refused.
  expect(evaluated('partial interface ClassMetadata { b: string; } let v: ClassMetadata = { b: "x" }; "took";')).toBe('took');
  expectThrown('partial interface ClassMetadata { b: string; } let w: ClassMetadata = {};');
  // A member already contributed is a conflict rather than an override, on the
  // intrinsics exactly as on a user interface: the meaning of `%ClassMetadata%`
  // must not depend on load order.
  expectThrown('partial interface ClassMetadata { b: string; } partial interface ClassMetadata { b: uint8; }');
});

test('a partial over one intrinsic leaves its siblings untouched', () => {
  // Twenty-six names, twenty-six types: contributing to `%ClassMetadata%` adds
  // nothing to `%ClassFieldMetadata%`. A shared structure between the records
  // would pass every test above and fail this one.
  expect(evaluated('partial interface ClassMetadata { b: string; } let v: ClassFieldMetadata = {}; "untouched";')).toBe('untouched');
});

test('the contexts whose reflections carry no metadata have no interface', () => {
  // decorators.md: Let, Const, Tuple, Record, and the block contexts "do not
  // carry metadata", and Reflect.Type's reflection has no `metadata` member.
  // The names must therefore NOT exist - an interface here would be surface
  // no document declares.
  const absent = ['TypeMetadata', 'LetMetadata', 'ConstMetadata', 'BlockMetadata', 'TupleMetadata', 'RecordMetadata'];
  const report = absent.map((n) => `(typeof ${n})`).join(' + "," + ');
  expect(evaluated(`${report};`)).toBe(absent.map(() => 'undefined').join(','));
});

test('the names bind as the primitive type names do', () => {
  // #sec-value-types: "the type names are global bindings of their interned
  // Type Objects" - non-writable, so an assignment does not rebind.
  expect(evaluated('ClassMetadata = 5; typeof ClassMetadata;')).toBe('object');
});

test('what bounds a symbol-keyed metadata member', () => {
  // The interface member walk EVALUATES a
  // computed key instead of dropping it, so a Symbol-keyed member is a REAL
  // member: its presence is required, and a second declaration of it is the
  // conflict a string-keyed one is; the Symbol-keyed section below owns those.
  //
  // The checker judges a symbol-keyed member too, by the
  // minted key of the `const` its computed name resolves to. What bounds BOTH
  // key kinds is the checker's reach - a wrong store it cannot see is accepted
  // with a string key as much as a symbol one. See type-universe/literal-types.test.mts
  // and the Symbol-keyed section below.
  const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
  const decl = 'const k = Symbol("k"); partial interface ClassFieldMetadata { [k]: string; } ';
  expect(outcome(`${decl} let m: ClassFieldMetadata = { [k]: "ok" }; m[k] = 5;`)).toBe('StaticTypeError');
  expect(outcome('partial interface ClassFieldMetadata { s: string; } let m: ClassFieldMetadata = { s: "ok" }; m.s = 5;')).toBe('StaticTypeError');
  // 2. The checker now KNOWS the intrinsic names, so a wrong kind is rejected in
  // a never-called function exactly as a user interface's is - the convention
  // this used to be the documented exception to
  // (`PLAN-checker-type-resolution.md stage A`).
  //
  // The reason the exception existed still holds and is still honoured: an
  // intrinsic's SHAPE is completed by whichever partials have evaluated, so a
  // static judgment over the empty declaration must not accept an object a later
  // partial makes insufficient. It does not, because the checker reads a
  // partial-completed record where one exists and this registry answers only for
  // a name no declaration claims. The three shape rows below pin that; only the
  // KIND row moved, and no partial can make `5` an object.
  expectStaticTypeError('function f() { let m: ClassMetadata = 5; }');
  expectStaticTypeError('let m: ClassMetadata = 5;');
  // The shape rules the exception was protecting, unchanged.
  expect(evaluated('let m: ClassMetadata = {}; "admitted";')).toBe('admitted');
  expect(outcome('partial interface ClassMetadata { c: string; } let m: ClassMetadata = {};')).toBe('StaticTypeError');
  expect(outcome('partial interface ClassMetadata { c: string; } let m: ClassMetadata = { c: "x" };')).toBe('ACCEPTED');
});

// -- partial interface -----------------------------------------------------------

/**
 * #sec-decorator-metadata: `partial interface`.
 *
 * A metadata object is extended by declaring a partial interface over it, not a
 * partial class, and the reason is not stylistic.
 * The reason: the decorators extension has a subclass's
 * metadata inherit PROTOTYPICALLY, falling through for a key it does not set and
 * shadowing without mutating for one it does - and an instance of a class with a
 * typed field is NOT EXTENSIBLE, so it cannot be prototypically linked at all.
 * A class-based metadata object could not obey its own inheritance rule.
 *
 * An interface declares the shape and constructs nothing, so the three reasons
 * the partial CLASS clause gives for its restriction - no subclass, no instance
 * state, no change to a layout - all hold of it. That is why the restriction a
 * class needs, an interface does not.
 */

test('a partial interface contributes members to an existing one', () => {
  expect(evaluated('interface I { a: uint8; } partial interface I { b: string; } let v: I = { a: 1, b: "x" }; "accepted";')).toBe('accepted');
  // THE ASSERTION THAT MATTERS: the added member is REQUIRED afterwards. A merge
  // that parsed and did nothing would pass the line above on its own, which is
  // exactly what the first attempt at this did - the members were merged into a
  // new record that interned as a SECOND type, while every type-position
  // reference kept resolving through the original declaration.
  expectThrown('interface I { a: uint8; } partial interface I { b: string; } let w: I = { a: 1 };');
  // The original member is still required too.
  expectThrown('interface I { a: uint8; } partial interface I { b: string; } let x: I = { b: "s" };');
});

test('several partials each contribute, and a redeclared member is refused', () => {
  expect(evaluated('interface D { a: uint8; } partial interface D { b: string; } partial interface D { c: uint8; } '
    + 'let v: D = { a: 1, b: "x", c: 2 }; "accepted";')).toBe('accepted');
  expectThrown('interface D { a: uint8; } partial interface D { b: string; } partial interface D { c: uint8; } let w: D = { a: 1, b: "x" };');
  // A member already declared is a TypeError rather than an override, so the
  // meaning of an interface does not depend on the order its declarations load.
  expectThrown('interface C { a: uint8; } partial interface C { a: string; }');
});

test('the metadata shape it exists for', () => {
  // #sec-decorator-metadata: "a program adds to one by declaring a `partial
  // interface` over it whose members are typed and Symbol-keyed".
  expect(evaluated('const k = Symbol("k"); interface Meta { } partial interface Meta { [k]: string; } "declared";')).toBe('declared');
  // A partial interface binds no name of its own - it extends one someone else
  // bound - so it neither collides nor shadows.
  expect(evaluated('interface N { a: uint8; } partial interface N { b: string; } typeof N;')).toBe('object');
});

// -- Symbol-keyed metadata members -----------------------------------------------

/**
 * Symbol-keyed metadata members.
 *
 * decorators.md adds metadata through `partial interface ClassMetadata {
 * [myMetadata]: string }`, and a SYMBOL key is the collision escape hatch the
 * design gives third-party libraries. The member merged and then vanished: the
 * interface member walk took a literal name and dropped everything else, so a
 * computed key never reached the record - even though a Property Type Record's
 * [[Key]] has been "a String or a Symbol" since it was widened.
 *
 * `[k]: T` is a COMPUTED PROPERTY NAME rather than an index signature - an
 * index signature needs an identifier and a `:` INSIDE the brackets - so the
 * key has to be evaluated.
 */

const outcome = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);

test('a symbol-keyed member is a REAL member of the interface', () => {
  // Its presence is required, which is the observable that says the record
  // received it: before this the declaration merged and left nothing behind, so
  // an empty object satisfied the interface.
  expect(outcome('const k = Symbol("k"); partial interface ClassFieldMetadata { [k]: string; } let m: ClassFieldMetadata = {};')).toBe('TypeError');
  // Supplying it satisfies the interface and round-trips.
  expect(evaluated('const k = Symbol("k"); partial interface ClassFieldMetadata { [k]: string; } let m: ClassFieldMetadata = { [k]: "ok" }; m[k];')).toBe('ok');
  // And an OPTIONAL symbol member is optional, so the marker is carried too.
  expect(evaluated('const k = Symbol("k"); partial interface ClassFieldMetadata { [k]?: string; } let m: ClassFieldMetadata = {}; String(m[k]);')).toBe('undefined');
});

test('symbol IDENTITY is what distinguishes members, not the description', () => {
  // Two symbols of the same description are different keys, so both may be
  // declared - which a description-keyed implementation would have rejected as
  // a duplicate. This is the property that makes a symbol key a collision
  // escape hatch at all.
  expect(outcome('const a = Symbol("x"), b = Symbol("x"); '
    + 'partial interface ClassFieldMetadata { [a]: string; } partial interface ClassFieldMetadata { [b]: string; }')).toBe('ACCEPTED');
  // The SAME symbol twice is the conflict a string-keyed member would be:
  // "two declarations of one member is a conflict rather than a merge".
  expect(outcome('const a = Symbol("x"); '
    + 'partial interface ClassFieldMetadata { [a]: string; } partial interface ClassFieldMetadata { [a]: string; }')).toBe('TypeError');
});

test('a user interface gets the same treatment, not just the intrinsics', () => {
  // The walk is one walk; the metadata intrinsics are ordinary interfaces that
  // a partial happens to target. Worth asserting so the fix is not read as
  // special-casing them.
  expect(outcome('const k = Symbol("k"); interface I { [k]: string; } let m: I = {};')).toBe('TypeError');
  expect(evaluated('const k = Symbol("k"); interface I { [k]: string; } let m: I = { [k]: "ok" }; m[k];')).toBe('ok');
});

test('MEMBERSHIP handles symbol keys; the STATIC CHECKER is what does not', () => {
  // It would be easy to read this as "the structural walk reads string keys
  // only". That is wrong, and the difference matters: the
  // run-time membership judgment reads symbol keys CORRECTLY - it builds a
  // property key from the record's key, string or symbol - and `is` answers
  // both directions for both kinds.
  const S = 'const k = Symbol("k"); interface I { [k]: string; } ';
  expect(evaluated(`${S} String({ [k]: "ok" } is I);`)).toBe('true');
  expect(evaluated(`${S} String({ [k]: 5 } is I);`)).toBe('false');
  expect(evaluated('interface J { s: string; } String({ s: 5 } is J);')).toBe('false');
});

test('interface member types are enforced STATICALLY, and only so - for BOTH key kinds', () => {
  // The refusals this suite reads as "enforcement" are the CHECKER's, and they
  // stop where the checker's view stops - for STRING keys just as much as
  // symbol ones. Through a function parameter, or from a value the checker
  // types as `any`, a wrong store is accepted with either kind of key.
  //
  // So the symbol gap is not "the runtime checks strings and not symbols". It
  // is that the CHECKER cannot judge a symbol-keyed member at all, and that is
  // a design question rather than a missing branch: a symbol's IDENTITY is not
  // statically knowable. Matching by the binding a computed key names would be
  // the tractable rule, and matching by DESCRIPTION would repeat exactly the
  // collision the symbol key exists to prevent - which is why this is left for
  // a decision rather than guessed at here.
  const T = 'interface J { s: string; } ';
  const S = 'const k = Symbol("k"); interface I { [k]: string; } ';
  const outcome2 = (source: string): string => evaluated(`try { eval(${JSON.stringify(source)}); "ACCEPTED"; } catch (e) { e.constructor.name; }`);
  // What the checker sees, it refuses - for a string key.
  expect(outcome2(`${T} let m: J = { s: "ok" }; m.s = 5;`)).toBe('StaticTypeError');
  expect(outcome2(`${T} let m: J = { s: 5 };`)).toBe('StaticTypeError');
  // What it does not see, it does not - ALSO for a string key. This is the
  // assertion that says the gap is the checker's reach and not the key.
  expect(outcome2(`${T} function f(o) { o.s = 5; } let m: J = { s: "ok" }; f(m);`)).toBe('ACCEPTED');
  expect(outcome2(`${T} function g(v) { let m: J = v; return m; } g({ s: 5 });`)).toBe('ACCEPTED');
  // A SYMBOL key is judged wherever a string key is, so what bounds both is
  // the checker's REACH, which is the real boundary.
  expect(outcome2(`${S} let m: I = { [k]: "ok" }; m[k] = 5;`)).toBe('StaticTypeError');
  expect(outcome2(`${S} let m: I = { [k]: 5 };`)).toBe('StaticTypeError');
  expect(outcome2(`${S} function f(o) { o[k] = 5; } let m: I = { [k]: "ok" }; f(m);`)).toBe('ACCEPTED');
});
