/**
 * proposal-runtime-types #sec-matching-specialization-lists: the bounded
 * structural matcher behind specialization lists, and behind the slotted form
 * of a type-subject pattern (#sec-pattern-matching), which shares it and
 * differs only in how a fixed leaf is compared (plan D5).
 *
 * The matcher is PURE over its host. Selection will run in two places - the
 * checker, where arguments are static, and the run time, where they are
 * bound - and each resolves types its own way, so neither owns the matcher and
 * neither keeps a copy of it: a rule enforced in one and not the other would
 * hold in some positions only. That is the arrangement `type-argument-order`
 * already makes for named arguments, and this module reuses its
 * `assignTypeArguments` for the positional, named, and variadic rules of
 * BindTypeArguments rather than restating them.
 *
 * What the matcher decides by itself is everything the syntax decides: which
 * nodes are captures, capture references, and the wildcard; which positions
 * are structural and which are forward computations; the order in which they
 * are checked; and that a failed match binds nothing.
 */

import type { ParseNode } from '../parser/ParseNode.mts';
import { assignTypeArguments, typeArgumentNameOf, type TypeArgumentSlotParam } from './type-argument-order.mts';

/** #sec-matchspecializationpattern: how a fixed leaf is compared. */
export type SpecializationMatchMode = 'specialization' | 'type-subject';

/** #sec-collectcaptures */
export interface CaptureRecord {
  readonly Name: string;
  readonly Declaration: ParseNode.CaptureBinding;
  readonly Variadic: boolean;
}

export interface CaptureBindingRecord<S> {
  readonly Capture: CaptureRecord;
  readonly Value: S;
}

/** A parameter of a nested constructor, or of the primary declaration. */
export interface PatternSlotParameter<S> extends TypeArgumentSlotParam {
  /** The parameter's resolved domain, where the caller knows it. */
  readonly Domain?: S;
  /** The count of `_` holes the parameter declares. */
  readonly Arity?: number;
  /** A metadata position, where a written capture domain selects the meta type. */
  readonly Metadata?: boolean;
}

/** What the matcher needs of the constructor a nested application names. */
export interface NestedConstructor<S> {
  readonly Name: string;
  readonly Parameters: readonly PatternSlotParameter<S>[];
  /**
   * The arguments _subject_ supplies, one per parameter (a variadic
   * parameter's as the sequence subject it binds), or *null* where _subject_
   * is not an application of this constructor.
   */
  argumentsOf(subject: S): readonly S[] | null;
  /** The default of parameter _q_, evaluated over the arguments before it. */
  defaultOf(q: number, args: readonly S[]): S | undefined;
}

/**
 * The relations and resolutions a caller supplies. _S_ is whatever the caller
 * binds a position to: a Type Record, or a scalar constant for a value slot.
 */
export interface SpecializationMatchHost<S> {
  /** The Type Record, or constant, a fixed |Type| or extent denotes. May throw. */
  resolveFixed(node: ParseNode): S;
  /** SameType for a type and SameValue for a value (#sec-matchspecializationpattern). */
  sameArgument(a: S, b: S): boolean;
  /** #sec-structural-matching, for a fixed leaf in ~type-subject~ mode. */
  structuralMatch(subject: S, fixed: S): boolean;
  /** The constructor a nested application names, resolved in the capture scope; *null* if it names none. */
  constructorOf(name: ParseNode.TypeName): NestedConstructor<S> | null;
  /** An array subject's extent (a constant, or ~dynamic~) and element, or *null*. */
  arrayOf(subject: S): { readonly Extent: S | 'dynamic', readonly Element: S } | null;
  /** A tuple subject's elements, or *null*. */
  sequenceOf(subject: S): readonly S[] | null;
  /** The tuple subject of _elements_, which a variadic capture binds. */
  makeSequence(elements: readonly S[]): S;
  /** The metadata of meta type _meta_ that _subject_ carries, or *null*. */
  metadataOf(subject: S, meta: ParseNode.Type): S | null;
  /** A forward computation over the captures bound so far. May throw. */
  evaluate(node: ParseNode, env: ReadonlyMap<string, S>): S;
  /** Whether _value_ satisfies the capture's written bound. May throw. */
  satisfiesBound(value: S, bound: ParseNode.Type, env: ReadonlyMap<string, S>): boolean;
}

