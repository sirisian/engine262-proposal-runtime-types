import type { ParseNode } from '../parser/ParseNode.mts';
import { DefaultValueOf } from './runtime.mts';
import type { TypeRecord } from './records.mts';
import { EnsureCompletion, Q } from '../completion.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import { ApplyMetaHook, GoverningMetaTypes, LookupMetaHook, SnapshotMetadataValue, HasMetaHooks, MetaTypeClaiming, MetaTypeGoverns, MetadataPortion, LookupTypeDefault } from '../abstract-ops/runtime-types.mts';
import {
  Evaluate_MetaDeclaration, Evaluate_RuntimeTypesBindingDeclaration, preEvaluatedTypeDeclarations,
} from '../runtime-semantics/RuntimeTypesDeclarations.mts';
import { Value } from '../value.mts';
import { GetTypeObject } from './intern.mts';
import { displayType } from './records.mts';
import {
  CheckScript,
  TakeDeferredMetadataChecks, TakeUnclaimedKeyChecks, TakeNarrowingRequests, SetNarrowingResolutions,
  TakeDefaultRequirements, TakeBlockScopedMetaNames,
  type DeferredMetadataCheck, type NarrowingRequest, type NarrowingResolution,
} from './check.mts';
import { BeginTypeEvaluation, BudgetExhaustionKind, EndTypeEvaluation, IsBudgetExhausted } from './budget.mts';
import { Throw } from '#self';

/**
 * proposal-runtime-types #sec-type-errors: the CHECKING PASS. It runs per
 * source text, after parsing and before that source text is evaluated, from
 * the phase where an effectful context exists: ScriptEvaluation drives it
 * before the script body, and ExecuteModule before the module body. A
 * rejection here rejects the source before its first statement runs, which is
 * the Early Error discipline ("a source text that contains one is rejected
 * rather than evaluated") applied from the one place a `subtype` hook, being
 * user code, is callable at all. The synchronous parse-time pass of check.mts
 * decides everything structural and DEFERS the pairs only this judgment can
 * decide; this pass takes them up.
 *
 * Two steps, in order, because the second reads what the first registers:
 *
 * 1. The source text's own top-level type declarations are processed, in
 *    source order: type aliases, interfaces, and `meta` declarations. This is
 *    what makes a `meta` declared in a source govern a judgment in the same
 *    source; without it the realm's meta registry at check time would hold
 *    only earlier source texts' declarations. Processing is tolerant: a
 *    declaration whose evaluation completes abruptly here (a shape naming a
 *    binding the body has not yet initialized, say) is left unmarked and
 *    evaluates at its body position as before, registering late and governing
 *    only later sources; the abrupt completion is not this pass's to report,
 *    and the body's own evaluation will surface it if it is real. A
 *    declaration processed successfully is marked, and its body-position
 *    evaluation is a no-op, so registration happens exactly once.
 *
 * 2. The metadata subtype judgment of #sec-primitive-metadata is applied to
 *    every deferred pair: it holds of metadata s and t when `subtype` of every
 *    governing meta type holds of MetadataPortion(s, M) and
 *    MetadataPortion(t, M). Mirroring IsOfType's validation walk, a hook
 *    registered against the BASE type (`meta float32 { ... }`, the engine's
 *    base form) is consulted too, receiving the whole metadata, since the base
 *    form claims no keys and the portion notion is claim-relative. A pair some
 *    meta type refuses is a type error naming both parameterizations, thrown
 *    before the body runs.
 *
 * What this pass deliberately does not do yet, pinned rather than implied:
 * enum declarations are not pre-processed (their member initializers are
 * expressions this engine does not yet hold to the compile-time-evaluable
 * discipline, so pre-running them could observe bindings early); declarations
 * nested in blocks or wrapped in `export` are left to body order; the
 * and judgment results are not yet memoized across passes, which
 * purity and interning license but nothing here needs at this scale.
 */
export function* RunPreEvaluationTypeCheck(root: ParseNode.Script | ParseNode.Module): PlainEvaluator {
  // #sec-evaluation-budget: this pass runs a source text's own type
  // declarations and then applies the metadata subtype judgment, both of which
  // call USER CODE - a builder, a `where`, a meta hook. It is therefore a
  // top-level type-position evaluation and is metered as one. Without this the
  // pass is an unbounded denial-of-service surface on any tool that runs it,
  // which is every tool that type-checks a file.
  BeginTypeEvaluation();
  try {
    return yield* runPreEvaluationTypeCheckMetered(root);
  } finally {
    EndTypeEvaluation();
  }
}

