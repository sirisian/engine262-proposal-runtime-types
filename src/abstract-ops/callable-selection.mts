/**
 * Plan section 3.8 and section 6.1, phase 4 step 2: selecting a callable's
 * specialized case for a DIRECT EXPLICIT call, `f.<A>(x)`.
 *
 * The group's roles are rebuilt with the same `AnalyzeCallableGroup` the
 * checker runs, over a host whose written types were resolved first (the
 * matcher is synchronous), so the run time and the checker agree on owners,
 * attachment, and standalone cases. Then:
 *   1. the most specific attached case the arguments match (`SelectSpecialization`);
 *   2. otherwise a standalone case they match - a fixed position is more
 *      specific than one an owner's parameter reaches (rule 8);
 *   3. otherwise the owner's body, bound as any generic call is;
 *   4. otherwise no viable overload.
 * Two applicable cases neither more specific than the other are an ambiguity
 * naming both and the arguments.
 */

import type { ParseNode } from '../parser/ParseNode.mts';
import { TypeNodeToTypeRecord, markValueParameterBinding } from '../type-system/runtime.mts';
import { displayType, builtinTypeRecord, makePrimitive, type TypeRecord } from '../type-system/records.mts';
import { IsSubtype } from '../type-system/relations.mts';
import { SpecializationPatternsOf } from '../type-system/specialization-patterns.mts';
import { AnalyzeCallableGroup, SelectSpecialization } from '../type-system/specialization-selection.mts';
import { CallableGroupHostFor, FixedTypeSubtrees, MatchStandaloneCase } from '../type-system/component-patterns.mts';
import {
  Throw, Value, Q, EnsureCompletion, type PlainEvaluator, type ValueEvaluator,
} from '#self';

type Argument = TypeRecord | number;
type Declaration = ParseNode & {
  TypeParameters?: ParseNode.TypeParameters | null, BodylessOwner?: boolean,
  BindingIdentifier?: { name?: string }, FormalParameters?: readonly ParseNode[],
};

export interface CaseChoice {
  /** The function to call: a case's, or the owner's for the fallback. */
  readonly fn: Value;
  /** The case's capture bindings; *undefined* for the owner, whose parameters the call binds itself. */
  readonly frame: Map<string, TypeRecord> | undefined;
}

const isCase = (d: Declaration | undefined) => d?.TypeParameters?.ListKind === 'specialization' || d?.TypeParameters?.ListKind === 'mixed';

/** The members of a group holding a specialized case, or *undefined* for any other callee. */
export function CaseGroupMembers(func: Value): readonly { fn: Value, declaration: Declaration }[] | undefined {
  const functions = (func as { OverloadFunctions?: readonly Value[] }).OverloadFunctions ?? [func];
  const members = functions
    .map((fn) => ({ fn, declaration: (fn as { ECMAScriptCode?: { parent?: Declaration } }).ECMAScriptCode?.parent }))
    .filter((m): m is { fn: Value, declaration: Declaration } => !!m.declaration);
  return members.some((m) => isCase(m.declaration)) ? members : undefined;
}

/**
 * Rule 4: a case takes part in ordinary overload resolution too, so one whose
 * value parameters cannot receive _count_ arguments does not apply - an
 * additive `f<uint8>(x: uint8, extra: string)` is not `f.<uint8>(3)`'s case,
 * and the owner's body runs. An unknown count (a spread) filters nothing.
 */
export function ValueArityAdmits(declaration: unknown, count: number | undefined): boolean {
  if (count === undefined) return true;
  const formals = ((declaration as { FormalParameters?: readonly { type?: string, Initializer?: unknown }[] } | null)?.FormalParameters ?? []);
  const rest = formals.some((p) => p.type === 'FunctionRestParameter' || p.type === 'BindingRestElement');
  const fixed = formals.filter((p) => p.type !== 'FunctionRestParameter' && p.type !== 'BindingRestElement');
  const required = fixed.filter((p) => !p.Initializer).length;
  return count >= required && (rest || count <= fixed.length);
}

/** The outcome of `SelectCase`. */
export type CaseSelection =
  | { readonly Kind: 'case', readonly Declaration: ParseNode, readonly Bindings: readonly { readonly Name: string, readonly Value: TypeRecord | number }[] }
  | { readonly Kind: 'owner', readonly Declaration: ParseNode }
  | { readonly Kind: 'error', readonly Message: string };

