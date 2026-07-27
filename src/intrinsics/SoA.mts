import { Q, X } from '../completion.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import {
  NumberValue, ObjectValue, TypedNumberValue, Value, type Arguments, type FunctionCallContext,
} from '../value.mts';
import type { Realm } from '../execution-context/Realm.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { LayoutOf, SoAColumnsOf, type SoAColumn } from '../type-system/layout.mts';
import { BufferElementType } from '../abstract-ops/placement.mts';
import { ArrayViewBackingOf } from '../abstract-ops/array-view.mts';
import type { ArrayBufferObject } from '../abstract-ops/arraybuffer-objects.mts';
import { bootstrapConstructor } from './bootstrap.mts';
import {
  AllocateArrayBuffer, ArrayCreate, CreateDataProperty, Get, GetValueFromBuffer, OrdinaryCreateFromConstructor,
  OrdinaryObjectCreate, R, RequireType, SetValueInBuffer, Throw, ToIndex, surroundingAgent,
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
  /** For a VIEW, where its bytes begin and how many it reserved. */
  readonly ViewByteOffset?: number;
  readonly ViewByteLength?: number;
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
  // The Data Block IS the bytes; `new Uint8Array(block)` would COPY it, so the
  // writes below would land in a discarded array and every element already
  // stored would be lost on the first growth. Caught by a test that pushed past
  // the initial capacity and read element 0 back - a length check alone would
  // have passed.
  const from = (storage.Buffer as unknown as { ArrayBufferData: Uint8Array }).ArrayBufferData;
  const to = (grown as unknown as { ArrayBufferData: Uint8Array }).ArrayBufferData;
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
  const soaConstructor = bootstrapConstructor(realmRec, SoAConstructor, 'SoA', 0, proto, [
    ['from', SoA_from, 1],
  ]);
  realmRec.Intrinsics['%SoA%'] = soaConstructor;
}

export {
  SoAProto_lengthGetter, SoAProto_capacityGetter, SoAProto_byteLengthGetter, SoAProto_reserve, LayoutOf,
};

/**
 * The buffer element type a column's field is stored as, reusing the placement
 * module's mapping so an SoA column and a placed field encode identically —
 * which is what lets a byte view over either see the same thing.
 */
function columnElementType(t: TypeRecord) {
  return BufferElementType(t);
}

/**
 * `s[i]` — GATHER a `T` from the columns.
 *
 * soa.md: "particles[0]; // Gathers a Particle value from the columns". The
 * result is a VALUE, and a value type copies, so `s[0].x = 5` writes to that
 * copy and is lost. That is not a limitation of this implementation but the
 * ordinary rule for `[N].<T>` too, and it is why `ref` exists.
 */
export function* SoAGather(storage: SoAStorage, index: number): ValueEvaluator {
  const live = requireViewLive(storage);
  if (live) {
    return live;
  }
  if (index < 0 || index >= storage.Length || !Number.isInteger(index)) {
    return Value.undefined;
  }
  const element = storage.Element;
  // A PRIMITIVE element degenerates to a single column, and its "element" is
  // the column's value rather than an object with fields.
  if (element.Kind !== 'nominal') {
    const only = storage.Columns[0]!;
    const type = columnElementType(only.type);
    if (type === null) {
      return Throw.TypeError('a column of this type cannot be read');
    }
    const raw = GetValueFromBuffer(storage.Buffer, storage.ColumnOffsets[0]! + index * only.layout.byteLength, type, true, 'unordered');
    return raw instanceof NumberValue ? new TypedNumberValue(R(raw) as number, only.type) : raw;
  }
  const ctor = (element as { Constructor?: ObjectValue }).Constructor;
  if (!ctor) {
    return Throw.TypeError('this element type has no constructor');
  }
  const proto = Q(yield* Get(ctor, Value('prototype')));
  const instance = OrdinaryObjectCreate(proto instanceof ObjectValue ? proto : Value.null);
  const typed = new Map<unknown, { TypeRecord: TypeRecord }>();
  for (let i = 0; i < storage.Columns.length; i += 1) {
    const column = storage.Columns[i]!;
    const type = columnElementType(column.type);
    if (type === null) {
      return Throw.TypeError('a column of this type cannot be read');
    }
    const raw = GetValueFromBuffer(storage.Buffer, storage.ColumnOffsets[i]! + index * column.layout.byteLength, type, true, 'unordered');
    const value = raw instanceof NumberValue ? new TypedNumberValue(R(raw) as number, column.type) : raw;
    X(CreateDataProperty(instance, Value(column.key), value));
    typed.set(column.key, { TypeRecord: column.type });
  }
  // The gathered value carries its field types, so a store into it is checked
  // exactly as one into a constructed instance is - even though the write is
  // then lost, which is what makes the copy semantics visible rather than
  // silent.
  (instance as { TypedProperties?: Map<unknown, { TypeRecord: TypeRecord }> }).TypedProperties = typed;
  X(instance.PreventExtensions());
  return instance;
}

