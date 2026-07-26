import type { TypeRecord } from './records.mts';

/**
 * proposal-runtime-types (memorylayout.md): the laid-out size of a type. A type
 * either has a layout or it does not, and asking a type that does not is an error
 * rather than a number, because a program asking for the size of a `string` has
 * made a mistake a returned number would hide.
 */
export interface Layout {
  /** Size in bits, which is what an arbitrary-width integer needs to describe itself. */
  readonly bitLength: number;
  /** Laid-out size in bytes, including any trailing padding the alignment requires. */
  readonly byteLength: number;
  /** Byte alignment of the type. */
  readonly alignment: number;
}

/**
 * A width no named type has aligns to the smallest power of two at least its byte
 * length, capped at eight: `uint.<4>` sits at alignment one and `uint.<24>` at four.
 */
function naturalAlignment(byteLength: number): number {
  let a = 1;
  while (a < byteLength && a < 8) {
    a *= 2;
  }
  return a;
}

function fromBits(bitLength: number): Layout {
  const byteLength = Math.ceil(bitLength / 8);
  return { bitLength, byteLength, alignment: naturalAlignment(byteLength) };
}

/**
 * The layout of a type, or null where the type has none. Per memorylayout.md the
 * numeric types, `boolean`, the SIMD vectors, enums (their underlying type's), value
 * type classes, and a fixed-length array have layouts; `bigint`, `string`, `any`,
 * reference types, a `[].<T>` with no length, and a union of value types do not,
 * because their size is a property of the value rather than of the type.
 */
export function LayoutOf(t: TypeRecord): Layout | null {
  if (t.Kind === 'array') {
    // A fixed-length array lays out as its element repeated; one with no length is
    // not a laid-out type, though its instances have a byteLength.
    const extent = (t as { Extent?: unknown }).Extent;
    const element = (t as { Element?: TypeRecord }).Element;
    if (typeof extent !== 'number' || !element) {
      return null;
    }
    const elementLayout = LayoutOf(element);
    if (!elementLayout) {
      return null;
    }
    const byteLength = elementLayout.byteLength * extent;
    return { bitLength: byteLength * 8, byteLength, alignment: elementLayout.alignment };
  }
  if (t.Kind === 'nominal') {
    // #sec-memory-layout's type table, row "an enum": "Yes, its underlying
    // type's." The pin this replaces said the Type Record carried no resolved
    // underlying type; F62 added [[Underlying]] for the enum subtype relation,
    // so the enum row costs one line now.
    if (t.EnumMembers !== undefined) {
      return t.Underlying ? LayoutOf(t.Underlying) : null;
    }
    // Row "a value type class": the natural-alignment walk over its fields,
    // computed at DECLARATION and carried on the constructor. Computing it here
    // would mean resolving each field's type at every read, which is a
    // generator's work, and #sec-layout-properties calls these compile-time
    // constants - so the walk runs once, where the field types are already
    // resolved, and this reads the answer.
    const constructor = t.Constructor as { InstanceLayout?: Layout | null } | undefined;
    return constructor?.InstanceLayout ?? null;
  }
  if (t.Kind !== 'primitive') {
    // A union, a reference type, and `any` have no layout by design.
    return null;
  }
  const name = t.Name;
  if (name === 'int' || name === 'uint') {
    const bits = t.Arguments[0];
    return typeof bits === 'number' ? fromBits(bits) : null;
  }
  if (name === 'vector') {
    // A SIMD vector is its lane type repeated, aligned to its whole width.
    const lane = t.Arguments[0];
    const lanes = t.Arguments[1];
    if (typeof lanes !== 'number' || lane === undefined || typeof lane === 'number') {
      return null;
    }
    const laneLayout = LayoutOf(lane);
    if (!laneLayout) {
      return null;
    }
    // A vector's width is counted in BITS, not in whole lane bytes, so a bit
    // vector packs: `boolean8` is eight one-bit lanes in a single byte, which is
    // what makes it a usable bitfield rather than a name for a byte.
    const bitLength = laneLayout.bitLength * lanes;
    const byteLength = Math.ceil(bitLength / 8);
    // A SIMD vector aligns to its WHOLE width rather than the capped natural rule,
    // which memorylayout.md states for a width no named type has: float32x4 is 16
    // bytes at alignment 16, because the register it occupies is addressed that way.
    return { bitLength, byteLength, alignment: byteLength };
  }
  switch (name) {
    case 'float16': return fromBits(16);
    case 'float32': return fromBits(32);
    case 'float64': return fromBits(64);
    case 'float128': return fromBits(128);
    case 'decimal32': return fromBits(32);
    case 'decimal64': return fromBits(64);
    case 'decimal128': return fromBits(128);
    case 'boolean': return fromBits(8);
    // `number` is the type an untyped program computes with rather than a width
    // asked for by name, but its values are those of float64 and it lays out as one.
    case 'number': return fromBits(64);
    // `bigint`, `string`, and `symbol` size with the value, not the type.
    default: return null;
  }
}

