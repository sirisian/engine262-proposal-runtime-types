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

test('a self-referential union reports instead of overflowing', () => {
  // D94: `type R = { a: int32 } | R` has no finite layout and the DECLARATION
  // said so. The literal path went through `requireAssignable`, which erases
  // both sides, and TWO walks recursed over [[Members]] with no cycle guard -
  // `eraseMetadata` and `literalFitsNumericType`. Guarding the first only moved
  // the overflow to the second.
  //
  // A host RangeError is not a throw completion, so nothing downstream could
  // catch it, and it fired at CHECK time - `if (false)` around the literal did
  // not avoid it. `rejects` returning true is the whole point: a TypeError now
  // reaches the program where a stack trace used to escape it.
  expect(rejects('type R = { a: int32 } | R; let c: R = { a: 1 };')).toBe(true);
  expect(rejects('type R = { a: int32 } | R; let c: R = { a: (1 := int32) };')).toBe(true);
  expect(rejects('type R = { a: int32 } | R; if (false) { let c: R = { a: 1 }; }')).toBe(true);
  expect(rejects('type R = { a: int32 } | R;')).toBe(true);
  expect(rejects('type S = { next: S };')).toBe(true);

  // Four shapes of LEGITIMATE recursion, which must keep working - an ~object~
  // is returned untouched by the erasure, so none of them takes the guarded arm.
  expect(accepts('type S = { next: S | null }; let s: S = { next: null };')).toBe(true);
  expect(accepts('type Arr = { items: [].<Arr> }; const t: Arr = { items: [] };')).toBe(true);
  expect(accepts('type L1 = { next: L1 | null }; type L2 = { next: L2 | null };')).toBe(true);
  expect(accepts('interface I { next: I | null }')).toBe(true);
  expect(accepts('type A = { b: B | null }; type B = { a: A | null };')).toBe(true);

  // The numeric-union path the second guard sits on is unchanged, narrowest
  // arm included.
  expect(accepts('let n: uint8 | string = 1;')).toBe(true);
  expect(evaluated('let n: uint32 | uint8 = 1; String(Reflect.typeOf(n));')).toBe('uint.<8>');
});

test('a nested literal at a recursive type takes its wanted member types', () => {
  // D95: `adapted` took the wanted type only for an ~object~ member - D73 added
  // that arm for the case it had and scoped it to that kind. A member of any
  // other kind fell through to `widen`, so at
  // `type L = { value: uint8, next: L | null }` the inner literal's `next: null`
  // kept the literal type `null` where its position wanted `L | null`.
  //
  // `next` is WRITABLE and so compared INVARIANTLY, and SameType(null, L | null)
  // is false - the relation was RIGHT to refuse. A literal is created at the
  // type its position asks for, which is what was not happening.
  const L = 'type L = { value: uint8, next: L | null }; ';
  expect(accepts(`${L} const n: L = { value: 1, next: { value: 2, next: null } };`)).toBe(true);
  expect(accepts(`${L} const n: L = { value: 1, next: { value: 2, next: { value: 3, next: null } } };`)).toBe(true);
  expect(accepts('type A = { b: B | null }; type B = { a: A | null }; const v: A = { b: { a: null } };')).toBe(true);
  // A recursive INTERFACE and a GENERIC one, which fail the same way.
  expect(accepts('interface I { value: uint8, next: I | null } const n: I = { value: 1, next: { value: 2, next: null } };')).toBe(true);
  expect(accepts('interface N<T> { v: T, next: N.<T> | null } const n: N.<uint8> = { v: (1 := uint8), next: { v: (2 := uint8), next: null } };')).toBe(true);

  // A genuinely wrong nested value is still refused - adaptation happens ONLY
  // where the member is assignable.
  expect(accepts(`${L} const n: L = { value: 1, next: { value: "s", next: null } };`)).toBe(false);
  // Depth 1, a BINDING of the inner value, and the NON-recursive equivalent were
  // the three controls that identified this as adaptation rather than
  // comparison; all still hold.
  expect(accepts(`${L} const n: L = { value: 1, next: null };`)).toBe(true);
  expect(accepts('type M = { value: uint8, next: { value: uint8 } | null }; const n: M = { value: 1, next: { value: 2 } };')).toBe(true);
  // A `readonly` member was always accepted - covariant, so SameType is never
  // asked - which is what confirmed the invariance reading.
  expect(accepts('type RO = { v: uint8, readonly next: RO | null }; const n: RO = { v: 1, next: { v: 2, next: null } };')).toBe(true);

  // D73's OBJECT arm is untouched: freshness still reaches a nested object
  // member at a plain (non-union) position.
  expect(accepts('type P = { v: uint8, inner: { w: uint8 } }; const p: P = { v: 1, inner: { w: 2, u: "x" } };')).toBe(false);
});

