import { surroundingAgent } from '../execution-context/Agent.mts';
import type { SymbolValue } from '../value.mts';

/** Opaque storage tokens preserve engine Symbol identity without string coercion.
 * The tables belong to the Agent, like metadata claims and type interning.
 */
const agents = new WeakMap<object, {
  stored: Map<SymbolValue, symbol>;
  original: Map<symbol, SymbolValue>;
  order: Map<SymbolValue, number>;
}>();
function keysForAgent() {
  let state = agents.get(surroundingAgent);
  if (!state) {
    state = { stored: new Map(), original: new Map(), order: new Map() };
    agents.set(surroundingAgent, state);
  }
  return state;
}

export function MetadataStorageKey(key: string | SymbolValue): string | symbol {
  if (typeof key === 'string') return key;
  const state = keysForAgent();
  let token = state.stored.get(key);
  if (token === undefined) {
    token = Symbol();
    state.stored.set(key, token);
    state.original.set(token, key);
  }
  return token;
}

export function MetadataKey(key: string | symbol): string | SymbolValue {
  if (typeof key === 'string') return key;
  const original = keysForAgent().original.get(key);
  if (!original) throw new Error('unknown canonical metadata key');
  return original;
}

/** Shared with canonical property ordering; descriptions never decide identity. */
export function SymbolInternIndex(key: SymbolValue): number {
  const order = keysForAgent().order;
  let index = order.get(key);
  if (index === undefined) {
    index = order.size;
    order.set(key, index);
  }
  return index;
}

export function MetadataKeys(record: object): (string | symbol)[] {
  return Reflect.ownKeys(record).filter((key) => Object.prototype.propertyIsEnumerable.call(record, key));
}

export function MetadataEntries<T = unknown>(record: object): [string | symbol, T][] {
  return MetadataKeys(record).map((key) => [key, (record as Record<string | symbol, T>)[key]]);
}