/**
 * An error in the PATTERN rather than a failed match: an unknown or repeated
 * label, a position that exposes no component, an unusable pack boundary. It
 * is the same for every subject, so it belongs to the declaration.
 */
export class SpecializationPatternError extends Error {
  readonly kind: string;

  readonly node: ParseNode | undefined;

  constructor(kind: string, message: string, node?: ParseNode) {
    super(message);
    this.kind = kind;
    this.node = node;
  }
}

/** #sec-collectcaptures, as Capture Records. A repeated name keeps its first declaration. */
export function CaptureRecordsOf(captures: readonly ParseNode.CaptureBinding[]): CaptureRecord[] {
  const records: CaptureRecord[] = [];
  const names = new Set<string>();
  for (const c of captures) {
    const Name = c.BindingIdentifier.name;
    if (names.has(Name)) {
      continue;
    }
    names.add(Name);
    records.push({ Name, Declaration: c, Variadic: c.IsVariadic });
  }
  return records;
}

type Walkable = Record<string, unknown> & { type?: string };

function children(node: Walkable): unknown[] {
  const out: unknown[] = [];
  for (const key of Object.keys(node)) {
    if (key !== 'parent' && key !== 'location' && key !== 'sourceText') {
      out.push(node[key]);
    }
  }
  return out;
}

/** The name a bare reference reads: a one-word |TypeReference| or an |IdentifierReference|. */
function bareName(node: ParseNode | undefined): string | undefined {
  const n = node as unknown as Walkable | undefined;
  if (!n) {
    return undefined;
  }
  if (n.type === 'TypeReference') {
    const ref = n as unknown as ParseNode.TypeReference;
    if (ref.TypeArguments === null && ref.TypeName.MemberNames.length === 0) {
      return ref.TypeName.IdentifierReference.name;
    }
    return undefined;
  }
  if (n.type === 'IdentifierReference') {
    return (n as unknown as ParseNode.IdentifierReference).name;
  }
  return undefined;
}

function isSpread(node: ParseNode): boolean {
  return (node as { IsSpread?: boolean }).IsSpread === true
    || (node.type === 'CaptureBinding' && node.IsVariadic);
}

/** One argument of a pattern's run: its node, and whether it spreads a sequence. */
interface RunItem {
  readonly pattern: ParseNode;
  readonly variadic: boolean;
}

class Matcher<S> {
  readonly env = new Map<CaptureRecord, S>();

  readonly deferred: { node: ParseNode, subject: S }[] = [];

  private readonly byName: ReadonlyMap<string, CaptureRecord>;

  constructor(private readonly host: SpecializationMatchHost<S>, captures: readonly CaptureRecord[], private readonly mode: SpecializationMatchMode) {
    this.byName = new Map(captures.map((c) => [c.Name, c]));
  }

  envByName(): Map<string, S> {
    const out = new Map<string, S>();
    for (const [c, v] of this.env) {
      out.set(c.Name, v);
    }
    return out;
  }

  isWildcard(node: ParseNode): boolean {
    return bareName(node) === '_' && node.type === 'TypeReference' && !isSpread(node);
  }

  /** The Capture Record a |CaptureBinding| or capture reference stands for. */
  captureOf(node: ParseNode): CaptureRecord | undefined {
    if (node.type === 'CaptureBinding') {
      return this.byName.get(node.BindingIdentifier.name);
    }
    const name = bareName(node);
    return name === undefined ? undefined : this.byName.get(name);
  }

  /** Whether _node_ contains a capture, a capture reference, or the wildcard. */
  hasPatternPart(node: unknown): boolean {
    if (!node || typeof node !== 'object') {
      return false;
    }
    if (Array.isArray(node)) {
      return node.some((n) => this.hasPatternPart(n));
    }
    const n = node as Walkable;
    if (n.type === 'TypeParameters') {
      return false;
    }
    if (n.type === 'CaptureBinding' || (typeof n.type === 'string' && (this.captureOf(n as unknown as ParseNode) || this.isWildcard(n as unknown as ParseNode)))) {
      return true;
    }
    return children(n).some((c) => this.hasPatternPart(c));
  }

