import { Q } from '../completion.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import {
  ObjectValue, Value, type Arguments, type FunctionCallContext,
} from '../value.mts';
import type { Realm } from '../execution-context/Realm.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { LayoutOf, SoAColumnsOf, type SoAColumn } from '../type-system/layout.mts';
import type { ArrayBufferObject } from '../abstract-ops/arraybuffer-objects.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import {
  AllocateArrayBuffer, OrdinaryCreateFromConstructor, Throw, ToIndex, surroundingAgent,
} from '#self';

/**
 * proposal-runtime-types soa.md: the storage of an `SoA.<T, Length>`.
 *
 * ONE ALLOCATION, with the columns at computed offsets, rather than one
 * allocation per column. That is what the design's own byte view requires -
 * "a byte view over an `SoA` sees the columns in declaration order, one after
 * another. That is also its serialization order, and it's why `byteLength` is a
 * sum of column lengths" - and it is what makes the view form of a later stage
 * possible at all: a host lays out one buffer by the rule and hands it over.
 *
 * It is also why there is no constructor that assembles an SoA from columns a
 * caller supplies. soa.md declines that deliberately: two SoAs could then share
 * a column, and every column pass would need the overlap check that disjoint
 * extents at compile-time offsets otherwise prove away.
 */
export interface SoAStorage {
  readonly Element: TypeRecord;
  /** The declared extent; 0 is growable. */
  readonly Extent: number;
  readonly Columns: readonly SoAColumn[];
  /** Byte offset of each column from the base, parallel to Columns. */
  readonly ColumnOffsets: readonly number[];
  Buffer: ArrayBufferObject;
  /** Elements in use. For a fixed extent this is the extent and never moves. */
  Length: number;
  /** Elements the allocation can hold; equals Length for a fixed extent. */
  Capacity: number;
}

const storages = new WeakMap<object, SoAStorage>();

export function SoAStorageOf(instance: object): SoAStorage | undefined {
  return storages.get(instance);
}

export function SetSoAStorage(instance: object, storage: SoAStorage): void {
  storages.set(instance, storage);
}

/**
 * The byte offset of each column and the total size, for a given capacity.
 * "Each column is padded and aligned on its own", so a column begins at the next
 * multiple of its own alignment.
 */
export function ColumnLayoutFor(columns: readonly SoAColumn[], capacity: number): { offsets: number[], byteLength: number, alignment: number } {
  const offsets: number[] = [];
  let cursor = 0;
  let alignment = 1;
  for (const column of columns) {
    if (column.layout.alignment > 0 && cursor % column.layout.alignment !== 0) {
      cursor += column.layout.alignment - (cursor % column.layout.alignment);
    }
    offsets.push(cursor);
    cursor += column.layout.byteLength * capacity;
    if (column.layout.alignment > alignment) {
      alignment = column.layout.alignment;
    }
  }
  if (alignment > 0 && cursor % alignment !== 0) {
    cursor += alignment - (cursor % alignment);
  }
  return { offsets, byteLength: cursor, alignment };
}

/** The type arguments a construction supplied, set by the NewExpression intercept. */
let pendingTypeArguments: readonly TypeRecord[] | undefined;

export function SetPendingSoATypeArguments(args: readonly TypeRecord[] | undefined): void {
  pendingTypeArguments = args;
}

/**
 * `new SoA.<T, Length>()` and, for the growable form, `new SoA.<T>(length)`.
 *
 * An allocation is ZERO-FILLED, as every allocation in this specification is:
 * a fixed `SoA.<T, N>` holds N zero-filled elements from construction, which is
 * the same rule that makes `let d: [10].<A>` hold ten of them.
  * https://sirisian.github.io/ecmascript-types/#sec-structure-of-arrays
 */
function* SoAConstructor(args: Arguments, { NewTarget }: FunctionCallContext): ValueEvaluator {
  if (NewTarget === Value.undefined) {
    return Throw.TypeError('$1 requires new', Value('SoA'));
  }
  const typeArgs = pendingTypeArguments;
  pendingTypeArguments = undefined;
  if (typeArgs === undefined || typeArgs.length === 0) {
    // soa.md gives no untyped form: the element type is what determines the
    // columns, so an SoA without one has no storage to allocate.
    return Throw.TypeError('$1 needs an element type, as in `new SoA.<T, N>()`', Value('SoA'));
  }
  const element = typeArgs[0]!;
  const declaredExtent = typeArgs.length > 1 && typeof typeArgs[1] === 'number' ? typeArgs[1] as unknown as number : 0;
  const columns = SoAColumnsOf(element);
  if (columns === null) {
    return Throw.TypeError('$1 cannot be stored as columns', Value('this element type'));
  }
  // A fixed extent is the length from construction; a growable form takes an
  // optional initial length, and otherwise starts empty.
  let length = declaredExtent;
  if (declaredExtent === 0 && args.length > 0 && args[0] !== Value.undefined) {
    length = Number(Q(yield* ToIndex(args[0]!)));
  }
  const capacity = length;
  const placement = ColumnLayoutFor(columns, capacity);
  const buffer = Q(yield* AllocateArrayBuffer(surroundingAgent.intrinsic('%ArrayBuffer%'), placement.byteLength));
  const instance = Q(yield* OrdinaryCreateFromConstructor(NewTarget as never, '%SoA.prototype%'));
  SetSoAStorage(instance, {
    Element: element,
    Extent: declaredExtent,
    Columns: columns,
    ColumnOffsets: placement.offsets,
    Buffer: buffer as ArrayBufferObject,
    Length: length,
    Capacity: capacity,
  });
  return instance;
}

