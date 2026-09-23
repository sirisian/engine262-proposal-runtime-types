/**
 * proposal-runtime-types, plan phase 4: choosing among specializations, and
 * assembling a callable's overload contracts (plan section 3.8, D1).
 *
 * Like the matcher it builds on (specialization-patterns.mts), this module is
 * pure over a host: the checker, where arguments are static, and the run time,
 * where they are bound, will both call it, and neither keeps its own copy of
 * the rules. What it decides by itself is everything the patterns decide:
 *
 * - SPECIFICITY (section 6.1): whether every application one list matches is
 *   matched by another, over the finite facts the plan names - fixed slots,
 *   matching constructors, wildcard and capture positions, repeated-binding
 *   equalities, and bounds whose inclusion the host's decidable relations
 *   establish. Alpha-renaming a capture changes nothing.
 * - SELECTION: the unique most specific applicable case, or none, or an
 *   ambiguity naming the incomparable survivors. Declaration order never
 *   decides.
 * - CALLABLE GROUPS (section 3.8): owners, attachment of pattern-only cases to
 *   the unique accepting owner, standalone cases, and the declaration errors
 *   those rules imply.
 */

import type { ParseNode } from '../parser/ParseNode.mts';
import {
  MatchSpecializationList, SpecializationPatternsOf, ValidateSpecializationList, SpecializationPatternError,
  type CaptureBindingRecord, type PatternSlotParameter, type SpecializationMatchHost, type SpecializationDiagnostic,
  type NestedConstructor,
} from './specialization-patterns.mts';
import { assignTypeArguments, typeArgumentNameOf } from './type-argument-order.mts';

/** What specificity needs of a host beyond matching. */
export interface SpecificityHost<S> extends SpecializationMatchHost<S> {
  /**
   * Whether every value satisfying _narrow_ satisfies _wide_, by the existing
   * decidable relations only; *false* where inclusion is not established.
   */
  boundIncludes(wide: ParseNode.Type, narrow: ParseNode.Type): boolean;
}

// ---------------------------------------------------------------------------
// Terms: a pattern position as specificity sees it.

type Term<S> =
  | { readonly t: 'wild' }
  | { readonly t: 'capture', readonly name: string, readonly bound: ParseNode.Type | null }
  | { readonly t: 'fixed', readonly value: S }
  | { readonly t: 'app', readonly ctor: string, readonly constructor: NestedConstructor<S>, readonly slots: readonly Slot<S>[] }
  | { readonly t: 'array', readonly extent: Term<S> | 'dynamic', readonly element: Term<S> }
  | { readonly t: 'seq', readonly items: readonly Item<S>[] }
  | { readonly t: 'computed', readonly node: ParseNode };

/** A parameter's run: one term, or a sequence for a variadic parameter. */
type Slot<S> = { readonly one: Term<S> } | { readonly run: readonly Item<S>[] };

interface Item<S> {
  readonly term: Term<S>;
  readonly spread: boolean;
}

function bareName(node: ParseNode): string | undefined {
  if (node.type === 'TypeReference' && node.TypeArguments === null && node.TypeName.MemberNames.length === 0) {
    return node.TypeName.IdentifierReference.name;
  }
  if (node.type === 'IdentifierReference') {
    return node.name;
  }
  return undefined;
}

function isSpread(node: ParseNode): boolean {
  return (node as { IsSpread?: boolean }).IsSpread === true || (node.type === 'CaptureBinding' && node.IsVariadic);
}

class TermBuilder<S> {
  private readonly captures: ReadonlyMap<string, ParseNode.CaptureBinding>;

  constructor(private readonly host: SpecificityHost<S>, list: ParseNode.TypeParameters) {
    this.captures = new Map((list.Captures ?? []).map((c) => [c.BindingIdentifier.name, c]));
  }

  private capture(name: string): Term<S> {
    return { t: 'capture', name, bound: this.captures.get(name)?.TypeParameterConstraint ?? null };
  }

