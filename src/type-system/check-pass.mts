import type { ParseNode } from '../parser/ParseNode.mts';
import type { TypeRecord } from './records.mts';
import { EnsureCompletion, Q } from '../completion.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import { ApplyMetaHook, GoverningMetaTypes, LookupMetaHook, HasMetaHooks, MetaTypeClaiming, MetaTypeGoverns, MetadataPortion } from '../abstract-ops/runtime-types.mts';
import {
  Evaluate_MetaDeclaration, Evaluate_RuntimeTypesBindingDeclaration, preEvaluatedTypeDeclarations,
} from '../runtime-semantics/RuntimeTypesDeclarations.mts';
import { Value } from '../value.mts';
import { GetTypeObject } from './intern.mts';
import { displayType } from './records.mts';
import {
<<<<<<< Updated upstream
=======
  CheckScript,
>>>>>>> Stashed changes
  TakeDeferredMetadataChecks, TakeUnclaimedKeyChecks, TakeNarrowingRequests, SetNarrowingResolutions,
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
  for (const item of items ?? []) {
    if (item.type === 'TypeAliasDeclaration' || item.type === 'InterfaceDeclaration') {
      const attempt = EnsureCompletion(yield* Evaluate_RuntimeTypesBindingDeclaration(item));
      if (attempt.Type === 'normal') {
        preEvaluatedTypeDeclarations.add(item);
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
<<<<<<< Updated upstream
=======
  // A3.3: the SECOND walk. The first ran without any narrowing, so it both
  // over-reports (an un-narrowed binding failing an assignment narrowing would
  // admit) and under-reports (a diagnostic that needs the narrowed type). This
  // walk has strictly more information, so its errors are the answer - and it
  // reports by THROWING, because that is how this pass speaks, where the first
  // walk's errors joined the early error list.
  //
  // Only when something was recorded (A3.4): a program that never compares a
  // bounded value must pay none of this, and must keep reporting at parse time.
  if (requests.length > 0) {
    const errors = CheckScript(root as ParseNode.Script);
    if (errors.length > 0) {
      return Throw(errors[0]!);
    }
  }
>>>>>>> Stashed changes
  for (const pair of TakeDeferredMetadataChecks(root)) {
    const admits = Q(yield* MetadataSubtypeJudgment(pair));
    if (!admits) {
      return Throw.TypeError('$1 is not assignable to $2', Value(displayType(pair.source)), Value(displayType(pair.target)));
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
    const narrowed = attempt.Value;
<<<<<<< Updated upstream
=======
    // KNOWN DEFECT (A3.5): the hook's return is merged by its own enumerable
    // keys, which picks up an ObjectValue's internal fields - a narrowed type
    // comes out as `{ bounds: ..., properties: {...} }`. The narrowing itself
    // works, and the type does change; what is wrong is the SHAPE of the
    // merged portion. The fix is to snapshot the hook's return through the
    // metadata value language, as `SnapshotMetadataValue` does for a default,
    // rather than reading its keys directly.
>>>>>>> Stashed changes
    if (narrowed && typeof narrowed === 'object') {
      const n = narrowed as unknown as Record<string, unknown>;
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