/**
 * `s[i] = v` — SCATTER the fields into the columns.
 *
 * soa.md: "particles[0] = spawned; // Scatters the fields into the columns".
 * Each field is checked against the column's declared type on the way, so the
 * store boundary of #table-check-sites applies per column.
 */
export function* SoAScatter(storage: SoAStorage, index: number, value: Value): PlainEvaluator<boolean> {
  const live = requireViewLive(storage);
  if (live) {
    return live;
  }
  if (index < 0 || index >= storage.Length || !Number.isInteger(index)) {
    return false;
  }
  const element = storage.Element;
  if (element.Kind !== 'nominal') {
    const only = storage.Columns[0]!;
    const type = columnElementType(only.type);
    if (type === null) {
      return Throw.TypeError('a column of this type cannot be written');
    }
    const converted = Q(yield* RequireType(value, only.type));
    const numeric = converted instanceof TypedNumberValue
      ? Value(Number((converted as unknown as { value: number }).value))
      : converted;
    Q(yield* SetValueInBuffer(storage.Buffer, storage.ColumnOffsets[0]!, type, numeric as NumberValue, true, 'unordered'));
    return true;
  }
  if (!(value instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an element of this type', value);
  }
  for (let i = 0; i < storage.Columns.length; i += 1) {
    const column = storage.Columns[i]!;
    const type = columnElementType(column.type);
    if (type === null) {
      return Throw.TypeError('a column of this type cannot be written');
    }
    const field = Q(yield* Get(value, Value(column.key)));
    const converted = Q(yield* RequireType(field, column.type));
    const numeric = converted instanceof TypedNumberValue
      ? Value(Number((converted as unknown as { value: number }).value))
      : converted;
    Q(yield* SetValueInBuffer(storage.Buffer, storage.ColumnOffsets[i]! + index * column.layout.byteLength, type, numeric as NumberValue, true, 'unordered'));
  }
  return true;
}

/**
 * `push(value)` — "Appends to every column."
 *
 * Growable only: a fixed extent has nothing to reallocate, and soa.md says
 * `push`, `pop`, and `reserve` "are already absent from an `SoA.<T, N>` as they
 * are from a `[N].<T>`".
 *
 * https://sirisian.github.io/ecmascript-types/#sec-structure-of-arrays
 */
function* SoAProto_push([value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const storage = requireStorage(thisValue);
  if (!storage) {
    return Throw.TypeError('$1 is not an SoA', thisValue);
  }
  if (storage.Extent !== 0) {
    return Throw.TypeError('a fixed-extent SoA cannot be grown');
  }
  if (storage.Length === storage.Capacity) {
    // Growth doubles, so a run of pushes does not recopy every column each time.
    Q(yield* growTo(storage, storage.Capacity === 0 ? 4 : storage.Capacity * 2));
  }
  storage.Length += 1;
  const ok = Q(yield* SoAScatter(storage, storage.Length - 1, value));
  if (!ok) {
    storage.Length -= 1;
    return Throw.TypeError('$1 could not be appended', value);
  }
  return Value(storage.Length);
}

/**
 * `pop()` — the last element, or *undefined* where there is none.
 *
 * https://sirisian.github.io/ecmascript-types/#sec-structure-of-arrays
 */
function* SoAProto_pop(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const storage = requireStorage(thisValue);
  if (!storage) {
    return Throw.TypeError('$1 is not an SoA', thisValue);
  }
  if (storage.Extent !== 0) {
    return Throw.TypeError('a fixed-extent SoA cannot be shortened');
  }
  if (storage.Length === 0) {
    return Value.undefined;
  }
  const last = Q(yield* SoAGather(storage, storage.Length - 1));
  storage.Length -= 1;
  return last;
}

/**
 * `fill(value)` — every element, returning the SoA.
 *
 * https://sirisian.github.io/ecmascript-types/#sec-structure-of-arrays
 */
function* SoAProto_fill([value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const storage = requireStorage(thisValue);
  if (!storage) {
    return Throw.TypeError('$1 is not an SoA', thisValue);
  }
  for (let i = 0; i < storage.Length; i += 1) {
    Q(yield* SoAScatter(storage, i, value));
  }
  return thisValue;
}

/**
 * `toArray()` — a `[].<T>` of the elements, COPIED.
 *
 * soa.md: "`SoA.<T>` and `[].<T>` are distinct types with distinct layouts, and
 * neither is assignable to the other. Conversion is explicit and copies."
 *
 * https://sirisian.github.io/ecmascript-types/#sec-structure-of-arrays
 */
function* SoAProto_toArray(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
  const storage = requireStorage(thisValue);
  if (!storage) {
    return Throw.TypeError('$1 is not an SoA', thisValue);
  }
  const out = X(ArrayCreate(0));
  for (let i = 0; i < storage.Length; i += 1) {
    const element = Q(yield* SoAGather(storage, i));
    X(CreateDataProperty(out, Value(String(i)), element));
  }
  X(CreateDataProperty(out, Value('length'), Value(storage.Length)));
  (out as { TypedElement?: TypeRecord }).TypedElement = storage.Element;
  return out;
}

/** Reallocate every column for a larger capacity, preserving the elements in use. */
function* growTo(storage: SoAStorage, capacity: number): PlainEvaluator<void> {
  const placement = ColumnLayoutFor(storage.Columns, capacity);
  const grown = Q(yield* AllocateArrayBuffer(surroundingAgent.intrinsic('%ArrayBuffer%'), placement.byteLength));
  // The Data Block IS the bytes; `new Uint8Array(block)` would COPY it, so the
  // writes below would land in a discarded array and every element already
  // stored would be lost on the first growth. Caught by a test that pushed past
  // the initial capacity and read element 0 back - a length check alone would
  // have passed.
  const from = (storage.Buffer as unknown as { ArrayBufferData: Uint8Array }).ArrayBufferData;
  const to = (grown as unknown as { ArrayBufferData: Uint8Array }).ArrayBufferData;
  for (let i = 0; i < storage.Columns.length; i += 1) {
    const used = storage.Columns[i]!.layout.byteLength * storage.Length;
    const oldOffset = storage.ColumnOffsets[i]!;
    to.set(from.subarray(oldOffset, oldOffset + used), placement.offsets[i]!);
  }
  storage.Buffer = grown as ArrayBufferObject;
  (storage as { ColumnOffsets: readonly number[] }).ColumnOffsets = placement.offsets;
  storage.Capacity = capacity;
  return undefined;
}

export {
  SoAProto_push, SoAProto_pop, SoAProto_fill, SoAProto_toArray,
};

/**
 * proposal-runtime-types soa.md: a `ref` into an SoA.
 *
 * "A `ref` binding is a reference to the element, which for an `SoA` is A
 * COLUMN SET AND AN INDEX. Field accesses through it compile to a load or store
 * on one column."
 *
 * This is NOT the proxy object soa.md forecloses. A proxy would trap every
 * field access and check it at the read; this is an object whose field reads
 * and writes are computed from the columns directly, which is the same
 * mechanism a placed instance's fields already use. In an engine the
 * indirection cannot literally be compiled out, but nothing about it is
 * dynamic: the column set and the offsets are fixed when the type is.
 *
 * It is also why `ref s[i]` and `s[i]` differ. The gather is a COPY, because a
 * value type copies; the reference names the storage. Both are correct and the
 * design relies on the difference.
 */
export interface SoAElementBacking {
  readonly Storage: SoAStorage;
  readonly Index: number;
  /** The capacity the columns had when this reference was taken. */
  readonly PinnedCapacity: number;
}

const elementBackings = new WeakMap<object, SoAElementBacking>();

export function SoAElementBackingOf(instance: object): SoAElementBacking | undefined {
  return elementBackings.get(instance);
}

/**
 * "A reference into an `SoA` pins the container as well as the element: a
 * `push` that reallocates moves every column, so growing an `SoA` while a
 * reference into it is live is a TypeError, exactly as changing an array's
 * length during `ref` iteration is."
 */
function requireUnmoved(backing: SoAElementBacking) {
  if (backing.Storage.Capacity !== backing.PinnedCapacity) {
    return Throw.TypeError('this reference is into an SoA that has since grown');
  }
  return requireViewLive(backing.Storage);
}

/**
 * A VIEWED SoA follows the fixed array view's detachment: "shrinking a resizable
 * buffer below the view's extent detaches it and any access afterward is a
 * TypeError, while growth never invalidates it. A view over a
 * `SharedArrayBuffer` can never detach, since shared buffers never shrink."
 *
 * An ALLOCATED SoA owns its buffer and has nothing to detach from, which is why
 * this tests the view fields rather than every SoA.
 */
export function requireViewLive(storage: SoAStorage) {
  if (storage.ViewByteLength === undefined) {
    return undefined;
  }
  const bytes = (storage.Buffer as unknown as { ArrayBufferData?: { byteLength: number } }).ArrayBufferData?.byteLength ?? 0;
  if ((storage.ViewByteOffset ?? 0) + storage.ViewByteLength > bytes) {
    return Throw.TypeError('this SoA view is over a buffer that no longer covers it');
  }
  return undefined;
}

/** The object a `ref` into an SoA borrows: the column set and the index. */
export function* SoAElementReference(storage: SoAStorage, index: number): ValueEvaluator {
  if (index < 0 || index >= storage.Length || !Number.isInteger(index)) {
    return Throw.TypeError('$1 is not an element of this SoA', Value(String(index)));
  }
  const element = storage.Element;
  const ctor = element.Kind === 'nominal' ? (element as { Constructor?: ObjectValue }).Constructor : undefined;
  const proto = ctor ? Q(yield* Get(ctor, Value('prototype'))) : Value.null;
  const view = OrdinaryObjectCreate(proto instanceof ObjectValue ? proto : Value.null);
  elementBackings.set(view as unknown as object, { Storage: storage, Index: index, PinnedCapacity: storage.Capacity });
  const typed = new Map<unknown, { TypeRecord: TypeRecord }>();
  for (const column of storage.Columns) {
    typed.set(column.key, { TypeRecord: column.type });
  }
  (view as { TypedProperties?: Map<unknown, { TypeRecord: TypeRecord }> }).TypedProperties = typed;
  X(view.PreventExtensions());
  return view;
}

/** A field read through a reference: one indexed load from that field's column. */
export function* ReadSoAField(backing: SoAElementBacking, key: string): ValueEvaluator {
  const moved = requireUnmoved(backing);
  if (moved) {
    return moved;
  }
  const { Storage: storage } = backing;
  const i = storage.Columns.findIndex((c) => c.key === key);
  if (i < 0) {
    return Value.undefined;
  }
  const column = storage.Columns[i]!;
  const type = BufferElementType(column.type);
  if (type === null) {
    return Throw.TypeError('a column of this type cannot be read');
  }
  const raw = GetValueFromBuffer(storage.Buffer, storage.ColumnOffsets[i]! + backing.Index * column.layout.byteLength, type, true, 'unordered');
  return raw instanceof NumberValue ? new TypedNumberValue(R(raw) as number, column.type) : raw;
}

/** A field write through a reference: one indexed store into that field's column. */
export function* WriteSoAField(backing: SoAElementBacking, key: string, value: Value): PlainEvaluator<boolean> {
  const moved = requireUnmoved(backing);
  if (moved) {
    return moved;
  }
  const { Storage: storage } = backing;
  const i = storage.Columns.findIndex((c) => c.key === key);
  if (i < 0) {
    return false;
  }
  const column = storage.Columns[i]!;
  const type = BufferElementType(column.type);
  if (type === null) {
    return Throw.TypeError('a column of this type cannot be written');
  }
  const converted = Q(yield* RequireType(value, column.type));
  const numeric = converted instanceof TypedNumberValue
    ? Value(Number((converted as unknown as { value: number }).value))
    : converted;
  Q(yield* SetValueInBuffer(storage.Buffer, storage.ColumnOffsets[i]! + backing.Index * column.layout.byteLength, type, numeric as NumberValue, true, 'unordered'));
  return true;
}

/**
 * proposal-runtime-types soa.md, "Views": `SoA.<T, Length>(buffer, byteOffset)`
 * lays an SoA over memory that already exists.
 *
 * "The form is the array view's. It is A CALL ON THE TYPE rather than a `new`,
 * because nothing is constructed, and the buffer argument accepts what
 * `[].<T>`'s does ... so an `SoA` view and a `[].<uint8>` over the same bytes
 * alias the same memory."
 *
 * ONLY THE FIXED FORM IS VIEWABLE, "and the reason is the layout rather than
 * caution. A `[].<T>` view can track a resizable buffer because growth appends
 * past the end. An `SoA`'s capacity is baked into every column's offset, so
 * growth moves every column after the first, and a length-tracking `SoA` view
 * would be describing a layout that is no longer there."
 *
 * "A viewed `SoA` is the same object an allocated one is. Both are a base and
 * the column offsets the layout rule computes from it" - so this produces the
 * same storage record, differing only in where the base came from and in that
 * the buffer is not its own.
 */
export function* CreateSoAView(element: TypeRecord, extent: number, args: readonly Value[]): ValueEvaluator {
  if (extent === 0) {
    return Throw.TypeError('only a fixed-extent SoA can view a buffer');
  }
  const columns = SoAColumnsOf(element);
  if (columns === null) {
    return Throw.TypeError('this element type cannot be stored as columns');
  }
  const source = args[0];
  let buffer: ArrayBufferObject | undefined;
  let baseOffset = 0;
  if (source instanceof ObjectValue && 'ArrayBufferData' in source) {
    buffer = source as unknown as ArrayBufferObject;
  } else if (source instanceof ObjectValue) {
    const inner = ArrayViewBackingOf(source as unknown as object);
    if (inner) {
      buffer = inner.Buffer;
      baseOffset = inner.ByteOffset;
    } else {
      const viewed = source as unknown as { ViewedArrayBuffer?: ArrayBufferObject, ByteOffset?: number };
      if (viewed.ViewedArrayBuffer) {
        buffer = viewed.ViewedArrayBuffer;
        baseOffset = viewed.ByteOffset ?? 0;
      }
    }
  }
  if (!buffer) {
    return Throw.TypeError('an SoA view needs an ArrayBuffer, a SharedArrayBuffer, or a typed array');
  }
  // Hoisted out of a ternary: the Q macro may not appear inside a conditional
  // expression, which the bundler enforces and tsc does not - so a build that
  // reports no type errors can still have failed.
  let requested = 0;
  if (args.length > 1) {
    requested = Number(Q(yield* ToIndex(args[1]!)));
  }
  const byteOffset = baseOffset + requested;
  const placement = ColumnLayoutFor(columns, extent);
  // "byteOffset must be a multiple of SoA.<T, Length>.alignment, or it's a
  // TypeError. Columns are placed relative to the base, so a misaligned base
  // misaligns every column and there would be nothing left of the aligned-lane-
  // load guarantee."
  if (placement.alignment > 0 && byteOffset % placement.alignment !== 0) {
    return Throw.TypeError('an SoA view needs a byte offset that is a multiple of its alignment');
  }
  // "The buffer must hold SoA.<T, Length>.byteLength bytes past byteOffset, or
  // it's a TypeError. Both are compile-time constants, so the check costs
  // nothing at run time."
  const available = ((buffer as unknown as { ArrayBufferData?: { byteLength: number } }).ArrayBufferData?.byteLength ?? 0) - byteOffset;
  if (available < placement.byteLength) {
    return Throw.TypeError('the buffer does not hold this SoA view');
  }
  const instance = OrdinaryObjectCreate(surroundingAgent.currentRealmRecord.Intrinsics['%SoA.prototype%']);
  SetSoAStorage(instance, {
    Element: element,
    Extent: extent,
    Columns: columns,
    ColumnOffsets: placement.offsets.map((o) => o + byteOffset),
    Buffer: buffer,
    Length: extent,
    Capacity: extent,
    ViewByteOffset: byteOffset,
    ViewByteLength: placement.byteLength,
  });
  return instance;
}

/**
 * `SoA.from(values)` — soa.md's conversion from an array.
 *
 * "SoA.<T> and [].<T> are distinct types with distinct layouts, and neither is
 * assignable to the other. CONVERSION IS EXPLICIT AND COPIES." The element type
 * comes from the array's own, so the caller does not restate it — and an
 * untyped array has none, which is refused rather than guessed at.
 *
 * https://sirisian.github.io/ecmascript-types/#sec-structure-of-arrays
 */
function* SoA_from([values = Value.undefined]: Arguments): ValueEvaluator {
  if (!(values instanceof ObjectValue)) {
    return Throw.TypeError('$1 is not an array', values);
  }
  const element = (values as { TypedElement?: TypeRecord }).TypedElement;
  if (element === undefined) {
    return Throw.TypeError('SoA.from needs an array with a declared element type');
  }
  const columns = SoAColumnsOf(element);
  if (columns === null) {
    return Throw.TypeError('this element type cannot be stored as columns');
  }
  const lengthValue = Q(yield* Get(values, Value('length')));
  const length = Number(Q(yield* ToIndex(lengthValue)));
  const placement = ColumnLayoutFor(columns, length);
  const buffer = Q(yield* AllocateArrayBuffer(surroundingAgent.intrinsic('%ArrayBuffer%'), placement.byteLength));
  const instance = OrdinaryObjectCreate(surroundingAgent.currentRealmRecord.Intrinsics['%SoA.prototype%']);
  const storage: SoAStorage = {
    Element: element,
    // A growable SoA, as the design's signature says: `static from<T>(values:
    // [].<T>): SoA.<T>`.
    Extent: 0,
    Columns: columns,
    ColumnOffsets: placement.offsets,
    Buffer: buffer as ArrayBufferObject,
    Length: length,
    Capacity: length,
  };
  SetSoAStorage(instance, storage);
  for (let i = 0; i < length; i += 1) {
    const value = Q(yield* Get(values, Value(String(i))));
    Q(yield* SoAScatter(storage, i, value));
  }
  return instance;
}

/**
 * `SoA.withCapacity.<T>(n)` — "Empty, capacity >= n".
 *
 * The element type is a TYPE argument here rather than inferred, because there
 * is no value to infer it from; the call is intercepted where the type
 * arguments are in scope.
 *
 * https://sirisian.github.io/ecmascript-types/#sec-structure-of-arrays
 */
export function* SoAWithCapacity(element: TypeRecord, n: number): ValueEvaluator {
  const columns = SoAColumnsOf(element);
  if (columns === null) {
    return Throw.TypeError('this element type cannot be stored as columns');
  }
  const placement = ColumnLayoutFor(columns, n);
  const buffer = Q(yield* AllocateArrayBuffer(surroundingAgent.intrinsic('%ArrayBuffer%'), placement.byteLength));
  const instance = OrdinaryObjectCreate(surroundingAgent.currentRealmRecord.Intrinsics['%SoA.prototype%']);
  SetSoAStorage(instance, {
    Element: element,
    Extent: 0,
    Columns: columns,
    ColumnOffsets: placement.offsets,
    Buffer: buffer as ArrayBufferObject,
    Length: 0,
    Capacity: n,
  });
  return instance;
}

export { SoA_from };
