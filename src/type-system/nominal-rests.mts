import { ObjectValue, JSStringValue, type PropertyKeyValue, type NullValue } from '../value.mts';
import {
  OrdinaryNominalPrototype, OrdinaryNominalPath, ObserveNominalPrototypeDependencies,
  ScalarRestValues, ScalarRestsAccept, ScalarRestMember, TupleBackingLength, isArrayIndex,
  type ScalarRestStorage,
} from '#self';

/** Recheck the complete sequence under one prospective ordinary link change.
 * Retain the successful nominal-role paths, not an exact class or one partition.
 * Negative roles need no dependency: losing one cannot invalidate the existing
 * witness. Whenever a positive role changes, all roles are reconsidered. */
function dependencies(owner: ObjectValue, changed?: ObjectValue, replacement?: ObjectValue | NullValue): ObjectValue[] | false {
  const patterns = (owner as ScalarRestStorage).ScalarRestGuards;
  if (!patterns?.some((pattern) => pattern.some((run) => run.Type.Kind === 'nominal'))) return [];
  const values = ScalarRestValues(owner, TupleBackingLength(owner));
  if (!values) return false;
  const links = new Set<ObjectValue>();
  for (const pattern of patterns) {
    if (!ScalarRestsAccept(pattern, values, (value, type) => {
      if (type.Kind !== 'nominal') return ScalarRestMember(value, type);
      const target = OrdinaryNominalPrototype(type);
      if (!(value instanceof ObjectValue) || !target) return false;
      const path = OrdinaryNominalPath(value, target, changed, replacement);
      if (!path) return false;
      for (const link of path) links.add(link);
      return true;
    })) return false;
  }
  return [...links];
}

/** Called only after ordinary data publication or completed guard acquisition.
 * During a staged removal the old length can temporarily include absent data;
 * retain the previous dependencies until a valid final length is published. */
export function RefreshNominalRestDependencies(owner: ObjectValue, key?: PropertyKeyValue): void {
  const patterns = (owner as ScalarRestStorage).ScalarRestGuards;
  if (!patterns?.some((pattern) => pattern.some((run) => run.Type.Kind === 'nominal'))) return;
  if (key !== undefined && (!(key instanceof JSStringValue) || (key.stringValue() !== 'length'
      && (!isArrayIndex(key) || Number(key.stringValue()) >= TupleBackingLength(owner))))) return;
  const links = dependencies(owner);
  if (links !== false) ObserveNominalPrototypeDependencies(owner, links, dependencies);
}
