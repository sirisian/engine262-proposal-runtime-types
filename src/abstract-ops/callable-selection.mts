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
import { TypeNodeToTypeRecord, markValueParameterBinding, pushTypeParameterFrame, popTypeParameterFrame, BindTypeParameterTyped } from '../type-system/runtime.mts';
import { resolveOverload, type OverloadSignature } from '../type-system/overloads.mts';
import { displayType, builtinTypeRecord, makePrimitive, type TypeRecord } from '../type-system/records.mts';
import { IsSubtype } from '../type-system/relations.mts';
import { SpecializationPatternsOf } from '../type-system/specialization-patterns.mts';
import { AnalyzeCallableGroup, SelectSpecialization } from '../type-system/specialization-selection.mts';
import { CallableGroupHostFor, FixedTypeSubtrees, MatchStandaloneCase } from '../type-system/component-patterns.mts';
import { GenericWhereVerified, MarkGenericWhereVerified } from '../type-system/generic-where.mts';
import { Evaluate } from '../evaluator.mts';
import { SignaturesOf, InferGenericCallBindings, functionWhereClauses, classFrameOfObject } from './runtime-types.mts';
import {
  Throw, Value, Q, Call, CreateBuiltinFunction, EnsureCompletion, GetValue, ExecutionContext, surroundingAgent, type PlainEvaluator, type ValueEvaluator,
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
  // A function declares `FormalParameters`; a method, `UniqueFormalParameters`.
  const declared = declaration as { FormalParameters?: readonly { type?: string, Initializer?: unknown }[], UniqueFormalParameters?: readonly { type?: string, Initializer?: unknown }[] } | null;
  const formals = declared?.FormalParameters ?? declared?.UniqueFormalParameters ?? [];
  const rest = formals.some((p) => p.type === 'FunctionRestParameter' || p.type === 'BindingRestElement');
  const fixed = formals.filter((p) => p.type !== 'FunctionRestParameter' && p.type !== 'BindingRestElement');
  const required = fixed.filter((p) => !p.Initializer).length;
  return count >= required && (rest || count <= fixed.length);
}

/**
 * The group's roles at run time: every written type its lists name resolved
 * first (the matcher is synchronous), then the checker's `AnalyzeCallableGroup`
 * over the resolved host, so both agree on owners, attachment, and standalone
 * cases.
 */
function* AnalyzeGroupAtRuntime(members: readonly { fn: Value, declaration: Declaration }[], name: string): PlainEvaluator<{
  analysis: ReturnType<typeof AnalyzeCallableGroup>, host: ReturnType<typeof CallableGroupHostFor>, resolve: (node: ParseNode) => TypeRecord | null,
}> {
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
  return { analysis, host, resolve };
}

/** A case's capture bindings as a type-parameter frame, values marked as value parameters. */
/**
 * #sec-generics (decided in phase 4, step 9g), for a selected case: a value
 * binder keeps its declared type where it is read - `maximum: float32` bound
 * from `write.<float32, -1024, 1024, 18>` is a `float32`, so `value / maximum`
 * divides two `float32`s. The binder's literal binds through
 * `BindTypeParameterTyped`, as a declaration's defaults and a class
 * specialization's arguments do.
 */
function* TypedFrameOfBindings(declaration: unknown, bindings: readonly { Capture: { Name: string }, Value: Argument }[]): PlainEvaluator<Map<string, TypeRecord>> {
  const frame = FrameOfBindings(bindings);
  const list = (declaration as { TypeParameters?: { TypeParameterList?: readonly { BindingIdentifier?: { name?: string }, IsValueParameter?: boolean }[] } | null } | undefined)
    ?.TypeParameters?.TypeParameterList ?? [];
  for (const tp of list) {
    const name = tp.BindingIdentifier?.name;
    const bound = name ? frame.get(name) : undefined;
    if (name && bound && tp.IsValueParameter) {
      Q(yield* BindTypeParameterTyped(frame, name, bound, tp));
    }
  }
  return frame;
}

function FrameOfBindings(bindings: readonly { Capture: { Name: string }, Value: Argument }[]): Map<string, TypeRecord> {
  const frame = new Map<string, TypeRecord>();
  for (const b of bindings) {
    const record = typeof b.Value === 'number'
      ? markValueParameterBinding({ Kind: 'literal', Value: Value(b.Value), Base: makePrimitive('number') } as unknown as TypeRecord)
      : b.Value.Kind === 'object' || b.Value.Kind === 'literal' ? markValueParameterBinding(b.Value) : b.Value;
    frame.set(b.Capture.Name, record);
  }
  return frame;
}