  /** #sec-matchspecializationpattern */
  match(pattern: ParseNode, subject: S, metadataSlot = false): boolean {
    const { host } = this;
    // 1. The wildcard matches anything and binds nothing.
    if (this.isWildcard(pattern)) {
      return true;
    }
    // 2. A capture binds the first time and compares every time after.
    const capture = this.captureOf(pattern);
    if (capture) {
      return this.bind(capture, pattern, subject, metadataSlot);
    }
    // 3. A nested application exposes its arguments.
    if (pattern.type === 'TypeReference' && pattern.TypeArguments && this.hasPatternPart(pattern.TypeArguments)) {
      return this.matchApplication(pattern, subject);
    }
    // 4. An array exposes its extent and element, a tuple its elements.
    if (pattern.type === 'ArrayType' && this.hasPatternPart([pattern.ArrayExtent, pattern.TypeArguments])) {
      const parts = host.arrayOf(subject);
      if (!parts) {
        return false;
      }
      // The same FORM: a pattern stating an extent matches only a fixed-extent
      // array, and `[].<E>` only a dynamic one.
      if (pattern.ArrayExtent === null) {
        if (parts.Extent !== 'dynamic') {
          return false;
        }
      } else if (parts.Extent === 'dynamic' || !this.match(pattern.ArrayExtent as unknown as ParseNode, parts.Extent)) {
        return false;
      }
      const element = pattern.TypeArguments?.TypeArgumentList[0];
      return element === undefined || this.match(element as unknown as ParseNode, parts.Element);
    }
    if (pattern.type === 'TupleType' && this.hasPatternPart(pattern.TupleElementList)) {
      const elements = host.sequenceOf(subject);
      if (!elements) {
        return false;
      }
      return this.matchSequence(pattern.TupleElementList.map((e) => ({
        pattern: e.Type as unknown as ParseNode,
        variadic: e.Rest,
      })), elements, pattern);
    }
    // 5. Anything else that reads a capture is a forward computation, checked
    //    once every structural position has bound what it reads.
    if (this.hasPatternPart(pattern)) {
      this.deferred.push({ node: pattern, subject });
      return true;
    }
    // 6. A fixed leaf: identity for a specialization, structural matching for
    //    a type-subject pattern.
    const fixed = host.resolveFixed(pattern);
    return this.mode === 'type-subject' ? host.structuralMatch(subject, fixed) : host.sameArgument(subject, fixed);
  }

  private bind(capture: CaptureRecord, pattern: ParseNode, subject: S, metadataSlot: boolean): boolean {
    const bound = this.env.get(capture);
    if (bound !== undefined) {
      return this.host.sameArgument(subject, bound);
    }
    let value = subject;
    // A written domain in a metadata position selects the meta type whose
    // metadata the capture binds, `float32.<const D: Dimensions>`.
    if (metadataSlot && pattern.type === 'CaptureBinding' && pattern.TypeParameterDomain) {
      const metadata = this.host.metadataOf(subject, pattern.TypeParameterDomain);
      if (metadata === null) {
        return false;
      }
      value = metadata;
    }
    this.env.set(capture, value);
    return true;
  }

  private matchApplication(pattern: ParseNode.TypeReference, subject: S): boolean {
    const constructor = this.host.constructorOf(pattern.TypeName);
    if (!constructor) {
      throw new SpecializationPatternError('no-component', `\`${pattern.TypeName.sourceText}\` names no constructor whose arguments a pattern can expose`, pattern);
    }
    const args = constructor.argumentsOf(subject);
    if (!args) {
      return false;
    }
    const items = pattern.TypeArguments!.TypeArgumentList as unknown as ParseNode[];
    return this.matchRuns(constructor.Parameters, items, items.map(typeArgumentNameOf), args, constructor.Name, pattern,
      (q, supplied) => constructor.defaultOf(q, supplied));
  }