test('mentionsTypeParameter terminates on a cyclic record', () => {
  // D98: the THIRD walk of this shape, after D94 guarded `eraseMetadata` and
  // `literalFitsNumericType`. A recursive ALIAS reached through a function
  // PARAMETER inside a BLOCK overflowed the host stack - at top level the same
  // program is merely unchecked (D96), because the block takes a path that
  // WALKS the type instead of decaying it to `any`.
  //
  // `false` on a revisit is the honest answer: a record already being asked
  // about contributes no new parameter mention.
  const L = 'type L = { v: uint8, next: L | null }; ';
  // Not an overflow, and correctly REFUSED - in a block the parameter is
  // genuinely checked once the walk terminates.
  expect(rejects(`${L} { function f(p: L) { return 1; } f({ v: "s", next: null }); }`)).toBe(true);
  expect(accepts(`${L} { function f(p: L) { return 1; } f({ v: (1 := uint8), next: null }); }`)).toBe(true);

  // The generic machinery this predicate gates is unchanged - it is what D62,
  // D86 and D87 all turned on, so a `seen` set that returned the wrong answer
  // would show here first.
  expect(accepts('interface B<T> { n: T } let b: B.<uint8> = { n: (1 := uint8) };')).toBe(true);
  expect(accepts('type P<T> = [T, string]; let p: P.<uint8> = [(1 := uint8), "s"];')).toBe(true);
  expect(accepts('interface B<T> { [k: string]: T } let b: B.<uint8> = { n: (1 := uint8) };')).toBe(true);
  expect(accepts('interface I<T> { v: T } interface B<T> { n: I.<T> } let b: B.<uint8> = { n: { v: (1 := uint8) } };')).toBe(true);
});

test('freshness reaches a UNION target', () => {
  // D97: #sec-literal-freshness is written for "an expected OBJECT TYPE", so a
  // union was outside it and an excess property SURVIVED - at run time as well
  // as statically, which made it a loosening rather than a missing diagnostic.
  //
  // The rule applied is the CONSERVATIVE one: excess only where NO arm declares
  // or admits the key. A stricter rule - fresh against the arm that takes the
  // literal - needs an arm CHOSEN, which D89 left open. Every property refused
  // here is refused under either rule.
  expect(accepts('let c: { x: int32 } | { y: string } = { x: (1 := int32), u: "t" };')).toBe(false);
  expect(accepts('type P = { v: uint8, inner: { w: uint8 } | null }; let p: P = { v: 1, inner: { w: 2, u: "x" } };')).toBe(false);
  expect(accepts('type P = { inner: { w: uint8 } | { z: string } | null }; let p: P = { inner: { w: 2, u: "x" } };')).toBe(false);
  expect(accepts('type P = { a: { b: { c: uint8 } | null } }; let p: P = { a: { b: { c: 1, u: "x" } } };')).toBe(false);
  expect(accepts('interface I { w: uint8 } type P = { inner: I | null }; let p: P = { inner: { w: 2, u: "x" } };')).toBe(false);

  // Checked WITHOUT entering the structural arm. Widening `structural` to admit
  // a union was measured first and REGRESSED this row from refused to accepted:
  // that arm ends `return contextual`, so entering it skips the
  // `requireAssignable` that refuses a disagreeing-arm literal.
  expect(accepts('let c: { x: int32 } | { x: string } = { x: 1 };')).toBe(false);
  // ...and D89's adaptation is untouched.
  expect(accepts('let c: { x: int32 } | { y: string } = { x: 1 };')).toBe(true);

  // A key SOME arm declares is admitted: this is the conservative rule's own
  // limit, and the row that says which rule was implemented.
  expect(accepts('let c: { x: int32 } | { y: string } = { x: (1 := int32), y: "s" };')).toBe(true);
  // An arm's INDEX SIGNATURE admits arbitrary keys, as at a plain object type.
  expect(accepts('let c: { [k: string]: int32 } | { y: string } = { x: (1 := int32), zz: (2 := int32) };')).toBe(true);
  // Freshness is lost through a BINDING - the rule's own limit, at a union too.
  expect(accepts('let s = { x: (1 := int32), u: "t" }; let c: { x: int32 } | { y: string } = s;')).toBe(true);

  // An arm that is itself a COMPOSITE is flattened, not dropped: a filter that
  // kept only object arms reported `x` as excess here (D93's lesson).
  expect(accepts('let c: ({ x: int32 } | { y: string }) | { z: boolean } = { x: 1 };')).toBe(true);
});

