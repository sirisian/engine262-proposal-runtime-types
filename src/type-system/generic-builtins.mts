import type { ObjectValue } from '../value.mts';

// Built-in applications are implemented by CallExpression and NewExpression,
// rather than ECMAScript declarations. Remember their original function objects
// so replacing a library property cannot give an ordinary function this capability.
const genericBuiltins = new WeakSet<object>();
export function RegisterGenericBuiltin(value: ObjectValue): void {
  genericBuiltins.add(value);
}
export function IsGenericBuiltin(value: ObjectValue): boolean {
  return genericBuiltins.has(value);
}
