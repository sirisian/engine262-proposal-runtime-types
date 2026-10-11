import { Value, ReferenceValue, ObjectValue, JSStringValue, SymbolValue } from '../value.mts';
import type { ReferenceRecord } from '../value.mts';
import { EnvironmentRecord, RefBindingHolder } from '../execution-context/Environment.mts';
import { Q, EnsureCompletion } from '../completion.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import { IsOfType, RuntimeTypeOf } from '../type-system/runtime.mts';
import { SameType } from '../type-system/relations.mts';
import type { ParameterRecord, TypeRecord } from '../type-system/records.mts';
import { PlanReferenceArguments, type ReferenceForwarding } from '../type-system/reference-rest.mts';
import { GetValue } from './reference-operations.mts';
import { CheckedConvertValue } from './runtime-types.mts';

/** A location's declared contract, following aliases without reading storage. */
export function DeclaredReferenceLocationType(location: ReferenceRecord): TypeRecord | undefined {
  const seen = new Set<ReferenceRecord>();
  while (!seen.has(location)) {
    seen.add(location);
    if (location.Base instanceof EnvironmentRecord && location.ReferencedName instanceof JSStringValue) {
      const binding = RefBindingHolder(location.Base, location.ReferencedName)?.bindings.get(location.ReferencedName);
      if (binding?.refLocation) {
        location = binding.refLocation;
        continue;
      }
      return binding?.declaredType as TypeRecord | undefined;
    }
    if (location.Base instanceof ObjectValue && (location.ReferencedName instanceof JSStringValue || location.ReferencedName instanceof SymbolValue)) {
      const key = location.ReferencedName instanceof JSStringValue ? location.ReferencedName.stringValue() : location.ReferencedName;
      const base = location.Base as ObjectValue & {
        TypedProperties?: Map<string | SymbolValue, { TypeRecord: TypeRecord }>, TypedElement?: TypeRecord,
        TypedTuple?: { Positions: readonly TypeRecord[], Rest?: TypeRecord },
      };
      const index = typeof key === 'string' ? Number(key) : NaN;
      const indexed = String(index) === key && Number.isInteger(index) && index >= 0 && index < 0xFFFFFFFF;
      return base.TypedProperties?.get(key)?.TypeRecord
        ?? (indexed ? base.TypedTuple?.Positions[index] ?? base.TypedTuple?.Rest ?? base.TypedElement : undefined);
    }
    break;
  }
  return undefined;
}

/**
 * Runtime distribution retains each original argument. A borrow contributes
 * its location contract to a ref position, and its current value to a value
 * position. Reading it checks liveness; neither that read nor this partition
 * replaces the original reference or the callee's later checks.
 */
export function* AssignRuntimeArguments(parameters: readonly ParameterRecord[], args: readonly Value[], forwarding?: ReferenceForwarding): PlainEvaluator<number[] | null> {
  const plan = PlanReferenceArguments(parameters);
  const admitted: Map<TypeRecord, boolean[]>[] = [];
  const values: Value[] = [];
  for (const arg of args) {
    const borrowed = arg instanceof ReferenceValue;
    const value = borrowed ? Q(yield* GetValue(arg.Location)) : arg;
    values.push(value);
    const locationType = borrowed ? (DeclaredReferenceLocationType(arg.Location) ?? RuntimeTypeOf(value)) : undefined;
    const row = new Map<TypeRecord, boolean[]>();
    for (const { type, byReference } of plan.contracts) {
      const modes = row.get(type) ?? [];
      row.set(type, modes);
      const mode = byReference ? 1 : 0;
      if (modes[mode] !== undefined) continue;
      const wanted = type.Kind === 'reference' ? type.Target : type;
      if (byReference && (!borrowed || (locationType!.Kind !== 'any' && wanted.Kind !== 'any' && !SameType(locationType!, wanted)))) {
        modes[mode] = false;
        continue;
      }
      let ok = Q(yield* IsOfType(value, wanted));
      if (!ok && !byReference && !(value instanceof ObjectValue)) {
        // A value boundary may convert a primitive. A reference never converts
        // its storage, and object conversion must not run during distribution.
        const converted = EnsureCompletion(yield* CheckedConvertValue(value, wanted));
        ok = converted.Type === 'normal';
      }
      modes[mode] = ok;
    }
    admitted.push(row);
  }
  return plan.assign(args.length, (i, type, byReference, optional) => {
    const ref = byReference || type.Kind === 'reference';
    // Named placement emits undefined for an omitted fixed slot. It must
    // still reach that slot's initializer when the callee partitions rests.
    if (optional && !ref && values[i] === Value.undefined) return true;
    return admitted[i].get(type)![ref ? 1 : 0];
  }, forwarding);
}
