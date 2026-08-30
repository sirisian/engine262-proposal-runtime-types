import { expect, test } from 'vitest';
import { evaluated, ok, run } from '../harness.mts';

/**
 * Spec: #sec-literal-freshness, #sec-type-members, #sec-partial-declarations,
 * #sec-type-references, #sec-composite-types.
 *
 * Regression rows for the object-literal and interface defects closed in the
 * D66-D83 sequence. Each row is the shortest program that distinguished the
 * defect from its correct neighbour, and most are paired: an accepted row is
 * worthless without the wrong-value twin that proves the check ran.
 *
 * `ok(...)` wraps the program in `if (false) { ... }`, so it reports the STATIC
 * verdict alone - a refusal proves checking occurred where a throw would not.
 */

/** The static verdict, with the program never executed. */
function accepts(source: string): boolean {
  return ok(`if (false) { ${source} } 1;`);
}

/**
 * Whether a program is REJECTED at all, statically or at the run time.
 *
 * Some of these rules are enforced at the run-time boundary rather than by the
 * checking pass - D69's unresolvable member types are reported where the
 * interface is evaluated, and an unbound type parameter reaches a binding
 * lookup - so `accepts` above, which never executes the program, cannot see
 * them. Where the row is about a rule holding AT ALL, this is the honest test.
 */
function rejects(source: string): boolean {
  if (!ok(`if (false) { ${source} } 1;`)) {
    return true;
  }
  return (run(`${source} 1;`) as { Type: string }).Type === 'throw';
}

test('a method in an object type is checked, and its type parameters are in scope', () => {
  // D66: an object type written with method shorthand checked nothing.
  expect(accepts('let p: { m(): uint8 } = { m() { return (1 := uint8); } };')).toBe(true);
  expect(accepts('let p: { m(): uint8 } = { m: "s" };')).toBe(false);
  // D64 row 11: a missing method member.
  expect(accepts('let p: { m(): uint8 } = { };')).toBe(false);

  // D71's shape half: a METHOD written in shorthand made the literal's whole
  // shape null, so NOTHING about it was checked - not the method, and not its
  // siblings. Every row below was accepted before.
  expect(accepts('let p: { m(): uint8 } = { m() { return (1 := uint8); }, u: "s" };')).toBe(false);
  expect(accepts('let p: { m(): uint8, n: uint8 } = { m() { return (1 := uint8); } };')).toBe(false);
  expect(accepts('let p: { m(): uint8, n: uint8 } = { m() { return (1 := uint8); }, n: "s" };')).toBe(false);
  // ...while a correct literal, and a sibling that ADAPTS, still pass.
  expect(accepts('let p: { m(): uint8 } = { m() { return (1 := uint8); } };')).toBe(true);
  expect(accepts('let p: { m(): uint8, n: uint8 } = { m() { return (1 := uint8); }, n: 1 };')).toBe(true);

  // D71's body half: an UNANNOTATED method body's return, taken from the member
  // the target declares. `enterFunction` enforced a return only where one was
  // WRITTEN, so this escaped while the annotated, arrow and standalone
  // spellings were all refused.
  expect(accepts('let p: { m(): uint8 } = { m() { return "s"; } };')).toBe(false);
  expect(accepts('let p: { m(): uint8 } = { m() { return (1 := uint8); } };')).toBe(true);
  expect(accepts('let p: { m(): uint8 } = { m() { return 1; } };')).toBe(true);
  expect(accepts('let p: { m(): void } = { m() { } };')).toBe(true);
  // ...and the three spellings that already worked must keep working.
  expect(accepts('let p: { m(): uint8 } = { m(): uint8 { return "s"; } };')).toBe(false);
  expect(accepts('let p: { m: () => uint8 } = { m: () => "s" };')).toBe(false);
  expect(accepts('class C { m(): uint8 { return "s"; } }')).toBe(false);
  // A method with NO contextual type is not constrained by this.
  expect(accepts('let p = { m() { return "s"; } };')).toBe(true);

  // ...at an INTERFACE target too: a nominal carries its members on
  // [[Structure]], so reading [[Properties]] alone found nothing and every
  // member of a literal at an interface went unadapted.
  expect(accepts('interface I { m(): uint8; } let p: I = { m() { return "s"; } };')).toBe(false);
  expect(accepts('interface I { m(): uint8; } let p: I = { m() { return (1 := uint8); } };')).toBe(true);
  expect(accepts('interface I { n: uint8 } let p: I = { n: 1 };')).toBe(true);
  // A PARAMETERISED nominal's structure is unsubstituted, so its members must be
  // substituted before comparison - `Box<T>` carries `T`, not the argument.
  expect(accepts('interface Box<T> { get(): T; } let b: Box.<uint8> = { get() { return (1 := uint8); } };')).toBe(true);
  expect(accepts('interface Box<T> { get(): T; } let b: Box.<uint8> = { get() { return "s"; } };')).toBe(false);
  expect(accepts('interface I<T> { n: T } let c: I.<uint8> = { n: "s" };')).toBe(false);

  // ...and a METHOD's key is compared like any other. `checkObjectLiteralAgainst`
  // skipped every non-PropertyDefinition, so an intersection of CONFLICTING
  // method arms accepted a literal where the DATA and ARROW spellings refused.
  expect(accepts('let c: { m(): int32 } & { m(): string } = { m() { return (1 := int32); } };')).toBe(false);
  expect(accepts('let c: { m(): int32 } & { m(): string } = { m() { return "s"; } };')).toBe(false);
  expect(accepts('let c: { m: () => int32 } & { m: () => string } = { m: () => (1 := int32) };')).toBe(false);
  // ...while AGREEING arms and a non-overlapping method still pass.
  expect(accepts('let c: { m(): int32 } & { m(): int32 } = { m() { return (1 := int32); } };')).toBe(true);
  expect(accepts('let c: { m(): int32 } & { n: int32 } = { m() { return (1 := int32); }, n: 1 };')).toBe(true);

  // D67: an interface with a method reaches an object type, both readonly.
  expect(accepts(`interface S { m(): uint8; }
    let s: S = { m() { return (0 := uint8); } };
    let o: { m(): uint8 } = s;`)).toBe(true);

  // D68: a method's OWN type parameters are in scope across its signature.
  expect(accepts('type G = { m<T>(v: T): T };')).toBe(true);
  expect(accepts('type G = { m<A, B>(a: A, b: B): A };')).toBe(true);
  // ...and nowhere else: a sibling member naming `T` is still unbound.
  expect(rejects('type G = { m<T>(v: T): T, n: T };')).toBe(true);
});