type Ordered = { ok: true, ordered: (TypeRecord | undefined)[] } | { ok: false, unknown?: string };

/**
 * Plan section 3.8, rules 3 to 5 (step 3): the arguments in a candidate's own
 * positions. A positional argument fills the next position; a named one the
 * position its label names. An unlabeled position (a selector, a pattern-only
 * case's entry) takes no name, and a capture's name is never a label.
 */
function OrderByLabels(labels: readonly (string | undefined)[], args: readonly TypeRecord[], names: readonly (string | undefined)[]): Ordered {
  const ordered: (TypeRecord | undefined)[] = [];
  let seenNamed = false;
  for (let i = 0; i < args.length; i += 1) {
    const label = names[i];
    if (label === undefined) {
      if (seenNamed || ordered.length >= labels.length) return { ok: false };
      ordered.push(args[i]);
      continue;
    }
    seenNamed = true;
    const at = labels.indexOf(label);
    if (at === -1) return { ok: false, unknown: label };
    if (ordered[at] !== undefined) return { ok: false };
    while (ordered.length <= at) ordered.push(undefined);
    ordered[at] = args[i];
  }
  return { ok: true, ordered };
}

/**
 * Plan section 3.8 and section 6.1: the choice for a direct explicit call, for
 * the checker and the run time alike. Each candidate orders the arguments by
 * its own labels - an attached case by its owner's, a mixed case by its
 * binders', a pattern-only case by none - and then: the most specific attached
 * case; otherwise a matching standalone case (rule 8); otherwise the owner's
 * body; otherwise no viable overload. A label no candidate knows is named.
 */
