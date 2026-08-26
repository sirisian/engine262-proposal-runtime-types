import {
  INDEX_TYPE,
  NumberValue,
  TypedNumberValue,
  Value,
  wellKnownSymbols } from '../value.mts';
import { Q, X } from '../completion.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { bootstrapPrototype } from './bootstrap.mts';
import { CreateMapIterator } from './MapIteratorPrototype.mts';
import type { MapObject } from './Map.mts';
import {
  surroundingAgent,
  Call,
  CanonicalizeKeyedCollectionKey,
  F,
  IsCallable,
  RequireInternalSlot,
  SameValue, SameValueZero, Throw,
  RequireType,
} from '#self';
import type {
  Arguments, Descriptor, ValueEvaluator, FunctionCallContext, Realm,
  ValueCompletion, PlainEvaluator,
} from '#self';

/** https://tc39.es/ecma262/#sec-map.prototype.clear */
function MapProto_clear(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let M be the this value.
  const M = thisValue as MapObject;
  // 2. Perform ? RequireInternalSlot(M, [[MapData]]).
  Q(RequireInternalSlot(M, 'MapData'));
  // 3. Let entries be the List that is M.[[MapData]].
  const entries = M.MapData;
  // 4. For each Record { [[Key]], [[Value]] } p that is an element of entries, do
  if (entries.length) {
    Q(surroundingAgent.debugger_tryTouchDuringPreview(M));
  }
  for (const p of entries) {
    // a. Set p.[[Key]] to empty.
    p.Key = undefined;
    // b. Set p.[[Value]] to empty.
    p.Value = undefined;
  }
  // 5. Return undefined.
  return Value.undefined;
}

/**
 * proposal-runtime-types: a typed collection's key and value positions take
 * their declared types, which sec-array-defaults-and-stores states for
 * `Map.<K, V>` alongside the array. The map carries its type arguments from the
 * boundary that produced it, index 0 being the key and 1 the value (F73).
 *
 * RequireType, the one check-site operation, for the reason the Set side gives:
 * the synchronous helper this replaces reached the numeric types alone, so a
 * `Map.<string, uint8>` checked neither position and `m.get(5)` answered
 * *undefined* rather than reporting the key it could never hold.
 */