test('an interface member type is resolved and its failures reported', () => {
  // D69: an unbound name, in a data member and in a method signature.
  expect(rejects('interface I { n: U; }')).toBe(true);
  expect(rejects('interface I { m(): U; }')).toBe(true);
  expect(rejects('interface I { m(v: U): uint8; }')).toBe(true);

  // D72: a name that IS bound but denotes a value is "not a type", not a
  // temporal-dead-zone report - the two were indistinguishable.
  expect(rejects('const q = 5; interface I { n: q; }')).toBe(true);

  // ...while a RECURSIVE interface reaching its own binding still resolves.
  expect(accepts('interface Node { next: Node | undefined; }')).toBe(true);
  expect(accepts('interface A { b: B; } interface B { a: A; }')).toBe(true);
  // A forward reference to a type declared later keeps working.
  expect(accepts('interface I { n: L; } type L = uint8; let i: I = { n: (1 := uint8) };')).toBe(true);
  // D68's frame reaches the interface path too.
  expect(accepts('interface I { m<T>(v: T): T; }')).toBe(true);
});

test('an untyped literal adapts at an INTERSECTION where the arms agree', () => {
  const arms = 'type A = { x: int32 }; type B = { y: int32 }; type C = A & B; ';
  // D70: the arms carry [[Members]], not [[Properties]], so nothing adapted.
  expect(accepts(`${arms} let c: C = { x: 1, y: 2 };`)).toBe(true);
  expect(accepts('let c: { x: int32 } & { y: int32 } = { x: 1, y: 2 };')).toBe(true);
  expect(accepts('let c: { x: int32 } & { x: int32 } = { x: 1 };')).toBe(true);

  // The arms must AGREE: taking either would admit a literal at a target
  // wanting both. This is the OPPOSITE of D75's rule for the same target form.
  //
  // D84 regressed this and it is restored: D75's merge concatenated the arms'
  // [[Properties]], so a key two arms declare appeared TWICE and the walk
  // matched the first. Merged BY KEY now, with a disagreeing key taking `never`
  // - declared, so freshness still admits it, and satisfied by nothing.
  expect(accepts('let c: { x: int32 } & { x: string } = { x: 1 };')).toBe(false);
  // ...at every position, and where the RUN TIME misses it: a value typed for
  // the FIRST arm, and a return type.
  expect(accepts('let c: { x: int32 } & { x: string } = { x: (1 := int32) };')).toBe(false);
  expect(accepts('function f(): { x: int32 } & { x: string } { return { x: 1 }; }')).toBe(false);
  expect(accepts('function f(p: { x: int32 } & { x: string }) { return 1; } f({ x: 1 });')).toBe(false);
  expect(accepts('let c: { a: { x: int32 } } & { a: { x: string } } = { a: { x: 1 } };')).toBe(false);
  // An INTERFACE arm is `nominal`, so the merge never fires and assignability
  // refuses it - a path the fix must not disturb.
  expect(accepts('interface A { x: int32 } interface B { x: string } let c: A & B = { x: 1 };')).toBe(false);
  // ...while an OPTIONAL and a READONLY difference are not conflicts.
  expect(accepts('let c: { x?: int32 } & { x: int32 } = { x: 1 };')).toBe(true);
  expect(accepts('let c: { readonly x: int32 } & { x: int32 } = { x: 1 };')).toBe(true);

  // A UNION adapts too (D89), where every arm declaring the key AGREES - here
  // only one arm declares `x`, so it is unambiguous.
  expect(accepts('let c: { x: int32 } | { y: string } = { x: 1 };')).toBe(true);
  // ...and where the arms DISAGREE nothing is adapted, so the member widens and
  // the literal is refused. #sec-union-boundary-selection decides that case for
  // a VALUE; deciding it for a LITERAL is an open design question.
  expect(accepts('let c: { x: int32 } | { x: string } = { x: 1 };')).toBe(false);

  // ...and the wrong-value twins.
  expect(accepts(`${arms} let c: C = { x: "s", y: (2 := int32) };`)).toBe(false);
  expect(accepts(`${arms} let c: C = { x: (1 := int32) };`)).toBe(false);
});