export function SelectCase(
  analysis: ReturnType<typeof AnalyzeCallableGroup>,
  args: readonly TypeRecord[],
  names: readonly (string | undefined)[],
  valueCount: number | undefined,
  host: ReturnType<typeof CallableGroupHostFor>,
  resolve: (node: ParseNode) => TypeRecord | null,
  isSubtype: (sub: TypeRecord, sup: TypeRecord) => boolean,
  describe: (t: TypeRecord) => string,
  name: string,
): CaseSelection {
  const tuple = `(${args.map((a, i) => `${names[i] !== undefined ? `${names[i]}: ` : ''}${describe(a)}`).join(', ')})`;
  const unknown = new Set<string>();
  // Whether some candidate took the labels: then a label is not what failed.
  let labelsTaken = false;
  const ownerLabels = (o: { Parameters?: readonly { Name: string }[] }) => (o.Parameters ?? []).map((p) => p.Name);
  for (const owner of analysis.Owners) {
    const order = OrderByLabels(ownerLabels(owner), args, names);
    if (!order.ok) {
      if (order.unknown) unknown.add(order.unknown);
      continue;
    }
    labelsTaken = true;
    // A hole a named call leaves takes the owner's default, as the owner's own binding would.
    const filled: TypeRecord[] = [];
    let complete = true;
    order.ordered.forEach((a, q) => {
      const binder = (owner.Parameters?.[q] as { Binder?: ParseNode.TypeParameter } | undefined)?.Binder;
      const value = a ?? (binder?.TypeParameterDefault ? resolve(binder.TypeParameterDefault as unknown as ParseNode) : null);
      if (value) filled.push(value); else complete = false;
    });
    if (!complete) continue;
    const attached = analysis.Attached.filter((a) => a.Owner === owner && ValueArityAdmits(a.Case.Node, valueCount))
      .map((a) => ({ List: a.Case.List!, Declaration: a.Case.Node, Label: a.Case.Label }));
    if (attached.length === 0) continue;
    const result = SelectSpecialization(attached, owner.Parameters as never, filled, host as never);
    if (result.Kind === 'selected') {
      return { Kind: 'case', Declaration: result.Case.Declaration!, Bindings: (result.Bindings as readonly { Capture: { Name: string }, Value: TypeRecord | number }[]).map((b) => ({ Name: b.Capture.Name, Value: b.Value })) };
    }
    if (result.Kind === 'ambiguous') {
      return { Kind: 'error', Message: `${result.Cases.map((c) => c.Label).join(' and ')} both apply to ${tuple}, and neither is more specific than the other; declare a case for their intersection` };
    }
  }
  const matching: { d: ParseNode, bindings: readonly { Name: string, Value: TypeRecord }[], label: string }[] = [];
  for (const d of analysis.Standalone) {
    if (!d.List || d.List.ListKind === 'parameters' || !ValueArityAdmits(d.Node, valueCount)) continue;
    const kinds = (d.List as { EntryKinds?: readonly string[] }).EntryKinds ?? SpecializationPatternsOf(d.List).map(() => 'argument');
    let binder = 0;
    const labels = kinds.map((k) => (k === 'parameter' ? (d.List!.TypeParameterList ?? [])[binder++]?.BindingIdentifier.name : undefined));
    const order = OrderByLabels(labels, args, names);
    if (!order.ok) {
      if (order.unknown) unknown.add(order.unknown);
      continue;
    }
    labelsTaken = true;
    const result = MatchStandaloneCase(d.List, order.ordered, resolve, isSubtype, describe);
    if (result.Kind === 'bound') return { Kind: 'error', Message: `${d.Label} applies to ${tuple}, but ${result.Message}` };
    if (result.Kind === 'match') matching.push({ d: d.Node, bindings: result.Bindings, label: d.Label });
  }
  if (matching.length === 1) return { Kind: 'case', Declaration: matching[0]!.d, Bindings: matching[0]!.bindings };
  if (matching.length > 1) {
    return { Kind: 'error', Message: `${matching.map((m) => m.label).join(' and ')} both apply to ${tuple}, and neither is more specific than the other` };
  }
  const owner = analysis.Owners.find((o) => !(o.Node as { BodylessOwner?: boolean }).BodylessOwner && OrderByLabels(ownerLabels(o), args, names).ok);
  if (owner) return { Kind: 'owner', Declaration: owner.Node };
  if (unknown.size > 0 && !labelsTaken) {
    const label = [...unknown][0];
    return { Kind: 'error', Message: `\`${label}\` names no type parameter of \`${name}\` that the arguments reach; a capture's name is not a label, and a pattern-only case's positions take none` };
  }
  // Why the owner's body is not the fallback: there is none, it has no body,
  // or it does not take these arguments (their count or labels).
  const why = analysis.Owners.length === 0 ? 'it has no owner'
    : analysis.Owners.every((o) => (o.Node as { BodylessOwner?: boolean }).BodylessOwner) ? 'its owner has no body'
      : 'its owner does not take these arguments';
  return { Kind: 'error', Message: `no overload of \`${name}\` applies to ${tuple}: no case matches, and ${why}` };
}

/** Functions a selection chose, whose case body may run (the step-1 guard stands down for them). */
const selectedInvocations = new WeakSet<object>();
export function IsSelectedInvocation(fn: unknown): boolean {
  return !!fn && typeof fn === 'object' && selectedInvocations.has(fn);
}
export function* WithSelectedInvocation(fn: Value, body: () => ValueEvaluator): ValueEvaluator {
  const had = selectedInvocations.has(fn as object);
  selectedInvocations.add(fn as object);
  try {
    return Q(yield* body());
  } finally {
    if (!had) selectedInvocations.delete(fn as object);
  }
}

/**
 * The choice for `f.<typeArguments>(...)` over the group _members_, or a throw
 * completion: no viable overload, an ambiguity, or a form a later step
 * implements (named or spread arguments).
 */