/**
 * Plan section 3.8, rules 4 and 5 (step 4): an IMPLICIT call, `f(x)`, into a
 * group holding a case. Ordinary value resolution chooses among the owner (its
 * binding inferred, as any generic call's), the additive cases, and the
 * standalone cases - a replacement is reached only through its owner. When the
 * owner wins, its inferred binding selects among its attached replacements
 * (as an explicit call's arguments would), else its body runs; a bodyless
 * owner no replacement matches is no viable overload.
 */
export function* DispatchCaseGroup(
  overloaded: Value,
  args: readonly Value[],
  thisValue: Value,
  name: string,
  callContext: TypeRecord | undefined,
): ValueEvaluator {
  const members = CaseGroupMembers(overloaded) ?? [];
  const { analysis, host } = Q(yield* AnalyzeGroupAtRuntime(members, name));
  const declarationOf = (fn: Value) => members.find((m) => m.fn === fn)?.declaration;
  // The checker records each attached case's role (Q4); unrecorded is a replacement.
  const replacements = new Set<object>(analysis.Attached
    .filter((a) => (a.Case.Node as { CaseRole?: string }).CaseRole !== 'additive')
    .map((a) => a.Case.Node as object));
  const signatures = Q(yield* SignaturesOf(overloaded, (fn) => !replacements.has(declarationOf(fn) as object))) as readonly OverloadSignature[];
  // Overloading on return type (the contextual type) must not filter out an
  // owner that routes to replacements: its own return is not the call's when a
  // replacement is chosen (`const c: 'u' = f(x)` with `f<uint8>(x: uint8): 'u'`).
  // The chosen declaration's return is checked where the result is bound.
  const routes = analysis.Owners.some((o) => analysis.Attached.some((a) => a.Owner === o && replacements.has(a.Case.Node as object)));
  const resolution = resolveOverload(signatures, args, routes ? undefined : callContext);
  if (resolution.Kind === 'none') {
    return Throw.TypeError('no overload of $1 matches these arguments', Value(name));
  }
  if (resolution.Kind === 'ambiguous') {
    return Throw.TypeError('the call to $1 is ambiguous between overloads', Value(name));
  }
  const chosen = resolution.Signature.Function;
  const chosenDeclaration = declarationOf(chosen);
  const owner = analysis.Owners.find((o) => o.Node === chosenDeclaration);
  if (owner) {
    const attached = analysis.Attached
      .filter((a) => a.Owner === owner && replacements.has(a.Case.Node as object) && ValueArityAdmits(a.Case.Node, args.length))
      .map((a) => ({ List: a.Case.List!, Declaration: a.Case.Node, Label: a.Case.Label }));
    if (attached.length > 0) {
      const inferred = Q(yield* InferGenericCallBindings(chosen as never, args));
      const ownerArgs = (owner.Parameters ?? []).map((p) => inferred?.get(p.Name));
      if (ownerArgs.every((a) => a !== undefined)) {
        let result: ReturnType<typeof SelectSpecialization<TypeRecord>> = SelectSpecialization(attached, owner.Parameters as never, ownerArgs as TypeRecord[], host as never);
        // A replacement whose filter does not hold is excluded (B12).
        const remaining = [...attached];
        for (;;) {
          if (result.Kind !== 'selected') break;
          const selectedCase = result.Case;
          const candidate = members.find((m) => m.declaration === selectedCase.Declaration)!.fn;
          const filterFrame = Q(yield* TypedFrameOfBindings(selectedCase.Declaration, result.Bindings as never));
          if (Q(yield* CaseFilterHolds(candidate, filterFrame, classFrameOfObject(thisValue)))) break;
          remaining.splice(remaining.findIndex((c) => c.Declaration === selectedCase.Declaration), 1);
          if (remaining.length === 0) {
            result = { Kind: 'none' } as unknown as typeof result;
            break;
          }
          result = SelectSpecialization(remaining, owner.Parameters as never, ownerArgs as TypeRecord[], host as never);
        }
        if (result.Kind === 'ambiguous') {
          return Throw.TypeError('$1', Value(`${result.Cases.map((c) => c.Label).join(' and ')} both apply to this call, and neither is more specific than the other`));
        }
        if (result.Kind === 'selected') {
          const fn = members.find((m) => m.declaration === result.Case.Declaration)!.fn;
          const dispatchFrame = Q(yield* TypedFrameOfBindings((result as { Case?: { Declaration?: unknown } }).Case?.Declaration, result.Bindings as never));
          pushTypeParameterFrame(dispatchFrame);
          try {
            return Q(yield* WithSelectedInvocation(fn, function* callCase() {
              return yield* Call(fn, thisValue, args as Value[]);
            }));
          } finally {
            popTypeParameterFrame();
          }
        }
      }
    }
    if ((owner.Node as Declaration).BodylessOwner) {
      return Throw.TypeError('$1', Value(`no overload of \`${name}\` applies to this call: no case matches, and its owner has no body`));
    }
    // The owner's body, chosen by this selection: a class operator's owner is
    // otherwise refused beside its cases (the step-1 sibling guard).
    return Q(yield* WithSelectedInvocation(chosen, function* callOwner() {
      return yield* Call(chosen, thisValue, args as Value[]);
    }));
  }
  // An additive or standalone case, chosen by its own value signature.
  return Q(yield* WithSelectedInvocation(chosen, function* callChosen() {
    return yield* Call(chosen, thisValue, args as Value[]);
  }));
}