test('a NESTED literal is adapted at a composite target', () => {
  // D73: a nested object member widened instead of being taken at the wanted
  // type, because the adaptation was gated on a NUMERIC predicate alone.
  expect(accepts('let c: { a: { x: int32 } } & { b: int32 } = { a: { x: (1 := int32) }, b: (2 := int32) };')).toBe(true);

  // D74: the nested literal had no contextual type of its own, so its members
  // never adapted - two and three levels deep.
  expect(accepts('let c: { a: { x: int32 } } & { b: int32 } = { a: { x: 1 }, b: 2 };')).toBe(true);
  expect(accepts('let c: { a: { b: { x: int32 } } } & { } = { a: { b: { x: 1 } } };')).toBe(true);

  // Recording the target does NOT force the member to take it: an out-of-range
  // literal keeps refusing rather than being adapted into range.
  expect(accepts('let c: { a: { x: uint8 } } & { } = { a: { x: 999 } };')).toBe(false);
  expect(accepts('let c: { a: { x: int32 } } & { } = { a: { x: "s" } };')).toBe(false);
  expect(accepts('let c: { a: { x: int32 } } & { } = { a: { } };')).toBe(false);
});

test('freshness reaches a COMPOSITE and an INTERFACE target', () => {
  // D75: the member walk was gated on an `object` target, so a composite
  // reached neither freshness nor the flags inside the block.
  expect(accepts('let c: { x: int32 } & { } = { x: (1 := int32), u: "s" };')).toBe(false);
  expect(accepts('let c: { a: { x: int32 } } & { } = { a: { x: (1 := int32), u: "s" } };')).toBe(false);

  // An intersection DECLARES the union of its arms, so a key any arm declares
  // is not excess - and the second arm's member is still required and typed.
  expect(accepts('let c: { x: int32 } & { u: string } = { x: (1 := int32), u: "s" };')).toBe(true);
  expect(accepts('let c: { x: int32 } & { u: string } = { x: (1 := int32), u: (2 := int32) };')).toBe(false);
  expect(accepts('let c: { x: int32 } & { u: string } = { x: (1 := int32) };')).toBe(false);

  // D79: the same rule at an interface, which the RUN TIME misses entirely.
  expect(accepts('interface I { n: int32 } let c: I = { n: (1 := int32), u: "s" };')).toBe(false);
  expect(accepts('interface I<T> { n: T } let c: I.<int32> = { n: (1 := int32), u: "s" };')).toBe(false);
  expect(accepts('interface I { n: int32 } function f(p: I) { return 1; } f({ n: (1 := int32), u: "s" });')).toBe(false);
  expect(accepts('interface I { n: int32 } let c: I = { n: (1 := int32) };')).toBe(true);

  // A COMPUTED key cannot be matched statically and must not be reported.
  expect(accepts('const k = "u"; interface I { n: int32 } let c: I = { n: (1 := int32), [k]: "s" };')).toBe(true);
});

