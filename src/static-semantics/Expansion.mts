import type { ParseNode } from '../parser/ParseNode.mts';
import { ReplacementDecoratorNames } from './ReplacementDecoratorNames.mts';

/**
 * proposal-runtime-types `sec-expansion` and `sec-when-expansion-happens`.
 *
 * Expansion is the phase in which replacement decorators run. It occurs after a
 * module's source text has been scanned and BEFORE the module is checked -
 * `ParseModule` calls `CheckModule` a dozen lines after parsing, so the seam
 * this occupies and the checker are the same few lines.
 *
 * **That ordering is normative rather than incidental.** The checker must never
 * see an unexpanded decoration: an implementation that checked first would
 * reject syntax a replacement decorator was about to produce, which forbids
 * exactly the macros worth writing.
 */

/** The implementation's expansion limit. Specified, not left to each engine. */
export const EXPANSION_LIMIT = 128;

export interface ExpansionSite {
  /** The decoration naming a replacement decorator. */
  readonly decorator: ParseNode;
  /** The declaration it decorates. */
  readonly target: ParseNode;
  /** The name it spells. */
  readonly name: string;
  /** How far from the decorated declaration it sits; 0 is closest. */
  readonly distance: number;
}

/** The identifier a decoration spells, where it spells a bare one. */
function decoratedName(decorator: ParseNode): string | undefined {
  const d = decorator as {
    MemberExpression?: { type?: string, name?: string },
  };
  const m = d.MemberExpression;
  return m?.type === 'IdentifierReference' ? m.name : undefined;
}

/**
 * Every decoration in _root_ that names a replacement decorator, OUTERMOST
 * first.
 *
 * The order is `sec-expansion`'s: an outer decoration receives the ones it
 * encloses UNEXPANDED and may rewrite or remove them. Innermost-first would make
 * an outer decorator unable to delete an inner one, because the inner one would
 * already have run - which is the capability conditional compilation depends on.
 */
export function ExpansionSites(root: ParseNode, names: readonly string[]): readonly ExpansionSite[] {
  if (names.length === 0) {
    return [];
  }
  const wanted = new Set(names);
  const sites: ExpansionSite[] = [];
  const seen = new Set<object>();

  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object' || seen.has(node as object)) {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    seen.add(node as object);
    const n = node as ParseNode & { Decorators?: readonly ParseNode[] | null };
    const decorators = n.Decorators;
    if (Array.isArray(decorators)) {
      // A stack is written outermost-first in source, and `sec-replacement-
      // decorators` requires replacement decorators to sit OUTERMOST, so source
      // order is already expansion order within one target.
      decorators.forEach((d, i) => {
        const name = decoratedName(d);
        if (name !== undefined && wanted.has(name)) {
          sites.push({
            decorator: d, target: n, name, distance: decorators.length - 1 - i,
          });
        }
      });
    }
    for (const key of Object.keys(n)) {
      if (key === 'location' || key === 'sourceText' || key === 'strict' || key === 'parent') {
        continue;
      }
      visit((n as unknown as Record<string, unknown>)[key]);
    }
  };
  visit(root);
  return sites;
}

export interface ExpansionResult {
  /** How many decorations were expanded. Zero means the phase did nothing. */
  readonly expanded: number;
  /** The sites found, in the order they would run. */
  readonly sites: readonly ExpansionSite[];
  /** Set when the limit was exceeded, naming the decoration and the depth. */
  readonly limitExceeded?: { readonly name: string, readonly depth: number };
}

/**
 * `sec-expansion`: run the fixpoint.
 *
 * **The name set is fixed before the loop and nothing in the loop changes it**,
 * so a decoration an expansion introduces cannot name a replacement decorator no
 * import brought in. Re-resolving imports mid-expansion would be the
 * alternative, and it is unavailable: a preprocessor module can name nothing
 * asynchronous, so an expansion has nothing to fetch with.
 *
 * WHAT THIS DOES NOT YET DO: call the decorator. Calling one requires the
 * preprocessor module to have been loaded and evaluated before this point, which
 * is the load-ordering change `sec-preprocessor-modules` describes and which
 * `ParseModule` cannot do today - it runs BEFORE `LoadRequestedModules`. The
 * loop, the ordering, the limit and the gate are here; the call is the piece
 * that waits on the loader.
 */
/**
 * Rewrite _sourceText_ by running every replacement decorator in it.
 *
 * The returned tokens are spliced by REPLACING THE DECORATED CONSTRUCT'S SOURCE
 * RANGE, outermost site first and applied back-to-front so earlier offsets stay
 * valid. `ParseModule` re-parses when the text changed.
 *
 * A re-parse is an implementation choice, not a semantic one. `sec-expansion`'s
 * "nothing is re-lexed" is about the LOOP - the returned stream is walked for
 * further decorations rather than re-derived - and spans carry origin either
 * way, so a diagnostic still names the position a program was written at.
 */