  mentions(node: unknown): boolean {
    if (!node || typeof node !== 'object') {
      return false;
    }
    if (Array.isArray(node)) {
      return node.some((n) => this.mentions(n));
    }
    const n = node as ParseNode;
    if ((n as { type?: string }).type === 'TypeParameters') {
      return false;
    }
    if (n.type === 'CaptureBinding') {
      return true;
    }
    const name = typeof n.type === 'string' ? bareName(n) : undefined;
    if (name !== undefined && (name === '_' || this.captures.has(name))) {
      return true;
    }
    return Object.keys(n).some((k) => k !== 'parent' && k !== 'location' && k !== 'sourceText' && this.mentions((n as unknown as Record<string, unknown>)[k]));
  }

  term(node: ParseNode): Term<S> {
    const name = bareName(node);
    if (name === '_' && node.type === 'TypeReference') {
      return { t: 'wild' };
    }
    if (node.type === 'CaptureBinding') {
      return this.capture(node.BindingIdentifier.name);
    }
    if (name !== undefined && this.captures.has(name)) {
      return this.capture(name);
    }
    if (node.type === 'TypeReference' && node.TypeArguments && this.mentions(node.TypeArguments)) {
      const constructor = this.host.constructorOf(node.TypeName);
      if (!constructor) {
        throw new SpecializationPatternError('no-component', `\`${node.TypeName.sourceText}\` names no constructor`, node);
      }
      const items = node.TypeArguments.TypeArgumentList as unknown as ParseNode[];
      return {
        t: 'app', ctor: constructor.Name, constructor, slots: this.slots(constructor.Parameters, items, items.map(typeArgumentNameOf), (q) => constructor.defaultOf(q, [])),
      };
    }
    if (node.type === 'ArrayType' && this.mentions([node.ArrayExtent, node.TypeArguments])) {
      const element = node.TypeArguments?.TypeArgumentList[0] as unknown as ParseNode | undefined;
      return {
        t: 'array',
        extent: node.ArrayExtent === null ? 'dynamic' : this.term(node.ArrayExtent as unknown as ParseNode),
        element: element ? this.term(element) : { t: 'wild' },
      };
    }
    if (node.type === 'TupleType' && this.mentions(node.TupleElementList)) {
      return { t: 'seq', items: node.TupleElementList.map((e) => ({ term: this.term(e.Type as unknown as ParseNode), spread: e.Rest })) };
    }
    if (this.mentions(node)) {
      return { t: 'computed', node };
    }
    return { t: 'fixed', value: this.host.resolveFixed(node) };
  }

  slots(parameters: readonly PatternSlotParameter<S>[], items: readonly ParseNode[], names: readonly (string | undefined)[], defaults?: (q: number) => S | undefined): Slot<S>[] {
    const assigned = assignTypeArguments(parameters, items, names, () => true);
    if (!assigned.ok) {
      throw new SpecializationPatternError(assigned.kind, 'the pattern cannot be assigned to the parameters', items[0]);
    }
    return assigned.runs.map((run, q): Slot<S> => {
      if (parameters[q].Variadic) {
        return { run: run.map((n) => ({ term: this.term(n), spread: isSpread(n) })) };
      }
      if (run.length === 0) {
        const fallback = defaults?.(q);
        // An omitted slot stands for the default: a fixed fact, never a wildcard.
        return { one: fallback === undefined ? { t: 'wild' } : { t: 'fixed', value: fallback } };
      }
      return { one: this.term(run[0]) };
    });
  }
}

// ---------------------------------------------------------------------------
// Inclusion: does `general` match every application `specific` matches?

class Inclusion<S> {
  /** What each capture of the general list stands for in the specific one. */
  private readonly mapping = new Map<string, Term<S> | readonly Item<S>[]>();

  constructor(private readonly host: SpecificityHost<S>) {}

