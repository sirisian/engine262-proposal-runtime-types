import {
  Value,
  type Arguments,
  type FunctionCallContext,
} from '../value.mts';
import { Q, type ValueEvaluator } from '../completion.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import type { WeakMapObject } from './WeakMap.mts';
import type { PlainEvaluator } from '#self';
import {
  surroundingAgent,
  Call,
  IsCallable,
  SameValue,
  RequireInternalSlot,
  CanBeHeldWeakly,
  Realm,
  Throw,
  RequireType,
} from '#self';

/**
 * proposal-runtime-types: the weak collections carry type arguments from the
 * same boundary the strong ones do - CheckedConvertValue stamps all four - and
 * this is the consumer that stamp did not have. A `WeakMap.<object, uint8>`
 * stamped its arguments and then checked neither position, which is worse than
 * not stamping: the checker reports the value position as a type error while
 * the run time accepts anything through the `any` path, so the two disagree
 * about the same store.
 *
 * The KEY position of a weak collection is constrained to `object | symbol` by
 * the design, since a weak reference needs identity; CanBeHeldWeakly still
 * decides that, and this decides the declared type on top of it.
 */
function* weakValueAtType(O: Value, value: Value, index: number): PlainEvaluator<Value> {
  if (!surroundingAgent.feature('runtime-types')) {
    return value;
  }
  const args = (O as { TypedCollection?: readonly (TypeRecord | number)[] }).TypedCollection;
  const t = args?.[index];
  if (t === undefined || typeof t === 'number') {
    return value;
  }
  return Q(yield* RequireType(value, t));
}

