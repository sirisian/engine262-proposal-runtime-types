import { Q, X } from '../completion.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import {
  NumberValue, TypedNumberValue, Value, type ObjectValue,
} from '../value.mts';
import type { TypeRecord } from '../type-system/records.mts';
import type { ClassLayout, FieldPlacement } from '../type-system/layout.mts';
import type { TypedArrayTypes } from '../intrinsics/TypedArray.mts';
import type { ArrayBufferObject } from './arraybuffer-objects.mts';
import {
  GetValueFromBuffer, SetValueInBuffer, IsDetachedBuffer, Throw, surroundingAgent, ToIndex,
} from '#self';

/**
 * proposal-runtime-types, the placement forms of
 * #sec-type-arguments-and-placement-new-in-expression-position: "The placement
 * forms allocate into an existing buffer rather than into fresh storage...
 * Construction stores each field of each instance at its laid-out position."
 *
 * This is the first thing in the engine that puts real BYTES under an instance.
 * Every typed class before it stored its fields as ordinary properties, which
 * is why the layout could be computed for four stages without anything reading
 * it. A placement instance is the other case: its fields ARE the buffer's
 * bytes, so a read is a decode at an offset and a write is an encode there.
 */
export interface PlacementBacking {
  readonly Buffer: ArrayBufferObject;
  readonly ByteOffset: number;
  /** The reserved extent, which is what a shrinking resizable buffer is measured against. */
  readonly ByteLength: number;
  readonly Layout: ClassLayout;
}

const placements = new WeakMap<object, PlacementBacking>();

/**
 * The placement a construction now under way is to be bound to.
 *
 * C++'s placement `new`, which this form is named after, constructs the object
 * DIRECTLY IN the supplied storage: there is no intermediate object and no
 * copy, and `this` points into the buffer for the whole of the constructor.
 * The clause says the same - "Construction stores each field of each instance
 * at its laid-out position" - and the first implementation instead constructed
 * into fresh storage and moved the fields afterwards, which left every field's
 * constructor-written property behind as a stale copy that could not be deleted
 * (#sec-typed-storage makes deleting a typed field a *TypeError*).
 *
 * Marking the instance between its creation and the initialization of its
 * fields removes the intermediate state rather than cleaning up after it: no
 * property is ever created, so there is nothing to delete and the typed-storage
 * rule never comes into it. A constructor that reads back a field it has just
 * written now reads the buffer too, which is what a placed instance should do
 * for the whole of its life rather than from the end of construction onwards.
 *
 * One-shot, and consumed by the first instance created after it is set, which
 * is the same shape NewTarget is threaded through construction with.
 */
let pendingPlacement: PlacementBacking | undefined;

export function SetPendingPlacement(backing: PlacementBacking | undefined): void {
  pendingPlacement = backing;
}

/** Consume the pending placement, if the object being created is to take it. */
export function TakePendingPlacement(instance: object): void {
  if (pendingPlacement !== undefined) {
    placements.set(instance, pendingPlacement);
    pendingPlacement = undefined;
  }
}

export function SetPlacementBacking(instance: object, backing: PlacementBacking): void {
  placements.set(instance, backing);
}

export function PlacementBackingOf(instance: object): PlacementBacking | undefined {
  return placements.get(instance);
}

/**
 * The buffer element type a field's declared type is stored as. A field whose
 * type has no such encoding - an object, a string, a nested class - is not
 * storable in a buffer and is reported rather than silently kept as a property,
 * since a placement instance whose fields were half in the buffer and half
 * beside it would satisfy nobody.
 */
export function BufferElementType(t: TypeRecord): TypedArrayTypes | null {
  if (t.Kind !== 'primitive') {
    return null;
  }
  const width = typeof t.Arguments[0] === 'number' ? t.Arguments[0] as number : undefined;
  switch (t.Name) {
    case 'uint':
      if (width === 8) {
 return 'Uint8'; 
}
      if (width === 16) {
 return 'Uint16'; 
}
      if (width === 32) {
 return 'Uint32'; 
}
      if (width === 64) {
 return 'BigUint64'; 
}
      return null;
    case 'int':
      if (width === 8) {
 return 'Int8'; 
}
      if (width === 16) {
 return 'Int16'; 
}
      if (width === 32) {
 return 'Int32'; 
}
      if (width === 64) {
 return 'BigInt64'; 
}
      return null;
    case 'float16': return 'Float16';
    case 'float32': return 'Float32';
    case 'float64': case 'number': return 'Float64';
    case 'boolean': return 'Uint8';
    default: return null;
  }
}

/**
 * "Touching a detached instance throws a *TypeError* exception." A placement
 * over a RESIZABLE buffer records its extent, and the buffer shrinking below it
 * detaches the instance - so detachment is not only the ArrayBuffer's own
 * detach but any shrink that takes the bytes away.
 */