function requireStorage(thisValue: Value) {
  if (!(thisValue instanceof ObjectValue)) {
    return null;
  }
  return SoAStorageOf(thisValue as unknown as object) ?? null;
}

/**
 * soa.md: "particles.length; // The ELEMENT COUNT, not a column length."
 *
 * https://sirisian.github.io/ecmascript-types/#sec-structure-of-arrays
 */
function* SoAProto_lengthGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const storage = requireStorage(thisValue);
  if (!storage) {
    return Throw.TypeError('$1 is not an SoA', thisValue);
  }
  // "particles.length; // The ELEMENT COUNT, not a column length"
  return Value(storage.Length);
}

/**
 * soa.md: "capacity — Growable arrays; the allocation backing every column."
 *
 * https://sirisian.github.io/ecmascript-types/#sec-structure-of-arrays
 */
function* SoAProto_capacityGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const storage = requireStorage(thisValue);
  if (!storage) {
    return Throw.TypeError('$1 is not an SoA', thisValue);
  }
  return Value(storage.Capacity);
}

/**
 * The instance's byteLength: the allocation the columns occupy.
 *
 * https://sirisian.github.io/ecmascript-types/#sec-structure-of-arrays
 */
function* SoAProto_byteLengthGetter(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const storage = requireStorage(thisValue);
  if (!storage) {
    return Throw.TypeError('$1 is not an SoA', thisValue);
  }
  // The instance's byteLength is the allocation the columns occupy, which for a
  // growable SoA follows its CAPACITY rather than its length - the columns are
  // placed against the allocation, not against the elements in use.
  return Value(ColumnLayoutFor(storage.Columns, storage.Capacity).byteLength);
}

/**
 * `reserve(n)` — "Grow every column to hold at least n elements".
 *
 * Growing moves every column after the first, because a column's offset is
 * computed from the capacity. That is the same fact soa.md gives as the reason
 * only a fixed SoA is viewable, and the reason a live reference into a growable
 * one is invalidated by growth.
  * https://sirisian.github.io/ecmascript-types/#sec-structure-of-arrays
 */
function* SoAProto_reserve([n = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const storage = requireStorage(thisValue);
  if (!storage) {
    return Throw.TypeError('$1 is not an SoA', thisValue);
  }
  if (storage.Extent !== 0) {
    return Throw.TypeError('a fixed-extent SoA cannot be grown');
  }
  const wanted = Number(Q(yield* ToIndex(n)));
  if (wanted <= storage.Capacity) {
    return Value.undefined;
  }
  const placement = ColumnLayoutFor(storage.Columns, wanted);
  const grown = Q(yield* AllocateArrayBuffer(surroundingAgent.intrinsic('%ArrayBuffer%'), placement.byteLength));
  // Each column is copied to its new offset. The columns move independently,
  // which is why this is a per-column copy and not one block move.
  const from = new Uint8Array((storage.Buffer as unknown as { ArrayBufferData: Uint8Array }).ArrayBufferData);
  const to = new Uint8Array((grown as unknown as { ArrayBufferData: Uint8Array }).ArrayBufferData);
  for (let i = 0; i < storage.Columns.length; i += 1) {
    const stride = storage.Columns[i]!.layout.byteLength;
    const used = stride * storage.Length;
    const oldOffset = storage.ColumnOffsets[i]!;
    const newOffset = placement.offsets[i]!;
    to.set(from.subarray(oldOffset, oldOffset + used), newOffset);
  }
  storage.Buffer = grown as ArrayBufferObject;
  (storage as { ColumnOffsets: readonly number[] }).ColumnOffsets = placement.offsets;
  storage.Capacity = wanted;
  return Value.undefined;
}

/** https://sirisian.github.io/ecmascript-types/#sec-structure-of-arrays */
export function bootstrapSoA(realmRec: Realm) {
  if (!surroundingAgent.feature('runtime-types')) {
    return;
  }
  const proto = realmRec.Intrinsics['%SoA.prototype%'];
  const soaConstructor = bootstrapConstructor(realmRec, SoAConstructor, 'SoA', 0, proto, []);
  realmRec.Intrinsics['%SoA%'] = soaConstructor;
}

export {
  SoAProto_lengthGetter, SoAProto_capacityGetter, SoAProto_byteLengthGetter, SoAProto_reserve, LayoutOf,
};
