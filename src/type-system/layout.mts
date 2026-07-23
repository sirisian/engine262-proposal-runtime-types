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
  if (t.Kind !== 'primitive') {
    // An enum's layout is its underlying type's, and a value type class's is the
    // natural-alignment walk over its fields. Neither is computed here: the Type
    // Record carries no resolved underlying type for an enum, and the field walk
    // belongs with the rest of the memory layout work. Both report no layout for
    // now rather than a wrong number. A union, a reference type, and `any` have
    // none by design.
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
    const width = laneLayout.byteLength * lanes;
    return { bitLength: width * 8, byteLength: width, alignment: naturalAlignment(width) };
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