test('an INDEX SIGNATURE constrains its values and survives on an interface', () => {
  // D77: a key admitted by a signature had its value checked against nothing.
  expect(accepts('let c: { [k: string]: int32 } = { x: "s" };')).toBe(false);
  expect(accepts('let c: { [k: string]: uint8 } = { x: 999 };')).toBe(false);
  expect(accepts('function f(p: { [k: string]: int32 }) { return 1; } f({ x: "s" });')).toBe(false);
  expect(accepts('function f(): { [k: string]: int32 } { return { x: "s" }; }')).toBe(false);
  expect(accepts('let c: { a: { [k: string]: int32 } } = { a: { x: "s" } };')).toBe(false);

  // A NAMED member beside a signature keeps its own type; an arbitrary extra
  // key is still ADMITTED rather than excess; an untyped value still adapts.
  expect(accepts('let c: { x: string, [k: string]: int32 } = { x: "s" };')).toBe(true);
  expect(accepts('let c: { x: string, [k: string]: int32 } = { x: (1 := int32) };')).toBe(false);
  expect(accepts('let c: { [k: string]: int32 } = { x: (1 := int32), zz: (3 := int32) };')).toBe(true);
  expect(accepts('let c: { [k: string]: int32 } = { x: 1 };')).toBe(true);

  // D78: an interface's signature was DISCARDED when its structure was built,
  // in the checker and the run time alike.
  expect(accepts('interface I { [k: string]: int32 } let c: I = { x: "s" };')).toBe(false);
  expect(accepts('interface I { [k: string]: uint8 } let c: I = { x: 999 };')).toBe(false);
  expect(accepts('interface I { [k: string]: int32 } let c: I = { x: (1 := int32) };')).toBe(true);
  // D79's freshness must not report a key the signature admits.
  expect(accepts('interface I { n: int32, [k: string]: int32 } let c: I = { n: (1 := int32), u: (2 := int32) };')).toBe(true);
});

test('an interface index signature is enforced by `is` as well as by an annotation', () => {
  // D78 row 5: the run-time membership test admitted a value the type excludes,
  // where the ALIAS spelling of the same type answered *false*. Both sides had
  // to land together or the two would disagree in the other direction.
  expect(evaluated('interface I { [k: string]: int32 } String(({ x: "s" } is I));')).toBe('false');
  expect(evaluated('type A = { [k: string]: int32 }; String(({ x: "s" } is A));')).toBe('false');
  expect(evaluated('interface I { [k: string]: int32 } String(({ x: (1 := int32) } is I));')).toBe('true');
});

test('every declaration of a `partial interface` contributes its members', () => {
  const base = 'interface P { n: int32 } partial interface P { u: string } ';
  // D82: the checker held ONE declaration - the first at one site, the last at
  // another - so the base's members were absent from the structure entirely.
  expect(accepts(`${base} let c: P = { n: (1 := int32), u: "s" };`)).toBe(true);
  expect(accepts(`${base} let c: P = { n: "s", u: "s" };`)).toBe(false);
  // D81, which closed with it: the base's member is required, not just typed.
  expect(accepts(`${base} let c: P = { u: "s" };`)).toBe(false);
  expect(accepts(`${base} let c: P = { n: (1 := int32) };`)).toBe(false);

  // THREE declarations all contribute, and ORDER does not matter - the design
  // requires an interface's meaning not to depend on how its declarations load.
  const three = 'interface P { n: int32 } partial interface P { u: string } partial interface P { z: int32 } ';
  expect(accepts(`${three} let c: P = { n: (1 := int32), u: "s", z: (2 := int32) };`)).toBe(true);
  expect(accepts(`${three} let c: P = { n: (1 := int32), u: "s" };`)).toBe(false);
  expect(accepts('partial interface P { u: string } interface P { n: int32 } let c: P = { n: (1 := int32), u: "s" };')).toBe(true);

  // D79's freshness works THROUGH a merged partial, which is why D82 had to
  // land first: before it, `u` read as undeclared.
  expect(accepts(`${base} let c: P = { n: (1 := int32), u: "s", zz: "t" };`)).toBe(false);
  // ...and D78's signature survives a partial too.
  expect(accepts('interface P { n: int32 } partial interface P { [k: string]: int32 } let c: P = { n: (1 := int32), zz: (2 := int32) };')).toBe(true);
});