function* mapValueAtType(O: Value, value: Value, index: number): PlainEvaluator<Value> {
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

/** https://tc39.es/ecma262/#sec-map.prototype.delete */
function* MapProto_delete([key = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let M be the this value.
  const M = thisValue as MapObject;
  // 2. Perform ? RequireInternalSlot(M, [[MapData]]).
  Q(RequireInternalSlot(M, 'MapData'));
  key = Q(yield* mapValueAtType(M, key, 0));
  // 3. Let entires be M.[[MapData]].
  const entries = M.MapData;
  // 4. For each Record { [[Key]], [[Value]] } p that is an element of entries, do
  for (const p of entries) {
    // a. If p.[[Key]] is not empty and SameValueZero(p.[[Key]], key) is true, then
    if (p.Key !== undefined && SameValueZero(p.Key, key)) {
      Q(surroundingAgent.debugger_tryTouchDuringPreview(M));
      // i. Set p.[[Key]] to empty.
      p.Key = undefined;
      // ii. Set p.[[Value]] to empty.
      p.Value = undefined;
      // iii. Return true.
      return Value.true;
    }
  }
  return Value.false;
}

/** https://tc39.es/ecma262/#sec-map.prototype.entries */
function MapProto_entries(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let M be the this value.
  const M = thisValue;
  // 2. Return ? CreateMapIterator(M, key+value);
  return Q(CreateMapIterator(M, 'key+value'));
}

/** https://tc39.es/ecma262/#sec-map.prototype.foreach */
function* MapProto_forEach([callbackfn = Value.undefined, thisArg = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let M be the this value.
  const M = thisValue as MapObject;
  // 2. Perform ? RequireInternalSlot(M, [[MapData]]).
  Q(RequireInternalSlot(M, 'MapData'));
  // 3. If IsCallable(callbackfn) is false, throw a TypeError exception.
  if (!IsCallable(callbackfn)) {
    return Throw.TypeError('$1 is not a function', callbackfn);
  }
  // 4. Let entries be the List that is M.[[MapData]].
  const entries = M.MapData;
  // 5. For each Record { [[Key]], [[Value]] } e that is an element of entries, in original key insertion order, do
  for (const e of entries) {
    // a. If e.[[Key]] is not empty, then
    if (e.Key !== undefined) {
      // i. Perform ? Call(callbackfn, thisArg, « e.[[Value]], e.[[Key]], M »).
      Q(yield* Call(callbackfn, thisArg, [e.Value!, e.Key, M]));
    }
  }
  // 6. Return undefined.
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-map.prototype.get */
function* MapProto_get([key = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let M be the this value.
  const M = thisValue as MapObject;
  // 2. Perform ? RequireInternalSlot(M, [[MapData]]).
  Q(RequireInternalSlot(M, 'MapData'));
  key = Q(yield* mapValueAtType(M, key, 0));
  // 3. Let entries be the List that is M.[[MapData]].
  const entries = M.MapData;
  // 4. For each Record { [[Key]], [[Value]] } p that is an element of entries, do
  for (const p of entries) {
    // a. If p.[[Key]] is not empty and SameValueZero(p.[[Key]], key) is true, return p.[[Value]].
    if (p.Key !== undefined && SameValueZero(p.Key, key)) {
      // i. Return p.[[Value]].
      return p.Value!;
    }
  }
  // 5. Return undefined.
  return Value.undefined;
}

/** https://tc39.es/ecma262/#sec-map.prototype.getorinsert */
function* MapProto_getOrInsert([key = Value.undefined, value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let M be the this value.
  const M = thisValue as MapObject;
  // 2. Perform ? RequireInternalSlot(M, [[MapData]]).
  Q(RequireInternalSlot(M, 'MapData'));
  // A store is a store whatever it is spelled: `getOrInsert` reaches both
  // positions of the map and was checking NEITHER, so `m.getOrInsert(300, 400)`
  // on a `Map.<uint8, uint8>` stored two plain Numbers where `m.set` of the
  // same pair throws. Found while lifting the numeric-only limit, and the same
  // omission as the one being lifted: a boundary the table names, reached by a
  // method nobody had listed.
  key = Q(yield* mapValueAtType(M, key, 0));
  value = Q(yield* mapValueAtType(M, value, 1));
  // 3. Set key to CanonicalizeKeyedCollectionKey(key).
  key = CanonicalizeKeyedCollectionKey(key);
  // 4. For each Record { [[Key]], [[Value]] } p of M.[[MapData]], do
  const entries = M.MapData;
  for (const p of entries) {
    // a. If p.[[Key]] is not empty and SameValue(p.[[Key]], key) is true, return p.[[Value]].
    if (p.Key !== undefined && SameValue(p.Key, key)) {
      return p.Value!;
    }
  }
  // 5. Let p be the Record { [[Key]]: key, [[Value]]: value }.
  const p = { Key: key, Value: value };
  // 6. Append p to M.[[MapData]].
  entries.push(p);
  // 7. Return value.
  return value;
}

/** https://tc39.es/ecma262/#sec-map.prototype.getorinsertcomputed */
function* MapProto_getOrInsertComputed([key = Value.undefined, callbackfn = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let M be the this value.
  const M = thisValue as MapObject;
  // 2. Perform ? RequireInternalSlot(M, [[MapData]]).
  Q(RequireInternalSlot(M, 'MapData'));
  // 3. If IsCallable(callbackfn) is false, throw a TypeError exception.
  if (!IsCallable(callbackfn)) {
    return Throw.TypeError('$1 is not a function', callbackfn);
  }
  key = Q(yield* mapValueAtType(M, key, 0));
  // 4. Set key to CanonicalizeKeyedCollectionKey(key).
  key = CanonicalizeKeyedCollectionKey(key);
  // 5. For each Record { [[Key]], [[Value]] } p of M.[[MapData]], do
  const entries = M.MapData;
  for (const p of entries) {
    // a. If p.[[Key]] is not empty and SameValue(p.[[Key]], key) is true, return p.[[Value]].
    if (p.Key !== undefined && SameValueZero(p.Key, key)) {
      return p.Value!;
    }
  }
  // 6. Let value be ? Call(callbackfn, undefined, « key »).
  // The callback's RESULT is what gets stored, so it is the value position and
  // takes the value type. This is the one place in a collection where the
  // conversion demonstrably had to be effectful even before the type space
  // widened: user code produces the value, and it is checked after running.
  let value = Q(yield* Call(callbackfn, Value.undefined, [key]));
  value = Q(yield* mapValueAtType(M, value, 1));
  // 7. NOTE: The Map may have been modified during execution of callbackfn.
  // 8. For each Record { [[Key]], [[Value]] } p of M.[[MapData]], do
  for (const p of entries) {
    // a. If p.[[Key]] is not empty and SameValue(p.[[Key]], key) is true, then
    if (p.Key !== undefined && SameValueZero(p.Key, key)) {
      // i. Set p.[[Value]] to value.
      p.Value = value;
      // ii. Return value.
      return value;
    }
  }
  // 9. Let p be the Record { [[Key]]: key, [[Value]]: value }.
  const p = { Key: key, Value: value };
  // 10. Append p to M.[[MapData]].
  entries.push(p);
  // 11. Return value.
  return value;
}

/** https://tc39.es/ecma262/#sec-map.prototype.has */
function* MapProto_has([key = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let M be the this value.
  const M = thisValue as MapObject;
  // 2. Perform ? RequireInternalSlot(M, [[MapData]]).
  Q(RequireInternalSlot(M, 'MapData'));
  key = Q(yield* mapValueAtType(M, key, 0));
  // 3. Let entries be the List that is M.[[MapData]].
  const entries = M.MapData;
  // 4. For each Record { [[Key]], [[Value]] } p that is an element of entries, do
  for (const p of entries) {
    // a. If p.[[Key]] is not empty and SameValueZero(p.[[Key]], key) is true, return true.
    if (p.Key !== undefined && SameValueZero(p.Key, key)) {
      return Value.true;
    }
  }
  // 5. Return false.
  return Value.false;
}

/** https://tc39.es/ecma262/#sec-map.prototype.keys */
function MapProto_keys(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let M be the this value.
  const M = thisValue;
  // 2. Return ? CreateMapIterator(M, key).
  return Q(CreateMapIterator(M, 'key'));
}

/** https://tc39.es/ecma262/#sec-map.prototype.set */
function* MapProto_set([key = Value.undefined, value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  // 1. Let M be the this value.
  const M = thisValue as MapObject;
  // 2. Perform ? RequireInternalSlot(M, [[MapData]]).
  Q(RequireInternalSlot(M, 'MapData'));
  key = Q(yield* mapValueAtType(M, key, 0));
  value = Q(yield* mapValueAtType(M, value, 1));
  // 3. Let entries be the List that is M.[[MapData]].
  const entries = M.MapData;
  // 4. For each Record { [[Key]], [[Value]] } p that is an element of entries, do
  for (const p of entries) {
    // a. If p.[[Key]] is not empty and SameValueZero(p.[[Key]], key) is true, then
    if (p.Key !== undefined && SameValueZero(p.Key, key)) {
      // i. Set p.[[Value]] to value.
      Q(surroundingAgent.debugger_tryTouchDuringPreview(M));
      p.Value = value;
      // ii. Return M.
      return M;
    }
  }
  // 5. If key is -0𝔽, set key to +0𝔽.
  if (key instanceof NumberValue && Object.is(key.value, -0)) {
    key = F(+0);
  }
  // 6. Let p be the Record { [[Key]]: key, [[Value]]: value }.
  const p = { Key: key, Value: value };
  // 7. Append p as the last element of entries.
  Q(surroundingAgent.debugger_tryTouchDuringPreview(M));
  entries.push(p);
  // 8. Return M.
  return M;
}

/** https://tc39.es/ecma262/#sec-get-map.prototype.size */
/**
 * proposal-runtime-types #index-type, widened from arrays to containers: a
 * TYPED collection's `size` reads at the index type, `uint64`, the same type an
 * array's `length` and `capacity` report.
 *
 * The reason is NOT the one that fixed the width for arrays. That argument is
 * about a view's length coming from a buffer rather than an allocation the
 * language caps, and a collection has no view form. It is the OTHER property the
 * index type exists for: one type for every count is what makes a count from one
 * container comparable with a count from another. `map.size < array.length` is a
 * sentence a program wants to write, and it is unwriteable if the two are
 * different types - exactly as "a capacity is at least a length" is unwriteable
 * if those two are not one type. Before this, that comparison was a TypeError.
 *
 * CONDITIONED ON THE STAMP, and that is the whole of the backwards-compatibility
 * story. A `Map` with no type arguments carries no [[TypedCollection]] and
 * reports a Number, exactly as it does today - so `m.size + 1`, `m.size < 0`,
 * and every other expression an ordinary program writes a count into keep
 * working. `collections/backcompat.test.mts` is the guard for that and was
 * written before this change.
 */
function MapProto_sizeGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let M be the this value.
  const M = thisValue as MapObject;
  // 2. Perform ? RequireInternalSlot(M, [[MapData]]).
  Q(RequireInternalSlot(M, 'MapData'));
  // 3. Let entries be the List that is M.[[MapData]].
  const entries = M.MapData;
  // 4. Let count be 0.
  let count = 0;
  // 5. For each Record { [[Key]], [[Value]] } p that is an element of entries, do
  for (const p of entries) {
    // a. If p.[[Key]] is not empty, set count to count + 1.
    if (p.Key !== undefined) {
      count += 1;
    }
  }
  // 6. Return 𝔽(count), or a value of the index type where the collection is typed.
  if (surroundingAgent.feature('runtime-types')
      && (M as { TypedCollection?: readonly unknown[] }).TypedCollection !== undefined) {
    return new TypedNumberValue(count, INDEX_TYPE);
  }
  return F(count);
}

/** https://tc39.es/ecma262/#sec-map.prototype.values */
function MapProto_values(_args: Arguments, { thisValue }: FunctionCallContext): ValueCompletion {
  // 1. Let M be the this value.
  const M = thisValue;
  // 2. Return ? CreateMapIterator(M, value).
  return Q(CreateMapIterator(M, 'value'));
}

export function bootstrapMapPrototype(realmRec: Realm) {
  const proto = bootstrapPrototype(realmRec, [
    ['clear', MapProto_clear, 0],
    ['delete', MapProto_delete, 1],
    ['entries', MapProto_entries, 0],
    ['forEach', MapProto_forEach, 1],
    ['get', MapProto_get, 1],
    ['getOrInsert', MapProto_getOrInsert, 2],
    ['getOrInsertComputed', MapProto_getOrInsertComputed, 2],
    ['has', MapProto_has, 1],
    ['keys', MapProto_keys, 0],
    ['set', MapProto_set, 2],
    ['size', [MapProto_sizeGetter]],
    ['values', MapProto_values, 0],
  ], realmRec.Intrinsics['%Object.prototype%'], 'Map');

  const entriesFunc = X(proto.GetOwnProperty(Value('entries')));
  X(proto.DefineOwnProperty(wellKnownSymbols.iterator, entriesFunc as Descriptor));

  realmRec.Intrinsics['%Map.prototype%'] = proto;
}