test('an empty array literal is refused where no array fits', () => {
  // D58b: `staticType` returns `null` for an element-less ArrayLiteral, so the
  // annotation had nothing to compare against - `let n: uint8 = []` raised no
  // static error while `let o: { x: uint8 } = [1]` did. The RUN TIME refused
  // both, so this was a missing diagnostic and not a loosening.
  expect(accepts('let n: uint8 = [];')).toBe(false);
  expect(accepts('let o: { x: uint8 } = [];')).toBe(false);
  expect(accepts('interface I { x: uint8 } let i: I = [];')).toBe(false);

  // Reported ADDITIVELY rather than by typing the literal. `[].<never>` and
  // `[].<any>` were BOTH measured and both refuse `let a: U = []` where
  // `U = [].<T>` - an array whose element is an opaque type PARAMETER, which no
  // concrete element type is assignable to. This row is why.
  expect(accepts('function f<T, U = [].<T>>(v: T) { let a: U = []; return 1; }')).toBe(true);

  // Every target an array CAN satisfy is untouched.
  expect(accepts('let a: [].<uint8> = [];')).toBe(true);
  expect(accepts('let a: [].<uint8> = []; a.push((1 := uint8));')).toBe(true);
  expect(accepts('let a: any = [];')).toBe(true);
  expect(accepts('let t: [uint8, string] = [];')).toBe(false);
  // ...and a NON-empty array is checked as it always was.
  expect(accepts('let o: { x: uint8 } = [1];')).toBe(false);
  expect(accepts('let a: [].<uint8> = [(1 := uint8)];')).toBe(true);
});

test('concat does not admit a foreign element', () => {
  // D102: `concat` shared a table case with `slice`, `reverse`, `sort`,
  // `toReversed` and `toSorted`, all returning the RECEIVER. That is right for
  // the other five and wrong for concat, whose result unions the ARGUMENTS'
  // element types - which the RUN TIME already answered:
  // `Reflect.typeOf(a.concat(["s"]))` is `[].<string | uint.<8>>` where the
  // checker said `[].<uint.<8>>`.
  //
  // A LOOSENING, not a display quirk: the checker believed the result had the
  // receiver's type, so the binding matched and RAN, and `b[1]` was the string
  // `"s"` inside an array typed `[].<uint8>`.
  expect(accepts('let a: [].<uint8> = []; let b: [].<uint8> = a.concat(["s"]);')).toBe(false);
  // The parameters are arrays OF THE ELEMENT now, so the argument is refused on
  // its own - one table entry caused both halves.
  expect(accepts('let a: [].<uint8> = []; a.concat(["s"]);')).toBe(false);
  // A matching element still passes, and its result still binds.
  expect(accepts('let a: [].<uint8> = []; let b: [].<uint8> = a.concat([(2 := uint8)]);')).toBe(true);

  // The five that KEEP the shared case: their result really is the receiver's.
  expect(accepts('let a: [].<uint8> = []; let b: [].<string> = a.slice();')).toBe(false);
  expect(accepts('let a: [].<uint8> = []; let b: [].<uint8> = a.slice();')).toBe(true);
  expect(accepts('let a: [].<uint8> = []; let b: [].<uint8> = a.sort();')).toBe(true);
  expect(accepts('let a: [].<uint8> = []; let b: [].<uint8> = a.reverse();')).toBe(true);
  expect(accepts('let a: [].<uint8> = []; let b: [].<uint8> = a.toSorted();')).toBe(true);
});

test('push, unshift and splice check their element', () => {
  // D102 row 2: all three were ABSENT from `arrayMethodSignature`, so a foreign
  // element raised no static error - `a.push("s")` on a `[].<uint8>`
  // type-checked. The RUN TIME refused every one, and these entries are copied
  // from it.
  expect(accepts('let a: [].<uint8> = []; a.push("s");')).toBe(false);
  expect(accepts('let a: [].<uint8> = []; a.unshift("s");')).toBe(false);
  expect(accepts('let a: [].<uint8> = []; a.splice(0, 0, "s");')).toBe(false);

  // The element parameter is a REST - all three are variadic.
  expect(accepts('let a: [].<uint8> = []; a.push((1 := uint8));')).toBe(true);
  expect(accepts('let a: [].<uint8> = []; a.push((1 := uint8), (2 := uint8));')).toBe(true);
  expect(accepts('let a: [].<uint8> = []; a.splice(0, 1);')).toBe(true);

  // `splice`'s RETURN is the receiver, as `slice`'s is. Building a fresh array
  // record gave `Extent: undefined` and refused this row - which MATCHES the run
  // time, and the run time is wrong there: it reports
  // `"[undefined].<uint.<8>>" is not assignable to "[].<uint.<8>>"`. Copying an
  // error is not agreement (D103).
  expect(accepts('let a: [].<uint8> = []; let b: [].<uint8> = a.splice(0, 1);')).toBe(true);
});