function* runPreEvaluationTypeCheckMetered(root: ParseNode.Script | ParseNode.Module): PlainEvaluator {
  const items = root.type === 'Script'
    ? root.ScriptBody?.StatementList
    : root.ModuleBody?.ModuleItemList;
  // PLAN-declarative-checker-facts.md phase 2. A |ComputedType| alias -
  // `type G = makeG();` - resolves by EVALUATING, so the walk that runs at
  // PARSE time cannot know what it denotes: nothing has evaluated yet, the
  // annotation reads ~any~, and a bad value is left to the run-time boundary.
  // The loop below is where it becomes knowable, and the walk below THAT is
  // where it can be used - but that walk only runs when narrowing recorded
  // something, so an alias-annotated binding never reached it.
  let computedAliasResolved = false;
  for (const item of items ?? []) {
    if (item.type === 'TypeAliasDeclaration' || item.type === 'InterfaceDeclaration') {
      const attempt = EnsureCompletion(yield* Evaluate_RuntimeTypesBindingDeclaration(item));
      if (attempt.Type === 'normal') {
        preEvaluatedTypeDeclarations.add(item);
        if (item.type === 'TypeAliasDeclaration'
          && (item as { Type?: { type?: string } }).Type?.type === 'ComputedType') {
          computedAliasResolved = true;
        }
      }
    } else if (item.type === 'MetaDeclaration') {
      const attempt = EnsureCompletion(yield* Evaluate_MetaDeclaration(item));
      if (attempt.Type === 'normal') {
        preEvaluatedTypeDeclarations.add(item);
      }
    }
  }
  // The unclaimed-key error, adjudicated HERE and not in the walk: claims
  // register when a MetaDeclaration evaluates, and the loop above has just
  // pre-evaluated this source text's own, so a parameterization written above
  // its meta type is legal while a key claimed nowhere in the agent is the
  // clause's type error, named at the parameterization that writes it.
  // Adjudicated BEFORE the pairwise judgment below, so a deferred pair riding
  // only on unclaimed keys is rejected earlier and for the right reason,
  // which closes cycle 26's vacuous-admit rider by the plan's own prediction.
  for (const check of TakeUnclaimedKeyChecks(root)) {
    if (HasMetaHooks(GetTypeObject(check.base) as unknown as object)) {
      // The base-form waiver (C9, found while landing this phase): a meta
      // registered against the BASE receives the whole metadata, so it speaks
      // for every key of a parameterization of that base, and the brand and
      // where-shaped programs of the base-form route stay legal. The route
      // and its waiver are one engine affordance, pinned together.
      continue;
    }
    for (const key of check.keys) {
      if (MetaTypeClaiming(key) === undefined) {
        return Throw.TypeError('$1 is not claimed by any meta type, in $2', Value(key), Value(check.display));
      }
    }
  }
  // #sec-metadata-narrowing: resolve each recorded comparison by calling
  // `narrow`, which this pass can do and the walk cannot. OUTERMOST FIRST along
  // the parent links, so an inner request narrows from its parent's result -
  // the clause's example is `if (v >= 0)` giving `bounds: 0..` and "a further
  // `if (v <= 343)` intersect that bound to `0..=343`", which reading each
  // request against the declared type would not produce.
  const resolutions = new Map<object, NarrowingResolution>();
  const requests = TakeNarrowingRequests(root);
  const byKey = new Map<object, NarrowingRequest>();
  for (const r of requests) {
    byKey.set(r.key, r);
  }
  const depthOf = (r: NarrowingRequest): number => {
    let d = 0;
    let p = r.parent;
    while (p) {
      d += 1;
      p = byKey.get(p)?.parent ?? null;
    }
    return d;
  };
  const ordered = [...requests].sort((x, y) => depthOf(x) - depthOf(y));
  for (const request of ordered) {
    // An inner guard sits inside the outer's consequent, so it narrows from the
    // parent's TRUE-branch result where it has a parent.
    const parent = request.parent ? resolutions.get(request.parent) : undefined;
    const from = parent ? parent.whenTrue : (request.subject as TypeRecord);
    const whenTrue = Q(yield* NarrowedMetadata(from, request.operator, request.constant));
    const negated = NEGATED_COMPARISON[request.operator] ?? request.operator;
    const whenFalse = Q(yield* NarrowedMetadata(from, negated, request.constant));
    resolutions.set(request.key, { whenTrue, whenFalse });
  }
  SetNarrowingResolutions(root, resolutions);
  // A3.3: the SECOND walk. The first ran without any narrowing, so it both
  // over-reports (an un-narrowed binding failing an assignment narrowing would
  // admit) and under-reports (a diagnostic that needs the narrowed type). This
  // walk has strictly more information, so its errors are the answer - and it
  // reports by THROWING, because that is how this pass speaks, where the first
  // walk's errors joined the early error list.
  //
  // Only when something was recorded (A3.4): a program that never compares a
  // bounded value must pay none of this, and must keep reporting at parse time.
  // ... or when this source text declared a call-form alias that has only just
  // become resolvable: the first walk read it as ~any~, and this one reads what
  // it denotes. Gated on that rather than run always, so a text with no such
  // alias pays nothing - the same discipline the narrowing gate applies.
  if (requests.length > 0 || computedAliasResolved) {
    const errors = CheckScript(root as ParseNode.Script);
    if (errors.length > 0) {
      return Throw(errors[0]!);
    }
  }
  for (const pair of TakeDeferredMetadataChecks(root)) {
    const admits = Q(yield* MetadataSubtypeJudgment(pair));
    if (!admits) {
      return Throw.TypeError('$1 is not assignable to $2', Value(displayType(pair.source)), Value(displayType(pair.target)));
    }
  }
  // PLAN-default-timing.md phase 2. #sec-defaultvalueof: "It is a type error to
  // declare a binding or a field with a type _t_ and no initializer when
  // DefaultValueOf(_t_) is ~none~", and #sec-type-errors makes a type error
  // determinable before the text runs an Early Error - so a source text
  // containing one is rejected rather than evaluated. The engine answered at
  // DECLARATION EVALUATION, which meant the error arrived after the program had
  // begun and a declaration in a branch that never ran was never checked.
  //
  // Adjudicated HERE for the reason the two channels above are: the answer
  // needs `DefaultValueOf`, an evaluator the synchronous walk cannot call, and
  // it needs this text's `meta` declarations processed, which the loop at the
  // top of this pass has just done. An older comment at the evaluation-time
  // site said a checking-pass test would refuse `type T = ...; meta T { default
  // = "d"; } let s: T;` - that was true before the pass pre-processed type
  // declarations and is not true now.
  const nestedMetaNames = TakeBlockScopedMetaNames(root);
  for (const requirement of TakeDefaultRequirements(root)) {
    // D4's guard: a `meta` declaration nested where this loop cannot see it -
    // the loop scans TOP-LEVEL items - may register a default for this very
    // type at run time, and `{ meta T { default = "d"; } } let s: T;` works
    // today. Where such a declaration names the type, the question is left to
    // the evaluation-time site rather than answered wrongly here.
    if (nestedMetaNames.has(requirement.display)) {
      continue;
    }
    let dflt = LookupTypeDefault(GetTypeObject(requirement.type));
    if (dflt === undefined) {
      const attempt = EnsureCompletion(yield* DefaultValueOf(requirement.type));
      if (attempt.Type !== 'normal') {
        return attempt;
      }
      dflt = attempt.Value as Value | undefined;
    }
    if (dflt === undefined) {
      // A budget exhaustion is NOT "no default": answering so would reject a
      // valid program for running out of steps, so the budget error below is
      // what reports, and this check stands down.
      if (IsBudgetExhausted()) {
        break;
      }
      return Throw.TypeError('$1 has no default value, so a declaration of it needs an initializer', Value(requirement.display));
    }
  }
  // #sec-evaluation-budget: "the evaluation is abandoned, and
  // EvaluateToTypeObject of the containing type-position expression is
  // ~empty~, with a diagnostic naming the outermost call". Reported once, HERE,
  // at the end of the whole pass rather than at the metered point that noticed
  // - the point that notices is wherever the last step happened to be spent,
  // which is not the containing evaluation the clause asks to name. It is also
  // why the check must come after the work and not before it: an earlier
  // version of this sat above the judgments that spend the budget and could
  // never observe an exhaustion they caused.
  if (IsBudgetExhausted()) {
    return Throw.RangeError(
      'the type evaluation budget was exhausted ($1) while checking this source text',
      Value(BudgetExhaustionKind() ?? 'steps'),
    );
  }
  return undefined;
}