test('an object type is a subtype of an index-signature type it satisfies', () => {
  // D85: `IsObjectSubtype` covered t's signatures only from s's OWN signatures,
  // so `every(... some(...))` was vacuously false for a source declaring none.
  // `{ x: int32, [k: string]: int32 }` passed where `{ x: int32 }` did not.
  expect(evaluated('type F = { }; type T = { [k: string]: int32 }; String(Reflect.isAssignable((type F), (type T)));')).toBe('true');
  expect(evaluated('type F = { x: int32 }; type T = { [k: string]: int32 }; String(Reflect.isAssignable((type F), (type T)));')).toBe('true');
  expect(evaluated('type F = { x: string }; type T = { [k: string]: int32 }; String(Reflect.isAssignable((type F), (type T)));')).toBe('false');

  // COVARIANT on the value, matching the arm it extends. Numeric value types
  // cannot show this - two primitives are disjoint unless the same
  // (#sec-aredisjoint) - so `any` is the row that distinguishes covariance from
  // invariance, and it is what the design's `{ [key: string]: any }` uses.
  expect(evaluated('type F = { x: uint8 }; type T = { [k: string]: any }; String(Reflect.isAssignable((type F), (type T)));')).toBe('true');
  expect(evaluated('type F = { x: uint8 }; type T = { [k: string]: int32 }; String(Reflect.isAssignable((type F), (type T)));')).toBe('false');

  // The design's own worked pattern: a TYPED value reaching an index-signature
  // position, which `dependentrecordtypes.md` calls the principal use.
  expect(accepts('function f(data: { [key: string]: any }) { return 1; } let o: { a: uint8 } = { a: (1 := uint8) }; f(o);')).toBe(true);
  expect(accepts('function g(): { [key: string]: any } { let o: { a: uint8 } = { a: (1 := uint8) }; return o; }')).toBe(true);
  // ...and D76, which was this defect seen through an intersection.
  expect(accepts('let c: { [k: string]: int32 } & { } = { };')).toBe(true);
  expect(accepts('let c: { [k: string]: int32 } & { } = { x: (1 := int32) };')).toBe(true);

  // A property t declares BY NAME is judged by the property loop, not the
  // signature, so a named member of a different type is still fine.
  expect(evaluated('type F = { x: string }; type T = { x: string, [k: string]: int32 }; String(Reflect.isAssignable((type F), (type T)));')).toBe('true');
  // ...and D77's value rule at a literal is untouched.
  expect(accepts('let c: { [k: string]: int32 } = { x: "s" };')).toBe(false);
});

test('a parameterised type substitutes its index signatures', () => {
  // D86: TWO substitution walks, the same gap in each. `substituteTypeParameters`
  // in check.mts had no signature arm at all and serves the ALIAS spelling;
  // `SubstituteTypeArguments` in runtime.mts copied [[IndexSignatures]] verbatim
  // beside a walked [[Properties]] and serves the NOMINAL one. Both were needed.
  expect(accepts('interface B<T> { [k: string]: T } let b: B.<uint8> = { n: (1 := uint8) };')).toBe(true);
  expect(accepts('type B<T> = { [k: string]: T }; let s: { [k: string]: uint8 } = {}; let b: B.<uint8> = s;')).toBe(true);
  // The exact-match row is the sharp one: a source carrying the very signature
  // the target wants was refused.
  expect(accepts('interface B<T> { [k: string]: T } let s: { [k: string]: uint8 } = {}; let b: B.<uint8> = s;')).toBe(true);
  // The KEY is substituted as well as the value.
  expect(accepts('type M<K, V> = { [k: K]: V }; let m: M.<string, uint8> = { a: (1 := uint8) };')).toBe(true);

  // ...and a source that does NOT fit still refuses, both ways.
  expect(accepts('interface B<T> { [k: string]: T } let s: { [k: string]: string } = {}; let b: B.<uint8> = s;')).toBe(false);
  expect(accepts('interface B<T> { [k: string]: T } let b: B.<uint8> = { n: "s" };')).toBe(false);

  // The arm is GATED on `mentionsTypeParameter`, which was missing the same
  // case - D62's shape, where an arm existed and was gated off so the fix did
  // nothing. These rows fail if only one half is applied.
  expect(accepts('interface B<T> { n: T } let b: B.<uint8> = { n: (1 := uint8) };')).toBe(true);
  expect(accepts('interface B<T> { m(): T; } let b: B.<uint8> = { m() { return (1 := uint8); } };')).toBe(true);
});