  private sameTerm(a: Term<S>, b: Term<S>): boolean {
    if (a.t !== b.t) {
      return false;
    }
    switch (a.t) {
      case 'wild': return false; // two wildcards need not agree
      case 'capture': return a.name === (b as typeof a).name;
      case 'fixed': return this.host.sameArgument(a.value, (b as typeof a).value);
      default: return false; // a repeated structure is not a finite fact
    }
  }

  term(general: Term<S>, specific: Term<S>): boolean {
    switch (general.t) {
      case 'wild':
        return true;
      case 'capture': {
        const seen = this.mapping.get(general.name);
        if (seen !== undefined) {
          // A repeated general capture is an equality the specific list must
          // guarantee: the same capture, or the same fixed argument.
          return !Array.isArray(seen) && this.sameTerm(seen as Term<S>, specific);
        }
        if (general.bound) {
          if (specific.t === 'fixed') {
            if (!this.host.satisfiesBound(specific.value, general.bound, new Map())) {
              return false;
            }
          } else if (specific.t !== 'capture' || !specific.bound || !this.host.boundIncludes(general.bound, specific.bound)) {
            return false;
          }
        }
        this.mapping.set(general.name, specific);
        return true;
      }
      case 'fixed':
        return specific.t === 'fixed' && this.host.sameArgument(specific.value, general.value);
      case 'app': {
        // A fixed application is compared by its arguments, as the matcher
        // compares a subject's.
        const other = specific.t === 'fixed' ? this.decompose(general.constructor, specific.value) : specific;
        return other !== null && other.t === 'app' && other.ctor === general.ctor
          && general.slots.every((slot, q) => this.slot(slot, other.slots[q]));
      }
      case 'array': {
        const parts = specific.t === 'fixed' ? this.host.arrayOf(specific.value) : null;
        const other: Term<S> | null = parts
          ? { t: 'array', extent: parts.Extent === 'dynamic' ? 'dynamic' : { t: 'fixed', value: parts.Extent }, element: { t: 'fixed', value: parts.Element } }
          : specific;
        return other.t === 'array'
          && (general.extent === 'dynamic' ? other.extent === 'dynamic' : other.extent !== 'dynamic' && this.term(general.extent, other.extent))
          && this.term(general.element, other.element);
      }
      case 'seq': {
        const elements = specific.t === 'fixed' ? this.host.sequenceOf(specific.value) : null;
        const other: Term<S> = elements ? { t: 'seq', items: elements.map((value) => ({ term: { t: 'fixed', value }, spread: false })) } : specific;
        return other.t === 'seq' && this.run(general.items, other.items);
      }
      case 'computed':
        // A forward computation is not among the finite facts: only the
        // identical node is known to agree.
        return specific.t === 'computed' && specific.node === general.node;
      default:
        return false;
    }
  }

  private decompose(constructor: NestedConstructor<S>, value: S): Term<S> | null {
    const args = constructor.argumentsOf(value);
    if (!args) {
      return null;
    }
    return {
      t: 'app',
      ctor: constructor.Name,
      constructor,
      slots: constructor.Parameters.map((p, q): Slot<S> => {
        if (!p.Variadic) {
          return { one: { t: 'fixed', value: args[q] } };
        }
        return { run: (this.host.sequenceOf(args[q]) ?? []).map((v) => ({ term: { t: 'fixed', value: v }, spread: false })) };
      }),
    };
  }

  slot(general: Slot<S>, specific: Slot<S> | undefined): boolean {
    if (!specific) {
      return false;
    }
    if ('one' in general) {
      return 'one' in specific && this.term(general.one, specific.one);
    }
    return 'run' in specific && this.run(general.run, specific.run);
  }

