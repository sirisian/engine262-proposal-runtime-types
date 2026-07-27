import { Q, X } from '../completion.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import {
  NumberValue, ObjectValue, TypedNumberValue, Value,
} from '../value.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { LayoutOf } from '../type-system/layout.mts';
import { BufferElementType } from './placement.mts';
import type { ArrayBufferObject } from './arraybuffer-objects.mts';
import {
  GetValueFromBuffer, SetValueInBuffer, IsDetachedBuffer, OrdinaryObjectCreate, R, RequireType,
  Throw, ToIndex, surroundingAgent,
} from '#self';

/**
 * proposal-runtime-types (README, "Views"): `[].<T>(buffer, byteOffset,
 * byteElementLength)` is a VIEW over bytes that already exist, as distinct from
 * an allocation. It is a call on the type rather than a `new`, because nothing
 * is constructed.
 *
 * "The `buffer` argument accepts any typed array as well as existing
 * `TypedArray`, `ArrayBuffer`, and `SharedArrayBuffer` instances, so a
 * `[].<uint8>` and a `Uint8Array` viewing the same buffer alias the same
 * memory."
 *
 * `byteElementLength` defaults to the element type's size and MAY DIFFER FROM
 * IT - the design's own example reads `uint16`s at a 3-byte stride out of an
 * array of a 3-byte class. So the stride is carried rather than derived, and a
 * view's element addressing is offset plus index times stride.
 */
export interface ArrayViewBacking {
  readonly Element: TypeRecord;
  readonly Buffer: ArrayBufferObject;
  readonly ByteOffset: number;
  readonly Stride: number;
  /** The declared extent, or ~dynamic~ for a length-tracking view. */
  readonly Extent: number | 'dynamic';
  /** For a fixed view, the byte extent recorded at construction. */
  readonly ByteExtent: number;
  /**
   * For a projection of an SoA column: the container and the generation its
   * allocation had when the projection was taken. A growth that reallocates
   * bumps the generation, and the projection then describes memory the
   * container no longer uses - so it is refused rather than read.
   */
  readonly SourceGeneration?: { readonly Generation: number };
  readonly TakenAtGeneration?: number;
}

const views = new WeakMap<object, ArrayViewBacking>();

export function ArrayViewBackingOf(instance: object): ArrayViewBacking | undefined {
  return views.get(instance);
}

function bufferByteLength(buffer: ArrayBufferObject): number {
  return (buffer as unknown as { ArrayBufferData?: { byteLength: number } }).ArrayBufferData?.byteLength ?? 0;
}

/**
 * "A `[].<T>` view is LENGTH-TRACKING: its `length` derives from the buffer's
 * current byte length, growing and shrinking as the buffer is resized. A fixed
 * `[N].<T>` view has a fixed byte extent recorded at construction; if the buffer
 * shrinks below that extent the view is DETACHED and any access throws a
 * TypeError. Growth never invalidates a view."
 */
export function ArrayViewLength(backing: ArrayViewBacking): number {
  if (backing.Extent !== 'dynamic') {
    return backing.Extent;
  }
  const available = bufferByteLength(backing.Buffer) - backing.ByteOffset;
  return available <= 0 ? 0 : Math.floor(available / backing.Stride);
}

function requireLive(backing: ArrayViewBacking) {
  if (IsDetachedBuffer(backing.Buffer)) {
    return Throw.TypeError('this view is over a detached buffer');
  }
  // A projection of an SoA column is invalidated by a growth that reallocates,
  // exactly as a `ref` into the same SoA is. Without this the projection kept
  // reading the OLD allocation and disagreed with the container silently, which
  // is the one outcome none of the alternatives chose.
  //
  // The comparison is loop-invariant: the generation cannot change without a
  // call, and a loop containing no call cannot change it, so it hoists rather
  // than costing anything per element. A FIXED SoA can never be invalidated at
  // all, which is the case the feature's performance argument cares about.
  if (backing.SourceGeneration !== undefined
      && backing.SourceGeneration.Generation !== backing.TakenAtGeneration) {
    return Throw.TypeError('this column projection is into an SoA that has since grown');
  }
  if (backing.Extent !== 'dynamic'
      && backing.ByteOffset + backing.ByteExtent > bufferByteLength(backing.Buffer)) {
    // A fixed view detaches when the buffer shrinks below its extent; a
    // length-tracking one simply reports a shorter length, which is why only
    // this branch tests the extent.
    return Throw.TypeError('this view is over a buffer that no longer covers it');
  }
  return undefined;
}

