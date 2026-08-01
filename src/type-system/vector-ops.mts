import {
  Value, VectorValue, JSStringValue, type PropertyKeyValue,
} from '../value.mts';
import { Q } from '../completion.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import { Throw } from '../host-defined/error-messages.mts';
import type { TypeRecord } from './records.mts';
import { RequireType } from '#self';

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
