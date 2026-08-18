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
  Throw, ToIndex, surroundingAgent, Get, Set as SetValueOnObject,
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
    // #sec-array-views: a FIXED view whose bytes have ceased to exist reports a
    // length of +0F, as a `%TypedArray%` in the same position does. It reported
    // its ORIGINAL extent, so a view over a buffer that had shrunk beneath it
    // described a run of elements none of which could be read - every access
    // already refused, and only the count disagreed.
    if (backing.ByteOffset + backing.ByteExtent > bufferByteLength(backing.Buffer)) {
      return 0;
    }
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
  // #sec-span-type: an out-of-range read RAISES rather than answering
  // *undefined*. A window over a buffer is bounds-checked exactly as one over
  // an owned array is, and as an owned array is - only a PLAIN array keeps
  // JavaScript's `undefined`, which #sec-array-and-tuple-types pins.
  //
  // This answered *undefined* while the array-backed window raised, so the one
  // type stood for two different behaviours at the same operation, which is the
  // divergence the window was introduced to end.
  if (index < 0 || index >= ArrayViewLength(backing) || !Number.isInteger(index)) {
    return Throw.RangeError('$1 is out of range', Value(String(index)));
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
  // As with the read: an out-of-range write raises rather than silently doing
  // nothing. Answering *false* here made a store vanish without a word.
  if (index < 0 || index >= ArrayViewLength(backing) || !Number.isInteger(index)) {
    return Throw.RangeError('$1 is out of range', Value(String(index)));
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
  // proposal-runtime-types #sec-array-views: the third argument is the COUNT
  // and the fourth is the stride.
  //
  // Every other view constructor in the language takes `(buffer, byteOffset,
  // count)` and makes the fixed/length-tracking distinction by whether that
  // third argument is there - `new Uint8Array(b, 0)` tracks and
  // `new Uint8Array(b, 0, 8)` does not. Taking a STRIDE in that position made a
  // familiar-looking call mean something else: `Span.<uint8>(b, 0, 4)` was a
  // view of 2 elements where `new Uint8Array(b, 0, 4)` is a view of 4, and
  // neither reported anything. The stride is last because nothing else in the
  // language has one - `%TypedArray%` cannot address interleaved data at all -
  // so the rare capability takes the rare position.
  const stride = args.length > 3 ? Number(Q(yield* ToIndex(args[3]!))) : layout.byteLength;
  const givenCount = args.length > 2 && args[2] !== Value.undefined
    ? Number(Q(yield* ToIndex(args[2]!)))
    : undefined;
  // A count given fixes the extent; a count omitted leaves it tracking. An
  // extent from the type still wins, since `[N].<T>(buffer)` states it there.
  const resolvedExtent = extent !== 'dynamic' ? extent : (givenCount ?? 'dynamic');
  if (stride === 0) {
    return Throw.TypeError('a view element cannot have a zero byte length');
  }
  const offset = baseOffset + byteOffset;
  const byteExtent = resolvedExtent === 'dynamic' ? 0 : resolvedExtent * stride;
  if (resolvedExtent !== 'dynamic' && offset + byteExtent > bufferByteLength(buffer)) {
    return Throw.RangeError('the view extent exceeds the buffer');
  }
  const view = OrdinaryObjectCreate(surroundingAgent.currentRealmRecord.Intrinsics['%Span.prototype%']);
  views.set(view as unknown as object, {
    Element: element, Buffer: buffer, ByteOffset: offset, Stride: stride, Extent: resolvedExtent, ByteExtent: byteExtent,
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
  const view = OrdinaryObjectCreate(surroundingAgent.currentRealmRecord.Intrinsics['%Span.prototype%']);
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

/**
 * proposal-runtime-types #sec-span-type: a window over an OWNED array, as
 * distinct from one over a buffer's bytes.
 *
 * A view knows a buffer, an offset, and a stride; there is nothing to decode
 * here, because the storage is the array's own indexed elements. What the two
 * share is the thing that matters — the liveness rule — so the generation is
 * recorded the same way an `SoA` column projection records it, and the check
 * below is the same comparison `requireLive` makes.
 */
export interface ArraySpanBacking {
  readonly Element: TypeRecord;
  /** The array being windowed. Its elements ARE the window's storage. */
  readonly Source: ObjectValue;
  /** Fixed at coercion: a window's length does not change (#sec-span-type). */
  readonly Length: number;
  /**
   * [[TypedGeneration]] when the window was taken. A growth that reallocates
   * bumps it, and the window then describes storage the array no longer uses,
   * so it is refused rather than read — the rule a `ref` into the same array
   * already obeys.
   */
  readonly TakenAtGeneration: number;
}

const arraySpans = new WeakMap<object, ArraySpanBacking>();

export function ArraySpanBackingOf(instance: object): ArraySpanBacking | undefined {
  return arraySpans.get(instance);
}

/** The generation an array is at, which is 0 until something has relocated it. */
function generationOf(source: ObjectValue): number {
  return (source as unknown as { TypedGeneration?: number }).TypedGeneration ?? 0;
}

/**
 * #sec-span-coercion: a coercion MATERIALIZES. The window is a value distinct
 * from the array coerced, and two coercions of one array need not be the same
 * value — which is why this constructs rather than tagging the array.
 */
export function MakeArraySpan(element: TypeRecord, source: ObjectValue, length: number): ObjectValue {
  const span = OrdinaryObjectCreate(surroundingAgent.currentRealmRecord.Intrinsics['%Span.prototype%']);
  arraySpans.set(span as unknown as object, {
    Element: element,
    Source: source,
    Length: length,
    TakenAtGeneration: generationOf(source),
  });
  X(span.PreventExtensions());
  return span;
}

/**
 * #sec-span-liveness. A window over a growable array is invalidated when that
 * array's allocation relocates. An operation that does NOT relocate does not
 * invalidate: a `reserve` for room the array already has, and a `shrinkToFit`
 * on an array already at fit, leave every window over it valid — which is why
 * this compares generations rather than asking whether anything was called.
 */
function requireSpanLive(backing: ArraySpanBacking) {
  if (generationOf(backing.Source) !== backing.TakenAtGeneration) {
    return Throw.TypeError('this window is into an array that has since grown');
  }
  return undefined;
}

/** An element read through a window: the array's own element, liveness first. */
export function* ReadArraySpanElement(backing: ArraySpanBacking, index: number): ValueEvaluator {
  const live = requireSpanLive(backing);
  if (live) {
    return live;
  }
  if (!Number.isInteger(index) || index < 0 || index >= backing.Length) {
    return Throw.RangeError('$1 is out of range', Value(String(index)));
  }
  return Q(yield* Get(backing.Source, Value(String(index))));
}

/**
 * An element write through a window. The store is checked against the ARRAY's
 * element type by the array's own store path, so nothing is re-checked here:
 * a window does not get to choose the type of storage it does not own.
 */
export function* WriteArraySpanElement(backing: ArraySpanBacking, index: number, value: Value): PlainEvaluator<boolean> {
  const live = requireSpanLive(backing);
  if (live) {
    return live;
  }
  if (!Number.isInteger(index) || index < 0 || index >= backing.Length) {
    return Throw.RangeError('$1 is out of range', Value(String(index)));
  }
  Q(yield* SetValueOnObject(backing.Source, Value(String(index)), value, Value.true));
  return true;
}

/** A window's length is fixed at coercion and does not follow the array. */
export function ArraySpanLength(backing: ArraySpanBacking): number {
  return backing.Length;
}

/**
 * The length of a value that presents a run of elements without owning
 * properties for them — a `Span.<T>` over an array, or a view over a buffer —
 * or ~undefined~ for anything else.
 *
 * Both kinds answer their elements from a backing rather than from stored
 * properties, so the object model cannot see those elements unless it is told.
 * This is what tells it, and it exists once rather than twice because the two
 * differ in where the bytes are and in nothing else that the object model
 * cares about.
 */
export function SpanLikeLengthOf(instance: object): number | undefined {
  const span = arraySpans.get(instance);
  if (span !== undefined) {
    return span.Length;
  }
  const view = views.get(instance);
  if (view !== undefined) {
    return ArrayViewLength(view);
  }
  return undefined;
}

/**
 * proposal-runtime-types #sec-array-and-tuple-types: give an array its element
 * type AND the prototype that carries the capacity operations.
 *
 * The two go together. Seven places stamp `[[TypedElement]]`, and a place that
 * set the slot without setting the prototype would produce an array that is
 * typed for every purpose except the three members that describe its
 * allocation — a difference invisible until someone called `capacity` on it.
 * Routing them through one helper is what stops that drifting apart again.
 */
export function StampTypedArray(array: ObjectValue, element: TypeRecord): void {
  (array as unknown as { TypedElement?: TypeRecord }).TypedElement = element;
  const intrinsics = surroundingAgent.currentRealmRecord.Intrinsics;
  const proto = intrinsics['%TypedArrayLike.prototype%'];
  const shaped = array as unknown as { Prototype?: ObjectValue };
  // Only where the array still has the ORDINARY array prototype. A class
  // deriving from an array type has its own, and replacing that would break
  // the derivation the clause allows.
  if (proto !== undefined && shaped.Prototype === intrinsics['%Array.prototype%']) {
    shaped.Prototype = proto;
  }
}

/**
 * proposal-runtime-types #sec-array-views: the buffer a window is over, its
 * byte offset into it, and its byte length.
 *
 * These are what make the `%TypedArray%` bridge two-directional. Without them
 * `Span.<T>(u.buffer)` went in and nothing came back, because a window could
 * not say what buffer it was over - and it failed silently rather than loudly:
 * `new Uint8Array(v.buffer)` CONSTRUCTED, because `undefined` reads as a length,
 * so a program got an empty array instead of an error.
 *
 * The values are derived rather than stored: an ArrayViewBacking already holds
 * Buffer, ByteOffset, Stride, and Extent.
 *
 * A window over an OWNED array has no buffer. #sec-array-and-tuple-types says a
 * typed array IS a contiguous buffer, so this is an implementation limit rather
 * than a rule of the language, and it is reported as one - the same distinction
 * the index-type range draws between what the language forbids and what this
 * engine cannot reach.
 */
export function ArrayViewBufferOf(instance: object): ArrayBufferObject | undefined {
  return views.get(instance)?.Buffer;
}

export function ArrayViewByteOffsetOf(instance: object): number | undefined {
  return views.get(instance)?.ByteOffset;
}

export function ArrayViewByteLengthOf(instance: object): number | undefined {
  const backing = views.get(instance);
  return backing === undefined ? undefined : ArrayViewLength(backing) * backing.Stride;
}

/** Whether this value is a window with no buffer beneath it in this engine. */
export function IsBufferlessWindow(instance: object): boolean {
  return arraySpans.get(instance) !== undefined;
}