test('a returned value type class instance is copied', () => {
  // D104: `returning` is one of the positions #sec-value-type-copying lists and
  // was the ONLY one that did not copy - a binding, an assignment, a typed
  // field, a typed array element and an argument all did.
  //
  // The cause was CHECK ELISION: `EnforceAnnotation` returns early on the elided
  // path, which stamps a typed ARRAY and never reaches `CheckedConvertValue`.
  // The array branch there already says the copy for the same reason, quoting
  // #sec-elision-stability - "eliding a check must not change what a value IS".
  const V = 'class P { x: uint8 = (0 := uint8); } const a = new P(); a.x = (1 := uint8); ';
  // 1 means the returned value was COPIED before `a` was mutated; 9 means it aliased.
  expect(evaluated(`${V} function f(): P { return a; } const b = f(); a.x = (9 := uint8); String(b.x);`)).toBe('1');
  expect(evaluated(`${V} const f = (): P => { return a; }; const b = f(); a.x = (9 := uint8); String(b.x);`)).toBe('1');
  expect(evaluated(`${V} class H { m(): P { return a; } } const b = new H().m(); a.x = (9 := uint8); String(b.x);`)).toBe('1');
  // An ELEMENT read returned: it copied into every other position already.
  expect(evaluated(`${V} let r: [].<P> = [new P()]; r[0].x = (5 := uint8); function f(): P { return r[0]; } const b = f(); r[0].x = (9 := uint8); String(b.x);`)).toBe('5');

  // An arrow's CONCISE body always copied - it is not elided, which is what made
  // the same annotation behave differently in the two arrow forms.
  expect(evaluated(`${V} const f = (): P => a; const b = f(); a.x = (9 := uint8); String(b.x);`)).toBe('1');

  // An ORDINARY class instance has no layout and keeps the identity a return
  // must preserve.
  expect(evaluated('class Q { } const q = new Q(); function f() { return q; } String(f() === q);')).toBe('true');
  // ...and a freshly constructed instance has nothing to alias.
  expect(evaluated(`${V} function f(): P { return new P(); } const b = f(); String(b.x);`)).toBe('0');

  // The clause's own worked example, unchanged: `let e: V = arr[0]` holds a copy.
  expect(evaluated('class P { x: uint8 = (0 := uint8); } let r: [].<P> = [new P()]; r[0].x = (5 := uint8); let e: P = r[0]; r[0].x = (9 := uint8); String(e.x);')).toBe('5');
});

test('Promise.resolve rejects with never, as the statics table states', () => {
  // D48: the row is "`(value: R): Promise.<R, never>`, a resolved promise having
  // nothing to reject with", and the engine built `Promise.<R, any>` - the
  // opposite claim, that it may reject with anything.
  //
  // The exact MIRROR of the `reject` arm, which was already corrected to give
  // its RESOLVED position `never`; this was the half not done.
  //
  // Nothing observable changes, and that is why the rows below all pass either
  // way: `any` is assignable to everything, and `never` is assignable to
  // everything for the opposite reason. The fix is to what the type CLAIMS.
  expect(accepts('let p: Promise.<uint8, never> = Promise.resolve((1 := uint8));')).toBe(true);
  expect(accepts('let p: Promise.<uint8, string> = Promise.resolve((1 := uint8));')).toBe(true);
  expect(accepts('let p: Promise.<uint8, any> = Promise.resolve((1 := uint8));')).toBe(true);
  // The RESOLVED type is still checked, so this is not a blanket acceptance.
  expect(accepts('let p: Promise.<string, never> = Promise.resolve((1 := uint8));')).toBe(false);
  // ...and `reject`'s own rows are unmoved.
  expect(accepts('let p: Promise.<uint8, never> = Promise.reject("boom");')).toBe(false);
  expect(accepts('let p: Promise.<uint8, string> = Promise.reject("boom");')).toBe(true);
});

test('a self-describing contribution does not anchor inference', () => {
  // D105: #sec-anchored-contributions says a contribution anchors when its
  // Static Type "derives from a DECLARED type". The checker asked instead
  // whether the type was NOT A LITERAL, and its own comment states the
  // assumption: "a known, non-literal contribution is one that derives from an
  // annotation somewhere".
  //
  // That is false for a form that DESCRIBES ITSELF. `{}` is `{}` and
  // `function(){}` is `() => void` - non-literal, and no declaration supplied
  // either. So an unannotated function returning one PARTICIPATED, its call had
  // a Static Type where the clause gives it ~any~, and the mismatch was refused
  // BEFORE THE PROGRAM RAN.
  //
  // Each row below must reach the boundary and throw, not be refused early.
  const runsThenThrows = (src: string) => {
    // A static rejection would fail even with the throw swallowed.
    expect(ok(`try { ${src} } catch (e) {} "ran";`), `should not be an early error: ${src}`).toBe(true);
    return (run(`${src} 1;`) as { Type: string }).Type === 'throw';
  };
  for (const v of ['{}', '{ x: 1 }', 'function(){}', '() => 1', 'null', 'undefined', '[1]', '"s"']) {
    expect(runsThenThrows(`function g(){ return ${v}; } let a: uint8 = g();`), `for ${v}`).toBe(true);
  }

  // `null` and `undefined` are ~primitive~ Type Records, not ~literal~ ones
  // (#sec-the-null-and-undefined-types), which is why the old test anchored
  // them. They have ONE VALUE each, so knowing the type says nothing a
  // declaration supplied - the same reasoning, generalized.

  // A real anchor still participates, and the mismatch is an early error.
  expect(accepts('function g(p: string){ return p; } let a: uint8 = g("s");')).toBe(false);
  expect(accepts('function g(): string { return "s"; } let a: uint8 = g();')).toBe(false);
  expect(accepts('let a: uint8 = "s";')).toBe(false);
  expect(accepts('let n: null = null; let a: uint8 = n;')).toBe(false);
});

