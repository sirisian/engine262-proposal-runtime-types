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
function overlaps(m: TypeRecord, t: TypeRecord): boolean {
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