/** https://tc39.es/ecma262/#sec-weakmap.prototype.delete */
function* WeakMapProto_delete([key = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let M be the this value.
  const M = thisValue as WeakMapObject;
  // 2. Perform ? RequireInternalSlot(M, [[WeakMapData]]).
  Q(RequireInternalSlot(M, 'WeakMapData'));
  key = Q(yield* weakValueAtType(M, key, 0));
  // 3. If CanBeHeldWeakly(key) is false, return false.
  if (!CanBeHeldWeakly(key)) {
    return Value.false;
  }
  // 4. For each Record { [[Key]], [[Value]] } p that is an element of entries, do
  const entries = M.WeakMapData;
  for (let i = 0; i < entries.length; i += 1) {
    const p = entries[i];
    // a. If p.[[Key]] is not empty and SameValue(p.[[Key]], key) is true, then
    if (p.Key !== undefined && SameValue(p.Key, key)) {
      // i. Set p.[[Key]] to empty.
      Q(surroundingAgent.debugger_tryTouchDuringPreview(M));
      p.Key = undefined;
      // ii. Set p.[[Value]] to empty.
      p.Value = undefined;
      // iii. return true.
      return Value.true;
    }
  }
  // 5. Return false.
  return Value.false;
}

/** https://tc39.es/ecma262/#sec-weakmap.prototype.get */
function* WeakMapProto_get([key = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let m be the this value.
  const M = thisValue as WeakMapObject;
  // 2. Perform ? RequireInternalSlot(M, [[WeakMapData]]).
  Q(RequireInternalSlot(M, 'WeakMapData'));
  key = Q(yield* weakValueAtType(M, key, 0));
  // 3. If CanBeHeldWeakly(key) is false, return false.
  if (!CanBeHeldWeakly(key)) {
    return Value.undefined;
  }
  // 4. For each Record { [[Key]], [[Value]] } p of M.[[WeakMapData]], do
  const entries = M.WeakMapData;
  for (const p of entries) {
    // a. If p.[[Key]] is not empty and SameValue(p.[[Key]], key) is true, return p.[[Value]].
    if (p.Key !== undefined && SameValue(p.Key, key)) {
      return p.Value!;
    }
  }
  // 6. Return undefined.
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-weakmap.prototype.getorinsert */
function* WeakMapProto_getOrInsert([key = Value.undefined, value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let m be the this value.
  const M = thisValue as WeakMapObject;
  // 2. Perform ? RequireInternalSlot(M, [[WeakMapData]]).
  Q(RequireInternalSlot(M, 'WeakMapData'));
  key = Q(yield* weakValueAtType(M, key, 0));
  value = Q(yield* weakValueAtType(M, value, 1));
  // 3. If CanBeHeldWeakly(key) is false, throw a TypeError exception.
  if (!CanBeHeldWeakly(key)) {
    return Throw.TypeError('$1 cannot be used as a WeakMap key', key);
  }
  // 4. For each Record { [[Key]], [[Value]] } p of M.[[WeakMapData]], do
  const entries = M.WeakMapData;
  for (const p of entries) {
    // a. If p.[[Key]] is not empty and SameValue(p.[[Key]], key) is true, return p.[[Value]].
    if (p.Key !== undefined && SameValue(p.Key, key)) {
      return p.Value!;
    }
  }
  // 5. Let p be the Record { [[Key]]: key, [[Value]]: value }.
  const p = { Key: key, Value: value };
  // 6. Append p to M.[[WeakMapData]].
  entries.push(p);
  // 7. Return value.
  return value;
}

/** https://tc39.es/ecma262/#sec-weakmap.prototype.getorinsertcomputed */
function* WeakMapProto_getOrInsertComputed([key = Value.undefined, callbackfn = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let m be the this value.
  const M = thisValue as WeakMapObject;
  // 2. Perform ? RequireInternalSlot(M, [[WeakMapData]]).
  Q(RequireInternalSlot(M, 'WeakMapData'));
  key = Q(yield* weakValueAtType(M, key, 0));
  // 3. If CanBeHeldWeakly(key) is false, throw a TypeError exception.
  if (!CanBeHeldWeakly(key)) {
    return Throw.TypeError('$1 cannot be weakly referenced', key);
  }
  // 4. If IsCallable(callbackfn) is false, throw a TypeError exception.
  if (!IsCallable(callbackfn)) {
    return Throw.TypeError('callbackfn ($1) is not a function', callbackfn);
  }
  // 5. For each Record { [[Key]], [[Value]] } p of M.[[WeakMapData]], do
  const entries = M.WeakMapData;
  for (const p of entries) {
    // a. If p.[[Key]] is not empty and SameValue(p.[[Key]], key) is true, return p.[[Value]].
    if (p.Key !== undefined && SameValue(p.Key, key)) {
      return p.Value!;
    }
  }
  // 6. Let value be ? Call(callbackfn, undefined, « key »).
  let value = Q(yield* Call(callbackfn, Value.undefined, [key]));
  value = Q(yield* weakValueAtType(M, value, 1));
  // 7. NOTE: The Map may have been modified during execution of callbackfn.
  // 8. For each Record { [[Key]], [[Value]] } p of M.[[WeakMapData]], do
  for (const p of entries) {
    // a. If p.[[Key]] is not empty and SameValue(p.[[Key]], key) is true, then
    if (p.Key !== undefined && SameValue(p.Key, key)) {
      // i. Set p.[[Value]] to value.
      p.Value = value;
      // ii. Return value.
      return value;
    }
  }
  // 9. Let p be the Record { [[Key]]: key, [[Value]]: value }.
  const p = { Key: key, Value: value };
  // 10. Append p to M.[[WeakMapData]].
  entries.push(p);
  // 11. Return value.
  return value;
}

/** https://tc39.es/ecma262/#sec-weakmap.prototype.has */
function* WeakMapProto_has([key = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let M be the this value.
  const M = thisValue as WeakMapObject;
  // 2. Perform ? RequireInternalSlot(M, [[WeakMapData]]).
  Q(RequireInternalSlot(M, 'WeakMapData'));
  key = Q(yield* weakValueAtType(M, key, 0));
  // 3. If CanBeHeldWeakly(key) is false, return false.
  if (!CanBeHeldWeakly(key)) {
    return Value.false;
  }
  // 4. For each Record { [[Key]], [[Value]] } p of M.[[WeakMapData]], do
  const entries = M.WeakMapData;
  for (const p of entries) {
    // a. If p.[[Key]] is not empty and SameValue(p.[[Key]], key) is true, return true.
    if (p.Key !== undefined && SameValue(p.Key, key)) {
      return Value.true;
    }
  }
  // 6. Return false.
  return Value.false;
}

/** https://tc39.es/ecma262/#sec-weakmap.prototype.set */
function* WeakMapProto_set([key = Value.undefined, value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let M be the this value.
  const M = thisValue as WeakMapObject;
  // 2. Perform ? RequireInternalSlot(M, [[WeakMapData]]).
  Q(RequireInternalSlot(M, 'WeakMapData'));
  key = Q(yield* weakValueAtType(M, key, 0));
  value = Q(yield* weakValueAtType(M, value, 1));
  // 3. If CanBeHeldWeakly(key) is false, throw a TypeError exception.
  if (!CanBeHeldWeakly(key)) {
    return Throw.TypeError('$1 cannot be weakly referenced', key);
  }
  // 4. For each Record { [[Key]], [[Value]] } p that is an element of entries, do
  const entries = M.WeakMapData;
  for (const p of entries) {
    // a. If p.[[Key]] is not empty and SameValue(p.[[Key]], key) is true, then
    if (p.Key !== undefined && SameValue(p.Key, key)) {
      // i. Set p.[[Value]] to value.
      Q(surroundingAgent.debugger_tryTouchDuringPreview(M));
      p.Value = value;
      // ii. Return M.
      return M;
    }
  }
  // 5. Let p be the Record { [[Key]]: key, [[Value]]: value }.
  const p = { Key: key, Value: value };
  // 7. Append p as the last element of entries.
  entries.push(p);
  // 7. Return M.
  return M;
}

export function bootstrapWeakMapPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['delete', WeakMapProto_delete, 1],
    ['get', WeakMapProto_get, 1],
    ['getOrInsert', WeakMapProto_getOrInsert, 2],
    ['getOrInsertComputed', WeakMapProto_getOrInsertComputed, 2],
    ['has', WeakMapProto_has, 1],
    ['set', WeakMapProto_set, 2],
  ], realmRec.Intrinsics['%Object.prototype%'], 'WeakMap');

  realmRec.Intrinsics['%WeakMap.prototype%'] = proto;
}
