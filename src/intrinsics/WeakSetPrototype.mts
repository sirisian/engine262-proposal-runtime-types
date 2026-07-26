import {
  Value,
  type Arguments,
  type FunctionCallContext,
} from '../value.mts';
import { Q, type ValueEvaluator } from '../completion.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import type { WeakSetObject } from './WeakSet.mts';
import type { PlainEvaluator } from '#self';
import {
  surroundingAgent,
  SameValue,
  RequireInternalSlot,
  CanBeHeldWeakly,
  Realm,
  Throw,
  RequireType,
} from '#self';

/**
 * proposal-runtime-types: the element position of a `WeakSet.<T>`, which
 * CheckedConvertValue already stamps and nothing consumed. See the WeakMap
 * side for why an unconsumed stamp is worse than no stamp.
 */
function* weakValueAtType(O: Value, value: Value): PlainEvaluator<Value> {
  if (!surroundingAgent.feature('runtime-types')) {
    return value;
  }
  const args = (O as { TypedCollection?: readonly (TypeRecord | number)[] }).TypedCollection;
  const t = args?.[0];
  if (t === undefined || typeof t === 'number') {
    return value;
  }
  return Q(yield* RequireType(value, t));
}

/** https://tc39.es/ecma262/#sec-weakset.prototype.add */
function* WeakSetProto_add([value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let S be this value.
  const S = thisValue as WeakSetObject;
  // 2. Perform ? RequireInternalSlot(S, [[WeakSetData]]).
  Q(RequireInternalSlot(S, 'WeakSetData'));
  value = Q(yield* weakValueAtType(S, value));
  // 3. If CanBeHeldWeakly(value) is false, throw a TypeError exception.
  if (!CanBeHeldWeakly(value)) {
    return Throw.TypeError('$1 cannot be weakly referenced', value);
  }
  // 4. For each e that is an element of entries, do
  const entries = S.WeakSetData;
  for (const e of entries) {
    // a. If e is not empty and SameValue(e, value) is true, then
    if (e !== undefined && SameValue(e, value)) {
      // i. Return S.
      return S;
    }
  }
  // 6. Append value as the last element of entries.
  entries.push(value);
  // 6. Return S.
  return S;
}

/** https://tc39.es/ecma262/#sec-weakset.prototype.delete */
function* WeakSetProto_delete([value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let S be the this value.`
  const S = thisValue as WeakSetObject;
  // 2. Perform ? RequireInternalSlot(S, [[WeakSetData]]).
  Q(RequireInternalSlot(S, 'WeakSetData'));
  value = Q(yield* weakValueAtType(S, value));
  // 3. If CanBeHeldWeakly(value) is false, return false.
  if (!CanBeHeldWeakly(value)) {
    return Value.false;
  }
  // 4. For each element e of S.[[WeakSetData]], do
  const entries = S.WeakSetData;
  for (let i = 0; i < entries.length; i += 1) {
    const e = entries[i];
    // i. If e is not empty and SameValue(e, value) is true, then
    if (e !== undefined && SameValue(e, value)) {
      // i. Replace the element of entries whose value is e with an element whose value is empty.
      Q(surroundingAgent.debugger_tryTouchDuringPreview(S));
      entries[i] = undefined;
      // ii. Return true.
      return Value.true;
    }
  }
  // 5. Return false.
  return Value.false;
}

/** https://tc39.es/ecma262/#sec-weakset.prototype.has */
function* WeakSetProto_has([value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let S be the this value.
  const S = thisValue as WeakSetObject;
  // 2. Perform ? RequireInternalSlot(S, [[WeakSetData]]).
  Q(RequireInternalSlot(S, 'WeakSetData'));
  value = Q(yield* weakValueAtType(S, value));
  // 3. If CanBeHeldWeakly(value) is false, return false.
  if (!CanBeHeldWeakly(value)) {
    return Value.false;
  }
  // 4. For each element e of S.[[WeakSetData]], do
  const entries = S.WeakSetData;
  for (const e of entries) {
    // a. If e is not empty and SameValue(e, value) is true, return true.
    if (e !== undefined && SameValue(e, value)) {
      return Value.true;
    }
  }
  // 5. Return false.
  return Value.false;
}

export function bootstrapWeakSetPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['add', WeakSetProto_add, 1],
    ['delete', WeakSetProto_delete, 1],
    ['has', WeakSetProto_has, 1],
  ], realmRec.Intrinsics['%Object.prototype%'], 'WeakSet');

  realmRec.Intrinsics['%WeakSet.prototype%'] = proto;
}