  private run(general: readonly Item<S>[], specific: readonly Item<S>[]): boolean {
    const spreadAt = general.findIndex((i) => i.spread);
    const specificSpreads = specific.filter((i) => i.spread).length;
    if (spreadAt < 0) {
      // A fixed-length general run includes only a fixed-length specific run.
      return specificSpreads === 0 && general.length === specific.length
        && general.every((g, i) => this.term(g.term, specific[i].term));
    }
    const after = general.length - spreadAt - 1;
    if (specific.length - specificSpreads < spreadAt + after && specificSpreads === 0) {
      return false;
    }
    const specificSpreadAt = specific.findIndex((i) => i.spread);
    // The ends must be fixed positions of the specific run, outside its own spread.
    if (specificSpreadAt >= 0 && (specificSpreadAt < spreadAt || specific.length - specificSpreadAt - 1 < after)) {
      return false;
    }
    for (let i = 0; i < spreadAt; i += 1) {
      if (!this.term(general[i].term, specific[i].term)) {
        return false;
      }
    }
    for (let i = 0; i < after; i += 1) {
      if (!this.term(general[spreadAt + 1 + i].term, specific[specific.length - after + i].term)) {
        return false;
      }
    }
    const middle = specific.slice(spreadAt, specific.length - after);
    const spread = general[spreadAt].term;
    if (spread.t === 'wild') {
      return true;
    }
    if (spread.t !== 'capture') {
      return false;
    }
    const seen = this.mapping.get(spread.name);
    if (seen !== undefined) {
      return Array.isArray(seen) && seen.length === middle.length && seen.every((s, i) => s.spread === middle[i].spread && this.sameTerm(s.term, middle[i].term));
    }
    this.mapping.set(spread.name, middle);
    return true;
  }
}

/** A specialization list with the primary it is read against. */
export interface SpecializationCase<S> {
  readonly List: ParseNode.TypeParameters;
  /** The declaration, reported with any diagnostic about the case. */
  readonly Declaration?: ParseNode;
  readonly Label?: string;
  readonly _slots?: Slot<S>[];
}

function slotsOf<S>(c: SpecializationCase<S>, primary: readonly PatternSlotParameter<S>[], host: SpecificityHost<S>, defaultOf?: (q: number) => S | undefined): Slot<S>[] {
  const entries = SpecializationPatternsOf(c.List);
  return new TermBuilder(host, c.List).slots(primary, entries, entries.map(() => undefined), defaultOf);
}

/**
 * Whether every application _specific_ matches is matched by _general_ (plan
 * section 6.1's finite facts).
 */
export function PatternIncludes<S>(
  general: SpecializationCase<S>,
  specific: SpecializationCase<S>,
  primary: readonly PatternSlotParameter<S>[],
  host: SpecificityHost<S>,
  defaultOf?: (q: number) => S | undefined,
): boolean {
  const g = slotsOf(general, primary, host, defaultOf);
  const s = slotsOf(specific, primary, host, defaultOf);
  const inclusion = new Inclusion(host);
  return g.every((slot, q) => inclusion.slot(slot, s[q]));
}

export type Specificity = 'more' | 'less' | 'equal' | 'incomparable';

/** How _a_ compares with _b_: `more` specific, `less`, `equal` coverage, or `incomparable`. */
export function CompareSpecificity<S>(
  a: SpecializationCase<S>,
  b: SpecializationCase<S>,
  primary: readonly PatternSlotParameter<S>[],
  host: SpecificityHost<S>,
  defaultOf?: (q: number) => S | undefined,
): Specificity {
  const aInB = PatternIncludes(b, a, primary, host, defaultOf);
  const bInA = PatternIncludes(a, b, primary, host, defaultOf);
  if (aInB && bInA) {
    return 'equal';
  }
  if (aInB) {
    return 'more';
  }
  return bInA ? 'less' : 'incomparable';
}

export type SelectionResult<S> =
  | { readonly Kind: 'selected', readonly Case: SpecializationCase<S>, readonly Bindings: CaptureBindingRecord<S>[] }
  | { readonly Kind: 'none' }
  | { readonly Kind: 'ambiguous', readonly Cases: readonly SpecializationCase<S>[] };

