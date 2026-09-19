import { Q, X } from '../completion.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import {
  NumberValue, ObjectValue, TypedNumberValue, Value,
} from '../value.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { LayoutOf, type ClassLayout, type FieldPlacement } from '../type-system/layout.mts';
import type { TypedArrayTypes } from '../intrinsics/TypedArray.mts';
import type { ArrayBufferObject } from './arraybuffer-objects.mts';
import {
  GetValueFromBuffer, SetValueInBuffer, IsDetachedBuffer, Throw, surroundingAgent, ToIndex,
  Get, OrdinaryObjectCreate, Set as SetProperty,
} from '#self';

/**
 * proposal-runtime-types, the placement forms of
 * #sec-type-arguments-and-placement-new-in-expression-position: "The placement
 * forms allocate into an existing buffer rather than into fresh storage...
 * Construction stores each field of each instance at its laid-out position."
 *
 * This is the first thing in the engine that puts real BYTES under an instance.
 * Every typed class before it stored its fields as ordinary properties, which
 * is why the layout could be computed for a long time without anything reading
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

/**
 * An instance of a laid-out class whose fields READ AND WRITE THROUGH to a
 * buffer at a byte offset, rather than to storage of its own.
 *
 * This is what a placement `new` produces and what an SoA column already built
 * by hand for a nested class field; a window over a buffer needs the same object
 * for its elements and had no way to ask for one, which is why every element
 * access on a class-typed view answered "an element of this type cannot be
 * viewed in a buffer" while the array-backed window read the same element fine.
 */
export function* PlacedInstance(
  type: TypeRecord,
  buffer: ArrayBufferObject,
  byteOffset: number,
  byteLength: number,
): PlainEvaluator<ObjectValue | null> {
  if (type.Kind !== 'nominal') {
    return null;
  }
  const ctor = (type as { Constructor?: ObjectValue }).Constructor as
    { InstanceLayout?: ClassLayout | null } | undefined;
  const layout = ctor?.InstanceLayout;
  if (!layout) {
    return null;
  }
  const proto = Q(yield* Get(ctor as unknown as ObjectValue, Value('prototype')));
  const instance = OrdinaryObjectCreate(proto instanceof ObjectValue ? proto : Value.null);
  SetPlacementBacking(instance as unknown as object, {
    Buffer: buffer, ByteOffset: byteOffset, ByteLength: byteLength, Layout: layout,
  });
  const typed = new Map<unknown, { TypeRecord: TypeRecord }>();
  for (const field of layout.fields) {
    typed.set(field.key, { TypeRecord: field.type });
  }
  (instance as { TypedProperties?: Map<unknown, { TypeRecord: TypeRecord }> }).TypedProperties = typed;
  X(instance.PreventExtensions());
  return instance;
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
    // A NESTED CLASS FIELD reads through a placement-backed instance at its own
    // offset, the same object a class ELEMENT of a window already gets. Without
    // this, `class Outer { i: Inner; }` over a buffer answered "a field of this
    // type cannot be placed in a buffer" for `o.i` - so memorylayout.md's own
    // `header.c.a = 10` could not run even once its source was byte-backed, and
    // a placement `new` refused the same read.
    //
    // The field's placement already carries its offset and its layout, which is
    // everything the nested instance needs; what was missing is that
    // `BufferElementType` answers only scalars and nothing asked what else the
    // field might be.
    const nested = Q(yield* PlacedInstance(
      fieldType,
      backing.Buffer,
      backing.ByteOffset + placement.offset,
      placement.layout.byteLength,
    ));
    if (nested) {
      return nested;
    }
    return Throw.TypeError('a field of this type cannot be placed in a buffer');
  }
  // `@endian` fixes this field's byte order. Without one the platform's order is
  // used, which is what a `TypedArray` does and what this implementation's *true*
  // stands for. `layout.mts` says the decorator is "carried and has no effect on
  // the byte walk ... a property of reading and writing rather than of
  // placement" - so this is where it belongs, and it was not consulted, leaving
  // `@endian('big')` and no decorator writing identical bytes.
  const raw = GetValueFromBuffer(backing.Buffer, backing.ByteOffset + placement.offset, element, true, 'unordered', placement.endian !== 'big');
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
    // A WHOLE NESTED FIELD is written field by field through the placed
    // instance, so a bit-field, an explicit offset and a further nesting each go
    // through the rule that placed them rather than being blitted.
    const nested = Q(yield* PlacedInstance(
      fieldType,
      backing.Buffer,
      backing.ByteOffset + placement.offset,
      placement.layout.byteLength,
    ));
    const source = value;
    if (!nested || !(source instanceof ObjectValue)) {
      return Throw.TypeError('a field of this type cannot be placed in a buffer');
    }
    const nestedLayout = LayoutOf(fieldType) as { fields?: readonly { key: unknown }[] } | null;
    for (const inner of nestedLayout?.fields ?? []) {
      if (typeof inner.key !== 'string') {
        continue;
      }
      const innerValue = Q(yield* Get(source, Value(inner.key)));
      Q(yield* SetProperty(nested, Value(inner.key), innerValue, Value.true));
    }
    return true;
  }
  Q(yield* SetValueInBuffer(backing.Buffer, backing.ByteOffset + placement.offset, element, numeric as NumberValue, true, 'unordered', placement.endian !== 'big'));
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
