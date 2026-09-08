import { RegExpParser } from '../parser/RegExpParser.mts';

/**
 * proposal-runtime-types #sec-metadata, the tier test for R18's decision
 * procedure:
 *
 *   "pattern pairs free of backreferences and lookaround, within a fixed
 *   automaton size, get the exact language-inclusion answer, and pairs beyond
 *   the bound get the syntactic one. The tier is decided by syntactic size and
 *   never by remaining fuel, so the judgment is identical on every host."
 *
 * This module answers the first half - whether a pattern is in the REGULAR
 * fragment - and measures the second, the syntactic size. Both are computed from
 * the pattern text alone, which is what makes the tier host-independent: an
 * implementation that decided the tier by how much budget was left would have two
 * hosts disagreeing about whether one pattern type is a subtype of another, and
 * that is a question about types rather than about resources.
 *
 * Backreferences and lookaround are excluded because neither is regular. A
 * backreference makes the language non-regular outright; lookaround keeps it
 * regular in principle but not under the construction this procedure uses, and
 * the clause names both rather than leaving an implementation to decide.
 */

/** What put a pattern outside the fragment, for a caller that wants to say. */
export type OutsideFragment = 'a backreference' | 'lookaround' | 'an unparseable pattern';

interface FragmentReport {
  /** *undefined* when the pattern is within the regular fragment. */
  readonly outside: OutsideFragment | undefined;
  /**
   * The node count under Thompson's construction - literals, classes,
   * quantifiers, alternations and groups. It bounds the NFA, and it is syntax,
   * so it is the same number on every host.
   */
  readonly size: number;
}

function parsePattern(source: string, flags: string): object | undefined {
  try {
    const parser = new RegExpParser(source, () => {});
    const context = {
      UnicodeMode: flags.includes('u') || flags.includes('v'),
      UnicodeSetsMode: flags.includes('v'),
      NamedCaptureGroups: true,
    };
    return parser.scope(context as never, () => parser.parsePattern()) as unknown as object;
  } catch {
    // A pattern the engine already accepted should parse, but a caller must not
    // be handed an exception from a subtype question: an unparseable pattern is
    // simply outside the fragment and takes the syntactic answer.
    return undefined;
  }
}

const LOOKAROUND = new Set(['?=', '?!', '?<=', '?<!']);
const BACKREFERENCE = new Set(['DecimalEscape', 'CaptureGroupName']);

/**
 * Whether `source` is within the regular fragment, and how large it is.
 */
export function InspectPattern(source: string, flags: string): FragmentReport {
  const root = parsePattern(source, flags);
  if (root === undefined) {
    return { outside: 'an unparseable pattern', size: 0 };
  }
  let outside: OutsideFragment | undefined;
  let size = 0;
  const seen = new Set<object>();
  const walk = (node: unknown): void => {
    if (outside !== undefined || !node || typeof node !== 'object' || seen.has(node as object)) {
      return;
    }
    seen.add(node as object);
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const record = node as { type?: string, production?: string };
    if (record.type === 'Assertion' && typeof record.production === 'string'
        && LOOKAROUND.has(record.production)) {
      outside = 'lookaround';
      return;
    }
    if (record.type === 'AtomEscape' && BACKREFERENCE.has(record.production ?? '')) {
      // AtomEscape :: DecimalEscape is `\\1`, and AtomEscape :: `k` GroupName is
      // `\\k<name>` - the two spellings of a backreference, told apart by
      // `production` rather than by which field is present.
      outside = 'a backreference';
      return;
    }
    if (typeof record.type === 'string') {
      size += 1;
    }
    for (const [key, child] of Object.entries(record)) {
      if (key === 'location' || key === 'parent') {
        continue;
      }
      walk(child);
    }
  };
  walk(root);
  return { outside, size };
}
