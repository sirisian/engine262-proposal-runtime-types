import { ObjectValue, type Value } from '../value.mts';
import type { TypeRecord } from './records.mts';
import { SameType } from './relations.mts';
import { OrdinaryNominalPrototype } from '#self';

export type OrdinaryConversionDeclaration = {
  Target: TypeRecord, Function: Value, Signature?: TypeRecord, Source: boolean,
};
const declarations = new WeakMap<Value, readonly OrdinaryConversionDeclaration[]>();
export type OrdinaryConstructorDeclaration = { Function: Value, Signature?: TypeRecord };
const constructors = new WeakMap<Value, readonly OrdinaryConstructorDeclaration[]>();

/** Constructor bodies retain their own declaration-context signatures. The
 * reflection record for the first constructor is not an overload table. */
export function RegisterOrdinaryConstructors(owner: Value, entries: readonly OrdinaryConstructorDeclaration[]): void {
  constructors.set(owner, entries);
}

export function OrdinaryConstructors(owner: Value): readonly OrdinaryConstructorDeclaration[] | undefined {
  return constructors.get(owner);
}

/** Keep declaration identity and all same-form alternatives. A display-keyed
 * dispatch table cannot distinguish shadowed class names or retain overloads. */
export function RegisterOrdinaryConversion(owner: Value, entry: OrdinaryConversionDeclaration): void {
  declarations.set(owner, [...(declarations.get(owner) ?? []), entry]);
}

export function OrdinaryInboundConversions(target: TypeRecord): readonly OrdinaryConversionDeclaration[] {
  const prototype = OrdinaryNominalPrototype(target);
  return prototype ? (declarations.get(prototype) ?? []).filter((entry) => !entry.Source && SameType(entry.Target, target)) : [];
}

/** Ordinary internal lookup only. The nearest declaration set for this exact
 * target shadows an inherited set. Selection retains the resulting callable;
 * execution must not repeat this lookup after another conversion's effects. */
export function OrdinarySourceConversions(value: Value, target: TypeRecord): readonly OrdinaryConversionDeclaration[] {
  let object = value;
  const seen = new Set<Value>();
  while (object instanceof ObjectValue && !seen.has(object)) {
    seen.add(object);
    if (object.GetPrototypeOf !== ObjectValue.prototype.GetPrototypeOf || !('Prototype' in object)) return [];
    object = object.Prototype as Value;
    const found = (declarations.get(object) ?? []).filter((entry) => entry.Source && SameType(entry.Target, target));
    if (found.length) return found;
  }
  return [];
}
