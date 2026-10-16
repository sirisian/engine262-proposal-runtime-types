import { AssignScalarRests, ScalarRestMember, ScalarRestOwner, ScalarRestValues, ScalarRestGuardsAccept, ScalarRestLengthAllowed, type ScalarRestPattern } from '../type-system/scalar-rests.mts';
import { CarriedTypeRecordOf, DefaultValueOf, RuntimeTypeOf } from '../type-system/runtime.mts';
import { TupleBackingLength, TupleStorageTypeAt, TupleResizePreserves, type TupleStorageShape } from '../type-system/tuple-storage.mts';
import { IsSubtype } from '../type-system/relations.mts';
import { displayType, type TypeRecord } from '../type-system/records.mts';
import { ObjectValue, ReferenceValue, Value, type Descriptor } from '../value.mts';
import { Q, EnsureCompletion, type ThrowCompletion } from '../completion.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import { RequireType, ConvertValue, ScalarRestConversionApplicable, LookupClassOperator } from './runtime-types.mts';
import { SameValue, Throw, isDecimalObject, isRationalObject, isFloat128Object } from '#self';

type Convert = (value: Value, type: TypeRecord) => ValueEvaluator;
export type ScalarRestItem = { value?: Value, convert?: boolean };

/** These real numeric values use ObjectValue only as an interpreter
 * representation. Their intrinsic payload conversions are pure; ordinary
 * objects, metadata and a potentially selected class operator are not. */
function pureScalarConversion(value: Value, type: TypeRecord, convert: Convert): boolean {
  const carried = CarriedTypeRecordOf(value);
  if (value instanceof ReferenceValue || (carried !== undefined && carried.Kind !== 'primitive')) return false;
  if (!(value instanceof ObjectValue)) return true;
  if (!isDecimalObject(value) && !isRationalObject(value) && !isFloat128Object(value)) return false;
  // These explicit cases return through the intrinsic payload path before
  // CheckedConvertValue's class-operator fallback. An unrelated operator must
  // not turn a pure, failed candidate into a selected effectful conversion.
  if (convert === ConvertValue && type.Kind === 'primitive'
      && ['string', 'boolean', 'number', 'bigint', 'int', 'uint', 'float16', 'float32', 'float64'].includes(type.Name)) return true;
  return LookupClassOperator(value, `convert ${displayType(type)}`) === null;
}

/** Pure intrinsic scalar computations may be retained. User conversion code is
 * only classified here and runs once, after assignment has been selected. */
export function* ConvertScalarRestItems(patterns: readonly ScalarRestPattern[], items: readonly ScalarRestItem[],
  convert: Convert, accepts: (index: number, type: TypeRecord, value?: Value) => boolean = () => true): PlainEvaluator<Value[]> {
  const unchanged = AssignScalarRests(patterns, items.length, (i, type) => items[i]!.value !== undefined
    && ScalarRestMember(items[i]!.value!, type) && accepts(i, type, items[i]!.value));
  if (unchanged) return items.map((item) => item.value!);
  const types = [...new Set(patterns[0]!.map((run) => run.Type))];
  const candidates: Map<TypeRecord, { value?: Value }>[] = [];
  let failure: ThrowCompletion | undefined;
  for (const item of items) {
    const row = new Map<TypeRecord, { value?: Value }>();
    const retain = (type: TypeRecord, value?: Value) => {
      if (accepts(candidates.length, type, value)) row.set(type, { value });
    };
    for (const type of types) {
      if (item.value === undefined) {
        const value = Q(yield* DefaultValueOf(type));
        if (value !== undefined) retain(type, value);
      } else if (ScalarRestMember(item.value, type)) retain(type, item.value);
      else if (item.convert) {
        if (pureScalarConversion(item.value, type, convert)) {
          const result = EnsureCompletion(yield* convert(item.value, type));
          if (result.Type === 'normal' && ScalarRestMember(result.Value, type)) retain(type, result.Value);
          else if (result.Type === 'throw') failure ??= result;
        } else if (ScalarRestConversionApplicable(item.value, type, convert)) retain(type);
      }
    }
    candidates.push(row);
  }
  const selected = AssignScalarRests(patterns, items.length, (i, type) => candidates[i]!.has(type));
  if (!selected) return failure ?? Throw.TypeError('no ordered scalar rest assignment admits the sequence');
  const values: Value[] = [];
  for (let i = 0; i < selected.length; i += 1) {
    const type = selected[i]!;
    const candidate = candidates[i]!.get(type)!;
    let value = candidate.value;
    if (value === undefined) {
      value = Q(yield* convert(items[i]!.value!, type));
    }
    if (!ScalarRestMember(value, type)) return Throw.TypeError('a scalar conversion returned a value outside its selected rest');
    values.push(value);
  }
  return values;
}

/** Retain data rather than replaying property Gets. Reentrant changes to any
 * consulted element or acquired guard invalidate this receiving operation. */
export function* PrepareScalarRestValues(object: ObjectValue, length: number,
  supplied: ReadonlyMap<number, Descriptor>, converting: boolean): PlainEvaluator<Value[] | undefined> {
  const owner = ScalarRestOwner(object);
  const guards = owner.ScalarRestGuards;
  if (!guards?.length) return undefined;
  const oldLength = TupleBackingLength(owner);
  const old = ScalarRestValues(owner, oldLength);
  if (!old) return Throw.TypeError('a scalar rest guard requires initialized own data elements');
  const items = Array.from({ length }, (_, index): ScalarRestItem => supplied.has(index)
    ? { value: supplied.get(index)!.Value, convert: converting }
    : { value: old[index] });
  const backing = owner as typeof owner & { TypedTuple?: TupleStorageShape, TypedElement?: TypeRecord,
    TypedProperties?: Map<string, { TypeRecord: TypeRecord }> };
  const tuple = backing.TypedTuple;
  const element = backing.TypedElement;
  if (!ScalarRestLengthAllowed(owner, length) || (tuple && !TupleResizePreserves(tuple, oldLength, length))) {
    return Throw.TypeError('scalar rest resize would change a surviving position contract or required count');
  }
  const values = Q(yield* ConvertScalarRestItems(guards, items, RequireType, (index, type, value) => {
    const targets = [tuple ? TupleStorageTypeAt(tuple, index, length) : undefined, element,
      backing.TypedProperties?.get(String(index))?.TypeRecord].filter((target): target is TypeRecord => target !== undefined);
    return targets.every((target) => IsSubtype(type, target, []) || (value !== undefined && IsSubtype(RuntimeTypeOf(value), target, [])));
  }));
  const now = ScalarRestValues(owner, oldLength);
  if (owner.ScalarRestGuards !== guards || backing.TypedTuple !== tuple || backing.TypedElement !== element || TupleBackingLength(owner) !== oldLength
      || !now || old.some((value, i) => !SameValue(value, now[i]!))) {
    return Throw.TypeError('scalar rest backing changed during conversion');
  }
  if (!ScalarRestGuardsAccept(owner, values)) return Throw.TypeError('the converted sequence violates its scalar rest guards');
  return values;
}
