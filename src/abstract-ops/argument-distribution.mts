import { Value, ReferenceValue, ObjectValue, JSStringValue } from '../value.mts';
import type { ReferenceRecord } from '../value.mts';
import { EnvironmentRecord, RefBindingHolder } from '../execution-context/Environment.mts';
import { Q, EnsureCompletion } from '../completion.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import { IsOfType, RuntimeTypeOf } from '../type-system/runtime.mts';
import { SameType } from '../type-system/relations.mts';
import { restElementType, type ParameterRecord, type TypeRecord } from '../type-system/records.mts';
import { SequenceAssignment } from '../type-system/sequence-assignment.mts';
import { GetValue } from './reference-operations.mts';
import { CheckedConvertValue } from './runtime-types.mts';

/** A location's declared contract, following aliases without reading storage. */
function declaredLocationType(location: ReferenceRecord): TypeRecord | undefined {
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
    if (location.Base instanceof ObjectValue && location.ReferencedName instanceof JSStringValue) {
      const key = location.ReferencedName.stringValue();
      const base = location.Base as ObjectValue & {
        TypedProperties?: Map<string, { TypeRecord: TypeRecord }>, TypedElement?: { TypeRecord: TypeRecord },
      };
      return base.TypedProperties?.get(key)?.TypeRecord
        ?? (String(Number(key)) === key ? base.TypedElement?.TypeRecord : undefined);
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
export function* AssignRuntimeArguments(parameters: readonly ParameterRecord[], args: readonly Value[]): PlainEvaluator<number[] | null> {
  const admitted: boolean[][] = [];
  for (const arg of args) {
    const borrowed = arg instanceof ReferenceValue;
    const value = borrowed ? Q(yield* GetValue(arg.Location)) : arg;
    const locationType = borrowed ? (declaredLocationType(arg.Location) ?? RuntimeTypeOf(value)) : undefined;
    const row: boolean[] = [];
    for (const p of parameters) {
      const type = p.Rest ? restElementType(p.Type) : p.Type;
      const byReference = p.Ref === true || type.Kind === 'reference';
      const wanted = type.Kind === 'reference' ? type.Target : type;
      if (byReference && (!borrowed || (locationType!.Kind !== 'any' && wanted.Kind !== 'any' && !SameType(locationType!, wanted)))) {
        row.push(false);
        continue;
      }
      let ok = Q(yield* IsOfType(value, wanted));
      if (!ok && !byReference && !(value instanceof ObjectValue)) {
        // A value boundary may convert a primitive. A reference never converts
        // its storage, and object conversion must not run during distribution.
        const converted = EnsureCompletion(yield* CheckedConvertValue(value, wanted));
        ok = converted.Type === 'normal';
      }
      row.push(ok);
    }
    admitted.push(row);
  }
  const counts = SequenceAssignment(parameters, args.length, (i, k) => admitted[i][k]);
  return counts === 'unmatched' ? null : counts;
}