export function* SelectExplicitCase(
  members: readonly { fn: Value, declaration: Declaration }[],
  typeArguments: readonly ParseNode[],
  name: string,
  valueArgumentCount?: number,
): PlainEvaluator<CaseChoice> {
  if (typeArguments.some((a) => (a as { IsSpread?: boolean }).IsSpread)) {
    return Throw.TypeError('$1', Value(`a spread application of \`${name}\`, whose group has a specialized case, is not supported yet`));
  }
  // Step 3: a named argument's label, ordered per candidate by SelectCase.
  const names = typeArguments.map((a) => (a as { ArgumentName?: string }).ArgumentName);
  // The arguments, and every written type the group's lists name, resolved now.
  const args: Argument[] = [];
  for (const node of typeArguments) {
    args.push(Q(yield* TypeNodeToTypeRecord(node as never)) as TypeRecord);
  }
  const resolved = new Map<object, TypeRecord>();
  const resolveAll = function* resolveAll(nodes: readonly ParseNode[]): PlainEvaluator<void> {
    for (const node of nodes) {
      if (resolved.has(node)) continue;
      const completion = EnsureCompletion(yield* TypeNodeToTypeRecord(node as never));
      if (completion.Type === 'normal') resolved.set(node, completion.Value as unknown as TypeRecord);
    }
  };
  for (const { declaration } of members) {
    const list = declaration.TypeParameters;
    if (!list) continue;
    const captureNames = new Set((list.Captures ?? []).map((c) => c.BindingIdentifier.name));
    if (list.ListKind === 'parameters') {
      Q(yield* resolveAll((list.TypeParameterList ?? []).flatMap((tp) => [tp.TypeParameterDomain, tp.TypeParameterConstraint].filter(Boolean) as unknown as ParseNode[])));
    } else {
      for (const entry of SpecializationPatternsOf(list)) {
        Q(yield* resolveAll(FixedTypeSubtrees(entry, captureNames)));
      }
      // A mixed list's binders: their domains, bounds, and defaults.
      Q(yield* resolveAll((list.TypeParameterList ?? []).flatMap((tp) => [tp.TypeParameterDomain, tp.TypeParameterConstraint, tp.TypeParameterDefault].filter(Boolean) as unknown as ParseNode[])));
      Q(yield* resolveAll((list.Captures ?? []).map((c) => c.TypeParameterDomain).filter(Boolean) as unknown as ParseNode[]));
    }
  }
  const resolve = (node: ParseNode) => resolved.get(node) ?? null;
  const host = CallableGroupHostFor(resolve, (a, b) => IsSubtype(a, b, []));
  // A case is labelled by its declared name, whatever the callee was called.
  const labelOf = (d: Declaration) => `\`${d.BindingIdentifier?.name ?? name}${(d.TypeParameters as { sourceText?: string } | null)?.sourceText ?? ''}\``;
  const ownerParameters = (d: Declaration) => (d.TypeParameters?.TypeParameterList ?? []).map((tp) => {
    const written = tp.IsValueParameter ? (tp.TypeParameterDomain ?? tp.TypeParameterConstraint) : undefined;
    const domain = written ? resolve(written as unknown as ParseNode) : null;
    return {
      Name: tp.BindingIdentifier.name, Variadic: !!tp.IsVariadic, HasDefault: !!tp.TypeParameterDefault,
      Kind: tp.IsValueParameter ? 'value' : 'type', Binder: tp, ...(domain ? { Domain: domain } : {}),
    };
  });
  const declarations = members.map((m) => ({
    Node: m.declaration, List: m.declaration.TypeParameters ?? null, Label: labelOf(m.declaration),
    Parameters: m.declaration.TypeParameters?.ListKind === 'parameters' ? ownerParameters(m.declaration) : undefined,
  }));
  const analysis = AnalyzeCallableGroup(declarations as never, host);
  const fnOf = (node: ParseNode) => members.find((m) => m.declaration === node)!.fn;
  const frameOf = (bindings: readonly { Capture: { Name: string }, Value: Argument }[]) => {
    const frame = new Map<string, TypeRecord>();
    for (const b of bindings) {
      const record = typeof b.Value === 'number'
        ? markValueParameterBinding({ Kind: 'literal', Value: Value(b.Value), Base: makePrimitive('number') } as unknown as TypeRecord)
        : b.Value.Kind === 'object' || b.Value.Kind === 'literal' ? markValueParameterBinding(b.Value) : b.Value;
      frame.set(b.Capture.Name, record);
    }
    return frame;
  };
  const choice = SelectCase(analysis as never, args as TypeRecord[], names, valueArgumentCount, host, resolve, (a, b) => IsSubtype(a, b, []), displayType, name);
  if (choice.Kind === 'error') {
    return Throw.TypeError('$1', Value(choice.Message));
  }
  if (choice.Kind === 'owner') {
    return { fn: fnOf(choice.Declaration), frame: undefined };
  }
  return { fn: fnOf(choice.Declaration), frame: frameOf(choice.Bindings.map((b) => ({ Capture: { Name: b.Name }, Value: b.Value }))) };
}

void builtinTypeRecord;
