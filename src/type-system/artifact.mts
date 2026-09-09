import { GetTypeObject } from './intern.mts';
import type { TypeRecord } from './records.mts';

/**
 * proposal-runtime-types #sec-expansion-artifact, the reference scheme.
 *
 *   "An expansion artifact is a serialization of the interning table for the
 *   concrete types a module graph's public surface produces, every closed
 *   application among them pre-evaluated, keyed by a hash of the module graph
 *   that produced it."
 *
 * A TABLE, because the clause says so and because nothing else works. Two shapes
 * defeat a serializer that walks nested types by containment, and both are
 * ordinary:
 *
 *   - a primitive record refers to ITSELF - `getReflection(uint8).type` is
 *     `uint8` - so an eager walk does not terminate on the simplest type in the
 *     language; and
 *   - a recursive type closes a cycle through a nested position, as
 *     `type L = { next: L | void }` reaches itself through its own property.
 *
 * A table represents both without difficulty: an entry names another entry by
 * INDEX rather than by containment, so a cycle is a pair of indices and the
 * reader needs no cycle detection. It allocates every entry first and fills them
 * afterwards, which is what interning already does to tie the knot for a
 * recursive declaration.
 *
 * The walk is GENERIC rather than a switch over kinds. A second walk that had to
 * know every kind would be a second definition of what a type is, kept in step
 * with the first by hand - and this codebase has three cases of exactly that
 * drifting apart: a metadata walk that did not know a RegExp is a leaf, an intern
 * comparison that folded refinement into identity, and a snapshot that knew a
 * live range but not the marker for one. Each was invisible to sampling. So this
 * asks only "is this field a type record", and any kind added later is carried
 * without being taught.
 */

/** A reference to another entry in the table. */
interface Ref { readonly $ref: number }

/**
 * An entry is a record's own shape with every nested type replaced by a `Ref`.
 *
 * Tagged rather than a bare index. Type positions are knowable - a property's
 * `type` is always a type - but a literal record carries a `Value` and a property
 * carries an `initial`, either of which may be a number, so bare indices would
 * make the format's meaning depend on the reader knowing every position's schema.
 * That is the second definition again, one level down.
 */
type Entry = Record<string, unknown>;

export interface TypeTable {
  /**
   * Written from the first entry, never retrofitted. A reader that meets a
   * higher version ignores the artifact and evaluates, which is the same path a
   * hash mismatch takes - so forward compatibility costs one comparison, and
   * only if the field was there from the start.
   */
  readonly version: number;
  readonly types: readonly Entry[];
  /** The public surface: a name to the index of the type it denotes. */
  readonly exports: Readonly<Record<string, number>>;
}

export const TYPE_TABLE_VERSION = 1;

function isTypeRecord(value: unknown): value is TypeRecord {
  return typeof value === 'object' && value !== null
    && typeof (value as { Kind?: unknown }).Kind === 'string';
}

/**
 * Serialize the types reachable from `roots` as a table.
 *
 * Entry order follows first encounter from the roots in the order given, which
 * makes the table deterministic for a deterministic root order; the roots
 * themselves come from a module's exports, which the checker already holds in a
 * canonical order.
 */
export function SerializeTypeTable(roots: ReadonlyMap<string, TypeRecord>): TypeTable {
  const indices = new Map<TypeRecord, number>();
  const types: Entry[] = [];

  const indexOf = (record: TypeRecord): number => {
    const seen = indices.get(record);
    if (seen !== undefined) {
      return seen;
    }
    // Reserved BEFORE the fields are walked, so a record that reaches itself
    // finds its own index rather than recurring.
    const index = types.length;
    indices.set(record, index);
    types.push({});
    const entry = types[index]!;
    for (const [key, value] of Object.entries(record)) {
      entry[key] = encode(value);
    }
    return index;
  };

  const encode = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(encode);
    }
    if (isTypeRecord(value)) {
      return { $ref: indexOf(value) } satisfies Ref;
    }
    if (isPlainRecord(value)) {
      const out: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(value)) {
        out[key] = encode(nested);
      }
      return out;
    }
    return value;
  };

  const exports: Record<string, number> = {};
  for (const [name, record] of roots) {
    exports[name] = indexOf(record);
  }
  return { version: TYPE_TABLE_VERSION, types, exports };
}

/**
 * A plain record is walked; anything else is a LEAF carried as-is.
 *
 * The test is the prototype, not a guess about the contents. An engine `Value` -
 * a literal's value, a property key, a metadata leaf - is an instance of
 * something, as is a parse node held by a nominal record. A first attempt tried
 * to recognise engine values by their fields and got both wrong: it walked a
 * `Value` apart, so a literal lost what it was, and it followed a nominal
 * record's declaration into a cycle the type system does not have, which
 * overflowed the stack.
 *
 * Property records, signature records and metadata records ARE plain, so they
 * are walked and their nested types become references, which is what the table
 * needs.
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (isParseNode(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * A parse node is plain by prototype but is not a record to walk. A ~nominal~
 * record holds its [[Declaration]], and a node carries a `parent` back-pointer,
 * so walking one does not terminate - the same non-termination the evaluable
 * fragment's walk has to skip.
 *
 * Held as an opaque leaf here, which is enough for a table read back IN THE SAME
 * AGENT. It is NOT enough for a wire: a declaration cannot cross one, so a
 * nominal type has to be carried by a stable name - its module and its declared
 * name - rather than by value. That is a design question for the producer and
 * not for the reference scheme, and it is recorded rather than guessed at.
 */
function isParseNode(value: object): boolean {
  return typeof (value as { type?: unknown }).type === 'string'
    && 'parent' in value;
}

/**
 * Read a table back, returning the exported types by name.
 *
 * Two phases, because a cycle cannot be built in one: every entry is allocated
 * as a mutable shell, references are resolved against the shells, and only then
 * is each interned. `GetTypeObject` canonicalizes the result, so a table read
 * back produces the SAME interned types the graph produced - which is the
 * property the clause rests the whole mechanism on.
 */
export function DeserializeTypeTable(table: TypeTable): Map<string, unknown> | undefined {
  if (table.version > TYPE_TABLE_VERSION) {
    // A newer producer: ignore rather than misread, and let the caller evaluate.
    return undefined;
  }
  const shells: Record<string, unknown>[] = table.types.map(() => ({}));
  const decode = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(decode);
    }
    if (typeof value === 'object' && value !== null) {
      const ref = (value as Partial<Ref>).$ref;
      if (typeof ref === 'number') {
        return shells[ref];
      }
      if (isPlainRecord(value)) {
        const out: Record<string, unknown> = {};
        for (const [key, nested] of Object.entries(value)) {
          out[key] = decode(nested);
        }
        return out;
      }
    }
    return value;
  };
  table.types.forEach((entry, index) => {
    for (const [key, value] of Object.entries(entry)) {
      shells[index]![key] = decode(value);
    }
  });
  const out = new Map<string, unknown>();
  for (const [name, index] of Object.entries(table.exports)) {
    out.set(name, GetTypeObject(shells[index] as unknown as TypeRecord));
  }
  return out;
}
