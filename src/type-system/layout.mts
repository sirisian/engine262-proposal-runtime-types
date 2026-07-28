import type { PrivateName } from '../value.mts';
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
/**
 * proposal-runtime-types #sec-layout-properties: a type's alignment is its byte
 * length rounded up to a power of two, and is NOT capped.
 *
 * The cap at 8 that this replaces made two 16-byte types disagree for no reason
 * a program could see: a `uint.<128>` aligned at 8 while a `float32x4` of the
 * same width aligned at 16, because the vector rule bypassed the cap. Rust,
 * which this layout follows, aligns each scalar to its own size - `u128` is
 * 16-byte aligned, matching C - and caps nothing; raising an alignment is
 * `#[repr(align(N))]`'s job, which is `@align` here. Removing the cap makes the
 * vector case fall out of the general rule instead of needing one of its own.
 */
function naturalAlignment(byteLength: number): number {
  let a = 1;
  while (a < byteLength) {
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
  if (t.Kind === 'nominal' && t.LibraryName === 'SoA') {
    // proposal-runtime-types soa.md, and the layout table's row: "A fixed-length
    // `SoA.<T, N>` - Yes, but not `T`'s: EACH FIELD OF `T` IS A COLUMN OF N
    // ELEMENTS, PADDED AND ALIGNED ON ITS OWN, and the size is the sum of the
    // columns. An element's fields are not adjacent."
    //
    // The split is ONE LEVEL, not recursive to the leaves: a field that is
    // itself a value type stays one column, interleaved within itself. soa.md
    // makes that deliberate - "a consumer that wants `origin` as a contiguous
    // stream of Vec2 gets it", and flattening the class is how a program asks
    // for the other thing. So each column is a fixed array of the FIELD's type,
    // and the field's own layout is whatever the class walk already gave it.
    //
    // There is no interior padding between an element's fields, because an
    // element's fields are no longer adjacent. That is why a `T` whose
    // interleaved layout pads to a larger stride has a SMALLER byteLength here
    // than its `[].<T>` equivalent.
    const element = t.Arguments[0];
    const extent = t.Arguments[1];
    if (element === undefined || typeof element === 'number') {
      return null;
    }
    // A growable `SoA.<T>` has no layout as a TYPE, exactly as `[].<T>` has
    // none: its instances have a byteLength and the type does not.
    if (typeof extent !== 'number' || extent === 0) {
      return null;
    }
    const columns = SoAColumnsOf(element);
    if (columns === null) {
      return null;
    }
    let byteLength = 0;
    let alignment = 1;
    for (const column of columns) {
      // Each column is padded and aligned on its own, so the next column starts
      // at the next multiple of its own alignment.
      if (column.layout.alignment > 0 && byteLength % column.layout.alignment !== 0) {
        byteLength += column.layout.alignment - (byteLength % column.layout.alignment);
      }
      byteLength += column.layout.byteLength * extent;
      if (column.layout.alignment > alignment) {
        alignment = column.layout.alignment;
      }
    }
    if (alignment > 0 && byteLength % alignment !== 0) {
      byteLength += alignment - (byteLength % alignment);
    }
    return { bitLength: byteLength * 8, byteLength, alignment };
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
  if (t.Kind === 'union') {
    // #sec-memory-layout's table, row "a reference type, INCLUDING A NULLABLE
    // UNION OF A VALUE TYPE CLASS": "No. A reference's width is the
    // implementation's business." So the union has no layout OF ITS OWN, and a
    // FIELD of that type still occupies a reference's width - which is what
    // #sec-layout-finiteness means by "a field written `T | null` closes a
    // cycle because it is a reference ... whose width is the implementation's;
    // the recursion stops there rather than descending, which is why a linked
    // list is expressible".
    //
    // Eight bytes at alignment eight is this implementation's choice, matching
    // a 64-bit pointer. The clause leaves it open deliberately, so nothing here
    // is normative beyond "it has one and the recursion stops".
    const nullable = t.Members.length === 2
      && t.Members.some((m) => m.Kind === 'literal' || m.Kind === 'void')
      && t.Members.some((m) => m.Kind === 'nominal');
    return nullable ? { bitLength: 64, byteLength: 8, alignment: 8 } : null;
  }
  if (t.Kind !== 'primitive') {
    // `any` and the remaining forms have no layout by design.
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
    // A SIMD vector aligns to its whole width - float32x4 is 16 bytes at
    // alignment 16, because the register it occupies is addressed that way -
    // and that is now what the general rule says, since a width that is already
    // a power of two rounds up to itself. It no longer needs a rule of its own.
    return { bitLength, byteLength, alignment: naturalAlignment(byteLength) };
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
  readonly key: string | PrivateName;
  /** The field's declared type, which a column of it needs (soa.md's `fields`). */
  readonly type: TypeRecord;
  /** The containing byte. A bit-field has no byte address of its own; this is where its byte begins. */
  readonly offset: number;
  /** The bit position, which is what fixes bit order exactly for a wire format. */
  readonly offsetBit: number;
  readonly isBitField: boolean;
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
  fields: readonly { key: string | PrivateName, type: TypeRecord, controls?: FieldControls }[],
  controls: ClassControls = {},
  declaringClass?: unknown,
): ClassLayout | null | { cycle: string } {
  // #sec-natural-alignment states this as a BIT cursor, not a byte one, because
  // a sub-byte field advances by bits: "Let a bit cursor begin at 0, at the end
  // of the layout of the class it extends where it extends one and at 0
  // otherwise." Writing it in bytes and special-casing bit-fields is how the
  // rounding rules drift apart; in bits the two cases share one cursor.
  const placed: FieldPlacement[] = baseLayout ? [...baseLayout.fields] : [];
  let cursor = baseLayout ? baseLayout.bitLength : 0;
  // "The cursor's furthest extent" - tracked separately, because an explicit
  // `offset` may place a field behind the cursor (the C union) and must not
  // shrink the class.
  let furthest = cursor;
  let alignment = controls.packed ? 1 : (baseLayout ? baseLayout.alignment : 1);
  for (const field of fields) {
    // #sec-layout-finiteness: "a value type class may not contain itself,
    // directly or through a cycle of value type fields", and "the two are one
    // condition" with the layout being defined at all.
    //
    // This check had never had to work. A cyclic class was refused by the
    // ordinary temporal dead zone before any layout was computed, so the
    // condition held by accident; resolving a type-position name against its
    // DECLARATION (which #sec-compile-time-evaluability requires) removes that
    // accident and leaves the clause to be enforced properly.
    //
    // A field whose type is a class STILL UNDER DECLARATION is the cycle: its
    // nominal record carries no [[Constructor]] yet, because the class it names
    // has not finished being defined. A reference to the same class does not
    // reach here - `T | null` is a union, and the union arm above gives it a
    // reference's width without descending - which is exactly the distinction
    // the clause draws between a linked list and a class containing itself.
    if (field.type.Kind === 'nominal'
        && field.type.EnumMembers === undefined
        && field.type.Constructor === undefined) {
      // ONLY the class itself is a cycle here. A by-value field naming a class
      // declared LATER also has no [[Constructor]] yet, and that is a forward
      // reference rather than a cycle: its layout is simply not computable at
      // this declaration, so the class reports none rather than an error. Being
      // wrong in that direction costs precision; being wrong in the other would
      // refuse a program the clause admits.
      if (declaringClass !== undefined && field.type.Declaration === declaringClass) {
        return { cycle: typeof field.key === 'string' ? field.key : field.key.Description.stringValue() };
      }
      return null;
    }
    const layout = LayoutOf(field.type);
    if (!layout) {
      return null;
    }
    // "Where the field's type has a `bitLength` under 8, it is a bit-field."
    // The byte boundary is the line, not the type's name: a `uint.<12>` is not
    // a bit-field and occupies 2 bytes unless an `offsetBit` places it, which
    // is what a 12-bit wire format has anyway.
    const isBitField = layout.bitLength < 8;
    let offsetBits;
    if (isBitField) {
      offsetBits = field.controls?.offsetBit !== undefined ? field.controls.offsetBit : cursor;
      cursor = offsetBits + layout.bitLength;
    } else {
      // "Otherwise the cursor is first rounded up to a byte."
      if (cursor % 8 !== 0) {
        cursor += 8 - (cursor % 8);
      }
      const fieldAlignment = field.controls?.align !== undefined
        ? field.controls.align
        : (controls.packed ? 1 : layout.alignment);
      let byteOffset;
      if (field.controls?.offset !== undefined) {
        byteOffset = field.controls.offset;
      } else if (field.controls?.offsetBit !== undefined) {
        // An `offsetBit` on a field 8 bits or wider places it too: the clause
        // says a `uint.<12>` occupies 2 bytes "unless an `offsetBit` places
        // it", so the control reaches past the sub-byte case.
        byteOffset = undefined;
        offsetBits = field.controls.offsetBit;
      } else if (controls.packed) {
        byteOffset = cursor / 8;
      } else {
        const at = cursor / 8;
        byteOffset = fieldAlignment > 0 && at % fieldAlignment !== 0
          ? at + (fieldAlignment - (at % fieldAlignment))
          : at;
      }
      if (byteOffset !== undefined) {
        offsetBits = byteOffset * 8;
      }
      cursor = offsetBits! + layout.bitLength;
      if (!controls.packed && fieldAlignment > alignment) {
        alignment = fieldAlignment;
      }
    }
    placed.push({
      key: field.key,
      type: field.type,
      offset: Math.floor(offsetBits! / 8),
      offsetBit: offsetBits!,
      isBitField,
      layout,
    });
    if (cursor > furthest) {
      furthest = cursor;
    }
  }
  if (controls.alignAll !== undefined) {
    alignment = controls.alignAll;
  }
  // "Its `bitLength` is the cursor's furthest extent, and its `byteLength` is
  // the size its `size` names, or that extent rounded up to a byte and then to
  // the class's alignment." So bitLength is the UNROUNDED extent: a class of
  // one `uint.<5>` reports 5 bits in 1 byte, where before it reported 8.
  const bitLength = furthest;
  let byteLength = Math.ceil(bitLength / 8);
  if (alignment > 0 && byteLength % alignment !== 0) {
    byteLength += alignment - (byteLength % alignment);
  }
  if (controls.size !== undefined) {
    byteLength = controls.size;
  }
  return { bitLength, byteLength, alignment, fields: placed };
}

/** One column per IMMEDIATE field of the element type, in declaration order. */
export interface SoAColumn {
  readonly key: string;
  readonly type: TypeRecord;
  readonly layout: Layout;
}

/**
 * The columns an `SoA.<T, N>` stores, or *null* where `T` cannot be split.
 *
 * soa.md: "`T` must be a value type class, since a class with a reference field
 * has nothing to split. A PRIMITIVE `T` IS PERMITTED and degenerates to a
 * single column, so generic code that may or may not be handed a primitive
 * needs no special case."
 */
export function SoAColumnsOf(element: TypeRecord): SoAColumn[] | null {
  if (element.Kind === 'primitive' || element.Kind === 'array') {
    const layout = LayoutOf(element);
    return layout ? [{ key: '0', type: element, layout }] : null;
  }
  if (element.Kind !== 'nominal') {
    return null;
  }
  const constructor = element.Constructor as { InstanceLayout?: ClassLayout | null } | undefined;
  const instance = constructor?.InstanceLayout;
  if (!instance) {
    // A class with no layout - an untyped field, a `dynamic` class, or a field
    // whose type has none - has nothing to split into columns.
    return null;
  }
  const columns: SoAColumn[] = [];
  for (const field of instance.fields) {
    if (field.isBitField) {
      // A bit-field is not byte-addressable, and a column of them would have to
      // be a bit-vector rather than an array. Refused rather than guessed at.
      return null;
    }
    if (typeof field.key !== 'string') {
      // A PRIVATE field. It occupies its slot in the instance layout (README:
      // private fields participate exactly as public ones do), but an SoA reads
      // and writes each column BY NAME, and a private slot has no name to reach
      // it by - so a class carrying one has no column form. Refused rather than
      // split into columns one of which nothing could ever fill.
      return null;
    }
    columns.push({ key: field.key, type: field.type, layout: field.layout });
  }
  return columns;
}
