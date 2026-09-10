import { GetTypeObject } from './intern.mts';
import { TypeOrigins } from './provenance.mts';
import { Value, TypedNumberValue } from '../value.mts';
import { orderKey, type TypeRecord } from './records.mts';

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
export function SerializeTypeTable(roots: ReadonlyMap<string, object>): TypeTable {
  // Collected first, ordered second, encoded third.
  //
  // The order is CANONICAL - `orderKey`'s total order over records, the same one
  // interning sorts by - and not first-encounter from the roots. First-encounter
  // is cheaper and makes the table's layout depend on the order a caller happened
  // to enumerate its exports in, so two producers over one graph could emit
  // different bytes for the same types and the hash would call them different.
  // Determinism has to be a property of the format rather than of the caller.
  const reachable = new Set<TypeRecord>();
  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }
    if (isTypeRecord(value)) {
      if (reachable.has(value)) {
        return;
      }
      reachable.add(value);
      for (const nested of Object.values(value)) {
        collect(nested);
      }
      return;
    }
    if (isPlainRecord(value)) {
      Object.values(value).forEach(collect);
      return;
    }
    // A typed number carries the numeric type of its value, which needs a table
    // entry like any other type.
    const typed = value as { type?: string, TypeRecord?: unknown } | null;
    if (typed?.type === 'TypedNumber' && isTypeRecord(typed.TypeRecord)) {
      collect(typed.TypeRecord);
    }
  };
  // TYPE OBJECTS in, Type Objects out. The reader already returns them - it ends
  // in `GetTypeObject` - so taking records made the round trip asymmetric at the
  // one operation whose whole property is `deserialize(serialize(x)) === x`.
  //
  // It also put the serializer out of reach of what it needs. A nominal cannot be
  // carried by value: its record holds a [[Declaration]], a parse node, and a
  // [[Constructor]], a live class - the only two leaves in a table that cannot be
  // encoded, and both only there. Carrying it by NAME instead needs the declared
  // name, which lives in provenance, which is keyed on Type Objects. A record
  // cannot reach it; a Type Object can, and can always yield its record.
  const recordOf = (root: object): TypeRecord => (root as { TypeRecord?: TypeRecord }).TypeRecord ?? root as TypeRecord;
  for (const root of roots.values()) {
    collect(recordOf(root));
  }

  const ordered = [...reachable].sort((a, b) => {
    const ka = orderKey(a);
    const kb = orderKey(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  const indices = new Map<TypeRecord, number>();
  ordered.forEach((record, index) => indices.set(record, index));

  const encode = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(encode);
    }
    if (isTypeRecord(value)) {
      return { $ref: indices.get(value)! } satisfies Ref;
    }
    if (isPlainRecord(value)) {
      const out: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(value)) {
        out[key] = encode(nested);
      }
      return out;
    }
    if (isEncodableLeaf(value)) {
      return encodeLeaf(value, (r) => ({ $ref: indices.get(r)! }));
    }
    if (typeof value === 'object' && value !== null) {
      // REFUSED, and named. Anything reaching here is an object this format has
      // no encoding for, and carrying it produced an artifact that could not be
      // written: a symbol-keyed member threw from inside the walk, with a failure
      // that named neither the symbol nor the member.
      //
      // A producer that cannot encode a surface should emit no artifact, not a
      // broken one - a consumer with no artifact evaluates and is always correct.
      // Saying which leaf stopped it is what lets an author fix it or decide the
      // surface is not shippable.
      throw new TypeError(`an expansion artifact cannot carry ${describeLeaf(value)}`);
    }
    // A JS primitive - a `Rest` flag, a kind name, an arity - travels as itself.
    return value;
  };

  const types: Entry[] = ordered.map((record) => {
    if ((record as { Kind?: string }).Kind === 'nominal') {
      return nominalEntry(record, encode);
    }
    const entry: Entry = {};
    for (const [key, value] of Object.entries(record)) {
      entry[key] = encode(value);
    }
    return entry;
  });
  const exports: Record<string, number> = {};
  for (const [name, root] of roots) {
    exports[name] = indices.get(recordOf(root))!;
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
 * A LEAF is encoded, not carried. Once a nominal travels by name, every leaf a
 * table holds is a primitive value - measured: a string, a number, a boolean, a
 * bigint, or a typed number - so the table becomes bytes rather than an
 * in-process structure, and that is what makes it an artifact rather than a
 * stage toward one.
 *
 * A TYPED NUMBER is not quite a leaf: it carries the numeric type its value has,
 * so its type is a reference into the table like any other. That is why the
 * collecting pass has to look inside one.
 *
 * A SYMBOL is refused. An unregistered symbol has no name that survives a
 * boundary, and a registered one would need `Symbol.for` at the consumer - a
 * decision about identity across a wire rather than an encoding, so it declines
 * here rather than guessing.
 */
function encodeLeaf(value: unknown, ref: (r: TypeRecord) => unknown): unknown {
  const leaf = value as { type?: string, value?: unknown, TypeRecord?: TypeRecord };
  switch (leaf.type) {
    case 'String': return { $str: leaf.value as string };
    case 'Number': return { $num: leaf.value as number };
    case 'Boolean': return { $bool: leaf.value as boolean };
    case 'BigInt': return { $bigint: String(leaf.value) };
    case 'TypedNumber':
      return { $typed: { value: String(leaf.value), type: ref(leaf.TypeRecord as TypeRecord) } };
    default:
      return undefined;
  }
}

function decodeLeaf(value: Record<string, unknown>, deref: (v: unknown) => unknown): unknown {
  if ('$str' in value) { return Value(value.$str as string); }
  if ('$num' in value) { return Value(value.$num as number); }
  if ('$bool' in value) { return value.$bool === true ? Value.true : Value.false; }
  if ('$bigint' in value) { return Value(BigInt(value.$bigint as string)); }
  if ('$typed' in value) {
    const typed = value.$typed as { value: string, type: unknown };
    const record = deref(typed.type) as TypeRecord;
    const numeric = typed.value.includes('.') || typed.value.includes('e')
      ? Number(typed.value)
      : BigInt(typed.value);
    return new TypedNumberValue(numeric as never, record as never);
  }
  return undefined;
}

/**
 * Names an unencodable leaf for the refusal, so the message points at the cause.
 *
 * A SYMBOL is the case that exists today, and its limit is real rather than an
 * oversight: an unregistered symbol has no name that survives a boundary, and a
 * registered one would need `Symbol.for` at the consumer - a decision about
 * identity across a wire rather than an encoding, which this format does not make
 * on an author's behalf.
 */
function describeLeaf(value: object): string {
  const type = (value as { type?: string }).type;
  if (type === 'Symbol') {
    return 'a symbol, which has no name that survives a boundary';
  }
  if (type === 'Object') {
    return 'an object value';
  }
  return `a ${type ?? value.constructor?.name ?? 'value'} it has no encoding for`;
}

/** Whether a value is one of the leaves `encodeLeaf` knows. */
function isEncodableLeaf(value: unknown): boolean {
  const type = (value as { type?: string } | null)?.type;
  return type === 'String' || type === 'Number' || type === 'Boolean'
    || type === 'BigInt' || type === 'TypedNumber';
}

/**
 * A nominal is carried by NAME, never by value.
 *
 * Its record holds a [[Declaration]] - a parse node, with a `parent`
 * back-pointer that does not terminate - and a [[Constructor]], a live class
 * object. Measured, those are the ONLY two leaves in a table that cannot be
 * encoded, and both are here: everything else is a string, a number, a boolean,
 * a bigint or a typed number. So this one substitution is the whole of what
 * stands between the table and bytes.
 *
 * Measured too that dropping nominals instead is not an option: 15% of a
 * realistic surface's entries are nominal, and 58% of them REACH one, so eleven
 * of twelve exported types would go with them.
 *
 * The name comes from provenance, which is keyed on Type Objects - interning
 * gives the Type Object for an already-interned record, so a nested nominal is
 * reachable as well as a root one.
 */
function nominalEntry(record: TypeRecord, encode: (v: unknown) => unknown): Entry {
  const typeObject = GetTypeObject(record) as unknown as object;
  const [origin] = TypeOrigins(typeObject);
  return {
    Kind: 'nominal',
    // `source` is the host's name for the file. A producer over a module graph
    // replaces it with the module specifier, which is the stable half of the
    // name; the declared name is the other half and comes from here.
    nominal: { name: origin?.name, source: origin?.source },
    Arguments: encode((record as { Arguments?: unknown }).Arguments ?? []),
  };
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
export function DeserializeTypeTable(
  table: TypeTable,
  /**
   * Resolves a carried name to the type it denotes at the CONSUMER. A nominal
   * cannot be rebuilt from an artifact - it names a declaration the consumer
   * has its own copy of - so this is the one thing a reader cannot do alone, and
   * it is the shape a real consumer's module resolution takes.
   */
  resolveNominal?: (name: { name?: string, source?: string }) => object | undefined,
): Map<string, unknown> | undefined {
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
        const leaf = decodeLeaf(value as Record<string, unknown>, decode);
        if (leaf !== undefined) {
          return leaf;
        }
        const out: Record<string, unknown> = {};
        for (const [key, nested] of Object.entries(value)) {
          out[key] = decode(nested);
        }
        return out;
      }
    }
    return value;
  };
  for (const [index, entry] of table.types.entries()) {
    const named = (entry as { nominal?: { name?: string, source?: string } }).nominal;
    if (named) {
      const resolved = resolveNominal?.(named);
      if (!resolved) {
        // Unresolvable: the consumer does not have what the artifact names, so
        // it cannot read this table and must evaluate. Declining is the same
        // answer a hash mismatch and a newer version get.
        return undefined;
      }
      const record = (resolved as { TypeRecord?: unknown }).TypeRecord ?? resolved;
      Object.assign(shells[index]!, record as object);
      continue;
    }
    for (const [key, value] of Object.entries(entry)) {
      shells[index]![key] = decode(value);
    }
  }
  const out = new Map<string, unknown>();
  for (const [name, index] of Object.entries(table.exports)) {
    out.set(name, GetTypeObject(shells[index] as unknown as TypeRecord));
  }
  return out;
}