test('a signature is trusted only where the name cannot be replaced', () => {
  // D107: a `function` declaration creates a MUTABLE binding, so
  // `function g(p: uint32){ return "s"; } g = function(p){ return 1; }` leaves
  // `g` holding a function that returns a NUMBER. The checker read `string` from
  // the declaration and refused `const q: number = g(...)` - rejecting a program
  // that is CORRECT, before it ran.
  //
  // #sec-check-elision states the rule and the engine already implemented it
  // there: "a name that nothing assigns cannot be replaced, whatever declared
  // it ... only one that writes to the name pays for the possibility, and it
  // pays at the boundaries that read a signature from it". Reading a call's
  // Static Type is one of those boundaries and asked nothing.
  //
  // A written-to name defers to the boundary, where the value is still checked.
  expect(accepts('function g(p: uint32){ return "s"; } g = function(p){ return 1; }; const q: number = g((1 := uint32));')).toBe(true);
  expect(accepts('function g(p: uint32){ return "s"; } if (globalThis.z) { g = function(p){ return 1; }; } const q: number = g((1 := uint32));')).toBe(true);
  // The test is on the SOURCE TEXT, so a self-assignment counts.
  expect(accepts('function g(p: uint32){ return "s"; } g = g; const q: number = g((1 := uint32));')).toBe(true);

  // An ordinary program keeps its early error - "an ordinary program therefore
  // keeps every elision it had".
  expect(accepts('function g(p: uint32){ return "s"; } const q: number = g((1 := uint32));')).toBe(false);
  expect(accepts('function g(p: uint32): string { return "s"; } const q: number = g((1 := uint32));')).toBe(false);
  expect(accepts('class C { m(p: uint32) { return "s"; } } const c = new C(); const q: number = c.m((1 := uint32));')).toBe(false);
  expect(accepts('const g: (p: uint32) => string = (p) => "s"; const q: number = g((1 := uint32));')).toBe(false);

  // The DESIGN'S own elision example must stay refused: not trusting a
  // signature must not become not checking at all.
  expect(accepts('function f(): uint32 { return (5 := uint32); } function g2(): uint32 { return f(); } f = function () { return "now-a-string"; }; const n2: uint32 = g2();')).toBe(false);

  // An UNANNOTATED binding is ~any~ and was always deferred - not this fix.
  expect(accepts('const g = (p: uint32): string => "s"; const q: number = g((1 := uint32));')).toBe(true);
});

test('an inference anchored in a nested list still publishes', () => {
  // D106: `publishInferredReturns()` ran as the last step of
  // `declareFunctionSignatures`, which runs BEFORE its statement list is walked -
  // deliberately, so `f(300)` above `function f(v: uint8) {}` is an Early Error.
  // The cost was that the fixpoint sampled the list's own bindings before they
  // existed.
  //
  // At TOP LEVEL that is invisible: `checkInTwoPasses` hands pass 1's frame to
  // pass 2, so the second pass's first sample already finds them. A BLOCK's
  // declarations do not survive that way, so a nested fixpoint saw `NULL` in
  // both passes and never converged - and the same program was an Early Error at
  // top level and not inside a block.
  const G = 'function g(){ return s; } const q: number = g();';
  expect(accepts(`{ let s: string = "s"; ${G} }`)).toBe(false);
  expect(accepts(`try { let s: string = "s"; ${G} } catch (e) { }`)).toBe(false);
  expect(accepts(`function w() { let s: string = "s"; ${G} }`)).toBe(false);
  expect(accepts(`let s: string = "s"; ${G}`)).toBe(false);

  // It was never lexical SCOPING: a `var` is function-scoped and failed
  // identically, so the test is purely "declared in a nested statement list".
  expect(accepts(`{ var s: string = "s"; ${G} }`)).toBe(false);

  // F56: the scan still runs BEFORE the list is walked, so a call above its
  // declaration is still an Early Error. Only the PUBLISH moved.
  expect(accepts('f(300); function f(v: uint8) {}')).toBe(false);

  // An unannotated binding is ~any~, and a self-describing contribution does not
  // anchor (D105): both stay deferred.
  expect(accepts(`{ let s = "s"; ${G} }`)).toBe(true);
  expect(accepts('function g2(){ return {}; } let a: uint8 = g2();')).toBe(true);
  // ...and a reassigned name is still not trusted (D107).
  expect(accepts('function g4(p: uint32){ return "s"; } g4 = function(p){ return 1; }; const q: number = g4((1 := uint32));')).toBe(true);
});