function requireLive(backing: PlacementBacking): undefined | ReturnType<typeof Throw.TypeError> {
  if (IsDetachedBuffer(backing.Buffer)) {
    return Throw.TypeError('this instance is placed on a detached buffer');
  }
  const bytes = (backing.Buffer as { ArrayBufferData?: { byteLength: number } }).ArrayBufferData?.byteLength ?? 0;
  if (backing.ByteOffset + backing.ByteLength > bytes) {
    return Throw.TypeError('this instance is placed on a buffer that no longer covers it');
  }
  return undefined;
}

function placementOf(backing: PlacementBacking, key: string): FieldPlacement | undefined {
  return backing.Layout.fields.find((f) => f.key === key);
}

/** A field read: decode the bytes at the field's laid-out position. */
export function* ReadPlacedField(backing: PlacementBacking, key: string, fieldType: TypeRecord): ValueEvaluator {
  const live = requireLive(backing);
  if (live) {
    return live;
  }
  const placement = placementOf(backing, key);
  if (!placement) {
    return Value.undefined;
  }
  if (placement.isBitField) {
    // "Reading or writing a bit-field is a shift and a mask." The byte that
    // contains it is read whole and the field's bits are taken out of it; a
    // bit-field never spans a byte, because the walk only packs a field under
    // 8 bits and rounds up before anything wider.
    const byte = GetValueFromBuffer(backing.Buffer, backing.ByteOffset + placement.offset, 'Uint8', true, 'unordered');
    const shift = placement.offsetBit - placement.offset * 8;
    const mask = (1 << placement.layout.bitLength) - 1;
    const bits = ((R(byte) >> shift) & mask);
    return new TypedNumberValue(bits, fieldType);
  }
  const element = BufferElementType(fieldType);
  if (element === null) {
    return Throw.TypeError('a field of this type cannot be placed in a buffer');
  }
  const raw = GetValueFromBuffer(backing.Buffer, backing.ByteOffset + placement.offset, element, true, 'unordered');
  if (raw instanceof NumberValue) {
    return new TypedNumberValue(R(raw), fieldType);
  }
  return raw;
}

/** A field write: encode the value into the field's laid-out position. */
export function* WritePlacedField(backing: PlacementBacking, key: string, fieldType: TypeRecord, value: Value): PlainEvaluator<boolean> {
  const live = requireLive(backing);
  if (live) {
    return live;
  }
  const placement = placementOf(backing, key);
  if (!placement) {
    return false;
  }
  const numeric = value instanceof TypedNumberValue
    ? Value((value as unknown as { value: number }).value)
    : value;
  if (placement.isBitField) {
    const byteIndex = backing.ByteOffset + placement.offset;
    const current = R(GetValueFromBuffer(backing.Buffer, byteIndex, 'Uint8', true, 'unordered'));
    const shift = placement.offsetBit - placement.offset * 8;
    const mask = (1 << placement.layout.bitLength) - 1;
    const bits = (Number(numeric instanceof NumberValue ? R(numeric) : 0) & mask);
    const merged = (current & ~(mask << shift)) | (bits << shift);
    Q(yield* SetValueInBuffer(backing.Buffer, byteIndex, 'Uint8', Value(merged & 0xFF), true, 'unordered'));
    return true;
  }
  const element = BufferElementType(fieldType);
  if (element === null) {
    return Throw.TypeError('a field of this type cannot be placed in a buffer');
  }
  Q(yield* SetValueInBuffer(backing.Buffer, backing.ByteOffset + placement.offset, element, numeric as NumberValue, true, 'unordered'));
  return true;
}

function R(v: Value): number {
  return v instanceof NumberValue ? Number((v as unknown as { value: number }).value) : 0;
}

export { X, surroundingAgent };

export function* ValidatePlacement(constructor: ObjectValue, args: readonly Value[]): PlainEvaluator<PlacementBacking> {
  const layout = (constructor as { InstanceLayout?: ClassLayout | null }).InstanceLayout;
  if (!layout) {
    return Throw.TypeError('a placement allocation needs a type with a layout');
  }
  const buffer = args[0];
  if (!buffer || typeof buffer !== 'object' || !('ArrayBufferData' in buffer)) {
    return Throw.TypeError('the first placement argument must be an ArrayBuffer');
  }
  const byteOffset = args.length > 1 ? Number(Q(yield* ToIndex(args[1]!))) : 0;
  const reserved = args.length > 2 ? Number(Q(yield* ToIndex(args[2]!))) : layout.byteLength;
  const bytes = (buffer as { ArrayBufferData?: { byteLength: number } }).ArrayBufferData?.byteLength ?? 0;
  if (byteOffset + reserved > bytes) {
    return Throw.RangeError('the placement extent exceeds the buffer');
  }
  return {
    Buffer: buffer as ArrayBufferObject, ByteOffset: byteOffset, ByteLength: reserved, Layout: layout,
  };
}