/**
 * Plan section 6.1 step 5: the unique most specific applicable case. A case
 * is chosen only when it is at least as specific as every other applicable
 * case; otherwise the maximal survivors are reported, so declaration order
 * never decides.
 */
export function SelectSpecialization<S>(
  cases: readonly SpecializationCase<S>[],
  primary: readonly PatternSlotParameter<S>[],
  bindings: readonly S[],
  host: SpecificityHost<S>,
  defaultOf?: (q: number, bindings: readonly S[]) => S | undefined,
): SelectionResult<S> {
  const applicable: { c: SpecializationCase<S>, b: CaptureBindingRecord<S>[] }[] = [];
  for (const c of cases) {
    const matched = MatchSpecializationList(c.List, primary, bindings, host, defaultOf);
    if (matched !== 'no-match') {
      applicable.push({ c, b: matched });
    }
  }
  if (applicable.length === 0) {
    return { Kind: 'none' };
  }
  const defaults = defaultOf ? (q: number) => defaultOf(q, bindings) : undefined;
  const winner = applicable.find((x) => applicable.every((y) => x === y || CompareSpecificity(x.c, y.c, primary, host, defaults) === 'more'));
  if (winner) {
    return { Kind: 'selected', Case: winner.c, Bindings: winner.b };
  }
  const maximal = applicable.filter((x) => !applicable.some((y) => x !== y && CompareSpecificity(y.c, x.c, primary, host, defaults) === 'more'));
  return { Kind: 'ambiguous', Cases: maximal.map((x) => x.c) };
}

/**
 * Duplicate cases: two lists of equal coverage, by any capture names. A
 * replacement identical in coverage to another is a duplicate rather than a
 * fallback (plan section 6.1).
 */