test('a void return is required of nothing', () => {
  // D57 half (a): #sec-issubtype states the step beside the ~none~ one the
  // engine already had - "If _b_.[[Return]].[[Kind]] is ~void~, return *true*" -
  // and gives the reason in the same clause: "a caller that has declared it will
  // not use the result".
  //
  // Without it every callback whose body ends in an expression -
  // `arr.forEach(x => other.push(x))`, where `push` answers a length - had to be
  // rewritten to discard its own result. A VALID PROGRAM REFUSED.
  const V = 'type VF = () => void; ';
  for (const src of [
    `${V}const h: VF = (() => "s");`,
    `${V}const h: VF = function () { return "s"; };`,
    `${V}const g: () => string = () => "s"; const h: VF = g;`,
    `${V}function take(cb: VF) { return 1; } take(() => "s");`,
    `${V}const h: VF = async function () { return "s"; };`,
    'type N = () => () => void; const h: N = () => (() => "s");',
    'type O = { m: () => void }; const o: O = { m: () => "s" };',
    'type PF = (x: uint8) => void; const h: PF = (x: uint8) => "s";',
    'type O = { m(): void }; class C { m() { return "s"; } } const o: O = new C();',
  ]) {
    expect(accepts(src), `should accept: ${src}`).toBe(true);
  }

  // The METHOD-SHORTHAND member is a SECOND site: it reaches the
  // `ReturnStatement` arm rather than `IsFunctionSubtype`, so the rule had to be
  // stated there too. The origin of the `void` is what separates it from D56 - a
  // CONTEXTUAL `void` requires nothing, an OWN annotation still refuses.
  expect(accepts('type O = { m(): void }; const o: O = { m() { return "s"; } };')).toBe(true);
  expect(accepts('type O = { m(): void }; const o: O = { m() { } };')).toBe(true);
  expect(accepts('type O = { m(): string }; const o: O = { m() { return "s"; } };')).toBe(true);
  expect(accepts('type O = { m(): string }; const o: O = { m() { return (1 := uint8); } };')).toBe(false);

  // D56 is intact: a body contradicting its OWN annotation still refuses.
  expect(accepts('function f(): void { return "s"; }')).toBe(false);
  expect(accepts('const o = { m(): void { return "s"; } };')).toBe(false);

  // A real return type is still checked, and the VARIANCE rules are untouched.
  // These use CLASS INHERITANCE deliberately: "this proposal performs no
  // implicit numeric widening, a ~primitive~ type is a subtype of no other
  // numeric type", so a numeric pair reads false in BOTH directions and could
  // not detect a regression here.
  expect(accepts('type SF = () => string; const h: SF = (() => (1 := uint8));')).toBe(false);
  const AB = 'class A {} class B extends A {} ';
  expect(evaluated(`${AB}String(Reflect.isAssignable((type () => B), (type () => A)));`)).toBe('true');
  expect(evaluated(`${AB}String(Reflect.isAssignable((type () => A), (type () => B)));`)).toBe('false');
  expect(evaluated(`${AB}String(Reflect.isAssignable((type (A) => void), (type (B) => void)));`)).toBe('true');
  expect(evaluated(`${AB}String(Reflect.isAssignable((type (B) => void), (type (A) => void)));`)).toBe('false');
  expect(evaluated('String(Reflect.isAssignable((type () => uint8), (type () => number)));')).toBe('false');

  // The step itself.
  expect(evaluated('String(Reflect.isAssignable((type () => string), (type () => void)));')).toBe('true');

  // The RESULT is still not usable: the call's Static Type is `void`.
  expect(accepts('type VF = () => void; const h: VF = (() => "s"); let s: string = h();')).toBe(false);
});