/**
 * #sec-primitive-metadata, the metadata subtype judgment, over one deferred
 * pair. Every governing meta type must admit its portions; a base-registered
 * hook, where one exists, must admit the whole metadata. A meta type is
 * required at declaration to define `subtype`, so a governing meta type with
 * no hook does not arise from a conforming declaration; were one reached, the
 * absent hook reads as a refusal, since a meta type that states no relation
 * between two of its parameterizations admits no crossing between them.
 */
/**
 * #sec-metadata-narrowing: "The false branch narrows by the negation of _op_,
 * pairing `>=` with `<`, `>` with `<=`, and `==` with `!=`, in both
 * directions." Six entries, because the pairing is symmetric.
 */
const NEGATED_COMPARISON: Record<string, string> = {
  '>=': '<', '<': '>=', '>': '<=', '<=': '>', '==': '!=', '!=': '==',
};

/**
 * #sec-metadata-narrowing: NarrowMetadata(_m_, _op_, _c_) - "the metadata whose
 * portion for each meta type _M_ defining `narrow` is the result of `narrow` of
 * _M_ ... and whose portion for each other meta type is UNCHANGED".
 *
 * Participation is by hook DEFINITION, not by portion, which is where this
 * differs from the subtype judgment below. A meta type defining no `narrow`
 * "learns nothing from a comparison and keeps the constraint it had".
 */
