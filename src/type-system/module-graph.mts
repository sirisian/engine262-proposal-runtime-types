/**
 * proposal-runtime-types #sec-expansion-artifact: an artifact is "keyed by a hash
 * of the module graph that produced it", and "a mismatch re-derives".
 *
 * The clause deliberately does not fix HOW the hash is computed - that is one of
 * the three things it names as unfixed, beside what carries the bytes and how a
 * producer finds a graph. So this does not hash. It produces the INVENTORY a hash
 * is taken over, and leaves the algorithm to whoever writes the artifact: an
 * engine that picked SHA-256 would be fixing by implementation exactly what the
 * clause declines to fix.
 *
 * What the inventory must contain is not open, though, and is the part worth
 * getting right. It covers everything that could change a computed type and
 * nothing else:
 *
 *   - the SOURCE TEXT of every module in the graph, transitively, because a type
 *     is computed from it; and
 *   - the SPECIFIER each was reached by, because a rename that resolves elsewhere
 *     changes the graph even when both files are byte-identical.
 *
 * It excludes what a build machine varies - timestamps, absolute paths, the order
 * modules happened to load. A hash over those would change when the types did
 * not, and a key that over-triggers is not unsafe but is useless: every consumer
 * re-derives every time and the artifact is dead weight.
 *
 * The order is CANONICAL, by specifier, for the same reason the artifact table is
 * ordered canonically: a graph reached in a different order is the same graph, and
 * two producers over it must agree or the key means nothing.
 */

interface ModuleLike {
  readonly LoadedModules?: readonly { readonly Specifier: string, readonly Module: unknown }[];
  readonly HostDefined?: { readonly specifier?: unknown };
  readonly ECMAScriptCode?: { readonly sourceText?: unknown };
}

export interface GraphEntry {
  /** The specifier this module was reached by, or the host's name for the root. */
  readonly specifier: string;
  /** The module's source text, which is what a type is computed from. */
  readonly source: string;
}

/**
 * Every module reachable from `root`, once each, ordered by specifier.
 *
 * A cycle is ordinary in a module graph, so a module already seen is not walked
 * again - which is also what makes the inventory finite.
 */
export function ModuleGraphInventory(root: unknown): GraphEntry[] {
  const seen = new Set<unknown>();
  const entries = new Map<string, GraphEntry>();

  const walk = (module: unknown, reachedBy: string | undefined): void => {
    if (!module || typeof module !== 'object' || seen.has(module)) {
      return;
    }
    seen.add(module);
    const record = module as ModuleLike;
    const own = record.HostDefined?.specifier;
    const specifier = reachedBy ?? (typeof own === 'string' ? own : undefined);
    const source = record.ECMAScriptCode?.sourceText;
    if (typeof specifier === 'string' && typeof source === 'string') {
      // Keyed by specifier: one module reached twice by one name is one entry,
      // and a module reached by two names is two, which is what a rename has to
      // change.
      entries.set(specifier, { specifier, source });
    }
    for (const request of record.LoadedModules ?? []) {
      walk(request.Module, request.Specifier);
    }
  };

  walk(root, undefined);
  return [...entries.values()].sort((a, b) => (a.specifier < b.specifier ? -1 : a.specifier > b.specifier ? 1 : 0));
}
