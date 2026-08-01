import {
  Value, VectorValue, JSStringValue, type PropertyKeyValue,
} from '../value.mts';
import { Q } from '../completion.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { Throw } from '../host-defined/error-messages.mts';
import type { TypeRecord } from './records.mts';
import { displayType } from './records.mts';
import { SameType } from './relations.mts';
import { CanonicalizeType } from './intern.mts';
import {
  RequireType, CreateBuiltinFunction, ApplyStringOrNumericBinaryOperator,
} from '#self';
import type { ValueEvaluator } from '../evaluator.mts';

/**
 * The lane type and count of a vector's Type Record.
 *
 * proposal-runtime-types #sec-vector-types: `vector.<T, N>` carries both as its
 * arguments, so a vector value knows its own shape without inspecting lanes.
 */
export function vectorShape(v: VectorValue): { laneType: TypeRecord, laneCount: number } | null {
  const record = v.TypeRecord as { Kind?: string, Name?: string, Arguments?: readonly unknown[] };
  if (record?.Kind !== 'primitive' || record.Name !== 'vector' || record.Arguments?.length !== 2) {
    return null;
  }
  const [laneType, laneCount] = record.Arguments;
  return typeof laneCount === 'number' ? { laneType: laneType as TypeRecord, laneCount } : null;
}

/**
 * A property read on a vector, or undefined where the key is not one of its own.
 *
 * #sec-vector-lanes gives a vector a computed lane read and a horizontal sum.
 * A vector is a PRIMITIVE, so a member access on one is routed through GetV,
 * which boxes it; these are answered before the boxing so that a lane read does
 * not depend on a wrapper object existing.
 */
export function* vectorGet(v: VectorValue, key: PropertyKeyValue): PlainEvaluator<Value | undefined> {
  const shape = vectorShape(v);
  if (!shape) {
    return undefined;
  }
  // The key arrives as a NumberValue for `a[0]` and as a JSStringValue for
  // `a['0']`, and a lane read must accept both: a member access does not
  // canonicalize its key to a string before the reference is resolved, so a
  // check for one shape alone silently declines the ordinary spelling.
  const name = laneKeyName(key);
  if (name !== undefined) {
    // A canonical numeric key is a lane index. #sec-vector-lanes: the index is
    // an expression, so no static rule bounds it - reading a lane whose index
    // is not less than N throws a RangeError, where the constant form
    // `lane.<I>()` is refused before the program runs. That asymmetry is the
    // reason the design gives both forms.
    if (/^(0|[1-9][0-9]*)$/.test(name)) {
      const index = Number(name);
      if (index >= shape.laneCount) {
        return Q(Throw.RangeError('$1 is out of range for this vector', key)) as Value;
      }
      return v.lanes[index] as Value;
    }

    // #sec-vector-lanes: the horizontal sum. Its order is implementation-defined
    // - the clause says so, and for a binary floating-point lane type it is
    // observable, since addition is not associative there - so this folds left,
    // and a design needing a fixed order folds over `lane.<I>()` itself.
    if (name === 'sum') {
      return CreateBuiltinFunction(function* sumLanes(): ValueEvaluator {
        // `Q` is a macro and may not appear inside a conditional expression, so
        // the fold is written as a statement rather than a ternary.
        let total: Value | undefined;
        for (const lane of v.lanes) {
          if (total === undefined) {
            total = lane as Value;
          } else {
            total = Q(yield* ApplyStringOrNumericBinaryOperator(total, '+', lane as Value)) as Value;
          }
        }
        return total ?? Value(0);
      }, 0, Value('sum'), []) as Value;
    }

  }
  return undefined;
}

/**
 * A lane write. #sec-vector-lanes admits it and records that whether it should
 * be admitted at all is an open question of the design, since `withLane`
 * expresses the same intent without mutating a value type.
 */
export function* vectorSet(v: VectorValue, key: PropertyKeyValue, value: Value): PlainEvaluator<Value | undefined> {
  const shape = vectorShape(v);
  const name = shape ? laneKeyName(key) : undefined;
  if (!shape || name === undefined) {
    return undefined;
  }
  if (!/^(0|[1-9][0-9]*)$/.test(name)) {
    return undefined;
  }
  const index = Number(name);
  if (index >= shape.laneCount) {
    return Q(Throw.RangeError('$1 is out of range for this vector', key)) as Value;
  }
  const converted = Q(yield* RequireType(value, shape.laneType)) as Value;
  (v.lanes as Value[])[index] = converted;
  return converted;
}

/**
 * The canonical name of a property key that could be a lane index, or undefined.
 *
 * A NumberValue key is what `a[0]` produces and a JSStringValue is what `a['0']`
 * produces; both name the same lane. A member access does not canonicalize its
 * key to a string before the reference resolves, so accepting only one shape
 * silently declines the ordinary spelling - which is what it did.
 */
function laneKeyName(key: PropertyKeyValue | Value): string | undefined {
  if (key instanceof JSStringValue) {
    return key.stringValue();
  }
  const asNumber = (key as { numberValue?(): number }).numberValue?.();
  return typeof asNumber === 'number' && Number.isInteger(asNumber) && asNumber >= 0
    ? String(asNumber)
    : undefined;
}