  /**
   * Assigns _items_ to _parameters_ by the rules of BindTypeArguments, without
   * evaluating any, and matches each parameter's run against its argument.
   */
  matchRuns(
    parameters: readonly PatternSlotParameter<S>[],
    items: readonly ParseNode[],
    names: readonly (string | undefined)[],
    args: readonly S[],
    owner: string,
    at: ParseNode,
    defaultOf: (q: number, args: readonly S[]) => S | undefined,
  ): boolean {
    const runs = assignRuns(parameters, items, names, owner, at);
    for (let q = 0; q < parameters.length; q += 1) {
      const parameter = parameters[q];
      const run = runs[q];
      const argument = args[q];
      if (parameter.Variadic) {
        const elements = argument === undefined ? [] : this.host.sequenceOf(argument);
        if (!elements) {
          return false;
        }
        if (!this.matchSequence(run.map((pattern) => ({ pattern, variadic: isSpread(pattern) })), elements, at)) {
          return false;
        }
        continue;
      }
      if (run.length === 0) {
        // An omitted entry stands for the default, never for a wildcard.
        const fallback = defaultOf(q, args);
        if (fallback === undefined || argument === undefined || !this.host.sameArgument(argument, fallback)) {
          return false;
        }
        continue;
      }
      if (isSpread(run[0])) {
        throw new SpecializationPatternError('spread-into-scalar', `a spread cannot stand for \`${parameter.Name}\` of ${owner}, which is not variadic`, run[0]);
      }
      if (argument === undefined || !this.match(run[0], argument, parameter.Metadata === true)) {
        return false;
      }
    }
    return true;
  }

  /**
   * A run matched against a sequence: elementwise, with at most one spread
   * taking the middle. A repeated pack compares by length and elementwise.
   */
  private matchSequence(items: readonly RunItem[], elements: readonly S[], at: ParseNode): boolean {
    const spreads = items.filter((i) => i.variadic);
    if (spreads.length > 1) {
      throw new SpecializationPatternError('unusable-boundary', 'two spreads in one run leave no boundary between them', at);
    }
    if (spreads.length === 0) {
      return items.length === elements.length && items.every((item, i) => this.match(item.pattern, elements[i]));
    }
    const at0 = items.indexOf(spreads[0]);
    const after = items.length - at0 - 1;
    if (elements.length < at0 + after) {
      return false;
    }
    for (let i = 0; i < at0; i += 1) {
      if (!this.match(items[i].pattern, elements[i])) {
        return false;
      }
    }
    for (let i = 0; i < after; i += 1) {
      if (!this.match(items[at0 + 1 + i].pattern, elements[elements.length - after + i])) {
        return false;
      }
    }
    const middle = elements.slice(at0, elements.length - after);
    const spread = spreads[0].pattern;
    const capture = this.captureOf(spread);
    if (capture) {
      const bound = this.env.get(capture);
      if (bound === undefined) {
        this.env.set(capture, this.host.makeSequence(middle));
        return true;
      }
      return this.sameSequence(bound, middle);
    }
    // A spread of a fixed tuple, `...[uint8, string]`.
    return this.sameSequence(this.host.resolveFixed(spread), middle);
  }

  private sameSequence(bound: S, middle: readonly S[]): boolean {
    const elements = this.host.sequenceOf(bound);
    return elements !== null && elements.length === middle.length && elements.every((e, i) => this.host.sameArgument(e, middle[i]));
  }

  /** The deferred computations, then the written bounds (#sec-matchspecializationlist). */
  finish(): boolean {
    const env = this.envByName();
    for (const { node, subject } of this.deferred) {
      if (!this.host.sameArgument(this.host.evaluate(node, env), subject)) {
        return false;
      }
    }
    for (const [capture, value] of this.env) {
      const bound = capture.Declaration.TypeParameterConstraint;
      if (bound && !this.host.satisfiesBound(value, bound, env)) {
        return false;
      }
    }
    return true;
  }

  result(captures: readonly CaptureRecord[]): CaptureBindingRecord<S>[] {
    const out: CaptureBindingRecord<S>[] = [];
    for (const c of captures) {
      const value = this.env.get(c);
      if (value !== undefined) {
        out.push({ Capture: c, Value: value });
      }
    }
    return out;
  }
}