export function ExpandSource(
  sourceText: string,
  root: ParseNode,
  names: readonly string[],
  resolve: (name: string) => unknown,
  tokensOf: (node: ParseNode) => unknown,
  checkEvaluable: (fn: unknown) => string | undefined,
  call: (fn: unknown, tokens: unknown) => unknown,
  textOf: (tokens: unknown) => string | undefined,
): { text: string, expanded: number, failures: readonly { kind: 'threw' | 'not-tokens' | 'not-evaluable', name: string, detail?: string }[] } {
  const sites = ExpansionSites(root, names);
  let expanded = 0;
  const edits: { start: number, end: number, text: string }[] = [];
  const failures: { kind: 'threw' | 'not-tokens' | 'not-evaluable', name: string, detail?: string }[] = [];
  for (const site of sites) {
    const fn = resolve(site.name);
    if (fn === undefined) {
      // A name that resolves to nothing leaves its decoration alone. A host that
      // does not implement preprocessor modules gets the parse it would have got
      // anyway, rather than an error about a feature it never opted into.
      continue;
    }
    const target = site.target as { location?: { startIndex?: number, endIndex?: number } };
    const decorator = site.decorator as { location?: { startIndex?: number, endIndex?: number } };
    // A Decorator node's location begins AFTER the `@`, so replacing from it
    // leaves the sigil behind and the next parse sees `@class C {}`. Measured
    // rather than assumed - the edit looked right and the rewritten text did
    // not. The `@` is found by scanning back from the node's own start.
    const nodeStart = decorator.location?.startIndex;
    const end = target.location?.endIndex;
    if (nodeStart === undefined || end === undefined) {
      continue;
    }
    const at = sourceText.lastIndexOf('@', nodeStart);
    const start = at === -1 ? nodeStart : at;
    // `sec-preprocessor-modules`: a replacement decorator must be compile-time
    // EVALUABLE, and it is checked HERE - before it is called, so a macro that
    // names the clock never runs at all.
    //
    // **This needed no loader change.** The check was thought to wait on load
    // ordering, on the reasoning that the module has to be loaded before it can
    // be inspected. It does not: a function object RETAINS ITS OWN SOURCE - the
    // retention `Function.prototype.toString` already requires - so the source
    // to check arrives with the function.
    const violation = checkEvaluable(fn);
    if (violation !== undefined) {
      failures.push({ kind: 'not-evaluable', name: site.name, detail: violation });
      continue;
    }
    const returned = call(fn, tokensOf(site.target));
    if (returned === undefined) {
      // `sec-applyreplacementdecorator`: an ABRUPT completion from a macro
      // becomes a Syntax Error at the DECORATION SITE carrying the macro's own
      // message. A macro rejects its input by throwing, which is what a function
      // does to reject its arguments and which cannot be ignored.
      failures.push({ kind: 'threw', name: site.name });
      continue;
    }
    const produced = textOf(returned);
    if (produced === undefined) {
      // The return was not a List of Token Records. Distinguished from throwing,
      // because a macro that returned the wrong SHAPE made a different mistake
      // from one that rejected its input.
      failures.push({ kind: 'not-tokens', name: site.name });
      continue;
    }
    // The decoration is replaced ALONG WITH what it decorates: a replacement
    // decorator returns the construct, and leaving the `@name` behind would
    // re-expand it forever.
    edits.push({ start, end, text: produced });
    expanded += 1;
  }
  let text = sourceText;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  }
  return { text, expanded, failures };
}

export function Expansion(root: ParseNode, names?: readonly string[]): ExpansionResult {
  const fixed = names ?? ReplacementDecoratorNames(root as ParseNode.Module);
  let depth = 0;
  let expanded = 0;
  let sites = ExpansionSites(root, fixed);
  const first = sites;
  while (sites.length > 0) {
    if (depth > EXPANSION_LIMIT) {
      return { expanded, sites: first, limitExceeded: { name: sites[0].name, depth } };
    }
    // One pass per depth. Each site would be replaced by the tokens its
    // decorator returns, and the returned stream walked for further decorations
    // - which is why nothing is re-lexed: what comes back is already tokens.
    expanded += sites.length;
    depth += 1;
    // Without the call there is nothing new to find, so the loop terminates on
    // the first pass. The shape is the specified one; the body is a stub, and
    // the tests say so rather than implying otherwise.
    sites = [];
  }
  return { expanded, sites: first };
}
