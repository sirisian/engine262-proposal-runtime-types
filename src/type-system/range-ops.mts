import { Value, NumberValue, ObjectValue, type TypedNumberValue } from '../value.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import { Throw } from '../host-defined/error-messages.mts';
import {
  isRangeObject, CreateRangeObject, endpointOf, type RangeObject, type RangeBound,
} from '../intrinsics/Range.mts';
import {
  F, R, surroundingAgent, type BigIntValue, type Realm,
} from '#self';

/**
 * proposal-runtime-types (ranges.md "Types", #sec-ranges): the operations
 * `RangeBounds` carries, and the interval arithmetic on top of them.
 *
 * Everything here works on an EDGE PAIR rather than on the four shapes, because
 * every one of these operations is a statement about a point set and an absent
 * endpoint is just an infinite one. A shape falls out of the result instead of
 * being chosen: intersecting a from-range with a to-range yields a two-endpoint
 * range, and negating a from-range yields a to-range, which is why each of these
 * returns a range rather than a range of some particular shape.
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

/** Descending is empty; at equal endpoints an open bound makes it empty. */
function intervalIsEmpty(iv: Interval): boolean {
  if (iv.lo.v === undefined || iv.hi.v === undefined) {
    return false;
  }
  return (iv.lo.open || iv.hi.open) ? iv.lo.v >= iv.hi.v : iv.lo.v > iv.hi.v;
}

// -- scaling -------------------------------------------------------------------

/**
 * Multiply both endpoints by a scalar.
 *
 * A negative factor reflects, so the endpoints exchange places AND carry their
 * bounds with them: the image of [a, b) under negation is (-b, -a]. That
 * exchange also swaps the one-ended shapes, a from-range scaling to a to-range.
 *
 * A zero factor is the case the obvious rule gets wrong: multiplying both
 * endpoints of `0..<10` gives the empty `0..<0`, where the image of a nonempty
 * range under multiplication by zero is the single point zero.
 */
export function rangeScale(a: RangeObject, factor: number, realmRec: Realm): RangeObject {
  const iv = toInterval(a);
  if (factor === 0) {
    if (intervalIsEmpty(iv)) {
      return fromInterval(iv, realmRec);
    }
    return fromInterval({ lo: { v: 0, open: false }, hi: { v: 0, open: false } }, realmRec);
  }
  const scaled = (e: Edge): Edge => ({ v: e.v === undefined ? undefined : e.v * factor, open: e.open });
  if (factor > 0) {
    return fromInterval({ lo: scaled(iv.lo), hi: scaled(iv.hi) }, realmRec);
  }
  return fromInterval({ lo: scaled(iv.hi), hi: scaled(iv.lo) }, realmRec);
}

// -- interval arithmetic -------------------------------------------------------

/** An edge is exclusive where either contributing edge is. */
function combine(x: Edge, y: Edge, f: (p: number, q: number) => number): Edge {
  if (x.v === undefined || y.v === undefined) {
    return { v: undefined, open: false };
  }
  return { v: f(x.v, y.v), open: x.open || y.open };
}

function add(a: Interval, b: Interval): Interval {
  return {
    lo: combine(a.lo, b.lo, (p, q) => p + q),
    hi: combine(a.hi, b.hi, (p, q) => p + q),
  };
}

/** The endpoints cross: the result's low is the left's low minus the right's HIGH. */
function subtract(a: Interval, b: Interval): Interval {
  return {
    lo: combine(a.lo, b.hi, (p, q) => p - q),
    hi: combine(a.hi, b.lo, (p, q) => p - q),
  };
}

function negate(a: Interval): Interval {
  const flip = (e: Edge): Edge => ({ v: e.v === undefined ? undefined : -e.v, open: e.open });
  return { lo: flip(a.hi), hi: flip(a.lo) };
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
  const a = toInterval(lval);
  const b = toInterval(rval);
  switch (op) {
    case '+':
      return fromInterval(add(a, b), realmRec);
    case '-':
      return fromInterval(subtract(a, b), realmRec);
    case '*':
      return fromInterval(multiply(a, b), realmRec);
    default:
      return fromInterval(divide(a, b), realmRec);
  }
}

export function rangeNegate(a: RangeObject, realmRec: Realm): RangeObject {
  return fromInterval(negate(toInterval(a)), realmRec);
}

/** `scale`'s factor, or null where the argument is not a usable scalar. */
export function scaleFactor(value: Value): number | null {
  return value instanceof NumberValue ? R(value) : null;
}
