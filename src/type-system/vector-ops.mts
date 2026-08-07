import {
  Value, VectorValue, JSStringValue, ObjectValue, type PropertyKeyValue,
} from '../value.mts';
import { Q } from '../completion.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { Throw } from '../host-defined/error-messages.mts';
import type { TypeRecord } from './records.mts';
import { displayType } from './records.mts';
import { SameType } from './relations.mts';
import { currentContextualType } from './runtime.mts';
import { CanonicalizeType } from './intern.mts';
import {
  RequireType, CreateBuiltinFunction, ApplyStringOrNumericBinaryOperator, CheckedConvertValue,
  OrdinaryObjectCreate, OrdinaryGetOwnProperty, OrdinaryOwnPropertyKeys, Descriptor,
  type Arguments,
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
    // proposal-runtime-types #sec-vector-component-accessors: `v.x` is
    // `v.lane.<0>()` and `v.xzzw` is `v.swizzle.<0, 2, 2, 3>()`. The accessors
    // are PROPERTIES rather than syntax, which is why they are answered here -
    // a computed access and Reflect.get reach the same value the dotted one
    // does, and that is the observable difference the clause turns on.
    const componentLanes = componentAccessorIndices(name, shape.laneCount);
    if (componentLanes) {
      if (componentLanes.length === 1) {
        return v.lanes[componentLanes[0]!] as Value;
      }
      const record = v.TypeRecord as { Arguments: readonly unknown[] };
      return new VectorValue(
        componentLanes.map((at) => v.lanes[at] as Value),
        CanonicalizeType({
          ...(v.TypeRecord as object),
          Arguments: [record.Arguments[0], componentLanes.length],
        } as unknown as TypeRecord),
      );
    }

    // proposal-runtime-types #sec-vector-masks: the operations that CONSUME a
    // mask. Declared on a vector whose lane type is `uint.<1>` alone, which is
    // what the design names boolean_N.
    if ((name === 'all' || name === 'any') && isBitLaneType(shape.laneType)) {
      const set = v.lanes.map((lane) => (lane as { numberValue?(): number }).numberValue?.() === 1);
      const answer = name === 'all' ? set.every((x) => x) : set.some((x) => x);
      return CreateBuiltinFunction(function* reduceMask(): ValueEvaluator {
        return answer ? Value.true : Value.false;
      }, 0, Value(name), []) as Value;
    }
    if (name === 'select' && isBitLaneType(shape.laneType)) {
      // "Lane j of the result is lane j of whenSet where lane j of the receiver
      // is set, and lane j of whenClear otherwise." U is NOT the receiver's lane
      // type: a mask selects between vectors of any lane type sharing its count.
      //
      // Both arguments are evaluated, because this is a CALL and not a
      // conditional - which is the trade the operation exists to make.
      return CreateBuiltinFunction(function* selectLanes([whenSet = Value.undefined, whenClear = Value.undefined]: Arguments): ValueEvaluator {
        if (whenSet?.type !== 'Vector' || whenClear?.type !== 'Vector') {
          return Q(Throw.TypeError('$1 is not assignable to $2', whenSet ?? Value.undefined, Value('a vector')));
        }
        if (!SameType((whenSet as VectorValue).TypeRecord as TypeRecord, (whenClear as VectorValue).TypeRecord as TypeRecord)) {
          return Q(Throw.TypeError('$1 is not assignable to $2', whenClear, Value(displayType((whenSet as VectorValue).TypeRecord as TypeRecord))));
        }
        const chosenShape = vectorShape(whenSet as VectorValue);
        if (!chosenShape || chosenShape.laneCount !== shape.laneCount) {
          return Q(Throw.TypeError('$1 is not assignable to $2', whenSet, Value(displayType(v.TypeRecord as TypeRecord))));
        }
        const chosen: Value[] = [];
        for (let i = 0; i < shape.laneCount; i += 1) {
          const bit = (v.lanes[i] as { numberValue?(): number }).numberValue?.() === 1;
          chosen.push((bit ? (whenSet as VectorValue).lanes[i] : (whenClear as VectorValue).lanes[i]) as Value);
        }
        return new VectorValue(chosen, (whenSet as VectorValue).TypeRecord);
      }, 2, Value('select'), []) as Value;
    }

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
 * A lane write. #sec-vector-lanes admits it, and the question of whether it
 * should be admitted at all is now closed there: `withLane` was thought to make
 * it redundant, and does not, because withLane's index is a COMPILE-TIME
 * CONSTANT. Refusing the assignment would leave a lane whose index is computed
 * with no way to be written.
 */
export function* vectorSet(v: VectorValue, key: PropertyKeyValue, value: Value): PlainEvaluator<Value | undefined> {
  const shape = vectorShape(v);
  if (!shape) {
    return undefined;
  }
  // #sec-vector-component-accessors: "an accessor naming no lane twice is
  // assignable, one naming a lane twice is not, since an assignment to it would
  // give one lane two values". The write replaces the named lanes with the
  // corresponding lanes of the assigned value.
  if (key instanceof JSStringValue) {
    const componentLanes = componentAccessorIndices(key.stringValue(), shape.laneCount);
    if (componentLanes) {
      if (!isAssignableAccessor(componentLanes)) {
        return Q(Throw.TypeError('$1 names a lane twice and cannot be assigned to', key)) as Value;
      }
      if (componentLanes.length === 1) {
        const converted = Q(yield* RequireType(value, shape.laneType)) as Value;
        (v.lanes as Value[])[componentLanes[0]!] = converted;
        return converted;
      }
      if (value.type !== 'Vector' || (value as VectorValue).lanes.length !== componentLanes.length) {
        return Q(Throw.TypeError('$1 is not assignable to $2', value, key)) as Value;
      }
      componentLanes.forEach((at, from) => {
        (v.lanes as Value[])[at] = (value as VectorValue).lanes[from] as Value;
      });
      return value;
    }
  }
  const name = laneKeyName(key);
  if (name === undefined) {
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


const COMPONENT_SETS = ['xyzw', 'rgba'];

/**
 * The lane indices a component accessor names, or null where the key is not one.
 *
 * proposal-runtime-types #sec-vector-component-accessors states five rules and
 * these are all of them: at most four lanes; a key of one to four characters;
 * every character drawn from ONE set, so a key mixing them is not an accessor;
 * and every character's index less than the lane count.
 *
 * `xyzw` and `rgba` name the same lanes in that order, so `v.x` and `v.r` are
 * one lane and `v.wzyx` and `v.abgr` are one permutation.
 */
export function componentAccessorIndices(name: string, laneCount: number): number[] | null {
  if (laneCount > 4 || name.length < 1 || name.length > 4) {
    return null;
  }
  for (const set of COMPONENT_SETS) {
    const indices: number[] = [];
    let matched = true;
    for (const character of name) {
      const at = set.indexOf(character);
      if (at < 0 || at >= laneCount) {
        matched = false;
        break;
      }
      indices.push(at);
    }
    if (matched) {
      return indices;
    }
  }
  return null;
}

/** Whether a component accessor may be assigned to: no lane named twice. */
export function isAssignableAccessor(indices: readonly number[]): boolean {
  return new Set(indices).size === indices.length;
}

/**
 * A binary operator over vectors, applied lane-wise.
 *
 * proposal-runtime-types #sec-vector-types: a vector's values are "the
 * sequences of N values of T", so an operator over two vectors of one shape
 * yields the vector of the operator applied to corresponding lanes. Two vectors
 * of different shapes are not operands of one operator.
 *
 * A vector and a LANE VALUE also pair, since the lane value broadcasts
 * (#sec-vector-lanes) - `v * 2` is `v * float32x4(2)` - which is what makes the
 * ordinary arithmetic of a kernel readable.
 */
export function* vectorBinaryOperator(
  lval: Value,
  opText: string,
  rval: Value,
): PlainEvaluator<Value> {
  const leftShape = lval.type === 'Vector' ? vectorShape(lval as VectorValue) : null;
  const rightShape = rval.type === 'Vector' ? vectorShape(rval as VectorValue) : null;
  const shape = leftShape ?? rightShape;
  if (!shape) {
    return Q(Throw.TypeError('$1 is not assignable to $2', rval, lval)) as Value;
  }
  if (leftShape && rightShape
      && !SameType((lval as VectorValue).TypeRecord as TypeRecord, (rval as VectorValue).TypeRecord as TypeRecord)) {
    return Q(Throw.TypeError(
      '$1 is not assignable to $2',
      rval,
      Value(displayType((lval as VectorValue).TypeRecord as TypeRecord)),
    )) as Value;
  }
  const carrier = (leftShape ? lval : rval) as VectorValue;
  const lanes: Value[] = [];
  for (let i = 0; i < shape.laneCount; i += 1) {
    const left = leftShape ? (lval as VectorValue).lanes[i] as Value : lval;
    const right = rightShape ? (rval as VectorValue).lanes[i] as Value : rval;
    lanes.push(Q(yield* ApplyStringOrNumericBinaryOperator(left, opText as never, right)) as Value);
  }
  return new VectorValue(lanes, carrier.TypeRecord);
}

/** The mask type for a vector of N lanes: `vector.<uint.<1>, N>`. */
function maskTypeFor(laneCount: number): TypeRecord {
  return CanonicalizeType({
    Kind: 'primitive',
    Name: 'vector',
    Arguments: [{ Kind: 'primitive', Name: 'uint', Arguments: [1] }, laneCount],
  } as unknown as TypeRecord);
}

/**
 * A comparison between vectors, per #sec-vector-comparisons.
 *
 * "A comparison between two vectors of one shape yields one lane per input
 * lane", and the result here is the bit-vector form: lane i is 1 where the
 * comparison holds for lane i and 0 where it does not. The clause's other two
 * result forms are selected by the expected type through return-type
 * overloading, which this engine does not yet reach for vectors.
 */
export function* vectorComparison(
  lval: Value,
  operator: string,
  rval: Value,
): PlainEvaluator<Value> {
  const leftShape = lval.type === 'Vector' ? vectorShape(lval as VectorValue) : null;
  const rightShape = rval.type === 'Vector' ? vectorShape(rval as VectorValue) : null;
  const shape = leftShape ?? rightShape;
  if (!shape) {
    return Q(Throw.TypeError('$1 is not assignable to $2', rval, lval)) as Value;
  }
  if (leftShape && rightShape
      && !SameType((lval as VectorValue).TypeRecord as TypeRecord, (rval as VectorValue).TypeRecord as TypeRecord)) {
    return Q(Throw.TypeError(
      '$1 is not assignable to $2',
      rval,
      Value(displayType((lval as VectorValue).TypeRecord as TypeRecord)),
    )) as Value;
  }
  // proposal-runtime-types #sec-vector-comparisons: the result form is chosen
  // by the expected type, and "left with no expected type the expression is
  // ambiguous among them and is a type error, so the result's type is written".
  //
  // The three forms are the compact mask, the wide mask, and the compared
  // vector type itself. The comparison computes the COMPACT one and the
  // conversion reaches the other two, so the selection here is only whether a
  // contextual type exists - not which of three to build.
  const expected = currentContextualType();
  if (!expected) {
    return Q(Throw.TypeError(
      'the comparison is ambiguous among its result forms; write the result type',
    )) as Value;
  }
  const lanes: Value[] = [];
  const maskType = maskTypeFor(shape.laneCount);
  const bitType = (maskType as { Arguments: readonly unknown[] }).Arguments[0] as TypeRecord;
  for (let i = 0; i < shape.laneCount; i += 1) {
    const left = leftShape ? (lval as VectorValue).lanes[i] as Value : lval;
    const right = rightShape ? (rval as VectorValue).lanes[i] as Value : rval;
    const l = (left as { numberValue?(): number }).numberValue?.() ?? NaN;
    const r = (right as { numberValue?(): number }).numberValue?.() ?? NaN;
    // #sec-vector-comparisons: "Which comparison each operator performs on a
    // lane is what it performs on a scalar." A hardware comparison chooses among
    // predicates differing on whether a NaN operand compares true (unordered) or
    // false (ordered); `<`, `<=`, `>`, `>=` and `==` are ordered and `!=` is
    // unordered, which is exactly what the JavaScript operators below already do
    // - `NaN < 1` and `NaN === NaN` are false, and `NaN !== NaN` is true.
    let holds = false;
    if (operator === '<') {
      holds = l < r;
    } else if (operator === '>') {
      holds = l > r;
    } else if (operator === '<=') {
      holds = l <= r;
    } else if (operator === '>=') {
      holds = l >= r;
    } else if (operator === '==') {
      holds = l === r;
    } else {
      holds = l !== r;
    }
    lanes.push(Q(yield* CheckedConvertValue(Value(holds ? 1 : 0), bitType)) as Value);
  }
  return new VectorValue(lanes, maskType);
}

/**
 * The object a vector boxes to, per #sec-vector-component-accessors.
 *
 * The clause states four observable consequences of accessors being PROPERTIES
 * rather than syntax: `'xyz' in v` is true, `v['xyz']` and `Reflect.get` reach
 * the accessor, `Object.keys(v)` is empty, and the prototype's own property
 * names include every accessor.
 *
 * The names are COMPUTED rather than installed. Two alternatives were ruled out
 * by measurement: eager per-type prototypes cost 680 names across 12 four-lane
 * types, 8160 property definitions per realm before any program runs; and one
 * shared prototype cannot answer `'z' in v` differently for a four-lane and a
 * two-lane receiver, which the third accessor rule requires. Computing from the
 * receiver's own lane count has neither problem, and is what String exotic
 * objects do for their index properties.
 */
export function VectorWrapperCreate(v: VectorValue, proto: ObjectValue): ObjectValue {
  const shape = vectorShape(v);
  const laneCount = shape?.laneCount ?? 0;
  const obj = OrdinaryObjectCreate(proto, []) as ObjectValue & { VectorData?: VectorValue };
  obj.VectorData = v;

  obj.GetOwnProperty = function* GetOwnProperty(key) {
    const own = OrdinaryGetOwnProperty(this, key);
    if (own !== Value.undefined) {
      return own;
    }
    const named = accessorValueOf(v, key, laneCount);
    if (named !== undefined) {
      // Non-enumerable, which is what keeps Object.keys empty while `in` and
      // getOwnPropertyNames still see them.
      return Descriptor({
        Value: named, Writable: Value.true, Enumerable: Value.false, Configurable: Value.true,
      });
    }
    return Value.undefined;
  };

  obj.OwnPropertyKeys = function* OwnPropertyKeys() {
    const keys = OrdinaryOwnPropertyKeys(this) as PropertyKeyValue[];
    for (const name of enumerateAccessorNames(laneCount)) {
      keys.push(Value(name) as PropertyKeyValue);
    }
    return keys;
  };

  return obj;
}

/** The value a component accessor or lane index names on a vector, or undefined. */
function accessorValueOf(v: VectorValue, key: Value, laneCount: number): Value | undefined {
  if (!(key instanceof JSStringValue)) {
    return undefined;
  }
  const name = key.stringValue();
  if (/^(0|[1-9][0-9]*)$/.test(name)) {
    const at = Number(name);
    return at < laneCount ? v.lanes[at] as Value : undefined;
  }
  const indices = componentAccessorIndices(name, laneCount);
  if (!indices) {
    return undefined;
  }
  if (indices.length === 1) {
    return v.lanes[indices[0]!] as Value;
  }
  const record = v.TypeRecord as { Arguments: readonly unknown[] };
  return new VectorValue(
    indices.map((at) => v.lanes[at] as Value),
    CanonicalizeType({
      ...(v.TypeRecord as object),
      Arguments: [record.Arguments[0], indices.length],
    } as unknown as TypeRecord),
  );
}

/**
 * Every component accessor name a vector of this lane count has.
 *
 * The clause's count: for four lanes it is 680, being two sets of four
 * characters over lengths one to four. Generated on demand rather than at realm
 * setup, so a program that never reflects never pays for it.
 */
function enumerateAccessorNames(laneCount: number): string[] {
  if (laneCount > 4 || laneCount < 1) {
    return [];
  }
  const names: string[] = [];
  for (const set of COMPONENT_SETS) {
    const characters = set.slice(0, laneCount).split('');
    let level = characters.map((c) => c);
    names.push(...level);
    for (let length = 2; length <= 4; length += 1) {
      const next: string[] = [];
      for (const prefix of level) {
        for (const c of characters) {
          next.push(prefix + c);
        }
      }
      names.push(...next);
      level = next;
    }
  }
  return names;
}
