import type { GraphEntry } from './module-graph.mts';
import { TypeOrigins, type TypeOrigin } from './provenance.mts';

/**
 * proposal-runtime-types #sec-expansion-artifact: "The artifact also carries the
 * extracted documentation for the origins of #sec-provenance, since a
 * dependency's sources are exactly what a consumer does not have on disk, which
 * is the one thing provenance alone cannot supply."
 *
 * An origin says WHERE a type was written. On a published dependency that points
 * at a file the consumer does not have, so the text has to travel with the
 * artifact or the origin is a reference to nothing.
 *
 * Three decisions, each recorded before this was built:
 *
 *   - RAW text, not a structured subset. A consumer that cannot parse a comment
 *     shows nothing and is still correct, which is what an artifact that is "an
 *     optimization and never a semantics" requires. Parsing it here would make
 *     every consumer inherit one parser's idea of what a doc comment is.
 *   - EVERY origin's text, not the first. Choosing the first declared is the
 *     load-order crowning that kept documentation out of the node model in the
 *     first place; a tool has the context to choose and this does not.
 *   - Keyed in an ARTIFACT-LOCAL table, not by path, so it cannot go stale
 *     relative to the key the artifact contract already checks.
 */

export interface OriginDocumentation {
  /** The module the text was written in. */
  readonly source: string;
  /** Where the declaration begins, which is what the origin records. */
  readonly startIndex: number;
  /** The comment written above it, raw and unparsed. */
  readonly text: string;
}

/**
 * The comment immediately above `startIndex`, or *undefined* where there is
 * none.
 *
 * Scans back over whitespace and takes whatever comment run ends there: a block
 * comment, or a run of consecutive line comments. What it takes is the text as
 * written, delimiters included, because deciding which parts of a comment are
 * documentation is the consumer's business and not this one's.
 */
function commentAbove(source: string, startIndex: number): string | undefined {
  let end = startIndex;
  while (end > 0 && /\s/.test(source[end - 1]!)) {
    end -= 1;
  }
  if (end === 0) {
    return undefined;
  }
  if (source.startsWith('*/', end - 2)) {
    const open = source.lastIndexOf('/*', end - 2);
    return open < 0 ? undefined : source.slice(open, end);
  }
  // A run of line comments, taken upwards while each line begins one.
  let lineStart = source.lastIndexOf('\n', end - 1) + 1;
  if (!source.startsWith('//', skipBlanks(source, lineStart))) {
    return undefined;
  }
  let first = lineStart;
  while (first > 0) {
    const previous = source.lastIndexOf('\n', first - 2) + 1;
    if (!source.startsWith('//', skipBlanks(source, previous))) {
      break;
    }
    first = previous;
  }
  return source.slice(skipBlanks(source, first), end);
}

function skipBlanks(source: string, from: number): number {
  let i = from;
  while (i < source.length && (source[i] === ' ' || source[i] === '\t')) {
    i += 1;
  }
  return i;
}

/**
 * The documentation for one type: every origin it has, with the text written
 * above each.
 *
 * An origin whose module is not in the graph, or which has no comment above it,
 * contributes nothing rather than an empty string - there is a difference
 * between "documented as nothing" and "not documented", and only the second is
 * true here.
 */
export function DocumentationFor(
  typeObject: object,
  graph: readonly GraphEntry[],
): OriginDocumentation[] {
  const sources = new Map(graph.map((entry) => [entry.specifier, entry.source]));
  const out: OriginDocumentation[] = [];
  for (const origin of TypeOrigins(typeObject) as readonly TypeOrigin[]) {
    if (origin.source === undefined) {
      continue;
    }
    const source = sources.get(origin.source);
    if (source === undefined) {
      continue;
    }
    const text = commentAbove(source, origin.startIndex);
    if (text !== undefined) {
      out.push({ source: origin.source, startIndex: origin.startIndex, text });
    }
  }
  return out;
}
