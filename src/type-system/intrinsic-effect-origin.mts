import { ObjectValue, Value } from '../value.mts';

export type IntrinsicEffectOrigin = 'set' | 'reflect-defineProperty' | 'deleteProperty' | 'defineProperty' | 'defineProperties' | 'assign'
  | 'create' | 'setPrototypeOf' | 'reflect-setPrototypeOf' | 'function-call' | 'function-apply' | 'function-bind';

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

// Accessor identity is separate from invocation summaries: calling this getter
// with an exotic receiver can run a trap. Only a proven ordinary receiver lets
// an inherited read use the no-user-code prototype lookup summary.
const prototypeGetters = new WeakSet<ObjectValue>();
export function registerIntrinsicPrototypeGetter(value: Value | undefined): void {
  if (value instanceof ObjectValue) prototypeGetters.add(value);
}
export function isIntrinsicPrototypeGetter(value: Value | undefined): boolean {
  return value instanceof ObjectValue && prototypeGetters.has(value);
}