/** An element read: decode at the view's offset plus index times stride. */
export function* ReadArrayViewElement(backing: ArrayViewBacking, index: number): ValueEvaluator {
  const live = requireLive(backing);
  if (live) {
    return live;
  }
  if (index < 0 || index >= ArrayViewLength(backing) || !Number.isInteger(index)) {
    return Value.undefined;
  }
  const type = BufferElementType(backing.Element);
  if (type === null) {
    return Throw.TypeError('an element of this type cannot be viewed in a buffer');
  }
  const raw = GetValueFromBuffer(backing.Buffer, backing.ByteOffset + index * backing.Stride, type, true, 'unordered');
  return raw instanceof NumberValue ? new TypedNumberValue(R(raw) as number, backing.Element) : raw;
}

/** An element write: the store check first, then encode at the same position. */
export function* WriteArrayViewElement(backing: ArrayViewBacking, index: number, value: Value): PlainEvaluator<boolean> {
  const live = requireLive(backing);
  if (live) {
    return live;
  }
  if (index < 0 || index >= ArrayViewLength(backing) || !Number.isInteger(index)) {
    return false;
  }
  const type = BufferElementType(backing.Element);
  if (type === null) {
    return Throw.TypeError('an element of this type cannot be viewed in a buffer');
  }
  const converted = Q(yield* RequireType(value, backing.Element));
  const numeric = converted instanceof TypedNumberValue
    ? Value(Number((converted as unknown as { value: number }).value))
    : converted;
  Q(yield* SetValueInBuffer(backing.Buffer, backing.ByteOffset + index * backing.Stride, type, numeric as NumberValue, true, 'unordered'));
  return true;
}

/**
 * Construct `[].<T>(buffer, byteOffset, byteElementLength)`.
 *
 * The buffer argument accepts an ArrayBuffer, a SharedArrayBuffer, or any typed
 * array - including one of this proposal's own views - so that two views over
 * the same bytes alias, which the design says is the point of reinterpreting a
 * buffer.
 */
export function* CreateArrayView(element: TypeRecord, extent: number | 'dynamic', args: readonly Value[]): ValueEvaluator {
  const layout = LayoutOf(element);
  if (!layout) {
    return Throw.TypeError('a view needs an element type with a layout');
  }
  const source = args[0];
  let buffer: ArrayBufferObject | undefined;
  let baseOffset = 0;
  if (source instanceof ObjectValue && 'ArrayBufferData' in source) {
    buffer = source as unknown as ArrayBufferObject;
  } else if (source instanceof ObjectValue) {
    // A typed array, or one of this proposal's views, viewed at its own base.
    const inner = ArrayViewBackingOf(source as unknown as object);
    if (inner) {
      buffer = inner.Buffer;
      baseOffset = inner.ByteOffset;
    } else {
      const viewed = (source as unknown as { ViewedArrayBuffer?: ArrayBufferObject, ByteOffset?: number });
      if (viewed.ViewedArrayBuffer) {
        buffer = viewed.ViewedArrayBuffer;
        baseOffset = viewed.ByteOffset ?? 0;
      }
    }
  }
  if (!buffer) {
    return Throw.TypeError('a view needs an ArrayBuffer, a SharedArrayBuffer, or a typed array');
  }
  const byteOffset = args.length > 1 ? Number(Q(yield* ToIndex(args[1]!))) : 0;
  const stride = args.length > 2 ? Number(Q(yield* ToIndex(args[2]!))) : layout.byteLength;
  if (stride === 0) {
    return Throw.TypeError('a view element cannot have a zero byte length');
  }
  const offset = baseOffset + byteOffset;
  const byteExtent = extent === 'dynamic' ? 0 : extent * stride;
  if (extent !== 'dynamic' && offset + byteExtent > bufferByteLength(buffer)) {
    return Throw.RangeError('the view extent exceeds the buffer');
  }
  const view = OrdinaryObjectCreate(surroundingAgent.currentRealmRecord.Intrinsics['%Object.prototype%']);
  views.set(view as unknown as object, {
    Element: element, Buffer: buffer, ByteOffset: offset, Stride: stride, Extent: extent, ByteExtent: byteExtent,
  });
  X(view.PreventExtensions());
  return view;
}

/**
 * A view built directly over a known extent of a buffer, rather than from user
 * arguments. This is what an SoA's `fields` projection returns: the column is
 * already a contiguous run at a known offset and stride, so there is nothing to
 * parse and nothing to check.
 */
export function MakeArrayView(element: TypeRecord, buffer: ArrayBufferObject, byteOffset: number, stride: number, extent: number | 'dynamic', source?: { readonly Generation: number }): ObjectValue {
  const view = OrdinaryObjectCreate(surroundingAgent.currentRealmRecord.Intrinsics['%Object.prototype%']);
  views.set(view as unknown as object, {
    Element: element,
    Buffer: buffer,
    ByteOffset: byteOffset,
    Stride: stride,
    Extent: extent,
    ByteExtent: extent === 'dynamic' ? 0 : extent * stride,
    SourceGeneration: source,
    TakenAtGeneration: source?.Generation,
  });
  X(view.PreventExtensions());
  return view;
}