test('a parameterised tuple substitutes its elements', () => {
  // D87: the SINGULAR [[Element]] an array carries was handled in both walks and
  // the PLURAL [[Elements]] a tuple carries was not - one letter apart, at
  // check.mts:1519 and :2527. Three edits, as D86 needed: the predicate the arm
  // is gated on, the alias walk, and the nominal one.
  expect(accepts('type P<T> = [T, string]; let p: P.<uint8> = [(1 := uint8), "s"];')).toBe(true);
  expect(accepts('type P<T> = [T, string]; let s: [uint8, string] = [(1 := uint8), "s"]; let p: P.<uint8> = s;')).toBe(true);
  expect(accepts('type P<T, U> = [T, U]; let p: P.<uint8, string> = [(1 := uint8), "s"];')).toBe(true);
  expect(accepts('type P<T> = [T]; let p: P.<uint8> = [(1 := uint8)];')).toBe(true);

  // A tuple inside a NOMINAL reaches the runtime walk, not the checker's - this
  // row stayed REFUSED with only the two check.mts edits and is what proves the
  // third is needed.
  expect(accepts('interface B<T> { n: [T, string] } let b: B.<uint8> = { n: [(1 := uint8), "s"] };')).toBe(true);

  // A REST marker and a NESTED tuple ride along; each element is spread, so only
  // [[Type]] is replaced.
  expect(accepts('type P<T> = [T, ...string]; let p: P.<uint8> = [(1 := uint8), "s"];')).toBe(true);
  expect(accepts('type P<T> = [[T], string]; let p: P.<uint8> = [[(1 := uint8)], "s"];')).toBe(true);

  // ...and a value that does not fit still refuses, generic or not.
  expect(accepts('type P<T> = [T, string]; let p: P.<uint8> = ["s", "s"];')).toBe(false);
  expect(accepts('type P = [uint8, string]; let p: P = ["s", "s"];')).toBe(false);
  // A generic ARRAY, which carries the singular field, was never affected.
  expect(accepts('type A<T> = [].<T>; let a: A.<uint8> = [(1 := uint8)];')).toBe(true);
});

test('the runtime substitution walk reaches every kind it must', () => {
  // D88: the walk dispatches on [[Kind]] and had five arms, where the checker's
  // `substituteTypeParameters` dispatches on FIELDS - so a kind with no arm
  // returned UNSUBSTITUTED at the tail, silently. That asymmetry is why D86, D87
  // and D88 were each found on the NOMINAL side after the alias side worked.
  expect(accepts('interface B<T> { n: [].<T> } let b: B.<uint8> = { n: [(1 := uint8)] };')).toBe(true);
  expect(accepts('interface I<T> { v: T } interface B<T> { n: I.<T> } let b: B.<uint8> = { n: { v: (1 := uint8) } };')).toBe(true);
  // The arms must COMPOSE: a handled kind containing an unhandled one failed.
  expect(accepts('interface B<T> { n: [].<[T, string]> } let b: B.<uint8> = { n: [[(1 := uint8), "s"]] };')).toBe(true);
  expect(accepts('interface B<T> { n: [[].<T>, string] } let b: B.<uint8> = { n: [[(1 := uint8)], "s"] };')).toBe(true);
  expect(accepts('interface B<T> { n: { m: [].<T> } } let b: B.<uint8> = { n: { m: [(1 := uint8)] } };')).toBe(true);

  // A CONCRETE argument needs no substitution and always passed - that contrast
  // is what identifies the nested case as [[Arguments]], not [[Structure]].
  expect(accepts('interface I<T> { v: T } interface B { n: I.<uint8> } let b: B = { n: { v: (1 := uint8) } };')).toBe(true);

  // ...and wrong values still refuse through both new arms.
  expect(accepts('interface B<T> { n: [].<T> } let b: B.<uint8> = { n: ["s"] };')).toBe(false);
  expect(accepts('interface I<T> { v: T } interface B<T> { n: I.<T> } let b: B.<uint8> = { n: { v: "s" } };')).toBe(false);

  // Every arm does `seen.set` before filling, so a cycle terminates. Nothing
  // exercised this before the change; an arm that omits it hangs.
  expect(rejects('interface Node<T> { v: T, next: Node.<T> | undefined } let n: Node.<uint8> = { v: (1 := uint8), next: undefined };')).toBe(false);
  expect(rejects('interface A<T> { b: B.<T> | undefined } interface B<T> { a: A.<T> | undefined } let a: A.<uint8> = { b: undefined };')).toBe(false);
  expect(rejects('interface Tree<T> { v: T, kids: [].<Tree.<T>> }')).toBe(false);
});