/**
 * `v.lane.<I>()` and `v.withLane.<I>(value)`.
 *
 * proposal-runtime-types #sec-vector-lanes: the index is a compile-time
 * constant, and "it is a type error if I is not a non-negative integer less
 * than N" - which is the half of the asymmetry the computed form does not have,
 * since an index that is an expression cannot be checked before the access.
 *
 * `withLane` returns a NEW vector; the receiver is unchanged, which follows
 * from a vector being a value type and is what the design gives it for.
 */
export function* vectorConstantLane(
  v: VectorValue,
  method: 'lane' | 'withLane' | 'swizzle' | 'shuffle',
  typeArgs: readonly ParseNode.Type[],
  args: readonly Value[],
): PlainEvaluator<Value> {
  const shape = vectorShape(v);
  if (!shape) {
    return Q(Throw.TypeError('$1 is not a member of this vector', Value(method))) as Value;
  }

  // proposal-runtime-types #sec-vector-permutation. `swizzle` names a lane of
  // the receiver for each lane of its result and `shuffle` draws from two
  // sources, where "an index below N selects that lane of the receiver, and an
  // index from N to 2N-1 selects lane I-N of other".
  //
  // The result's lane count is the NUMBER OF INDICES rather than the
  // receiver's, so a permutation narrows and widens as readily as it reorders.
  if (method === 'swizzle' || method === 'shuffle') {
    const bound = method === 'shuffle' ? shape.laneCount * 2 : shape.laneCount;
    if (typeArgs.length < 1) {
      return Q(Throw.TypeError('$1 takes one lane index', Value(method))) as Value;
    }
    let other: VectorValue | undefined;
    if (method === 'shuffle') {
      const supplied = args[0];
      if (supplied?.type !== 'Vector' || !SameType((supplied as VectorValue).TypeRecord as TypeRecord, v.TypeRecord as TypeRecord)) {
        return Q(Throw.TypeError('$1 is not assignable to $2', supplied ?? Value.undefined, Value(displayType(v.TypeRecord as TypeRecord)))) as Value;
      }
      other = supplied as VectorValue;
    }
    const lanes: Value[] = [];
    for (const arg of typeArgs) {
      const at = laneIndexOf(arg);
      if (at === undefined || at >= bound) {
        return Q(Throw.TypeError(
          'lane $1 is out of range for a vector of $2 lanes',
          Value(at === undefined ? '?' : String(at)),
          Value(String(shape.laneCount)),
        )) as Value;
      }
      lanes.push(at < shape.laneCount
        ? v.lanes[at] as Value
        : (other as VectorValue).lanes[at - shape.laneCount] as Value);
    }
    const record = v.TypeRecord as { Kind: string, Name: string, Arguments: readonly unknown[] };
    return new VectorValue(lanes, CanonicalizeType({
      ...record,
      Arguments: [record.Arguments[0], lanes.length],
    } as unknown as TypeRecord));
  }

  if (typeArgs.length !== 1) {
    return Q(Throw.TypeError('$1 takes one lane index', Value(method))) as Value;
  }
  // The index is written as a type argument because it is a value generic in
  // the design - `lane<I: uint32>()` - so it arrives as a type node and its
  // literal value is read from it rather than evaluated.
  // The index arrives as a LiteralType, not a NumericLiteral: it is written in
  // a TYPE argument position, so the parser reads it as the literal TYPE of
  // that number rather than as an expression. `negated` carries the sign, which
  // a lane index may not have.
  const node = typeArgs[0] as unknown as { type?: string, kind?: string, value?: unknown, negated?: boolean };
  const index = node?.type === 'LiteralType' && node.kind === 'number' && !node.negated
    ? node.value as number
    : undefined;
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
    return Q(Throw.TypeError('$1 takes one lane index', Value(method))) as Value;
  }
  if (index >= shape.laneCount) {
    return Q(Throw.TypeError(
      'lane $1 is out of range for a vector of $2 lanes',
      Value(String(index)),
      Value(String(shape.laneCount)),
    )) as Value;
  }
  if (method === 'lane') {
    return v.lanes[index] as Value;
  }
  const replacement = Q(yield* RequireType(args[0] ?? Value.undefined, shape.laneType)) as Value;
  const lanes = [...v.lanes];
  lanes[index] = replacement;
  return new VectorValue(lanes, v.TypeRecord);
}

/**
 * Whether a lane type is `uint.<1>`, which makes its vector a BIT VECTOR.
 *
 * proposal-runtime-types #sec-vector-lanes: "Where the lane type is `uint.<1>`,
 * a lane and a bit coincide", and the conversion between such a vector and an
 * integer is that correspondence read in each direction. This is what the
 * design names `boolean1` and builds `boolean8` and its siblings from.
 */
export function isBitLaneType(laneType: TypeRecord): boolean {
  return laneType.Kind === 'primitive'
    && laneType.Name === 'uint'
    && laneType.Arguments.length === 1
    && laneType.Arguments[0] === 1;
}


/** The lane index a type argument names, or undefined where it is not one. */
function laneIndexOf(node: ParseNode.Type): number | undefined {
  const literal = node as unknown as { type?: string, kind?: string, value?: unknown, negated?: boolean };
  return literal?.type === 'LiteralType' && literal.kind === 'number' && !literal.negated
    && Number.isInteger(literal.value as number) && (literal.value as number) >= 0
    ? literal.value as number
    : undefined;
}
