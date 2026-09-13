import type { ObjectValue } from '../value.mts';

// Storage identity, not a collection of references. A replacement value keeps
// the token; removing the element discards it permanently. A later element at
// the same index receives another token even if the allocation did not move.
const elementIdentities = new WeakMap<ObjectValue, Map<string, object>>();

export function ArrayElementIdentity(source: ObjectValue, key: string): object {
  let elements = elementIdentities.get(source);
  if (!elements) {
    elements = new Map();
    elementIdentities.set(source, elements);
  }
  let identity = elements.get(key);
  if (!identity) {
    identity = {};
    elements.set(key, identity);
  }
  return identity;
}

export function ArrayElementIsLive(source: ObjectValue, key: string, identity: object): boolean {
  return elementIdentities.get(source)?.get(key) === identity;
}

export function RemoveArrayElementIdentity(source: ObjectValue, key: string): void {
  elementIdentities.get(source)?.delete(key);
}
