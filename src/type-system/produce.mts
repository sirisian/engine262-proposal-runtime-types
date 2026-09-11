import { SerializeTypeTable, DeserializeTypeTable, type TypeTable } from './artifact.mts';
import { ModuleGraphInventory, type GraphEntry } from './module-graph.mts';
import { GraphKey } from './graph-key.mts';
import { ExportedTypesOf, ExportedAliasesOf } from './check.mts';

/**
 * proposal-runtime-types #sec-expansion-artifact: "a serialization of the
 * interning table for the concrete types a module graph's public surface
 * produces ... keyed by a hash of the module graph that produced it."
 *
 * This assembles one. It does not hash: the clause names how the hash is
 * computed among the things it does not fix, so what comes out carries the
 * INVENTORY the hash is taken over, and whoever writes the artifact to disk
 * chooses the algorithm.
 */

export interface Artifact {
  /** The format version, from `SerializeTypeTable`. */
  readonly table: TypeTable;
  /**
   * What the key is computed from - every module's source and the specifier it
   * was reached by.
   */
  readonly graph: readonly GraphEntry[];
  /**
   * What the types MEAN, as distinct from how the bytes are laid out.
   *
   * The clause keys an artifact by a hash of the module graph, which does not
   * cover this: a consumer reading an artifact produced under different
   * type-system semantics would be trusting types computed by different rules,
   * and the graph could be identical. The format version does not cover it
   * either - that says how the bytes are laid out, not what the types mean.
   *
   * Carried as its own field rather than folded into the hash, because folding
   * destroys information: a consumer would see "mismatch" and be unable to tell
   * a stale dependency from a version skew, and those want different messages to
   * a human. A reader that does not recognize it declines, which is the path a
   * stale hash and a higher format version already take.
   */
  readonly semantics: string;
  /**
   * The key: SHA-256 over the canonical encoding of `graph`.
   *
   * Carried rather than left to a host, because the clause fixes what an
   * artifact is keyed BY and was silent on what the key is computed FROM. Two
   * producers serializing one inventory differently get different keys, and a
   * consumer then reads every current artifact as stale - quietly, so the
   * symptom is that artifacts never help.
   */
  readonly key: string;
}

/**
 * The semantics identifier this engine computes types under.
 *
 * A constant here, and deliberately not derived from a package version: what
 * matters is whether the RULES changed, and a release that changes no rule
 * should not invalidate every artifact in existence.
 */
export const SEMANTICS_ID = 'proposal-runtime-types/1';

/**
 * Build an artifact for a checked module, or *undefined* where one cannot be
 * built.
 *
 * Declining rather than throwing, except where the format itself refuses a leaf.
 * A producer that cannot describe a surface should emit no artifact: a consumer
 * with no artifact evaluates and is always correct, which is the whole reason
 * "an optimization and never a semantics" holds.
 */
export function ProduceArtifact(module: unknown): Artifact | undefined {
  const record = module as { ECMAScriptCode?: unknown };
  const code = record?.ECMAScriptCode;
  if (!code) {
    return undefined;
  }
  // The PUBLIC surface is the module's export entries, not every top-level
  // binding. `ExportedTypesOf` returns the latter - its map is built from the
  // check session's whole frame - so building an artifact from it would carry a
  // module's private types into what it publishes.
  //
  // A type declaration creates an ordinary binding holding a Type Object, which
  // is what makes this an intersection rather than a separate channel: a name is
  // exported or it is not, and its binding holds a type or it does not.
  // BOTH maps, because a type reaches a module's surface two ways. `aliases`
  // holds what a name IS as a type - `type P = ...`, and a generic alias. A
  // CLASS is not there: its binding is the constructor, and the constructor IS
  // the type, so it comes from `bindings`. Asking one map would publish half a
  // surface.
  const aliases = ExportedAliasesOf((record as { HostDefined?: { specifier?: string } }).HostDefined?.specifier);
  const bindings = ExportedTypesOf(code as never);
  const entries = (module as { LocalExportEntries?: readonly {
    LocalName?: { stringValue?(): string }, ExportName?: { stringValue?(): string },
  }[] }).LocalExportEntries ?? [];
  const roots = new Map<string, object>();
  for (const entry of entries) {
    const local = entry.LocalName?.stringValue?.();
    const exportedAs = entry.ExportName?.stringValue?.();
    if (!local || !exportedAs) {
      continue;
    }
    const bound = aliases?.get(local) ?? bindings?.get(local);
    if (bound && typeof bound === 'object') {
      roots.set(exportedAs, bound as object);
    }
  }
  if (roots.size === 0) {
    // Nothing to precompute. An empty artifact is worse than none: a consumer
    // would verify a hash and read nothing.
    return undefined;
  }
  // `SerializeTypeTable` throws for a leaf the format cannot carry - a symbol -
  // and that is left to propagate. It names the leaf, and an author who wrote one
  // into a public surface needs to know rather than to receive nothing silently.
  const table = SerializeTypeTable(roots);
  const graph = ModuleGraphInventory(module);
  return {
    table,
    graph,
    semantics: SEMANTICS_ID,
    key: GraphKey(graph),
  };
}

/**
 * Read an artifact: the consumer #sec-expansion-artifact describes.
 *
 *   "A consumer verifies the hash and reads the types out of it rather than
 *   evaluating them; on a mismatch it evaluates, and determinism is what makes
 *   the two agree."
 *
 * Returns the exported types by name, or *undefined* where the artifact cannot
 * be read - a version this reader does not know, a key that does not match the
 * graph the artifact carries, a semantics identifier it does not recognize, or a
 * nominal name it cannot resolve. DECLINING rather than throwing is what keeps
 * "an optimization and never a semantics" true: a caller that gets nothing
 * evaluates, which is always correct.
 *
 * A HOST API, beside `ProduceArtifact`, rather than a reflective intrinsic. The
 * two halves of one mechanism belong in one world, and a program cannot reach
 * this at all - which is a stronger statement than nothing in the engine
 * consulting it.
 */
export function ReadArtifact(
  artifact: Artifact,
  resolveNominal: (name: { name?: string, source?: string }) => object | undefined,
): Map<string, unknown> | undefined {
  if (artifact.semantics !== SEMANTICS_ID) {
    // Types computed under other rules. The graph could be identical, so the key
    // cannot catch this and the format version does not either: that says how the
    // bytes are laid out, not what the types mean.
    return undefined;
  }
  if (artifact.key !== GraphKey(artifact.graph)) {
    // The artifact does not describe the graph it carries. Nothing here can be
    // trusted, including the graph, so there is nothing to compare against a
    // caller's own sources.
    return undefined;
  }
  return DeserializeTypeTable(artifact.table, resolveNominal);
}
