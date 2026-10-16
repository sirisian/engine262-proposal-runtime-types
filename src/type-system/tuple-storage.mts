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
  Runs?: { Prefix: readonly TupleStorageRunRecord[], Suffix: readonly TupleStorageRunRecord[], PrefixLength: number, SuffixLength: number },
};

type TupleStorageRunRecord = { Type: TypeRecord, Count: number };

export function TupleStorageShapeOf(type: TypeRecord): TupleStorageShape | undefined {
  if (type.Kind !== 'tuple') return undefined;
  const prefix: TupleStorageRunRecord[] = [];
  const suffix: TupleStorageRunRecord[] = [];
  let rest: TypeRecord | undefined;
  let hasDefaults = false;
  let required = 0;
  let expanded = false;
  const active = new Set<TypeRecord>();
  const append = (Type: TypeRecord, Count: number) => {
    if (Count > 0) (rest ? suffix : prefix).push({ Type, Count });
  };
  const visit = (tuple: TypeRecord & { Kind: 'tuple' }): boolean => {
    if (active.has(tuple)) return false;
    active.add(tuple);
    for (const element of tuple.Elements) {
      if (!element.Rest) {
        const optional = element.Initial !== 'none' || element.DeclaredDefault;
        hasDefaults ||= !!optional;
        if (!optional) required += 1;
        append(element.Type, 1);
      } else if (element.Type.Kind === 'tuple') {
        expanded = true;
        if (!visit(element.Type)) return false;
      } else if (element.Type.Kind === 'array') {
        if (element.Type.Extent === 'dynamic' && !rest) rest = element.Type.Element;
        else if (typeof element.Type.Extent === 'number' && Number.isSafeInteger(element.Type.Extent) && element.Type.Extent >= 0) {
          expanded = true;
          required += element.Type.Extent;
          append(element.Type.Element, element.Type.Extent);
        } else return false;
      } else return false;
    }
    active.delete(tuple);
    return true;
  };
  if (!visit(type) || !Number.isSafeInteger(required)) return undefined;
  // Expanded defaults need formation/provenance rules of their own. This
  // compact representation covers required finite runs and one dynamic rest.
  if (hasDefaults && (expanded || suffix.length)) return undefined;
  if (expanded) return { Positions: [], Rest: rest, Runs: { Prefix: prefix, Suffix: suffix,
    PrefixLength: prefix.reduce((n, run) => n + run.Count, 0), SuffixLength: suffix.reduce((n, run) => n + run.Count, 0) } };
  return { Positions: prefix.map((run) => run.Type), Rest: rest,
    ...(suffix.length ? { Suffix: suffix.map((run) => run.Type) } : {}),
    ...(hasDefaults ? { MinimumLength: required } : {}) };
}

function runs(shape: TupleStorageShape, suffix = false): readonly TupleStorageRunRecord[] {
  return shape.Runs ? suffix ? shape.Runs.Suffix : shape.Runs.Prefix
    : (suffix ? shape.Suffix ?? [] : shape.Positions).map((Type) => ({ Type, Count: 1 }));
}

export function TuplePrefixLength(shape: TupleStorageShape): number {
  return shape.Runs ? shape.Runs.PrefixLength : shape.Positions.length;
}

export function TupleSuffixLength(shape: TupleStorageShape): number {
  return shape.Runs ? shape.Runs.SuffixLength : shape.Suffix?.length ?? 0;
}

function runAt(list: readonly TupleStorageRunRecord[], index: number): { Type: TypeRecord, before: number, after: number } | undefined {
  for (const run of list) {
    if (index < run.Count) return { Type: run.Type, before: index + 1, after: run.Count - index };
    index -= run.Count;
  }
  return undefined;
}

export function TupleLengthRange(shape: TupleStorageShape): { min: number, max: number } {
  if (shape.Conjuncts) {
    const ranges = shape.Conjuncts.map(TupleLengthRange);
    return { min: ranges.reduce((n, r) => Math.max(n, r.min), 0),
      max: ranges.reduce((n, r) => Math.min(n, r.max), Infinity) };
  }
  const width = TuplePrefixLength(shape) + TupleSuffixLength(shape);
  return { min: shape.MinimumLength ?? width, max: shape.Rest === undefined ? width : Infinity };
}

