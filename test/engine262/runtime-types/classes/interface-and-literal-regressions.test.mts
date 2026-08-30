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

  // A UNION is deliberately untouched - satisfied by ONE arm, so a key with a
  // different type in each has no single answer.
  expect(accepts('let c: { x: int32 } | { y: string } = { x: 1 };')).toBe(false);

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