/**
 * Plan section 3.8 (B12), step 7c: whether a case's `where` filters hold for
 * its bindings, evaluated before any call as a generic application's clauses
 * are (#sec-generic-where), with the receiver's class bindings - a method's
 * filter reads its class's parameters. A case whose filter does not hold is
 * not applicable. Verdicts are memoized by class and case bindings together,
 * so one class specialization's verdict never answers for another's.
 */
export function* CaseFilterHolds(fn: Value, frame: Map<string, TypeRecord>, classFrame: Map<string, TypeRecord> | null): PlainEvaluator<boolean> {
  const clauses = functionWhereClauses(fn as never);
  if (!clauses) return true;
  const key = new Map<string, TypeRecord>([...(classFrame ?? new Map()), ...frame]);
  // Evaluated in the case's own declaring context, where its names were
  // written: a call may reach here from a built-in (the overload dispatch),
  // whose context has no environment.
  const declared = fn as unknown as { Environment?: unknown, PrivateEnvironment?: unknown, Realm?: unknown, ScriptOrModule?: unknown };
  const context = new ExecutionContext();
  context.Function = Value.null;
  context.Realm = declared.Realm as never;
  context.ScriptOrModule = declared.ScriptOrModule as never;
  context.LexicalEnvironment = declared.Environment as never;
  context.VariableEnvironment = declared.Environment as never;
  context.PrivateEnvironment = declared.PrivateEnvironment as never;
  surroundingAgent.executionContextStack.push(context);
  if (classFrame) pushTypeParameterFrame(classFrame);
  pushTypeParameterFrame(frame);
  try {
    for (const clause of clauses) {
      if (GenericWhereVerified(clause, key)) continue;
      const predicate = (clause as unknown as { RefinementPredicate?: ParseNode }).RefinementPredicate;
      if (!predicate) continue;
      const verdict = Q(yield* GetValue(Q(yield* Evaluate(predicate as never))));
      if (verdict === Value.false || verdict === Value.undefined || verdict === Value.null) return false;
      MarkGenericWhereVerified(clause, key);
    }
    return true;
  } finally {
    popTypeParameterFrame();
    if (classFrame) popTypeParameterFrame();
    surroundingAgent.executionContextStack.pop(context);
  }
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
  // Cases whose filters did not hold (B12): not applicable, so not candidates.
  excluded: ReadonlySet<object> = new Set(),
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
    const attached = analysis.Attached.filter((a) => a.Owner === owner && !excluded.has(a.Case.Node as object) && ValueArityAdmits(a.Case.Node, valueCount))
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
  const matching: { d: ParseNode, list: ParseNode.TypeParameters, ordered: readonly (TypeRecord | undefined)[], bindings: readonly { Name: string, Value: TypeRecord }[], label: string }[] = [];
  for (const d of analysis.Standalone) {
    if (!d.List || d.List.ListKind === 'parameters' || excluded.has(d.Node as object) || !ValueArityAdmits(d.Node, valueCount)) continue;
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
    if (result.Kind === 'match') matching.push({ d: d.Node, list: d.List, ordered: order.ordered, bindings: result.Bindings, label: d.Label });
  }
  if (matching.length === 1) return { Kind: 'case', Declaration: matching[0]!.d, Bindings: matching[0]!.bindings };
  if (matching.length > 1) {
    // Pattern-only standalone cases of one arity rank by specificity, as an
    // owner's attached cases do (section 6.1; rule 8): `write<uint8>` is more
    // specific than `write<uint.<const N>>` at `uint8`.
    const arity = SpecializationPatternsOf(matching[0]!.list).length;
    if (matching.every((m) => m.list.ListKind === 'specialization' && SpecializationPatternsOf(m.list).length === arity)
        && matching[0]!.ordered.every((a) => a !== undefined)) {
      const positions = Array.from({ length: arity }, (_e, i) => ({ Name: `#${i}`, Variadic: false, HasDefault: false }));
      const ranked = SelectSpecialization(matching.map((m) => ({ List: m.list, Declaration: m.d, Label: m.label })), positions as never, matching[0]!.ordered as TypeRecord[], host as never);
      if (ranked.Kind === 'selected') {
        return { Kind: 'case', Declaration: ranked.Case.Declaration!, Bindings: (ranked.Bindings as readonly { Capture: { Name: string }, Value: TypeRecord | number }[]).map((b) => ({ Name: b.Capture.Name, Value: b.Value })) };
      }
    }
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

/**
 * Plan section 3.8, phase 4 step 5: a stored application's case as a callable:
 * each call runs the case in its captures' frame, as a selected invocation.
 * One value per case function and binding, so `f.<T: uint8> === f.<uint8>`
 * (C14), while a case function of another closure's evaluation is another.
 */
const storedCaseValues = new WeakMap<object, Map<string, Value>>();
/**
 * Step 8: what a specialization value selected - its group, the chosen
 * declaration's function, and a case's capture frame - for its reflected type
 * and its declaration reflection.
 */
const selections = new WeakMap<object, { group: Value, fn: Value, frame: Map<string, TypeRecord> | undefined }>();
export function RecordSelection(value: Value, group: Value, fn: Value, frame: Map<string, TypeRecord> | undefined): void {
  selections.set(value as object, { group, fn, frame });
}
export function SelectionOfValue(value: unknown): { group: Value, fn: Value, frame: Map<string, TypeRecord> | undefined } | undefined {
  return value && typeof value === 'object' ? selections.get(value) : undefined;
}
export function StoredCaseValue(fn: Value, frame: Map<string, TypeRecord>, name: string, group?: Value): Value {
  const key = [...frame.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${k}=${displayType(v)}`).join(';');
  let byBinding = storedCaseValues.get(fn as object);
  if (!byBinding) {
    byBinding = new Map();
    storedCaseValues.set(fn as object, byBinding);
  }
  const known = byBinding.get(key);
  if (known) {
    return known;
  }
  const behaviour = function* storedCase(args: readonly Value[], context: { thisValue: Value }): ValueEvaluator {
    pushTypeParameterFrame(frame);
    try {
      return Q(yield* WithSelectedInvocation(fn, function* callStored() {
        return yield* Call(fn, context.thisValue, args as Value[]);
      }));
    } finally {
      popTypeParameterFrame();
    }
  };
  const length = ((fn as { FormalParameters?: readonly unknown[] }).FormalParameters ?? []).length;
  const stored = CreateBuiltinFunction(behaviour as never, length, Value(name), []);
  byBinding.set(key, stored);
  if (group) RecordSelection(stored, group, fn, frame);
  return stored;
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
  classFrame: Map<string, TypeRecord> | null = null,
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
  const { analysis, host, resolve } = Q(yield* AnalyzeGroupAtRuntime(members, name));
  const fnOf = (node: ParseNode) => members.find((m) => m.declaration === node)!.fn;
  // A chosen case whose filter does not hold is excluded, and selection runs
  // again among the rest (B12).
  const excluded = new Set<object>();
  for (;;) {
    const choice = SelectCase(analysis as never, args as TypeRecord[], names, valueArgumentCount, host, resolve, (a, b) => IsSubtype(a, b, []), displayType, name, excluded);
    if (choice.Kind === 'error') {
      return Throw.TypeError('$1', Value(choice.Message));
    }
    if (choice.Kind === 'owner') {
      return { fn: fnOf(choice.Declaration), frame: undefined };
    }
    const fn = fnOf(choice.Declaration);
    const frame = Q(yield* TypedFrameOfBindings(choice.Declaration, choice.Bindings.map((b) => ({ Capture: { Name: b.Name }, Value: b.Value }))));
    if (Q(yield* CaseFilterHolds(fn, frame, classFrame))) {
      return { fn, frame };
    }
    excluded.add(choice.Declaration as object);
  }
}

void builtinTypeRecord;