/** One field's placement, which is what a reflection reports as its `offset`. */
export interface FieldPlacement {
  readonly key: string;
  readonly offset: number;
  readonly layout: Layout;
}

export interface ClassLayout extends Layout {
  readonly fields: readonly FieldPlacement[];
}

/**
 * #sec-natural-alignment: "Each field is placed at the next offset that is a
 * multiple of its own alignment, a class's alignment is the largest alignment
 * among its fields, and its byteLength is rounded up to that alignment so that
 * every element of an array of the class is aligned too."
 *
 * Declaration order, never reordered - the clause is explicit that field order
 * is a performance decision the PROGRAM makes, because views, serialization,
 * and interop depend on the declared order. `{ a: uint8, b: float64, c: uint8 }`
 * is 24 bytes and the reordering a compiler would be tempted to do is 16; this
 * returns 24.
 *
 * Inheritance appends: the base's fields keep their offsets and the subclass's
 * follow under the same rule, so `class B extends A` lays out as the flattening
 * of both. That is what lets a B be passed where an A is expected.
 *
 * Returns *null* where the class has no layout - a field whose type has none
 * (a `string`, a reference, a union), which the table's rows "a class with an
 * untyped field" and "a union of value types" cover between them. One field
 * without a layout is enough: a class is laid out or it is not.
 */
/**
 * #sec-layout-control: the seven reserved names, three on a class and four on a
 * field. They are NOT decorators in the semantic sense of this proposal's
 * decorators extension - they take no context parameter and name no function -
 * they are reserved names that set property-descriptor keys and happen to share
 * the `@` spelling. That is why they are recognized syntactically and never
 * evaluated.
 *
 * `offsetBit` and `endian` are carried and have no effect on the byte walk:
 * the first places a BIT-field, and the second fixes a field's byte order,
 * which is a property of reading and writing rather than of placement.
 */
export interface ClassControls {
  readonly packed?: boolean;
  readonly alignAll?: number;
  readonly size?: number;
}

export interface FieldControls {
  readonly align?: number;
  readonly offset?: number;
  readonly offsetBit?: number;
  readonly endian?: string;
}

export function ComputeClassLayout(
  baseLayout: ClassLayout | null,
  fields: readonly { key: string, type: TypeRecord, controls?: FieldControls }[],
  controls: ClassControls = {},
): ClassLayout | null {
  const placed: FieldPlacement[] = baseLayout ? [...baseLayout.fields] : [];
  let cursor = baseLayout ? baseLayout.byteLength : 0;
  // `packed` gives the class alignment 1 and places each field immediately
  // after the one before it; `alignAll` decides the INSTANCE's alignment. The
  // clause is explicit that they compose - one decides the fields' placement
  // and the other the whole - so they are tracked separately.
  let alignment = controls.packed ? 1 : (baseLayout ? baseLayout.alignment : 1);
  for (const field of fields) {
    const layout = LayoutOf(field.type);
    if (!layout) {
      return null;
    }
    // "An `align` REPLACES its field's alignment rather than strengthening it":
    // a `float32x4` at `@align(4)` follows a `float32` at byte 2 at byte 8, not
    // at byte 16. Taking the max is the obvious wrong implementation.
    const fieldAlignment = field.controls?.align !== undefined
      ? field.controls.align
      : (controls.packed ? 1 : layout.alignment);
    let offset;
    if (field.controls?.offset !== undefined) {
      // Two fields may share one offset, which is the C union, and a negative
      // one reaches into a base's memory. Deliberate reinterpretation, so
      // neither is diagnosed.
      offset = field.controls.offset;
    } else {
      offset = fieldAlignment > 0 && cursor % fieldAlignment !== 0
        ? cursor + (fieldAlignment - (cursor % fieldAlignment))
        : cursor;
    }
    placed.push({ key: field.key, offset, layout });
    const end = offset + layout.byteLength;
    if (end > cursor) {
      cursor = end;
    }
    if (!controls.packed && fieldAlignment > alignment) {
      alignment = fieldAlignment;
    }
  }
  if (controls.alignAll !== undefined) {
    alignment = controls.alignAll;
  }
  // Rounded up to the class's own alignment, so an array of it stays aligned.
  let byteLength = alignment > 0 && cursor % alignment !== 0
    ? cursor + (alignment - (cursor % alignment))
    : cursor;
  if (controls.size !== undefined) {
    byteLength = controls.size;
  }
  return { bitLength: byteLength * 8, byteLength, alignment, fields: placed };
}
