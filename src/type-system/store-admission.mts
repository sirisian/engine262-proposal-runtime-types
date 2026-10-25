import { JSStringValue, RequireType, Q, type Value, type PropertyKeyValue, type PlainEvaluator } from '#self';
import { SameType } from './relations.mts';
import type { TypeRecord } from './records.mts';
import type { ConstructionSelections } from './result-dependencies.mts';

/** Successful evidence belongs to one internal store continuation. It is never
 * attached to a value, descriptor, receiver or ambient execution context. */
export type StoreAdmission = Readonly<{
  receiver: Value, key: PropertyKeyValue, value: Value, type: TypeRecord,
}>;

export function* AdmitStoreValue(receiver: Value, key: PropertyKeyValue, value: Value, type: TypeRecord,
  previous?: StoreAdmission, choices?: ConstructionSelections): PlainEvaluator<StoreAdmission> {
  const sameKey = previous && (previous.key === key || (previous.key instanceof JSStringValue
    && key instanceof JSStringValue && previous.key.stringValue() === key.stringValue()));
  if (previous?.receiver === receiver && sameKey && previous.value === value && SameType(previous.type, type)) {
    return previous;
  }
  // A different receiving check may execute user code. Do not retain an earlier
  // check alongside this one, or treat a construction choice as accepted proof.
  const converted = Q(yield* RequireType(value, type, undefined, choices));
  return { receiver, key, value: converted, type };
}