test("an object literal's shape carries readonly", () => {
  // D91: `objectLiteralShape` pushed `{ key, type, optional }` with no
  // `readonly`, so a literal's property records held `undefined` where a written
  // type holds `false`, and relations.mts's exact-match arm compares them with
  // `===`. Instrumented: `ro undefined/false sameType=true` - the member TYPES
  // matched and the comparison failed on the flag.
  //
  // Only a UNION surfaced it. A single or intersection target reaches
  // `checkObjectLiteralAgainst`, which compares members individually and never
  // asks whether the whole literal is the SAME TYPE; a union falls through to
  // `requireAssignable`, where an invariant member comparison needs it.
  expect(accepts('let c: { a: { x: int32 } } | { y: string } = { a: { x: (1 := int32) } };')).toBe(true);
  expect(accepts('let c: { a: { x: int32 } } = { a: { x: (1 := int32) } };')).toBe(true);
  expect(accepts('let c: { a: { x: int32 } } & { } = { a: { x: (1 := int32) } };')).toBe(true);

  // The readonly rules are ASYMMETRIC and both must survive: a readonly TARGET
  // takes a writable source covariantly, and a readonly SOURCE does not satisfy
  // a writable target.
  expect(accepts('let s: { a: int32 } = { a: (1 := int32) }; let c: { readonly a: int32 } = s;')).toBe(true);
  expect(evaluated('type R = { readonly a: int32 }; type W = { a: int32 }; String(Reflect.isAssignable((type R), (type W)));')).toBe('false');

  // A readonly INNER member: a LITERAL adapts to it, at a union as at a single
  // target (D89 gave the union a wanted type, so the two agree), while a BINDING
  // of an already-typed value does not - a writable source cannot satisfy a
  // readonly target. The literal/binding split is the point: a literal is
  // created at the target type, a binding already has one.
  expect(accepts('let c: { a: { readonly x: int32 } } | { y: string } = { a: { x: (1 := int32) } };')).toBe(true);
  expect(accepts('let c: { a: { readonly x: int32 } } = { a: { x: (1 := int32) } };')).toBe(true);
  expect(accepts('let s: { a: { x: int32 } } = { a: { x: (1 := int32) } }; let c: { a: { readonly x: int32 } } = s;')).toBe(false);

  // ...and a wrong value is still refused.
  expect(accepts('let c: { a: { x: int32 } } | { y: string } = { a: { x: "s" } };')).toBe(false);
  // An OPTIONAL member, the flag set beside this one, is unaffected.
  expect(accepts('let c: { a?: int32 } = { };')).toBe(true);
});

test("a literal's method member takes the signature its position wants", () => {
  // D92: the member was typed `{ Kind: 'function', Signatures: [] }` - D71's
  // deliberate stub, right for the member WALK where each member is compared on
  // its own, wrong at an EXACT-MATCH comparison where a signature-less function
  // is not the same type as any signature. A union reaches neither
  // checkObjectLiteralAgainst nor the merge, so it is where the limit came due.
  expect(accepts('let c: { m(): int32 } | { y: string } = { m() { return (1 := int32); } };')).toBe(true);
  // An ANNOTATED method failed too, so the stub was never about an uninferable
  // body - the shape builder did not read a signature at all.
  expect(accepts('let c: { m(): int32 } | { y: string } = { m(): int32 { return (1 := int32); } };')).toBe(true);
  expect(accepts('let c: { m(): int32, x: int32 } | { y: string } = { m() { return (1 := int32); }, x: 1 };')).toBe(true);
  expect(accepts('interface I { m(): int32; } let c: I | { y: string } = { m() { return (1 := int32); } };')).toBe(true);
  // Two arms declaring `m` and AGREEING - D89 made wantedOf answer across arms.
  expect(accepts('let c: { m(): int32 } | { m(): int32, y: string } = { m() { return (1 := int32); } };')).toBe(true);

  // The WANTED signature is adopted, never an inferred one, so the BODY is still
  // checked against that return independently. These two must keep firing.
  expect(accepts('let c: { m(): int32 } | { y: string } = { m() { return "s"; } };')).toBe(false);
  expect(accepts('let p: { m(): uint8 } = { m() { return "s"; } };')).toBe(false);
  // ...and a non-function value, a method no arm declares, and DISAGREEING arms.
  expect(accepts('let c: { m(): int32 } | { y: string } = { m: "s" };')).toBe(false);
  expect(accepts('let c: { y: string } | { z: int32 } = { m() { return (1 := int32); } };')).toBe(false);
  expect(accepts('let c: { m(): int32 } | { m(): string } = { m() { return (1 := int32); } };')).toBe(false);

  // ARITY tolerance: a zero-parameter method satisfies a one-parameter
  // signature, at a union as at a single target, an intersection, a binding and
  // the arrow spelling. Recorded because it looked like a regression - it was
  // the union catching up with the other four.
  expect(accepts('let c: { m(a: int32): int32 } | { y: string } = { m() { return (1 := int32); } };')).toBe(true);
  expect(accepts('let c: { m(a: int32): int32 } = { m() { return (1 := int32); } };')).toBe(true);
  expect(accepts('let c: { m: (a: int32) => int32 } = { m: () => (1 := int32) };')).toBe(true);
});