function assignRuns<S>(
  parameters: readonly PatternSlotParameter<S>[],
  items: readonly ParseNode[],
  names: readonly (string | undefined)[],
  owner: string,
  at: ParseNode,
): (readonly ParseNode[])[] {
  const assigned = assignTypeArguments(parameters, items, names, () => true);
  if (assigned.ok) {
    return assigned.runs.map((r) => [...r]);
  }
  const labels = parameters.map((p) => p.Name).join(', ');
  switch (assigned.kind) {
    case 'unknown-name':
      throw new SpecializationPatternError('unknown-name', `${owner} has no parameter named \`${assigned.name}\`; its parameters are ${labels}`, at);
    case 'supplied-twice':
      throw new SpecializationPatternError('supplied-twice', `\`${assigned.name}\` of ${owner} is supplied twice`, at);
    case 'positional-after-named':
      throw new SpecializationPatternError('positional-after-named', `a positional argument of ${owner} follows a named one`, at);
    case 'missing':
      throw new SpecializationPatternError('missing', `the pattern supplies nothing for \`${assigned.name}\` of ${owner}, which has no default`, at);
    default:
      throw new SpecializationPatternError('unmatched', `the pattern's arguments cannot be assigned to the parameters of ${owner} (${labels})`, at);
  }
}

/** The arguments of a specialization list, in order. */
export function SpecializationPatternsOf(list: ParseNode.TypeParameters): ParseNode[] {
  return (list.SpecializationEntryList ?? []).map((e) => e.Pattern as unknown as ParseNode);
}

/**
 * #sec-matchspecializationlist. _bindings_ are the primary's canonical ordered
 * bindings, one per parameter of _primary_ (a variadic parameter's as the
 * sequence subject it binds). The list's entries are assigned to the primary's
 * parameters positionally, by the variadic rules, so an entry stands for one
 * parameter or, under a pack, for part of that pack's run. Returns the
 * capture bindings, or ~no-match~; a match that fails binds nothing, since
 * every call starts from an empty environment.
 */
export function MatchSpecializationList<S>(
  list: ParseNode.TypeParameters,
  primary: readonly PatternSlotParameter<S>[],
  bindings: readonly S[],
  host: SpecializationMatchHost<S>,
  defaultOf: (q: number, bindings: readonly S[]) => S | undefined = () => undefined,
): CaptureBindingRecord<S>[] | 'no-match' {
  if (list.ListKind !== 'specialization') {
    throw new SpecializationPatternError('not-a-specialization', 'only a specialization list is matched; a mixed list declares an overload of its own', list);
  }
  const captures = CaptureRecordsOf(list.Captures ?? []);
  const matcher = new Matcher(host, captures, 'specialization');
  const items = SpecializationPatternsOf(list);
  if (!matcher.matchRuns(primary, items, items.map(() => undefined), bindings, 'the primary declaration', list, defaultOf)) {
    return 'no-match';
  }
  return matcher.finish() ? matcher.result(captures) : 'no-match';
}

/**
 * #sec-matchspecializationpattern as an entry point of its own, over one
 * pattern, one subject, and a relation mode. The slotted form of a
 * type-subject pattern, `when extends Map.<string, const V>`, is this call with
 * ~type-subject~ (plan D5); the pattern's own captures are its scope.
 */
export function MatchSpecializationPattern<S>(
  pattern: ParseNode,
  captures: readonly ParseNode.CaptureBinding[],
  subject: S,
  host: SpecializationMatchHost<S>,
  mode: SpecializationMatchMode,
): CaptureBindingRecord<S>[] | 'no-match' {
  const records = CaptureRecordsOf(captures);
  const matcher = new Matcher(host, records, mode);
  if (!matcher.match(pattern, subject)) {
    return 'no-match';
  }
  return matcher.finish() ? matcher.result(records) : 'no-match';
}

/** A declaration-time finding about a specialization list, independent of any subject. */
export interface SpecializationDiagnostic {
  readonly kind: string;
  readonly message: string;
  readonly node: ParseNode | undefined;
}

/**
 * #sec-capture-scope, the half that needs resolution: each nested application
 * must name a constructor and supply its labels correctly, and each capture
 * that writes a domain must restate its slot's (plan D9) unless the slot is a
 * metadata position; a capture with holes must occupy a slot of the same
 * arity. Checked once per declaration, before and independently of any match,
 * so an unused invalid declaration is refused too (C21). _primary_, where the
 * caller has resolved the family, extends the checks to the top-level entries;
 * _extentDomain_, the index type, to a captured array extent.
 */
