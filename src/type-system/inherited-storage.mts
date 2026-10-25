import { Descriptor, ObjectValue, JSStringValue, SymbolValue, NumberValue, Value, type PropertyKeyValue, type NullValue } from '../value.mts';
import { propertyKeyValue, type TypeRecord } from './records.mts';
import { OrdinaryDataReadSupported, RuntimeTypeOf, primitiveMembership, MayRequireCallableMaterialization } from './runtime.mts';
import { StructuralStorageEstablished } from '../abstract-ops/runtime-types.mts';
import { IsSubtype, SameType } from './relations.mts';
import { LayoutOf, SubclassAddsStorageOver } from './layout.mts';
import { IsDataDescriptor, IsAccessorDescriptor, SameValue } from '../abstract-ops/all.mts';
import { Throw } from '#self';
import type { ThrowCompletion } from '../completion.mts';

type Key = string | SymbolValue;
const normalized = (key: PropertyKeyValue): Key => key instanceof JSStringValue ? key.stringValue() : key;
type Guard = { owner: WeakRef<ObjectValue>, key: string | WeakRef<SymbolValue>, path: WeakRef<ObjectValue>[] };
type State = { guard: Guard, value: Value };
type Observation = { path: ObjectValue[], value: Value };
type Change = { guard: Guard, observation: Observation };
type Mutation = { object: ObjectValue, properties?: ReadonlyMap<Key, Descriptor | undefined>, prototype?: ObjectValue | NullValue, admitted?: TypeRecord };
const acquired = new WeakMap<ObjectValue, Map<Key, State>>();
const dependents = new WeakMap<ObjectValue, Set<Guard>>();

export function HasInheritedStorageDependents(object: ObjectValue): boolean {
  return (dependents.get(object)?.size ?? 0) !== 0;
}

function detach(guard: Guard): void {
  for (const ref of guard.path) {
    const object = ref.deref();
    if (object) dependents.get(object)?.delete(guard);
  }
  guard.path = [];
}
// Reverse edges and finalizer holdings retain neither receivers nor their
// values/type graphs. A prototype may otherwise keep arbitrary instances alive.
const finalized = new FinalizationRegistry<Guard>(detach);

function attach(guard: Guard, path: readonly ObjectValue[]): void {
  detach(guard);
  for (const object of path) {
    let set = dependents.get(object);
    if (!set) dependents.set(object, set = new Set());
    set.add(guard);
    guard.path.push(new WeakRef(object));
  }
}

function lookup(owner: ObjectValue, key: PropertyKeyValue, mutation?: Mutation): Observation | undefined {
  const path: ObjectValue[] = [];
  const seen = new Set<ObjectValue>();
  let object: ObjectValue = owner;
  while (!seen.has(object)) {
    seen.add(object);
    if (!OrdinaryDataReadSupported(object)) return undefined;
    path.push(object);
    const desc = mutation?.object === object && mutation.properties?.has(normalized(key))
      ? mutation.properties.get(normalized(key)) : object.properties.get(key);
    if (desc) {
      if (!IsDataDescriptor(desc)) return undefined;
      const value = desc.Value!;
      // Base Get derives these results after ordinary lookup. Bounds checks on
      // ordinary indexed data do not by themselves change its provenance.
      if (key instanceof JSStringValue) {
        for (const link of path) {
          const typed = link as { TypedElement?: TypeRecord, TypedTuple?: unknown };
          if (key.stringValue() === 'length' && value instanceof NumberValue
              && (typed.TypedElement !== undefined || typed.TypedTuple !== undefined)) return undefined;
          if (key.stringValue() === 'byteLength' && value === Value.undefined
              && typed.TypedElement && LayoutOf(typed.TypedElement)) return undefined;
        }
      }
      return { path, value };
    }
    if (object.GetPrototypeOf !== ObjectValue.prototype.GetPrototypeOf) return undefined;
    const parent = mutation?.object === object && mutation.prototype !== undefined
      ? mutation.prototype : (object as { Prototype?: Value }).Prototype;
    if (!(parent instanceof ObjectValue)) return undefined;
    object = parent;
  }
  return undefined;
}

/** An indirect mutation performs its destination's own conversions only. It
 * must not pick a dependent view's converter or replay structural getters. */
function established(value: Value, type: TypeRecord, previous: Value): boolean {
  if (SameValue(value, previous)) return true;
  if (type.Kind === 'any' || type.Kind === 'parameter') return true;
  if (type.Kind === 'shared') return established(value, type.Target, previous);
  if (type.Kind === 'union') return type.Members.some((part) => established(value, part, previous));
  if (type.Kind === 'intersection') return type.Members.every((part) => established(value, part, previous));
  if (type.Kind === 'literal') return SameValue(value, type.Value);
  if (type.Kind === 'primitive') return primitiveMembership(value, type.Name, type.Arguments);
  if (type.Kind === 'reference') return false;
  if (type.Kind === 'object') return value instanceof ObjectValue && StructuralStorageEstablished(value, type);
  const current = RuntimeTypeOf(value);
  return current.Kind !== 'any' && IsSubtype(current, type, []) && !SubclassAddsStorageOver(current, type)
    && !MayRequireCallableMaterialization(current, type) && StructuralStorageEstablished(value, type);
}