test('a NESTED composite annotation reaches every arm', () => {
  // D93: a composite written inside another arrived UNFLATTENED - traced,
  // `arms=2 armKinds=["union","object"]` where the FLAT spelling of the same
  // type gives three object arms. The two annotations denote one type and the
  // canonical form proves it, so the display was not what the literal met.
  expect(accepts('let c: ({ x: int32 } | { y: string }) | { z: boolean } = { x: 1 };')).toBe(true);
  expect(accepts('let c: ({ x: int32 } & { z: int32 }) & { w: int32 } = { x: 1, z: 2, w: 3 };')).toBe(true);
  // MIXED kinds never flatten, so recursion is what reaches them - an arm that
  // is itself a composite carries no [[Properties]] to read.
  expect(accepts('let c: ({ x: int32 } | { y: string }) & { z: int32 } = { x: 1, z: 2 };')).toBe(true);
  expect(accepts('let c: ({ x: int32 } & { z: int32 }) | { y: string } = { x: 1, z: 2 };')).toBe(true);
  // ...and through an ALIAS, so this was never a parenthesis artefact.
  expect(accepts('type U = { x: int32 } | { y: string }; let c: U & { z: int32 } = { x: 1, z: 2 };')).toBe(true);

  // ONE agreement check across ALL levels, not one per level. These three arms
  // are two levels apart and must still be seen to disagree - D89 left a
  // disagreeing key REFUSED as an open design question, and a per-level check
  // would pick an arm instead.
  expect(accepts('let c: { x: int32 } | { x: string } = { x: 1 };')).toBe(false);
  expect(accepts('let c: ({ x: int32 } | { x: string }) | { z: boolean } = { x: 1 };')).toBe(false);
  expect(accepts('let c: ({ x: int32 } | { z: boolean }) | { x: string } = { x: 1 };')).toBe(false);

  // Reaching into an arm must not invent a wanted type nor excuse a wrong value.
  expect(accepts('let c: ({ x: int32 } | { y: string }) | { z: boolean } = { w: 1 };')).toBe(false);
  expect(accepts('let c: ({ x: int32 } | { y: string }) & { z: int32 } = { x: "s", z: 2 };')).toBe(false);
  // An arm declaring NOTHING contributes nothing - D90's row.
  expect(accepts('let c: { x: int32 } | never = { x: 1 };')).toBe(true);
});

test('a CLASS type is not satisfied by an object literal', () => {
  const C = 'class C { a: uint8 = (0 := uint8); } ';
  // D61: the literal arm ended `return contextual`, GIVING the literal the
  // target's type without comparing - so a missing member and an excess one both
  // passed, and only a wrong member TYPE was caught by the walk's own check.
  //
  // #sec-object-types: "Every interface has one [a structural form]. A class has
  // none: a class states a construction and an identity as well as a shape, and
  // it is the identity that its type is for."
  expect(accepts(`${C} let c: C = { a: (1 := uint8) };`)).toBe(false);
  expect(accepts(`${C} let c: C = { };`)).toBe(false);
  expect(accepts(`${C} let c: C = { a: (1 := uint8), u: "s" };`)).toBe(false);

  // A class is satisfied by CONSTRUCTION, which is unaffected.
  expect(accepts(`${C} let c: C = new C();`)).toBe(true);
  expect(accepts(`${C} class D extends C { } let c: C = new D();`)).toBe(true);
  expect(accepts('interface I { a: uint8 } class D implements I { a: uint8 = (0 := uint8); } let c: I = new D();')).toBe(true);

  // ...and the other three targets this arm serves still take a literal.
  expect(accepts('interface I { a: uint8 } let c: I = { a: (1 := uint8) };')).toBe(true);
  expect(accepts('let c: { a: uint8 } = { a: (1 := uint8) };')).toBe(true);
  expect(accepts('type A = { a: uint8 }; let c: A = { a: (1 := uint8) };')).toBe(true);
  expect(accepts(`${C} let c: any = { a: (1 := uint8) };`)).toBe(true);
});

test('a member already declared on an interface is a TypeError', () => {
  // D83: the run time reported this and the checker accepted it in silence.
  expect(accepts('interface P { n: int32 } partial interface P { n: int32 }')).toBe(false);
  expect(accepts('interface P { n: int32 } partial interface P { n: string }')).toBe(false);
  expect(accepts('interface P { m(): int32; } partial interface P { m(): string; }')).toBe(false);
  expect(accepts('interface P { z: int32 } partial interface P { n: int32 } partial interface P { n: string }')).toBe(false);

  // Two members of ONE declaration are left alone: the run time accepts that
  // too, and making the checker refuse would introduce a disagreement rather
  // than remove one (OQ25).
  expect(accepts('interface P { n: int32, n: string }')).toBe(true);
  expect(accepts('interface P { n: int32 } partial interface P { u: string }')).toBe(true);
});