export function ValidateSpecializationList<S>(
  list: ParseNode.TypeParameters,
  host: Pick<SpecializationMatchHost<S>, 'constructorOf' | 'resolveFixed' | 'sameArgument'>,
  primary?: readonly PatternSlotParameter<S>[],
  describe: (domain: S) => string = String,
  extentDomain?: S,
): SpecializationDiagnostic[] {
  const diagnostics: SpecializationDiagnostic[] = [];
  const records = CaptureRecordsOf(list.Captures ?? []);
  const probe = new Matcher(host as SpecializationMatchHost<S>, records, 'specialization');
  const checkSlot = (item: ParseNode, parameter: PatternSlotParameter<S>, owner: string): void => {
    if (item.type !== 'CaptureBinding') {
      return;
    }
    const name = item.BindingIdentifier.name;
    if ((item.Arity ?? 0) !== (parameter.Arity ?? 0)) {
      diagnostics.push({
        kind: 'arity',
        message: (parameter.Arity ?? 0) === 0
          ? `\`const ${name}\` captures a constructor, and \`${parameter.Name}\` of ${owner} holds a first-order argument`
          : `\`${parameter.Name}\` of ${owner} holds a constructor of ${parameter.Arity} parameters, and \`const ${name}\` declares ${item.Arity}`,
        node: item,
      });
      return;
    }
    if (!item.TypeParameterDomain || parameter.Metadata || parameter.Domain === undefined) {
      return;
    }
    let written: S;
    try {
      written = host.resolveFixed(item.TypeParameterDomain);
    } catch {
      return; // an unresolvable annotation is reported where it is resolved
    }
    if (!host.sameArgument(written, parameter.Domain)) {
      diagnostics.push({
        kind: 'domain',
        message: `\`${name}\` occupies \`${parameter.Name}\` of ${owner}, whose domain is \`${describe(parameter.Domain)}\`, and \`const ${name}: ${item.TypeParameterDomain.sourceText}\` restates it as \`${describe(written)}\`; a written domain must match its slot's, and a bound is written \`const ${name} extends ...\``,
        node: item,
      });
    }
  };
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const n = node as Walkable;
    if (n.type === 'TypeParameters') {
      return;
    }
    const extent = n.type === 'ArrayType' ? (n as unknown as ParseNode.ArrayType).ArrayExtent as unknown as ParseNode | null : null;
    if (extent?.type === 'CaptureBinding' && extentDomain !== undefined) {
      checkSlot(extent, { Name: 'the extent', Variadic: false, HasDefault: false, Domain: extentDomain }, 'the array');
    }
    if (n.type === 'TypeReference' && (n as unknown as ParseNode.TypeReference).TypeArguments && probe.hasPatternPart((n as unknown as ParseNode.TypeReference).TypeArguments)) {
      const reference = n as unknown as ParseNode.TypeReference;
      const constructor = host.constructorOf(reference.TypeName);
      if (!constructor) {
        diagnostics.push({ kind: 'no-component', message: `\`${reference.TypeName.sourceText}\` names no constructor whose arguments a pattern can expose; bind the whole type and constrain it instead`, node: reference as unknown as ParseNode });
      } else {
        const items = reference.TypeArguments!.TypeArgumentList as unknown as ParseNode[];
        try {
          const runs = assignRuns(constructor.Parameters, items, items.map(typeArgumentNameOf), constructor.Name, reference as unknown as ParseNode);
          runs.forEach((run, q) => {
            if (!constructor.Parameters[q].Variadic && run.length === 1) {
              checkSlot(run[0], constructor.Parameters[q], constructor.Name);
            }
          });
        } catch (e) {
          if (!(e instanceof SpecializationPatternError)) {
            throw e;
          }
          diagnostics.push({ kind: e.kind, message: e.message, node: e.node });
        }
      }
    }
    children(n).forEach(visit);
  };
  const entries = SpecializationPatternsOf(list);
  if (primary && list.ListKind === 'specialization') {
    try {
      const runs = assignRuns(primary, entries, entries.map(() => undefined), 'the primary declaration', list);
      runs.forEach((run, q) => {
        if (!primary[q].Variadic && run.length === 1) {
          checkSlot(run[0], primary[q], 'the primary declaration');
        }
      });
    } catch (e) {
      if (!(e instanceof SpecializationPatternError)) {
        throw e;
      }
      diagnostics.push({ kind: e.kind, message: e.message, node: e.node });
    }
  }
  entries.forEach(visit);
  return diagnostics;
}
