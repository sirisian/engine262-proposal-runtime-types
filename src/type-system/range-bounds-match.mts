import type { TypeRecord } from './records.mts';
import { isRangeObject, type RangeObject, type RangeBound } from '../intrinsics/Range.mts';

/** Every name #sec-ranges gives a range value, shapes and interface alike. */
export function isRangeShapeName(name: string): boolean {
  return name === 'Range' || name === 'RangeFrom' || name === 'RangeTo'
    || name === 'RangeFull' || name === 'RangeBounds';
}

/**
 * Whether a value is of one of the four shapes, or of `RangeBounds`.
 *
 * Decided by the VALUE rather than by a prototype chain, because the four shapes
 * share one prototype here - the shapes are the type system's classification of
 * a single dynamic representation, and an absent endpoint is how that
 * representation says which one it has. Only `Range` is a global binding, so the
 * prototype path could not answer for the other three at all.
 */
export function rangeShapeMatches(value: unknown, name: string): boolean {
  if (!isRangeObject(value as never)) {
    return false;
  }
  const r = value as RangeObject;
  const hasStart = r.RangeStart !== undefined;
  const hasEnd = r.RangeEnd !== undefined;
  switch (name) {
    case 'RangeBounds': return true; // the interface every shape implements
    case 'Range': return hasStart && hasEnd;
    case 'RangeFrom': return hasStart && !hasEnd;
    case 'RangeTo': return !hasStart && hasEnd;
    default: return !hasStart && !hasEnd; // RangeFull
  }
}

/**
 * The ordinal a bound argument denotes, or null where the argument is not one.
 *
 * `Range.Bound.Closed` is 0 and `Range.Bound.Open` is 1, so a bound reaches a
 * type argument either as the ordinal itself (a value generic) or as a literal
 * type carrying it, and both spellings mean the same bound.
 */
function boundOrdinal(arg: TypeRecord | number): number | null {
  if (typeof arg === 'number') {
    return arg;
  }
  const t = arg as { Kind?: string, Value?: { numberValue?(): number } };
  if (t?.Kind === 'literal' && typeof t.Value?.numberValue === 'function') {
    return t.Value.numberValue();
  }
  return null;
}

function ordinalOf(bound: RangeBound | undefined): number | null {
  return bound === undefined ? null : (bound === 'open' ? 1 : 0);
}

/**
 * Whether a range's own bounds are the ones its type's arguments name.
 *
 * `Range.<T, S, E>` names both, `RangeFrom.<T, S>` and `RangeTo.<T, E>` the one
 * their shape has. An argument that is not a bound - a type parameter still
 * standing for one, say - constrains nothing and is skipped, so a generic
 * `Range.<T, S, E>` still admits every range.
 */
export function rangeMatchesBoundArguments(value: unknown, name: string, args: readonly (TypeRecord | number)[]): boolean {
  if (!isRangeObject(value as never)) {
    return false;
  }
  const r = value as RangeObject;
  const expected: (RangeBound | undefined)[] = name === 'RangeTo'
    ? [r.RangeEndBound]
    : (name === 'RangeFrom' ? [r.RangeStartBound] : [r.RangeStartBound, r.RangeEndBound]);
  for (let i = 0; i < expected.length; i += 1) {
    const arg = args[i + 1];
    if (arg === undefined) {
      continue;
    }
    const wanted = boundOrdinal(arg);
    if (wanted === null) {
      continue; // not a bound; constrains nothing
    }
    if (ordinalOf(expected[i]) !== wanted) {
      return false;
    }
  }
  return true;
}
