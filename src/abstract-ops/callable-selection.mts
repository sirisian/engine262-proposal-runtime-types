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
import { SpecializationPatternsOf, type PatternSlotParameter } from '../type-system/specialization-patterns.mts';
import { AnalyzeCallableGroup, SelectSpecialization } from '../type-system/specialization-selection.mts';
import { CallableGroupHostFor, FixedTypeSubtrees } from '../type-system/component-patterns.mts';
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
): PlainEvaluator<CaseChoice> {
  if (typeArguments.some((a) => (a as { ArgumentName?: string }).ArgumentName !== undefined || (a as { IsSpread?: boolean }).IsSpread)) {
    return Throw.TypeError('$1', Value(`a named or spread application of \`${name}\`, whose group has a specialized case, is not supported yet`));
  }
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
  const tuple = () => `(${args.map((a) => (typeof a === 'number' ? String(a) : displayType(a))).join(', ')})`;
  // 1. The attached cases of the owner the arguments reach.
  for (const owner of analysis.Owners) {
    const attached = analysis.Attached.filter((a) => a.Owner === owner).map((a) => ({ List: a.Case.List!, Declaration: a.Case.Node, Label: a.Case.Label }));
    if (attached.length === 0 || args.length > (owner.Parameters?.length ?? 0)) continue;
    const result = SelectSpecialization(attached, owner.Parameters as readonly PatternSlotParameter<Argument>[], args, host);
    if (result.Kind === 'selected') {
      return { fn: fnOf(result.Case.Declaration!), frame: frameOf(result.Bindings as never) };
    }
    if (result.Kind === 'ambiguous') {
      return Throw.TypeError('$1', Value(`${result.Cases.map((c) => c.Label).join(' and ')} both apply to ${tuple()}, and neither is more specific than the other; declare a case for their intersection`));
    }
  }
  // 2. A standalone case the arguments match, position by position.
  const standalone = analysis.Standalone.filter((d) => d.List && d.List.ListKind !== 'parameters');
  const matching: { fn: Value, frame: Map<string, TypeRecord>, label: string }[] = [];
  for (const d of standalone) {
    const positions = SpecializationPatternsOf(d.List!).map((_e, i) => ({ Name: `#${i}`, Variadic: false, HasDefault: false }));
    const result = SelectSpecialization([{ List: d.List!, Declaration: d.Node, Label: d.Label }], positions, args, host);
    if (result.Kind === 'selected') matching.push({ fn: fnOf(d.Node), frame: frameOf(result.Bindings as never), label: d.Label });
  }
  if (matching.length === 1) {
    return { fn: matching[0]!.fn, frame: matching[0]!.frame };
  }
  if (matching.length > 1) {
    return Throw.TypeError('$1', Value(`${matching.map((m) => m.label).join(' and ')} both apply to ${tuple()}, and neither is more specific than the other`));
  }
  // 3. The owner's body; 4. no viable overload.
  const owner = analysis.Owners.find((o) => !(o.Node as Declaration).BodylessOwner && (o.Parameters?.length ?? 0) >= args.length);
  if (owner) {
    return { fn: fnOf(owner.Node), frame: undefined };
  }
  return Throw.TypeError('$1', Value(`no overload of \`${name}\` applies to ${tuple()}: no case matches, and ${analysis.Owners.length > 0 ? 'its owner has no body' : 'it has no owner'}`));
}

void builtinTypeRecord;
