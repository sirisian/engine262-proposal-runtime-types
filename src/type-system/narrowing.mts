import {
  makePrimitive, type TypeRecord,
} from './records.mts';
import { IsAssignable } from './relations.mts';

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
 * PLAN-brand-layering-F.md F182. `sec-narrowing`: "`typeof` is unchanged: it
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

function overlaps(m: TypeRecord, t: TypeRecord): boolean {
  // F182. A `typeof` test names a CATEGORY of types, not one type. The
  // specification is explicit that `number` is disjoint from the sized numeric
  // types - "no other numeric type is assignable to it and it is assignable to
  // no other numeric type" - which is right for ASSIGNMENT and wrong here: it
  // made `typeof v === "number"` narrow `uint8 | string` to nothing, and the
  // checker rejected the clause's own example as dead code.
  //
  // Applied at `overlaps` because it is the single decision both `NarrowTo` and
  // `NarrowFrom` reach, so the true and false branches stay each other's
  // complement.
  if (isNumberCategory(t) && m.Kind === 'primitive' && typeofNumberNames.has(m.Name)) {
    return true;
  }
  if (isNumberCategory(m) && t.Kind === 'primitive' && typeofNumberNames.has(t.Name)) {
    return true;
  }
  return isAny(m) || isAny(t) || IsAssignable(m, t) || IsAssignable(t, m);
}

/** The part of _s_ that remains where a test against _t_ succeeds. */
export function NarrowTo(s: TypeRecord, t: TypeRecord): NarrowResult {
  if (isAny(s) || isAny(t)) {
    return s;
  }
  return fromMembers(membersOf(s).filter((m) => overlaps(m, t)));
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
