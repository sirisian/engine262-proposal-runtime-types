import type { ParseNode } from '../parser/ParseNode.mts';
import { EnsureCompletion, Q } from '../completion.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import { ApplyMetaHook, GoverningMetaTypes, MetaTypeGoverns, MetadataPortion } from '../abstract-ops/runtime-types.mts';
import {
  Evaluate_MetaDeclaration, Evaluate_RuntimeTypesBindingDeclaration, preEvaluatedTypeDeclarations,
} from '../runtime-semantics/RuntimeTypesDeclarations.mts';
import { Value } from '../value.mts';
import { GetTypeObject } from './intern.mts';
import { displayType } from './records.mts';
import { TakeDeferredMetadataChecks, type DeferredMetadataCheck } from './check.mts';
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
 * evaluation budget of #sec-evaluation-budget is not yet wired to the hook
 * calls; and judgment results are not yet memoized across passes, which
 * purity and interning license but nothing here needs at this scale.
 */
export function* RunPreEvaluationTypeCheck(root: ParseNode.Script | ParseNode.Module): PlainEvaluator {
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
  for (const pair of TakeDeferredMetadataChecks(root)) {
    const admits = Q(yield* MetadataSubtypeJudgment(pair));
    if (!admits) {
      return Throw.TypeError('$1 is not assignable to $2', Value(displayType(pair.source)), Value(displayType(pair.target)));
    }
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