test('a concise arrow body is checked against its own return annotation', () => {
  // D109: the declared return was RECORDED on the concise body's expression as a
  // contextual type and never COMPARED to it, so `(): uint8 => "s"` and
  // `(): void => "s"` were both accepted - although the code's own comment said
  // "the checker refuses the declaration before any call runs".
  //
  // For every type but `void` the run time caught it at EnforceReturnType, so
  // the cost was a diagnostic arriving late. `void` has NO backstop: it is the
  // type with no values, so RequireType against it would refuse the legitimate
  // *undefined* too, and the static check is the only one there can be.
  expect(accepts('const f = (): void => "s";')).toBe(false);
  expect(accepts('const f = (): void => (1 := uint8);')).toBe(false);
  expect(accepts('const f = async (): Promise.<void, never> => "s";')).toBe(false);
  expect(accepts('const f = (): uint8 => "s";')).toBe(false);
  expect(accepts('const f = (): uint8 => (300 := uint16);')).toBe(false);

  // A correct concise body is untouched, and `undefined` satisfies `void`.
  expect(accepts('const f = (): string => "s";')).toBe(true);
  expect(accepts('const f = (): uint8 => (1 := uint8);')).toBe(true);
  expect(accepts('const f = (): void => undefined;')).toBe(true);
  expect(accepts('const f = (): void => { };')).toBe(true);

  // The rule matches the BLOCK form rather than inventing one: a converting
  // return is refused there, at a declaration, and at a plain binding alike.
  expect(accepts('const f = (): string => (1 := uint8);')).toBe(false);
  expect(accepts('const f = (): string => { return (1 := uint8); };')).toBe(false);
  expect(accepts('let s: string = (1 := uint8);')).toBe(false);

  // D57's rule is NOT this one: a CONTEXTUAL `void` requires nothing of the
  // body, and only an arrow's OWN annotation refuses.
  expect(accepts('type VF = () => void; const h: VF = (() => "s");')).toBe(true);
  expect(accepts('const f = (): void => { return "s"; };')).toBe(false);
});

test('a spread supplies members for a MEMBERSHIP question', () => {
  // D64c: `objectLiteralShape` answers what TYPE a literal has and is
  // deliberately conservative - "a spread, a computed key, and a method each
  // yield NOTHING rather than an object type that omits what could not be read".
  //
  // That is right for a type and wrong for MEMBERSHIP. The missing-member rule
  // is not publishing a type; it asks whether a required key is present, and a
  // spread whose operand's type is KNOWN answers that. So `{ ...s }` at
  // `{ a: uint8, b: uint8 }` was accepted with `b` never supplied, while the
  // same members written plainly were refused.
  //
  // D64b changed the shape for EVERY caller and broke the conservatism test;
  // the split is why both can hold at once.
  const P = 'type P = { a: uint8, b: uint8 }; ';
  expect(accepts(`${P}const s: { a: uint8 } = { a: (1 := uint8) }; let p: P = { ...s };`)).toBe(false);
  expect(accepts(`${P}const s: { } = { }; let p: P = { ...s };`)).toBe(false);
  expect(accepts(`${P}const s: { a: uint8 } = { a: (1 := uint8) }; const t: { } = { }; let p: P = { ...s, ...t };`)).toBe(false);

  // A spread that supplies everything, or is completed by a named member.
  expect(accepts(`${P}const s: P = { a: (1 := uint8), b: (2 := uint8) }; let p: P = { ...s };`)).toBe(true);
  expect(accepts(`${P}const s: { a: uint8 } = { a: (1 := uint8) }; let p: P = { ...s, b: (2 := uint8) };`)).toBe(true);

  // The NULL is KEPT where the keys are genuinely unknowable: an UNANNOTATED
  // operand is ~any~ (D54), and a getter cannot be read. Enumerating either
  // would report every declared member as missing.
  expect(accepts(`${P}const s = { a: (1 := uint8) }; let p: P = { ...s };`)).toBe(true);
  expect(accepts(`${P}const s: { a: uint8 } = { a: (1 := uint8) }; let p: P = { ...s, get b() { return (2 := uint8); } };`)).toBe(true);

  // An OPTIONAL member the spread does not supply is still fine.
  expect(accepts('type Q = { a: uint8, b?: uint8 }; const s: { a: uint8 } = { a: (1 := uint8) }; let q: Q = { ...s };')).toBe(true);

  // The plain spelling and the freshness rules are unchanged.
  expect(accepts(`${P}let p: P = { a: (1 := uint8) };`)).toBe(false);
  expect(accepts('type E = { a: uint8 }; let e: E = { a: (1 := uint8), zz: "s" };')).toBe(false);
  expect(accepts('let c: { w: uint8 } | null = { };')).toBe(false);
});