function plan(mutation: Mutation): Change[] | false {
  const changes: Change[] = [];
  for (const guard of dependents.get(mutation.object) ?? []) {
    const owner = guard.owner.deref();
    const key = typeof guard.key === 'string' ? guard.key : guard.key.deref();
    if (!owner || key === undefined) { detach(guard); continue; }
    if (mutation.properties && !mutation.properties.has(key)) continue;
    // The supplier's outgoing prototype is not part of a successful data read.
    if (mutation.prototype !== undefined && guard.path.at(-1)?.deref() === mutation.object) continue;
    const state = acquired.get(owner)?.get(key);
    const type = (owner as { TypedProperties?: Map<unknown, { TypeRecord: TypeRecord }> })
      .TypedProperties?.get(key)?.TypeRecord;
    const observation = lookup(owner, propertyKeyValue(key), mutation);
    if (!state || !type || !observation) return false;
    const ownAdmission = observation.path.length === 1 && owner === mutation.object
      && mutation.admitted !== undefined && SameType(type, mutation.admitted);
    if (!ownAdmission && !established(observation.value, type, state.value)) return false;
    changes.push({ guard, observation });
  }
  return changes;
}

export function CommitInheritedStorageChanges(changes: readonly Change[]): void {
  for (const { guard, observation } of changes) {
    const owner = guard.owner.deref();
    const key = typeof guard.key === 'string' ? guard.key : guard.key.deref();
    if (!owner || key === undefined) { detach(guard); continue; }
    const state = acquired.get(owner)?.get(key);
    if (!state) continue;
    if (observation.path.length === 1) {
      // Its existing own-property backing now owns all future stores/deletion.
      detach(guard);
      acquired.get(owner)!.delete(key);
      continue;
    }
    state.value = observation.value;
    attach(guard, observation.path);
  }
}

export function AcquireInheritedStorage(owner: ObjectValue, key: PropertyKeyValue, value: Value, path: readonly ObjectValue[]): void {
  if (path.length < 2) return;
  const name = normalized(key);
  let properties = acquired.get(owner);
  if (!properties) acquired.set(owner, properties = new Map());
  let state = properties.get(name);
  if (!state) {
    const guard: Guard = { owner: new WeakRef(owner), key: typeof name === 'string' ? name : new WeakRef(name), path: [] };
    state = { guard, value };
    properties.set(name, state);
    finalized.register(owner, guard);
  }
  state.value = value;
  attach(state.guard, path);
}

/** Complete only fields relevant to ordinary data lookup. Ordinary descriptor
 * compatibility is checked first by the caller, with no mutation or user code. */
function prospective(object: ObjectValue, key: PropertyKeyValue, desc: Descriptor): Descriptor {
  const current = object.properties.get(key);
  if (IsAccessorDescriptor(desc)) return desc;
  if (IsDataDescriptor(desc)) {
    return Descriptor({ Value: desc.Value ?? (current && IsDataDescriptor(current) ? current.Value : Value.undefined) });
  }
  return current ?? Descriptor({ Value: Value.undefined });
}

export function PlanInheritedDefinition(object: ObjectValue, key: PropertyKeyValue, desc: Descriptor, admitted?: TypeRecord): Change[] | false {
  if (!dependents.has(object)) return [];
  return plan({ object, properties: new Map([[normalized(key), prospective(object, key, desc)]]), admitted });
}

export function PlanInheritedDeletion(object: ObjectValue, key: PropertyKeyValue): Change[] | false {
  return plan({ object, properties: new Map([[normalized(key), undefined]]) });
}

export function PlanInheritedPrototypeChange(object: ObjectValue, prototype: ObjectValue | NullValue): Change[] | false {
  return plan({ object, prototype });
}

/** Internal atomic array publication must preflight the entire group before
 * any definition. The ordinary definition funnel checks each commit as well. */
export function CheckInheritedDefinitions(object: ObjectValue, definitions: readonly { key: PropertyKeyValue, desc: Descriptor }[]): ThrowCompletion | undefined {
  if (!dependents.has(object)) return undefined;
  const properties = new Map(definitions.map(({ key, desc }) => [normalized(key), prospective(object, key, desc)]));
  return plan({ object, properties }) === false
    ? Throw.TypeError('a definition would invalidate an inherited storage contract') : undefined;
}

/** Acquiring Array backing changes the representation of length/byteLength.
 * It must not invalidate a previously acquired ordinary inherited data read. */
export function CheckInheritedArrayAcquisition(object: ObjectValue, element?: TypeRecord): ThrowCompletion | undefined {
  for (const guard of dependents.get(object) ?? []) {
    const key = typeof guard.key === 'string' ? guard.key : guard.key.deref();
    const owner = guard.owner.deref();
    if (key === undefined || !owner) { detach(guard); continue; }
    if (typeof key !== 'string') continue;
    if (key === 'length' || (key === 'byteLength'
        && element && LayoutOf(element) && lookup(owner, propertyKeyValue(key))?.value === Value.undefined)) {
      return Throw.TypeError('array backing would invalidate an inherited data representation');
    }
  }
  return undefined;
}
