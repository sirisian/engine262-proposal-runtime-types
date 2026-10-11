import type { ParameterRecord, TypeRecord } from './records.mts';
import { restElementType } from './records.mts';
import { SequenceAssignment } from './sequence-assignment.mts';

/** The leaf contracts of a collected reference sequence, without expanding extents. */
export function referenceRestTypes(type: TypeRecord): TypeRecord[] {
  if (type.Kind === 'array') return [type.Element];
  if (type.Kind === 'tuple') return type.Elements.flatMap((e) => e.Rest ? referenceRestTypes(e.Type) : [e.Type]);
  return [type];
}

/** Check the actual run, retaining positional correlation and nested rests. */
function admitsReferenceRun(type: TypeRecord, start: number, count: number, admits: (index: number, type: TypeRecord) => boolean, memo: Map<TypeRecord, Map<string, boolean>>): boolean {
  const spans = memo.get(type) ?? new Map<string, boolean>();
  memo.set(type, spans);
  const key = `${start}:${count}`;
  if (spans.has(key)) return spans.get(key)!;
  const result = checkReferenceRun(type, start, count, admits, memo);
  spans.set(key, result);
  return result;
}

function checkReferenceRun(type: TypeRecord, start: number, count: number, admits: (index: number, type: TypeRecord) => boolean, memo: Map<TypeRecord, Map<string, boolean>>): boolean {
  if (type.Kind === 'array' && typeof type.Extent === 'number' && type.Extent !== count) return false;
  if (type.Kind === 'tuple') {
    const slots = type.Elements.map((e) => ({ Rest: e.Rest, Optional: e.Initial !== 'none' || e.DeclaredDefault === true }));
    return SequenceAssignment(slots, count,
      (i, k) => type.Elements[k].Rest || admits(start + i, type.Elements[k].Type),
      (i, n, k) => !type.Elements[k].Rest || admitsReferenceRun(type.Elements[k].Type, start + i, n, admits, memo)) !== 'unmatched';
  }
  const element = type.Kind === 'array' ? type.Element : type;
  for (let i = start; i < start + count; i += 1) {
    if (!admits(i, element)) return false;
  }
  return true;
}

/** Same parameter-level greediness, with complete contracts for ref rests. */
export function PlanReferenceArguments(parameters: readonly ParameterRecord[]) {
  const types = parameters.map((p) => p.Rest ? restElementType(p.Type) : p.Type);
  const contracts = parameters.flatMap((p, k) => (p.Rest && p.Ref ? referenceRestTypes(p.Type) : [types[k]])
    .map((type) => ({ type, byReference: p.Ref === true || type.Kind === 'reference' })));
  const assign = (length: number, admits: (index: number, type: TypeRecord, byReference: boolean, optional?: boolean) => boolean): number[] | null => {
    // Each cache belongs to one immutable admission matrix and argument list.
    const memo = new Map<TypeRecord, Map<string, boolean>>();
    const counts = SequenceAssignment(parameters, length, (i, k) => {
      const p = parameters[k];
      if (p.Rest && p.Ref) return true;
      return admits(i, types[k], p.Ref === true, !p.Rest && p.Optional);
    }, (start, count, k) => {
      const p = parameters[k];
      return !p.Rest || !p.Ref || admitsReferenceRun(p.Type, start, count, (i, type) => admits(i, type, true), memo);
    });
    return counts === 'unmatched' ? null : counts;
  };
  return { contracts, assign };
}