test('a spread carries its members into the FRESHNESS rule', () => {
  // D64d: `checkObjectLiteralAgainst` walks `PropertyDefinitionList`, so a
  // spread - a PropertyDefinition with NO PropertyName - contributed no key and
  // the excess-member rule saw nothing. `{ ...u }` at `{ a: uint8 }` was
  // accepted with `u`'s excess `zz` unreported, while the same members written
  // plainly were refused.
  //
  // This is the THIRD site reading a literal's members, after the two D64c
  // split. It uses `objectLiteralMembers`, so the NULL is kept where the keys
  // are unknowable and an unknowable spread reports nothing rather than
  // everything.
  const U = 'const u: { a: uint8, zz: string } = { a: (1 := uint8), zz: "s" }; ';
  expect(accepts(`type E = { a: uint8 }; ${U}let e: E = { ...u };`)).toBe(false);
  expect(accepts(`type E = { a: uint8 }; ${U}let e: E = { a: (1 := uint8), ...u };`)).toBe(false);
  expect(accepts('type E = { a: uint8 }; let e: E = { a: (1 := uint8), zz: "s" };')).toBe(false);

  // A spread with nothing excess, and an UNANNOTATED operand whose keys are
  // unknowable (~any~ by D54), are both accepted.
  expect(accepts('type E = { a: uint8 }; const u: { a: uint8 } = { a: (1 := uint8) }; let e: E = { ...u };')).toBe(true);
  expect(accepts('type E = { a: uint8 }; const u = { a: (1 := uint8), zz: "s" }; let e: E = { ...u };')).toBe(true);

  // An INDEX SIGNATURE admits the key (D78), and an OPTIONAL member declares it.
  expect(accepts('type I = { [k: string]: int32 }; const u: { a: int32, zz: int32 } = { a: (1 := int32), zz: (2 := int32) }; let i: I = { ...u };')).toBe(true);
  expect(accepts(`type Q = { a: uint8, zz?: string }; ${U}let q: Q = { ...u };`)).toBe(true);
});

test('the LAST member writing a key decides its type', () => {
  // D64e: the walk had no notion of ORDER. It tested each member against the
  // target as it met it, so `{ a: (1 := uint8), ...t }` was accepted by checking
  // the NAMED `a` and never learning that `t`'s String `a` overwrote it, and
  // `{ ...u, ...t }` was accepted for the same reason one spread later.
  //
  // This is JavaScript's own evaluation order, not a type rule. A pre-pass finds
  // each key's last writer and the walk checks only that member.
  const P = 'type P = { a: uint8, b: uint8 }; ';
  const T = 'const t: { a: string, b: uint8 } = { a: "x", b: (2 := uint8) }; ';
  const U = 'const u: { a: uint8 } = { a: (1 := uint8) }; ';

  // A spread member the target declares must have the right TYPE...
  expect(accepts(`${P}${T}let p: P = { ...t };`)).toBe(false);
  expect(accepts(`${P}const s: { a: uint16, b: uint8 } = { a: (300 := uint16), b: (2 := uint8) }; let p: P = { ...s };`)).toBe(false);
  // ...including where it arrives via a second spread.
  expect(accepts(`${P}const s: { a: uint8 } = { a: (1 := uint8) }; const w: { b: string } = { b: "x" }; let p: P = { ...s, ...w };`)).toBe(false);

  // ORDER decides. A named member OVERWRITTEN by a later spread is refused;
  // one that overwrites an earlier spread is accepted.
  expect(accepts(`${P}${T}let p: P = { a: (1 := uint8), ...t };`)).toBe(false);
  expect(accepts(`${P}${T}let p: P = { ...t, a: (1 := uint8) };`)).toBe(true);
  expect(accepts(`${P}${T}${U}let p: P = { ...u, ...t };`)).toBe(false);
  expect(accepts(`${P}${T}${U}let p: P = { ...t, ...u };`)).toBe(true);

  // An UNANNOTATED operand is ~any~ (D54) and says nothing about its members.
  expect(accepts(`${P}const s = { a: "x", b: (2 := uint8) }; let p: P = { ...s };`)).toBe(true);

  // D64c's presence rule and D64d's excess rule are unchanged.
  expect(accepts(`${P}const s: { a: uint8 } = { a: (1 := uint8) }; let p: P = { ...s };`)).toBe(false);
  expect(accepts('type E = { a: uint8 }; const g: { a: uint8, zz: string } = { a: (1 := uint8), zz: "s" }; let e: E = { ...g };')).toBe(false);
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

  // Two members of ONE declaration are refused too (OQ25). The note here used to
  // say the run time accepted that, so refusing would introduce a disagreement -
  // measured, it does NOT: `interface P { n: int32, n: string }` THROWS at
  // declaration time, as do the object-type and same-type forms. The checker was
  // the half that was silent.
  //
  // The values told the same story from the other side: the run time requires a
  // value to satisfy EVERY member with the key, so `{ n: int32, n: string }` was
  // UNINHABITABLE while `let g: G = { n: (1 := int32) }` type-checked.
  expect(accepts('interface P { n: int32, n: string }')).toBe(false);
  expect(accepts('type G = { n: int32, n: string };')).toBe(false);
  // A SAME-type duplicate is refused as well - a deliberate tightening, since
  // the mistake is the duplication and the run time refuses it too.
  expect(accepts('type G = { n: int32, n: int32 };')).toBe(false);
  // ...and a duplicate KEY in a JS object LITERAL stays legal: that is
  // ECMA-262's rule about values, not this one about type members.
  expect(accepts('let o = { n: 1, n: 2 };')).toBe(true);
  expect(accepts('interface P { n: int32 } partial interface P { u: string }')).toBe(true);
});
