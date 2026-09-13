import {
  makePrimitive, type TypeRecord,
} from './records.mts';
import { AreDisjoint, IsAssignable, IsSubtype } from './relations.mts';
import { CanonicalizeType } from './intern.mts';

/**
 * proposal-runtime-types (spec, narrowing): NarrowTo and NarrowFrom are the two
 * halves of every narrowing row. A test over a value of Static Type _s_ against a
 * type _t_ splits _s_ in two: NarrowTo(_s_, _t_) is what the value may be where the
 * test SUCCEEDS, and NarrowFrom(_s_, _t_) is what it may be where the test FAILS.
 * Either may come back ~empty~, meaning that branch is unreachable, and the
 * specification makes that a type error rather than narrowing to `never`: a branch
 * the program wrote and can never take is dead code, not a computation.
 *
 * The sentinel is the string 'empty' rather than a Type Record, deliberately, so a
 * caller cannot confuse it with the `never` type.
 */
export const empty = 'empty';
export type NarrowResult = TypeRecord | typeof empty;

/**
 * `null | undefined`, the type the nullish narrowing forms test against. Each is
 * the literal type of the one value it holds, the same records the checker builds
 * for a written `null` or `undefined` annotation.
 */
export function nullishType(): TypeRecord {
  return {
    Kind: 'union',
    Members: [
      makePrimitive('null'),
      // proposal-runtime-types #sec-null-and-undefined-types: the nullish half
      // is the `undefined` TYPE, not a literal over ~void~. Built over ~void~ it
      // shared no member with a `T | undefined` annotation, so `x ?? d` on the
      // very union the clause names as the optional position was reported as a
      // test that "can never succeed" - dead-code diagnosis of live code.
      makePrimitive('undefined'),
    ],
  } as TypeRecord;
}

function membersOf(t: TypeRecord): readonly TypeRecord[] {
  return t.Kind === 'union' ? (t as { Members: readonly TypeRecord[] }).Members : [t];
}

function isAny(t: TypeRecord): boolean {
  return t.Kind === 'any';
}

function fromMembers(kept: readonly TypeRecord[]): NarrowResult {
  if (kept.length === 0) {
    return empty;
  }
  if (kept.length === 1) {
    return kept[0]!;
  }
  return { Kind: 'union', Members: [...kept] } as TypeRecord;
}

/**
 * Whether a value whose type is _m_ could be one of _t_. Assignability in either
 * direction means the two overlap: _m_ within _t_ means every such value passes,
 * and _t_ within _m_ means some do. Anything involving ~any~ overlaps, since an
 * unknown type must not manufacture a diagnostic.
 */
/**
 * The names `typeof` answers *"number"* for.
 *
 * `sec-narrowing`: "`typeof` is unchanged: it
 * reports *number* for every numeric type, so `typeof v === "number"` narrows
 * `uint8 | string` to `uint8`".
 */
const typeofNumberNames = new Set([
  // The integers are named `uint` and `int` with a WIDTH ARGUMENT, not
  // `uint8`: a list of the spelled names matched the floats and missed every
  // integer, which is why the clause's own `uint8 | string` example still
  // failed after the floats were fixed.
  'number', 'uint', 'int',
  'float16', 'float32', 'float64', 'float128',
  'decimal32', 'decimal64', 'decimal128',
]);

/** Whether _t_ is the `number` type, which a `typeof` test names as a CATEGORY. */
function isNumberCategory(t: TypeRecord): boolean {
  return t.Kind === 'primitive' && t.Name === 'number';
}


/**
 * Whether _m_ and _t_ overlap only through the `typeof` CATEGORY rule, which is
 * not a subtype relation and so is invisible to the steps below.
 *
 * This superseded an `overlaps` that answered the whole question - assignability
 * in either direction, with ~any~ overlapping everything - which was left behind
 * unused when the steps below took that general half over directly. Why the
 * category half still needs stating is unchanged: a `typeof` test names a
 * CATEGORY of types rather than one type, and the specification makes `number`
 * disjoint from the sized numeric types, which is right for assignment and wrong
 * for a `typeof` narrowing.
 */
function categoryOverlap(m: TypeRecord, t: TypeRecord): boolean {
  return (isNumberCategory(t) && m.Kind === 'primitive' && typeofNumberNames.has(m.Name))
    || (isNumberCategory(m) && t.Kind === 'primitive' && typeofNumberNames.has(t.Name));
}

/**
 * The part of _s_ that remains where a test against _t_ succeeds.
 *
 * #sec-narrowto, step for step. This was a member FILTER before: it kept every
 * member of _s_ that overlapped _t_ and never replaced one with the narrower
 * _t_, so three of the clause's answers were missing.
 *
 *   - An ~any~ source stayed `any` where step 1 returns _t_, so a checked value
 *     learned nothing from the check.
 *   - A union member WIDER than _t_ was kept whole where step 2 keeps _t_:
 *     `if (s === "a")` over a `string | uint8` left `s` at `string`, and
 *     `let x: "a" = s` inside the branch was refused on the strength of the
 *     narrowing that had just succeeded.
 *   - A non-union source overlapping _t_ without either being a subtype came
 *     back ~empty~ where the final step returns their INTERSECTION, so
 *     `o is { b: string }` over an `o: { a: uint8 }` was reported as a test that
 *     can never succeed - dead-code diagnosis of live code, the same fault the
 *     nullish rows carried before.
 *
 * The `typeof` category is carried through as a fourth way to keep a member.
 * It has to be: the clause's own example narrows `uint8 | string` by
 * `typeof v === "number"`, and #sec-numeric-types-of-this-proposal makes
 * `number` disjoint from every sized numeric type, so neither subtype test
 * above can see the overlap and the plain algorithm would drop both members.
 */
export function NarrowTo(s: TypeRecord, t: TypeRecord): NarrowResult {
  if (isAny(s)) {
    return t;
  }
  // Not a step of its own: IsSubtype(_s_, ~any~) holds, so the third step would
  // return _s_ anyway. Written out because it is reached far more often than it
  // is derived.
  if (isAny(t)) {
    return s;
  }
  if (s.Kind === 'union') {
    const kept: TypeRecord[] = [];
    let tKept = false;
    for (const m of (s as { Members: readonly TypeRecord[] }).Members) {
      if (IsSubtype(m, t, [])) {
        kept.push(m);
      } else if (IsSubtype(t, m, [])) {
        // The narrower of the two, and once however many members admit it.
        if (!tKept) {
          kept.push(t);
          tKept = true;
        }
      } else if (categoryOverlap(m, t)) {
        kept.push(m);
      }
    }
    if (kept.length === 0) {
      return empty;
    }
    return fromMembers(kept);
  }
  if (IsSubtype(s, t, [])) {
    return s;
  }
  if (IsSubtype(t, s, [])) {
    return t;
  }
  if (categoryOverlap(s, t)) {
    return s;
  }
  if (AreDisjoint(s, t)) {
    return empty;
  }
  return CanonicalizeType({ Kind: 'intersection', Members: [s, t] } as TypeRecord);
}

/**
 * The part of _s_ that remains where a test against _t_ fails. A member wholly
 * within _t_ always passes the test and so contributes nothing here; a member that
 * merely overlaps _t_ survives, since some of its values fail.
 */
export function NarrowFrom(s: TypeRecord, t: TypeRecord): NarrowResult {
  if (isAny(s) || isAny(t)) {
    return s;
  }
  return fromMembers(membersOf(s).filter((m) => !IsAssignable(m, t)));
}
