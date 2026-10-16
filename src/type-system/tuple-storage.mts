import type { TypeRecord } from './records.mts';
import { CanonicalizeType } from './intern.mts';
import { SameType } from './relations.mts';
import { ObjectValue, NumberValue, Value, R } from '#self';

/** A complete positional or required prefix/rest/suffix domain, or its conjunction with
 * other acquired domains. No observed partition or element values are stored. */
export type TupleStorageShape = {
  Positions: readonly TypeRecord[], Rest: TypeRecord | undefined,
  Suffix?: readonly TypeRecord[], Conjuncts?: readonly TupleStorageShape[],
  MinimumLength?: number,
};

export function TupleStorageShapeOf(type: TypeRecord): TupleStorageShape | undefined {
  if (type.Kind !== 'tuple') return undefined;
  const hasDefaults = type.Elements.some((e) => e.Initial !== 'none' || e.DeclaredDefault);
  // Without a rest, defaults change admitted lengths, never the type at an
  // existing index. Default/rest combinations still need general assignment.
  if (hasDefaults && type.Elements.some((e) => e.Rest)) return undefined;
  const positions: TypeRecord[] = [];
  const suffix: TypeRecord[] = [];
  let rest: TypeRecord | undefined;
  for (const element of type.Elements) {
    if (!element.Rest) (rest ? suffix : positions).push(element.Type);
    else if (!rest && element.Type.Kind === 'array' && element.Type.Extent === 'dynamic') rest = element.Type.Element;
    else return undefined;
  }
  return { Positions: positions, Rest: rest, ...(suffix.length ? { Suffix: suffix } : {}),
    ...(hasDefaults ? { MinimumLength: type.Elements.filter((e) => e.Initial === 'none' && !e.DeclaredDefault).length } : {}) };
}

export function TupleLengthRange(shape: TupleStorageShape): { min: number, max: number } {
  if (shape.Conjuncts) {
    const ranges = shape.Conjuncts.map(TupleLengthRange);
    return { min: ranges.reduce((n, r) => Math.max(n, r.min), 0),
      max: ranges.reduce((n, r) => Math.min(n, r.max), Infinity) };
  }
  const width = shape.Positions.length + (shape.Suffix?.length ?? 0);
  return { min: shape.MinimumLength ?? width, max: shape.Rest === undefined ? width : Infinity };
}

export function TupleStorageTypeAt(shape: TupleStorageShape, index: number, length: number): TypeRecord | undefined {
  if (index < 0 || index >= length) return undefined;
  if (shape.Conjuncts) {
    const types = shape.Conjuncts.map((part) => TupleStorageTypeAt(part, index, length));
    if (types.some((type) => type === undefined)) return undefined;
    return CanonicalizeType({ Kind: 'intersection', Members: types as TypeRecord[] });
  }
  if (index < shape.Positions.length) return shape.Positions[index];
  const suffix = shape.Suffix ?? [];
  if (index >= length - suffix.length) return suffix[index - (length - suffix.length)];
  return shape.Rest;
}

/** Distance to the next declared contract boundary; skip homogeneous runs. */
export function TupleStorageRun(shape: TupleStorageShape, index: number, length: number, direction = 1): number {
  if (shape.Conjuncts) return shape.Conjuncts.reduce((run, part) => Math.min(run, TupleStorageRun(part, index, length, direction)), Infinity);
  const end = length - (shape.Suffix?.length ?? 0);
  if (index < shape.Positions.length || index >= end) return 1;
  return direction === 1 ? end - index : index - shape.Positions.length + 1;
}

export function TupleResizePreserves(shape: TupleStorageShape, before: number, after: number): boolean {
  const range = TupleLengthRange(shape);
  if (after < range.min || after > range.max) return false;
  const end = Math.min(before, after);
  for (let index = 0; index < end;) {
    const oldType = TupleStorageTypeAt(shape, index, before);
    const newType = TupleStorageTypeAt(shape, index, after);
    if (!oldType || !newType || !SameType(oldType, newType)) return false;
    index += Math.min(end - index, TupleStorageRun(shape, index, before), TupleStorageRun(shape, index, after));
  }
  return true;
}

/** Internal Array length only: obtaining a backing contract must not replay
 * an observable length Get. Proxy transport keeps its separate ordinary hooks. */
export function TupleBackingLength(object: ObjectValue): number {
  let target = object;
  while ('ProxyTarget' in target && target.ProxyTarget instanceof ObjectValue) target = target.ProxyTarget;
  const value = target.properties.get(Value('length'))?.Value;
  return value instanceof NumberValue ? R(value) : 0;
}

export function TupleFixedPositions(shape: TupleStorageShape): readonly TypeRecord[] | undefined {
  const range = TupleLengthRange(shape);
  if (!Number.isFinite(range.max) || range.min !== range.max) return undefined;
  return Array.from({ length: range.max }, (_, index) => TupleStorageTypeAt(shape, index, range.max)!);
}

/** A bounded positional copy contains exactly the positions copied at this
 * length. Omitted source defaults do not create extra copied elements. */
export function TupleCopyPositions(shape: TupleStorageShape, length: number): readonly TypeRecord[] | undefined {
  const range = TupleLengthRange(shape);
  if (!Number.isFinite(range.max) || length < range.min || length > range.max) return undefined;
  return Array.from({ length }, (_, index) => TupleStorageTypeAt(shape, index, length)!);
}

/** Search includes every declared domain, even an empty rest. For conjunctions,
 * all prefix/suffix overlaps occur before their total width plus one; larger
 * lengths add only repetitions of the same middle intersection. */
export function TupleSearchTypes(shape: TupleStorageShape): TypeRecord[] {
  if (!shape.Conjuncts) return [...shape.Positions, ...(shape.Rest ? [shape.Rest] : []), ...(shape.Suffix ?? [])];
  const fixed = TupleFixedPositions(shape);
  if (fixed) return [...fixed];
  const leaves = (part: TupleStorageShape): TupleStorageShape[] => part.Conjuncts ? part.Conjuncts.flatMap(leaves) : [part];
  const parts = leaves(shape);
  const width = parts.reduce((n, part) => Math.max(n, part.Positions.length), 0)
    + parts.reduce((n, part) => Math.max(n, part.Suffix?.length ?? 0), 0) + 1;
  const result: TypeRecord[] = [];
  const range = TupleLengthRange(shape);
  for (let length = range.min; length <= Math.min(width, range.max); length += 1) {
    for (let index = 0; index < length; index += TupleStorageRun(shape, index, length)) {
      result.push(TupleStorageTypeAt(shape, index, length)!);
    }
  }
  return result;
}

/** A static index without a known length ranges over each possible suffix
 * alignment, never over a partition guessed from current element values. */
export function TupleIndexType(type: TypeRecord, index: number): TypeRecord | undefined {
  // Storage support does not expand the separate static-index judgment for
  // defaulted tuple types.
  if (type.Kind === 'tuple' && type.Elements.some((e) => e.Initial !== 'none' || e.DeclaredDefault)) return undefined;
  const shape = TupleStorageShapeOf(type);
  if (!shape || index < 0) return undefined;
  if (index < shape.Positions.length) return shape.Positions[index];
  if (!shape.Rest) return undefined;
  const members = [shape.Rest, ...(shape.Suffix ?? []).slice(0, index - shape.Positions.length + 1)];
  return CanonicalizeType({ Kind: 'union', Members: members });
}
