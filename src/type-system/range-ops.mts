import { Value, NumberValue, ObjectValue, type TypedNumberValue } from '../value.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import { Throw } from '../host-defined/error-messages.mts';
import {
  isRangeObject, CreateRangeObject, endpointOf, type RangeObject, type RangeBound,
} from '../intrinsics/Range.mts';
import { NumericRangeAdd } from './range-addition.mts';
import {
  F, surroundingAgent, type BigIntValue, type Realm,
} from '#self';

/**
 * Binary interval dispatch. Addition/subtraction use the exact, typed path in
 * range-addition.mts. Multiplication/division below still use the legacy Number
 * edge algebra and require their own domain and enclosure audit.
 */

/** One end of an interval: a value, or ~undefined~ for an infinite side. */
interface Edge {
  v: number | undefined;
  open: boolean;
}

interface Interval {
  lo: Edge;
  hi: Edge;
}

/**
 * An endpoint as this module's interval algebra holds it.
 *
 * A range may be written over a bigint type, and `R` hands back a bigint for
 * one. The algebra below is numeric throughout - it scales and divides
 * endpoints, and rebuilds them with `F` - so a bigint endpoint is taken as its
 * double here. That is exact to 2**53 and lossy past it; carrying the kind
 * through instead would mean making the interval arithmetic itself generic,
 * which is a larger change than this module currently supports.
 */
function edgeOf(v: NumberValue | BigIntValue | TypedNumberValue): number {
  // Through `endpointOf`, so a TYPED endpoint reads the same way it does
  // everywhere else. Interval arithmetic is over Number, so a bigint endpoint
  // narrows here rather than at each operation.
  const n = endpointOf(v)!;
  return typeof n === 'bigint' ? Number(n) : n;
}

/**
 * The interval arithmetic here is over Numbers, so an endpoint of a
 * user-declared ordered type has no edge: `Ordered` gives comparison and not
 * arithmetic.
 */
function numericEdge(v: Value | undefined): number | undefined {
  if (v === undefined || v instanceof ObjectValue) {
    return undefined;
  }
  return edgeOf(v as NumberValue | TypedNumberValue);
}

function toInterval(r: RangeObject): Interval {
  return {
    lo: { v: numericEdge(r.RangeStart), open: r.RangeStartBound === 'open' },
    hi: { v: numericEdge(r.RangeEnd), open: r.RangeEndBound === 'open' },
  };
}

function bound(e: Edge): RangeBound | undefined {
  return e.v === undefined ? undefined : (e.open ? 'open' : 'closed');
}

function fromInterval(iv: Interval, realmRec: Realm): RangeObject {
  return CreateRangeObject(
    iv.lo.v === undefined ? undefined : F(iv.lo.v),
    iv.hi.v === undefined ? undefined : F(iv.hi.v),
    bound(iv.lo),
    bound(iv.hi),
    realmRec,
  );
}

const FULL: Interval = { lo: { v: undefined, open: false }, hi: { v: undefined, open: false } };

// -- interval arithmetic -------------------------------------------------------

/** An edge is exclusive where either contributing edge is. */
function combine(x: Edge, y: Edge, f: (p: number, q: number) => number): Edge {
  if (x.v === undefined || y.v === undefined) {
    return { v: undefined, open: false };
  }
  return { v: f(x.v, y.v), open: x.open || y.open };
}

/**
 * The four products of the endpoints, the least and the greatest being the
 * result's.
 *
 * The exclusivity rule is the one worth stating: a result bound is exclusive
 * ONLY where every product attaining it involves an exclusive source bound. So
 * a bound is closed as soon as ONE attaining combination is closed on both
 * sides, which is how a zero endpoint can reach a product that another
 * combination only approaches.
 */
function multiply(a: Interval, b: Interval): Interval {
  const bounded = a.lo.v !== undefined && a.hi.v !== undefined
    && b.lo.v !== undefined && b.hi.v !== undefined;
  if (bounded) {
    const combos = [
      { p: a.lo.v! * b.lo.v!, closed: !a.lo.open && !b.lo.open },
      { p: a.lo.v! * b.hi.v!, closed: !a.lo.open && !b.hi.open },
      { p: a.hi.v! * b.lo.v!, closed: !a.hi.open && !b.lo.open },
      { p: a.hi.v! * b.hi.v!, closed: !a.hi.open && !b.hi.open },
    ];
    const lo = Math.min(...combos.map((c) => c.p));
    const hi = Math.max(...combos.map((c) => c.p));
    return {
      lo: { v: lo, open: !combos.some((c) => c.p === lo && c.closed) },
      hi: { v: hi, open: !combos.some((c) => c.p === hi && c.closed) },
    };
  }
  // Partially bounded: propagate what can be said. Two non-negative lows give a
  // low, since the product of two values at or above their lows is at or above
  // the product of the lows.
  const nonNegative = a.lo.v !== undefined && a.lo.v >= 0 && b.lo.v !== undefined && b.lo.v >= 0;
  if (nonNegative) {
    return {
      lo: combine(a.lo, b.lo, (p, q) => p * q),
      hi: combine(a.hi, b.hi, (p, q) => p * q),
    };
  }
  return FULL;
}

/**
 * The reciprocal of an interval BOUNDED AWAY FROM ZERO, or null where it is not.
 *
 * A divisor that merely excludes zero at an open endpoint, like `0<..=1`, is not
 * enough: its values approach zero, so the quotient is unbounded. The endpoints
 * exchange places as they do under negation, and an infinite side becomes an
 * open zero, since 1/x tends to zero without reaching it.
 */
function reciprocal(b: Interval): Interval | null {
  const strictlyPositive = b.lo.v !== undefined && b.lo.v > 0;
  const strictlyNegative = b.hi.v !== undefined && b.hi.v < 0;
  if (!strictlyPositive && !strictlyNegative) {
    return null;
  }
  const inv = (e: Edge): Edge => (e.v === undefined ? { v: 0, open: true } : { v: 1 / e.v, open: e.open });
  return { lo: inv(b.hi), hi: inv(b.lo) };
}

function divide(a: Interval, b: Interval): Interval {
  const inv = reciprocal(b);
  return inv === null ? FULL : multiply(a, inv);
}

// -- dispatch ------------------------------------------------------------------

/** The binary operators interval arithmetic defines over two ranges. */
export type RangeBinaryOperator = '+' | '-' | '*' | '/';

export function isRangeBinaryOperator(op: string): op is RangeBinaryOperator {
  return op === '+' || op === '-' || op === '*' || op === '/';
}

export function* rangeBinaryOperator(lval: Value, op: RangeBinaryOperator, rval: Value): ValueEvaluator {
  const realmRec = surroundingAgent.currentRealmRecord;
  if (!isRangeObject(lval) || !isRangeObject(rval)) {
    // A range and a non-range have no interval arithmetic between them; the
    // scalar case is `scale`, which is a method rather than an operator.
    return Throw.TypeError('interval arithmetic needs two ranges');
  }
  if (op === '+' || op === '-') return yield* NumericRangeAdd(lval, rval, op === '-', realmRec);
  const a = toInterval(lval);
  const b = toInterval(rval);
  switch (op) {
    case '*':
      return fromInterval(multiply(a, b), realmRec);
    default:
      return fromInterval(divide(a, b), realmRec);
  }
}