function* NarrowedMetadata(subject: TypeRecord, operator: string, constant: Value): PlainEvaluator<TypeRecord> {
  if (subject.Kind !== 'parameterized') {
    return subject;
  }
  const merged: Record<string, unknown> = Object.create(null);
  const source = subject.Metadata as unknown as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    merged[key] = source[key];
  }
  for (const metaType of GoverningMetaTypes(subject.Metadata).types) {
    if (LookupMetaHook(metaType, 'narrow') === undefined) {
      continue;
    }
    const portion = MetadataPortion(subject.Metadata, metaType);
    // Q3: a `narrow` hook that THROWS leaves the binding un-narrowed rather than
    // failing the program. `subtype` answers a JUDGMENT, so one that cannot be
    // made must refuse; `narrow` produces KNOWLEDGE, and the clause already
    // sanctions the outcome of learning nothing - a meta type defining no
    // `narrow` "keeps the constraint it had, which costs a check at the next
    // boundary and nothing else". A hook that throws is that situation arrived
    // at differently.
    //
    // This is not hypothetical: the pass runs BEFORE evaluation, so a hook
    // touching anything the script initializes throws a TDZ ReferenceError, and
    // propagating it would fail every program whose meta type does so.
    const attempt = EnsureCompletion(yield* ApplyMetaHook(metaType, 'narrow', [portion, Value(operator), constant]));
    if (attempt.Type !== 'normal') {
      continue;
    }
    // The hook returns a metadata object in the ENGINE's value space, so its own
    // enumerable keys are an ObjectValue's internals - reading them directly
    // produced `{ bounds: ..., properties: {...} }`. Snapshotting it through the
    // metadata value language is what a meta type's `default` gets, for the same
    // reason: a portion is CARRIED structurally, not read off an object whose
    // fields happen to be enumerable.
    const snapshot = EnsureCompletion(yield* SnapshotMetadataValue(attempt.Value as Value));
    if (snapshot.Type !== 'normal') {
      continue;
    }
    const n = snapshot.Value as unknown as Record<string, unknown>;
    if (n && typeof n === 'object') {
      for (const key of Object.keys(n)) {
        merged[key] = n[key];
      }
    }
  }
  return {
    Kind: 'parameterized', Base: subject.Base, Metadata: Object.freeze(merged) as unknown as Value,
  } as unknown as TypeRecord;
}

function* MetadataSubtypeJudgment(pair: DeferredMetadataCheck): PlainEvaluator<boolean> {
  const s = pair.source.Metadata;
  const t = pair.target.Metadata;
  const governing = new Set<object>([
    ...GoverningMetaTypes(s).types,
    ...GoverningMetaTypes(t).types,
  ]);
  for (const metaType of governing) {
    if (!MetaTypeGoverns(s, metaType) && !MetaTypeGoverns(t, metaType)) {
      // Participation (plan section 2): both portions at the default means no
      // part taken. `subtype(default, default)` is never consulted, so a
      // hostile or throwing hook cannot veto a crossing carrying none of its
      // metadata, and no hook need be reflexive at its own default.
      continue;
    }
    const verdict = Q(yield* ApplyMetaHook(metaType, 'subtype', [
      MetadataPortion(s, metaType),
      MetadataPortion(t, metaType),
    ]));
    if (verdict !== Value.true) {
      return false;
    }
  }
  const baseObject = GetTypeObject(pair.source.Base);
  const verdict = Q(yield* ApplyMetaHook(baseObject as unknown as object, 'subtype', [s, t]));
  if (verdict !== undefined && verdict !== Value.true) {
    return false;
  }
  return true;
}