export function TupleStorageTypeAt(shape: TupleStorageShape, index: number, length: number): TypeRecord | undefined {
  if (index < 0 || index >= length) return undefined;
  if (shape.Conjuncts) {
    const types = shape.Conjuncts.map((part) => TupleStorageTypeAt(part, index, length));
    if (types.some((type) => type === undefined)) return undefined;
    return CanonicalizeType({ Kind: 'intersection', Members: types as TypeRecord[] });
  }
  if (!shape.Runs) {
    if (index < shape.Positions.length) return shape.Positions[index];
    const suffix = shape.Suffix ?? [];
    return index >= length - suffix.length ? suffix[index - (length - suffix.length)] : shape.Rest;
  }
  const prefix = TuplePrefixLength(shape);
  const suffix = TupleSuffixLength(shape);
  if (index < prefix) return runAt(runs(shape), index)?.Type;
  if (index >= length - suffix) return runAt(runs(shape, true), index - (length - suffix))?.Type;
  return shape.Rest;
}

/** Distance to the next declared contract boundary; skip repeated finite runs. */
export function TupleStorageRun(shape: TupleStorageShape, index: number, length: number, direction = 1): number {
  if (shape.Conjuncts) return shape.Conjuncts.reduce((run, part) => Math.min(run, TupleStorageRun(part, index, length, direction)), Infinity);
  if (!shape.Runs) {
    const end = length - (shape.Suffix?.length ?? 0);
    if (index < shape.Positions.length || index >= end) return 1;
    return direction === 1 ? end - index : index - shape.Positions.length + 1;
  }
  const prefix = TuplePrefixLength(shape);
  const end = length - TupleSuffixLength(shape);
  const fixed = index < prefix ? runAt(runs(shape), index)
    : index >= end ? runAt(runs(shape, true), index - end) : undefined;
  if (fixed) return direction === 1 ? fixed.after : fixed.before;
  return direction === 1 ? end - index : index - prefix + 1;
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

/** Representative lengths for every prefix/suffix alignment. Contracts only
 * change when a prefix boundary meets a suffix boundary. Counts never expand
 * into per-position records or a loop over the numeric extent. */
export function TupleStorageLengths(shapes: readonly TupleStorageShape[], min: number, max: number): number[] {
  const leaves = (shape: TupleStorageShape): TupleStorageShape[] => shape.Conjuncts ? shape.Conjuncts.flatMap(leaves) : [shape];
  const prefix = new Set([0]);
  const suffix = new Set([0]);
  for (const shape of shapes.flatMap(leaves)) {
    let n = 0;
    for (const run of runs(shape)) {
      n += run.Count;
      prefix.add(n);
    }
    n = 0;
    for (const run of [...runs(shape, true)].reverse()) {
      n += run.Count;
      suffix.add(n);
    }
  }
  const lengths = new Set([min]);
  if (Number.isFinite(max)) lengths.add(max);
  for (const p of prefix) for (const s of suffix) {
    for (const length of [p + s - 1, p + s, p + s + 1]) {
      if (length >= min && length <= max) lengths.add(length);
    }
  }
  return [...lengths].filter((n) => n >= min && n <= max);
}

/** Search includes unoccupied declared domains; conjunctions retain all
 * possible alignments without expanding a finite repeated segment. */
export function TupleSearchTypes(shape: TupleStorageShape): TypeRecord[] {
  if (!shape.Conjuncts) return [...runs(shape), ...runs(shape, true)].map((run) => run.Type).concat(shape.Rest ? [shape.Rest] : []);
  const result: TypeRecord[] = [];
  const range = TupleLengthRange(shape);
  for (const length of TupleStorageLengths([shape], range.min, range.max)) {
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
  const prefix = TuplePrefixLength(shape);
  if (index < prefix) return runAt(runs(shape), index)?.Type;
  if (!shape.Rest) return undefined;
  const suffix: TypeRecord[] = [];
  let start = 0;
  for (const run of runs(shape, true)) {
    if (start > index - prefix) break;
    suffix.push(run.Type);
    start += run.Count;
  }
  return CanonicalizeType({ Kind: 'union', Members: [shape.Rest, ...suffix] });
}