export function FindDuplicateCases<S>(
  cases: readonly SpecializationCase<S>[],
  primary: readonly PatternSlotParameter<S>[],
  host: SpecificityHost<S>,
  defaultOf?: (q: number) => S | undefined,
): [SpecializationCase<S>, SpecializationCase<S>][] {
  const out: [SpecializationCase<S>, SpecializationCase<S>][] = [];
  for (let i = 0; i < cases.length; i += 1) {
    for (let j = i + 1; j < cases.length; j += 1) {
      if (CompareSpecificity(cases[i], cases[j], primary, host, defaultOf) === 'equal') {
        out.push([cases[i], cases[j]]);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Callable groups (plan section 3.8).

/** One declaration of a callable group: a function, method, or operator of one name. */
export interface CallableDeclaration<S> {
  readonly Node: ParseNode;
  readonly List: ParseNode.TypeParameters | null;
  readonly Label: string;
  /** The owner's parameters as slots, for a declaration whose list declares only parameters. */
  readonly Parameters?: readonly PatternSlotParameter<S>[];
}

export interface CallableGroupHost<S> extends SpecificityHost<S> {
  /**
   * Whether a FIXED entry of a case may stand in _parameter_: the same kind,
   * and within its domain and bound (plan phase 4, cycle 3: an owner accepts
   * only a case whose applications its contract admits).
   */
  admits(entry: ParseNode, parameter: PatternSlotParameter<S>): boolean;
  /**
   * Whether some application of a STRUCTURAL entry - one containing a capture
   * or wildcard, `Box.<const E>` - could stand in _parameter_: at least its
   * kind. The entry is never evaluated.
   */
  admitsStructure(entry: ParseNode, parameter: PatternSlotParameter<S>): boolean;
}

export interface CallableGroup<S> {
  readonly Owners: readonly CallableDeclaration<S>[];
  /** Each attached pattern-only case, with the owner it attached to. */
  readonly Attached: readonly { readonly Case: CallableDeclaration<S>, readonly Owner: CallableDeclaration<S> }[];
  /** Pattern-only cases no owner accepts, and mixed lists, which never attach. */
  readonly Standalone: readonly CallableDeclaration<S>[];
  readonly Diagnostics: readonly SpecializationDiagnostic[];
}

function accepts<S>(owner: CallableDeclaration<S>, list: ParseNode.TypeParameters, host: CallableGroupHost<S>): boolean {
  const terms = new TermBuilder(host, list);
  const parameters = owner.Parameters ?? [];
  const entries = SpecializationPatternsOf(list);
  const assigned = assignTypeArguments(parameters, entries, entries.map(() => undefined), () => true);
  if (!assigned.ok) {
    return false;
  }
  return assigned.runs.every((run, q) => run.every((entry) => {
    // A capture or wildcard takes its slot's domain (D4), so it fits any slot;
    // a nested application fits where its constructor's result could.
    if (entry.type === 'CaptureBinding' || bareName(entry) === '_') {
      return true;
    }
    return terms.mentions(entry) ? host.admitsStructure(entry, parameters[q]) : host.admits(entry, parameters[q]);
  }));
}

/**
 * Plan section 3.8, for the declarations of one name in one declaration
 * group. Owners are the declarations whose lists declare only parameters. A
 * pattern-only case attaches to the unique owner that accepts it; two
 * accepting owners are an error naming both; none leaves it standalone. A
 * mixed list carries its own labels and never attaches.
 */
export function AnalyzeCallableGroup<S>(declarations: readonly CallableDeclaration<S>[], host: CallableGroupHost<S>, describe?: (domain: S) => string): CallableGroup<S> {
  const owners = declarations.filter((d) => d.List?.ListKind === 'parameters');
  const attached: { Case: CallableDeclaration<S>, Owner: CallableDeclaration<S> }[] = [];
  const standalone: CallableDeclaration<S>[] = [];
  const diagnostics: SpecializationDiagnostic[] = [];
  for (const d of declarations) {
    if (d.List?.ListKind === 'mixed') {
      standalone.push(d);
      diagnostics.push(...ValidateSpecializationList(d.List, host, undefined, describe));
      continue;
    }
    if (d.List?.ListKind !== 'specialization') {
      continue;
    }
    const accepting = owners.filter((o) => accepts(o, d.List!, host));
    if (accepting.length > 1) {
      diagnostics.push({
        kind: 'two-owners',
        message: `${d.Label} is accepted by two owners, ${accepting[0].Label} and ${accepting[1].Label}; give it a distinct signature or name, since no rule chooses between them`,
        node: d.Node,
      });
      continue;
    }
    if (accepting.length === 1) {
      attached.push({ Case: d, Owner: accepting[0] });
      diagnostics.push(...ValidateSpecializationList(d.List, host, accepting[0].Parameters, describe));
      continue;
    }
    standalone.push(d);
    diagnostics.push(...ValidateSpecializationList(d.List, host, undefined, describe));
    // D4: a capture's domain is inherited from its slot, and a standalone
    // case's top-level slots belong to no owner, so there is nothing to inherit.
    for (const entry of SpecializationPatternsOf(d.List)) {
      if (entry.type === 'CaptureBinding' && !entry.TypeParameterDomain) {
        const name = entry.BindingIdentifier.name;
        diagnostics.push({
          kind: 'no-slot-domain',
          message: `\`const ${name}\` stands at the top of ${d.Label}, which attaches to no owner, so its slot has no domain to inherit; write \`const ${name}: type\` or a value domain, or declare an owner`,
          node: entry,
        });
      }
    }
  }
  // Two cases of equal coverage under one owner are duplicates, whatever
  // their capture names.
  for (const owner of owners) {
    const mine = attached.filter((a) => a.Owner === owner).map((a) => ({ List: a.Case.List!, Declaration: a.Case.Node, Label: a.Case.Label }));
    for (const [a, b] of FindDuplicateCases(mine, owner.Parameters ?? [], host)) {
      diagnostics.push({ kind: 'duplicate', message: `${a.Label} and ${b.Label} specialize ${owner.Label} for the same applications`, node: b.Declaration });
    }
  }
  return { Owners: owners, Attached: attached, Standalone: standalone, Diagnostics: diagnostics };
}
