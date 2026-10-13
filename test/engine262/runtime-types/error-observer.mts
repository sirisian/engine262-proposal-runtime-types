import { ObjectValue, type Value, type ManagedRealm } from '#self';

/** Read only an internal slot, without invoking an interpreted property Get. */
export function errorPrototypeOf(value: Value | undefined): unknown {
  return value instanceof ObjectValue && 'Prototype' in value ? value.Prototype : undefined;
}

export function nativeErrorClass(value: Value, realm: ManagedRealm) {
  const prototype = errorPrototypeOf(value);
  const names = ['Error', 'SyntaxError', 'TypeError', 'ReferenceError', 'StaticTypeError', 'RangeError'] as const;
  return names.find((name) => prototype === realm.Intrinsics[`%${name}.prototype%`]);
}
