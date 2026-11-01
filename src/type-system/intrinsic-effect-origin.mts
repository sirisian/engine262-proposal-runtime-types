import { ObjectValue, Value } from '../value.mts';

export type IntrinsicEffectOrigin = 'set' | 'reflect-defineProperty' | 'deleteProperty' | 'defineProperty' | 'defineProperties' | 'assign';

// Private identities recorded during bootstrap, before source code can replace
// a namespace property. A captured original retains its summary across realms
// and property renaming; names, native callability and signatures grant none.
const origins = new WeakMap<ObjectValue, IntrinsicEffectOrigin>();

export function registerIntrinsicEffectOrigins(namespace: ObjectValue, entries: Readonly<Record<string, IntrinsicEffectOrigin>>): void {
  for (const [name, origin] of Object.entries(entries)) {
    const value = namespace.properties.get(Value(name))?.Value;
    if (value instanceof ObjectValue) origins.set(value, origin);
  }
}

export function intrinsicEffectOrigin(value: Value | undefined): IntrinsicEffectOrigin | undefined {
  return value instanceof ObjectValue ? origins.get(value) : undefined;
}
