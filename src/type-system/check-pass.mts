import { GenericWhereVerified, MarkGenericWhereVerified } from './generic-where.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { EnsureCompletion, Q, X } from '../completion.mts';
import { FirstFreeReference } from '../static-semantics/PreprocessorEvaluability.mts';
import { DefaultValueOf, EvaluateAliasApplicationClauses, TypeNodeToTypeRecord, bindTypeParameter, pushTypeParameterFrame, popTypeParameterFrame, EvaluateRefinementPredicate, ValuePackView } from './runtime.mts';
import type { TypeRecord } from './records.mts';
import type { PlainEvaluator } from '../evaluator.mts';
import { RequireType, ConvertValue, CheckedConvertValue, ApplyMetaHook, GoverningMetaTypes, LookupMetaHook, SnapshotMetadataValue, HasMetaHooks, MetaTypeClaiming, MetaTypeGoverns, MetadataPortion, LookupTypeDefault, PrimitiveCastsFor, CastCoversTarget } from '../abstract-ops/runtime-types.mts';
import {
  Evaluate_MetaDeclaration, Evaluate_RuntimeTypesBindingDeclaration, preEvaluatedTypeDeclarations,
  typeDeclarationNamesInPass,
} from '../runtime-semantics/RuntimeTypesDeclarations.mts';
import { Evaluate_PrimitiveOperatorDeclaration } from '../runtime-semantics/PrimitiveOperatorDeclaration.mts';
import { Value } from '../value.mts';
import { SetMetResolution } from './intern.mts';
import { GetTypeObject } from './intern.mts';
import { displayType, builtinTypeRecord, BoundTypeRecordForName } from './records.mts';
import { SameType } from './relations.mts';
import { isIntegerTypeName, isFloatTypeName } from './numeric-signatures.mts';
import {
  RecheckAfterTypeEvaluation, HasDeferredGuardChecks, DeferredTypeChecksOf, SetEvaluatedTypeNode, SetEvaluatedEnum,
  TakeDeferredMetadataChecks, TakeDeferredCrossingChecks, TakeDeferredMeetChecks, TakeUnclaimedKeyChecks, TakeNarrowingRequests, SetNarrowingResolutions,
  TakeDefaultRequirements, GenericWhereChecksOf, DefaultConversionChecksOf, GenericDefaultChecksOf, SetEvaluatedGenericDefault,
  type DeferredMetadataCheck, type NarrowingRequest, type NarrowingResolution,
} from './check.mts';
import { BeginTypeEvaluation, BudgetExhaustionKind, EndTypeEvaluation, IsBudgetExhausted } from './budget.mts';
import { FirstNonEvaluableForm } from './evaluable-fragment.mts';
import { BeginFragmentEvaluation, EndFragmentEvaluation } from './fragment-library.mts';
import { Evaluate, GetValue, inspect, Throw, DeclarativeEnvironmentRecord, InstantiateFunctionObject, surroundingAgent } from '#self';

/**
 * The names the compile-time-evaluable fragment guarantees.
 *
 * #annex-evaluable-fragment, "The Library Surface": the floor is "the type
 * operations of #sec-type-objects, Type Object identity and `toString`, regular
 * expression construction and matching, `Map` and `Set`, whose keys Type Objects
 * serve as by interned identity, `Symbol` and its registry, and the pure methods
 * and functions of String, Number, BigInt, Math, Array, Object, and JSON."
 *
 * Naming it once, because the pass tests the same membership in two places and
 * they had drifted: the obligation path listed these inline and omitted `JSON`,
 * `Map` and `Set`, which the annex names explicitly.
 *
 * This is an ALLOWLIST of names an evaluation may READ, which is a different
 * question from whether a particular built-in is in the fragment - `Math` is
 * here and `Math.random` is excluded, and the exclusion is enforced on the
 * function at the call (`fragment-library.mts`), not by this set.
 */
/**
 * Is _name_ the base of a numeric type a bare numeric literal can reach?
 *
 * #sec-numeric-types: "Each integer, binary floating-point, decimal
 * floating-point, rational, complex, and vector type is a numeric type in that
 * sense." A VECTOR is left out here on purpose: #sec-literal-propagation states
 * its rule over "a position whose contextual type is a numeric VALUE type", and
 * a bare literal does not reach a vector position, so including it could only
 * refuse something the clause does not reach.
 */
function isNumericTypeName(name: string): boolean {
  return name === 'number'
    || isIntegerTypeName(name) || isFloatTypeName(name)
    || name.startsWith('decimal') || name === 'rational' || name === 'complex';
}

const FRAGMENT_FLOOR: readonly string[] = [
  'undefined', 'NaN', 'Infinity',
  'String', 'Number', 'BigInt', 'Boolean', 'Symbol', 'Object', 'Array', 'Math', 'JSON',
  'Map', 'Set', 'RegExp', 'Reflect',
];

/**
 * Does this type's default depend on a CLASS declared in this source text?
 *
 * A value type class's
 * default is "the instance of _t_ each of whose fields holds the default of the
 * field's type" - an object that only exists once the class has evaluated. The
 * pass pre-processes type aliases, interfaces, `meta` declarations and
 * `primitive` blocks; a CLASS DECLARATION is an ordinary declaration evaluated
 * with the body, so at check time there is nothing to instantiate and
 * `DefaultValueOf` answers ~none~ for a type that has a perfectly good default
 * at run time. `class P { a: uint8; } let d: [P, P];` is the case
 * `typed-bindings.test.mts` caught.
 *
 * Same shape as the nested-`meta` guard below and the same resolution: where the pass has not
 * processed what supplies the default, it does not answer, and the
 * evaluation-time site does.
 */
function defaultNeedsEvaluatedClass(t: TypeRecord, seen: Set<TypeRecord> = new Set()): boolean {
  if (seen.has(t)) {
    return false;
  }
  seen.add(t);
  if (t.Kind === 'nominal') {
    const declared = (t.Declaration as { type?: string } | undefined)?.type;
    return declared === 'ClassDeclaration' || declared === 'ClassExpression';
  }
  if (t.Kind === 'tuple') {
    return t.Elements.some((e) => defaultNeedsEvaluatedClass(e.Type, seen));
  }
  if (t.Kind === 'array') {
    return defaultNeedsEvaluatedClass(t.Element, seen);
  }
  if (t.Kind === 'union' || t.Kind === 'intersection') {
    return t.Members.some((m) => defaultNeedsEvaluatedClass(m, seen));
  }
  return false;
}

/**
 * Type names named by a `meta` declaration this pass did NOT pre-process.
 *
 * The pre-evaluation loop scans a Script's or
 * Module's TOP-LEVEL items, so a `meta` declaration nested in a block is
 * invisible to it - and perfectly visible to the running program, which
 * registers its `default` when the block evaluates. This program works and must
 * keep working:
 *
 *   type T = uint8 | string;
 *   { meta T { subtype(a, b) { return true; } default = "d"; } }
 *   let s: T;                                   // "d"
 *
 * Answering "no default" for `T` here would reject it. So the names such a
 * declaration could supply a default for are collected, and the check stands
 * down for them; the evaluation-time site answers instead.
 *
 * Collected by scanning rather than from the walk: the checker has no
 * |MetaDeclaration| arm - meta hooks register when the declaration EVALUATES,
 * which is why the walk never needed one - and adding a walk arm for a set this
 * pass consumes would put the knowledge further from its only reader.
 */
function nestedMetaTypeNames(root: ParseNode): Set<string> {
  const names = new Set<string>();
  const visit = (node: ParseNode): void => {
    if (node.type === 'MetaDeclaration') {
      // Keyed on what the LOOP PROCESSED, not on what is top-level. A top-level
      // BLOCK is itself a top-level item, so skipping top-level items skipped
      // the block whose contents are the whole point - the scan found nothing
      // and the guard never fired.
      if (!preEvaluatedTypeDeclarations.has(node)) {
        const named = (node as unknown as { TypeName?: { IdentifierReference?: { name?: string } } })
          .TypeName?.IdentifierReference?.name;
        if (typeof named === 'string') {
          names.add(named);
        }
      }
      return;
    }
    for (const key of Object.keys(node)) {
      if (key === 'parent' || key === 'location' || key === 'strict' || key === 'sourceText') {
        continue;
      }
      const child = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(child)) {
        for (const c of child) {
          if (c && typeof c === 'object' && 'type' in (c as object)) {
            visit(c as ParseNode);
          }
        }
      } else if (child && typeof child === 'object' && 'type' in (child as object)) {
        visit(child as ParseNode);
      }
    }
  };
  visit(root);
  return names;
}

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
 * Enum declarations with runtime dependencies or decorators, and declarations
 * nested in blocks or wrapped in `export`, are left to body order. Closed enum
 * declarations are processed below. Metadata judgments are not memoized across
 * passes.
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
  // A |ComputedType| alias -
  // `type G = makeG();` - resolves by EVALUATING, so the walk that runs at
  // PARSE time cannot know what it denotes: nothing has evaluated yet, the
  // annotation reads ~any~, and a bad value is left to the run-time boundary.
  // The loop below is where it becomes knowable, and the walk below THAT is
  // where it can be used - but that walk only runs when narrowing recorded
  // something, so an alias-annotated binding never reached it.
  let computedAliasResolved = false;
  // #sec-generic-where: a violated
  // clause is a type error at the SPECIALIZATION, and a written application's
  // arguments are in the source - so it is determinable, and #sec-type-errors
  // then makes it an Early Error: "a source text that contains one is rejected
  // rather than evaluated".
  //
  // Collected here rather than checked in `check.mts` because the checker is
  // SYNCHRONOUS and a predicate reaches user code through `yield*`. This loop is
  // a generator and runs before the checker walks, which is the same shape the
  // ComputedType pre-evaluation above already uses.
  //
  // Keyed by the APPLICATION node, not the alias name: `Pos.<3>` and `Pos.<0>`
  // are two applications of one name and must not share a verdict.
  const aliasDeclarations = new Map<string, ParseNode>();
  for (const item of items ?? []) {
    if (item.type === 'TypeAliasDeclaration') {
      const declName = (item as { BindingIdentifier?: { name?: string } }).BindingIdentifier?.name;
      const cls = (item as { WhereClauses?: readonly ParseNode[] | null }).WhereClauses;
      if (typeof declName === 'string' && cls && cls.length > 0
          && (item as { TypeParameters?: unknown }).TypeParameters) {
        aliasDeclarations.set(declName, item);
      }
    }
  }
  if (aliasDeclarations.size > 0) {
    const applications: { node: ParseNode, declaration: ParseNode }[] = [];
    // A visited set, because a Parse Node graph has PARENT links: `node.parent`
    // points back up, so a plain recursive walk revisits forever. The same trap
    // the contract-fact walk met, and the reason that one carries a set too.
    const seen = new Set<object>();
    const seek = (node: ParseNode | null | undefined, depth = 0): void => {
      if (!node || typeof node !== 'object' || depth > 40 || seen.has(node)) {
        return;
      }
      seen.add(node);
      if ((node as { type?: string }).type === 'TypeReference'
          && (node as { TypeArguments?: unknown }).TypeArguments) {
        const named = (node as { TypeName?: { IdentifierReference?: { name?: string } } })
          .TypeName?.IdentifierReference?.name;
        const decl = typeof named === 'string' ? aliasDeclarations.get(named) : undefined;
        if (decl) {
          applications.push({ node, declaration: decl });
        }
      }
      for (const key of Object.keys(node)) {
        if (key === 'parent' || key === 'location' || key === 'source') {
          continue;
        }
        let value;
        try {
          value = (node as unknown as Record<string, unknown>)[key];
        } catch {
          continue;
        }
        if (Array.isArray(value)) {
          value.forEach((v) => seek(v as ParseNode, depth + 1));
        } else if (value && typeof value === 'object') {
          seek(value as ParseNode, depth + 1);
        }
      }
    };
    (items ?? []).forEach((i) => seek(i));
    for (const applied of applications) {
      const verdict = EnsureCompletion(yield* EvaluateAliasApplicationClauses(
        applied.declaration as never, applied.node as never,
      ));
      if (verdict.Type === 'throw') {
        return verdict;
      }
    }
  }
  // The names this pass is defining, so a recursive reference can be told from a
  // member naming a VALUE binding - both report "cannot be used before
  // initialization" from the same site.
  for (const item of items ?? []) {
    if (item.type === 'TypeAliasDeclaration' || item.type === 'InterfaceDeclaration') {
      const declared = (item as unknown as { BindingIdentifier?: { name?: string } }).BindingIdentifier?.name;
      if (declared) {
        typeDeclarationNamesInPass.add(declared);
      }
    }
  }
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
    } else if (item.type === 'PrimitiveOperatorDeclaration') {
      // Found by the suite. #sec-type-errors lists what the pass processes before applying a
      // judgment that consults it: "its type aliases, its interfaces, its
      // `meta` declarations, AND THE IMPLICIT CAST OPERATORS OF ITS `primitive`
      // BLOCKS". The loop had the first three.
      //
      // It mattered the moment a default was decided here: a parameterization's
      // default is its base's zero HAVING CROSSED, and a cast is one of the two
      // ways through - so `primitive float64 { operator float64.<{ m: 1 }>... }
      // let d: Meter;` has a default only if that operator has been processed.
      // Without this the pass answered "no default" and refused a program the
      // run time accepts, which `typed-bindings.test.mts` caught.
      const attempt = EnsureCompletion(yield* Evaluate_PrimitiveOperatorDeclaration(item));
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
  // #sec-bindtypearguments: a default can read earlier bindings. Evaluate
  // closed defaults per application, then publish the instantiated signature.
  // Rechecking can expose a later default that depends on the one just filled.
  for (;;) {
    let resolved = false;
    for (const check of GenericDefaultChecksOf(root)) {
      const available = new Set(check.bindings.keys());
      if (FirstNonEvaluableForm(check.node) || FirstFreeReference(check.node, available)) continue;
      const context = surroundingAgent.runningExecutionContext;
      const outer = context.LexicalEnvironment;
      const scope = new DeclarativeEnvironmentRecord(null);
      const frame = new Map<string, TypeRecord>();
      for (const parameter of check.parameters) {
        const bound = check.bindings.get(parameter.Name);
        if (!bound) continue;
        bindTypeParameter(frame, parameter.Name, bound, parameter.Declaration);
        let value: Value;
        if (parameter.Kind === 'value' && bound.Kind === 'literal') value = bound.Value;
        else if (parameter.Kind === 'value' && bound.Kind === 'tuple') value = Q(yield* ValuePackView(bound));
        else value = GetTypeObject(bound);
        X(scope.CreateImmutableBinding(Value(parameter.Name), Value.true));
        X(scope.InitializeBinding(Value(parameter.Name), value));
      }
      context.LexicalEnvironment = scope;
      pushTypeParameterFrame(frame);
      BeginFragmentEvaluation();
      let result;
      try {
        result = EnsureCompletion(yield* TypeNodeToTypeRecord(check.node));
      } finally {
        EndFragmentEvaluation();
        popTypeParameterFrame();
        context.LexicalEnvironment = outer;
      }
      if (result.Type !== 'normal') {
        if (IsBudgetExhausted()) return result;
        return Throw.StaticTypeError('a generic default could not be evaluated: $1', Value(inspect(result.Value)));
      }
      SetEvaluatedGenericDefault(check.application, check.node, result.Value);
      resolved = true;
    }
    if (!resolved) break;
    const errors = RecheckAfterTypeEvaluation(root);
    if (errors.length) return Throw(errors[0]);
  }
  for (const check of DefaultConversionChecksOf(root)) {
    let value = check.value;
    if (value === undefined && check.initializer) {
      // The SYNTACTIC half of the fragment, and then what the initializer may
      // read. The allowed set was `new Set()` - empty - so any default naming a
      // global was skipped, and `Math` is a global. That skipped exactly the
      // population the LIBRARY half of the fragment exists to judge, which is
      // why `type T = [uint8 = Math.random()]` was diagnosed by the runtime
      // resolver when the declaration ran, and why the same default in a
      // parameter annotation - which that resolver never reaches - was not
      // diagnosed at all.
      //
      // The floor is the annex's, not an invention, and it is the set the
      // obligation path below already uses. A default naming anything else is
      // still skipped: #sec-evaluatetotypeobject only evaluates what it can read
      // at check time, and a name this pass cannot resolve is not one of them.
      if (FirstNonEvaluableForm(check.initializer)
        || FirstFreeReference(check.initializer, new Set(FRAGMENT_FLOOR))) continue;
      BeginFragmentEvaluation();
      let evaluated;
      try {
        evaluated = EnsureCompletion(yield* Evaluate(check.initializer));
        if (evaluated.Type === 'normal' && evaluated.Value !== undefined) {
          evaluated = EnsureCompletion(yield* GetValue(evaluated.Value));
        }
      } finally {
        EndFragmentEvaluation();
      }
      // #sec-evaluatetotypeobject: an abrupt completion makes the result
      // ~empty~, and ~empty~ in type position "is a type error" - an Early Error
      // by #sec-type-errors. This arm used to `continue`, discarding the
      // completion and the judgment with it. The generic-default arm above
      // already does exactly what this now does, budget check included.
      if (evaluated.Type !== 'normal') {
        if (IsBudgetExhausted()) break;
        return Throw.StaticTypeError('a default could not be evaluated: $1', Value(inspect(evaluated.Value)));
      }
      if (evaluated.Value === undefined) continue;
      value = evaluated.Value;
    }
    if (value === undefined) continue;
    const converted = EnsureCompletion(yield* (check.checked
      ? CheckedConvertValue(value, check.type) : ConvertValue(value, check.type)));
    if (converted.Type !== 'normal') {
      if (IsBudgetExhausted()) break;
      return Throw.StaticTypeError('a default is not convertible to $1', Value(displayType(check.type)));
    }
  }
  for (const check of GenericWhereChecksOf(root)) {
    const parameters = check.declaration.TypeParameters!.TypeParameterList;
    const frame = new Map<string, TypeRecord>();
    for (const parameter of parameters) {
      const name = parameter.BindingIdentifier.name;
      bindTypeParameter(frame, name, check.bindings.get(name)!, parameter);
    }
    const available = new Set(frame.keys());
    for (const clause of check.clauses) {
      const predicate = clause.RefinementPredicate;
      if (GenericWhereVerified(clause, frame) || FirstNonEvaluableForm(predicate) || FirstFreeReference(predicate, available)) continue;
      // Runtime subjects and writes require their evaluation-time environment.
      const hasRuntimeSubject = (node: ParseNode): boolean => {
        if (['ThisExpression', 'ContractReturn', 'AssignmentExpression', 'UpdateExpression'].includes(node.type)
          || (node.type === 'UnaryExpression' && node.operator === 'delete')) return true;
        return Object.entries(node).some(([key, child]) => {
          if (['parent', 'location', 'sourceText'].includes(key)) return false;
          return Array.isArray(child) ? child.some((part) => part && typeof part === 'object' && 'type' in part && hasRuntimeSubject(part))
            : child && typeof child === 'object' && 'type' in child && hasRuntimeSubject(child as ParseNode);
        });
      };
      if (hasRuntimeSubject(predicate)) continue;
      const context = surroundingAgent.runningExecutionContext;
      const outer = context.LexicalEnvironment;
      const scope = new DeclarativeEnvironmentRecord(null);
      for (const parameter of parameters) {
        const name = parameter.BindingIdentifier.name;
        const bound = frame.get(name)!;
        let value: Value;
        if (parameter.IsValueParameter && bound.Kind === 'literal') {
          value = bound.Value;
        } else if (parameter.IsValueParameter && bound.Kind === 'tuple') {
          value = Q(yield* ValuePackView(bound));
        } else {
          value = GetTypeObject(bound);
        }
        X(scope.CreateImmutableBinding(Value(name), Value.true));
        X(scope.InitializeBinding(Value(name), value));
      }
      context.LexicalEnvironment = scope;
      pushTypeParameterFrame(frame);
      BeginFragmentEvaluation();
      let result;
      try {
        result = EnsureCompletion(yield* EvaluateRefinementPredicate(predicate, Value.undefined));
      } finally {
        EndFragmentEvaluation();
        popTypeParameterFrame();
        context.LexicalEnvironment = outer;
      }
      if (result.Type === 'throw') {
        if (IsBudgetExhausted()) return result;
        // Layouts and decorated types may not have evaluated yet.
        continue;
      }
      if (!result.Value) return Throw.StaticTypeError('a $1 clause is not satisfied by this application', Value('where'));
      MarkGenericWhereVerified(clause, frame);
    }
  }
  // The unclaimed-key error, adjudicated HERE and not in the walk: claims
  // register when a MetaDeclaration evaluates, and the loop above has just
  // pre-evaluated this source text's own, so a parameterization written above
  // its meta type is legal while a key claimed nowhere in the agent is the
  // clause's type error, named at the parameterization that writes it.
  // Adjudicated BEFORE the pairwise judgment below, so a deferred pair riding
  // only on unclaimed keys is rejected earlier and for the right reason, which
  // closes the vacuous-admit case.
  for (const check of TakeUnclaimedKeyChecks(root)) {
    if (HasMetaHooks(GetTypeObject(check.base) as unknown as object)) {
      // The base-form waiver: a meta
      // registered against the BASE receives the whole metadata, so it speaks
      // for every key of a parameterization of that base, and the brand and
      // where-shaped programs of the base-form route stay legal. The route
      // and its waiver are one engine affordance, pinned together.
      continue;
    }
    for (const key of check.keys) {
      if (MetaTypeClaiming(key) === undefined) {
        return Throw.StaticTypeError('$1 is not claimed by any meta type, in $2', Value(key), Value(check.display));
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
  const obligations = DeferredTypeChecksOf(root);
  // Closed enums supply values needed by later type expressions, notably
  // `keyof Reflect.typeOf(E)`. Run only declarations whose initializer reads
  // are available here; class instances and ordinary value bindings are still
  // initialized in body order. Their statically known contributions were
  // checked by the ordinary walk, including uncalled sequential functions.
  if ((items ?? []).some((item) => item.type === 'EnumDeclaration')) {
    // The annex's floor, named once. This was a THIRD inline copy of it, and
    // like the obligation path's it had drifted: it omitted `JSON`, `Map` and
    // `Set`, so `enum E: object { A = JSON } enum F: object { B = JSON }` was
    // skipped here and its collision reported only when the declaration ran,
    // while the same program written with `Math` was refused before it.
    const available = new Set<string>(FRAGMENT_FLOOR);
    const typeNames = (node: ParseNode | readonly ParseNode[]): void => {
      if (Array.isArray(node)) {
        node.forEach(typeNames);
        return;
      }
      const n = node as ParseNode;
      if (n.type === 'TypeReference') {
        const name = n.TypeName.IdentifierReference.name;
        if (builtinTypeRecord(name)) {
          available.add(name);
        }
      }
      for (const key of Object.keys(n)) {
        if (['parent', 'location', 'sourceText'].includes(key)) continue;
        const child = (n as unknown as Record<string, unknown>)[key];
        if (Array.isArray(child) || (child && typeof child === 'object' && 'type' in child)) typeNames(child as ParseNode);
      }
    };
    typeNames(items ?? []);
    for (const item of items ?? []) {
      if (item.type !== 'EnumDeclaration' || item.Decorators?.length || item.EnumMemberList.some((member) => member.Decorators?.length)
        || item.EnumMemberList.some((member) => member.Initializer
        && (FirstNonEvaluableForm(member.Initializer) || FirstFreeReference(member.Initializer, available)))) {
        continue;
      }
      const underlying = item.TypeAnnotation ? EnsureCompletion(yield* TypeNodeToTypeRecord(item.TypeAnnotation.Type)) : undefined;
      if (underlying && (underlying.Type !== 'normal' || defaultNeedsEvaluatedClass(underlying.Value))) {
        continue;
      }
      BeginFragmentEvaluation();
      try {
        const attempt = EnsureCompletion(yield* Evaluate_RuntimeTypesBindingDeclaration(item));
        if (attempt.Type !== 'normal') {
          // The ORIGINATING error is carried, rather than replaced by this
          // one's summary. The declaration is refused for a reason the
          // evaluation already stated precisely - `"B" is already an enumerator
          // of "E"`, a duplicate enumerator name, a first enumerator with no
          // initializer under a non-numeric underlying type - and all of them
          // arrived as the same sentence, which named the enum's shape and not
          // the mistake. The object-member default path states the principle:
          // "WHY it was not evaluable is the useful half of the diagnostic".
          return Throw.StaticTypeError(
            'a closed enum initializer does not satisfy its declaration: $1',
            Value(inspect(attempt.Value)),
          );
        }
        preEvaluatedTypeDeclarations.add(item);
        const value = Q(yield* surroundingAgent.runningExecutionContext.LexicalEnvironment.GetBindingValue(Value(item.BindingIdentifier.name), Value.true));
        const record = (value as unknown as { TypeRecord: TypeRecord }).TypeRecord;
        if (record?.Kind === 'nominal' && record.EnumMembers) SetEvaluatedEnum(item, record, record.EnumMembers);
      } finally {
        EndFragmentEvaluation();
      }
    }
  }
  for (const obligation of obligations) {
    const context = surroundingAgent.runningExecutionContext;
    const outer = context.LexicalEnvironment;
    const scope = new DeclarativeEnvironmentRecord(outer);
    const bindings = new Map(obligation.constants);
    const dependencies = new Set<string>();
    const seenDependencies = new Set<object>();
    const visitDependencies = (value: unknown): void => {
      if (!value || typeof value !== 'object' || seenDependencies.has(value)) return;
      seenDependencies.add(value);
      if (Array.isArray(value)) {
        value.forEach(visitDependencies);
        return;
      }
      const node = value as ParseNode;
      if (typeof node.type !== 'string') return;
      if (node.type === 'IdentifierReference') dependencies.add(node.name);
      for (const [key, child] of Object.entries(node)) {
        if (!['parent', 'location', 'sourceText', 'ContextualType'].includes(key)) visitDependencies(child);
      }
    };
    visitDependencies(obligation.node);
    // A value binding that has not initialized is a runtime dependency. It
    // must not be mistaken for an absent type name, nor executed ahead of the
    // surrounding statements. The ordinary annotation boundary remains.
    let deferred = false;
    for (const name of dependencies) {
      if (bindings.has(name) || obligation.functions.has(name) || obligation.aliases.has(name)) continue;
      let environment: typeof scope.OuterEnv = outer;
      let found = false;
      while (environment) {
        if (X(environment.HasBinding(Value(name))) === Value.true) {
          found = true;
          const value = EnsureCompletion(yield* environment.GetBindingValue(Value(name), Value.true));
          if (value.Type !== 'normal') deferred = true;
          break;
        }
        environment = environment.OuterEnv;
      }
      if (!found && obligation.runtimeNames.has(name)) deferred = true;
    }
    // A builder may close over runtime state. Only execute closed builders
    // here; evaluating such a closure speculatively could mutate that state.
    const allowed = new Set([...bindings.keys(), ...obligation.aliases.keys(), ...obligation.functions.keys(),
      ...FRAGMENT_FLOOR]);
    for (const name of dependencies) {
      const fn = obligation.functions.get(name);
      if (!fn) continue;
      const before = new Set(dependencies);
      visitDependencies(fn);
      for (const dependency of dependencies) {
        if (!before.has(dependency) && (builtinTypeRecord(dependency) || BoundTypeRecordForName(dependency))) allowed.add(dependency);
      }
      if (FirstFreeReference(fn, allowed)) deferred = true;
    }
    if (deferred) continue;
    for (const [name, type] of obligation.aliases) {
      bindings.set(name, GetTypeObject(type));
    }
    for (const [name, fn] of obligation.functions) {
      if (fn.type === 'FunctionDeclaration') {
        bindings.set(name, X(InstantiateFunctionObject(fn, scope, context.PrivateEnvironment)));
      }
    }
    for (const [name, value] of bindings) {
      X(scope.CreateImmutableBinding(Value(name), Value.true));
      X(scope.InitializeBinding(Value(name), value));
    }
    context.LexicalEnvironment = scope;
    try {
      BeginFragmentEvaluation();
      let result;
      try {
        result = EnsureCompletion(yield* TypeNodeToTypeRecord(obligation.node));
      } finally {
        EndFragmentEvaluation();
      }
      if (result.Type !== 'normal') {
        return Throw.StaticTypeError('a closed type annotation could not be evaluated to a type: $1', Value(inspect(result.Value)));
      }
      SetEvaluatedTypeNode(obligation.node, result.Value);
    } finally {
      context.LexicalEnvironment = outer;
    }
  }
  if (requests.length > 0 || computedAliasResolved || HasDeferredGuardChecks(root) || obligations.length > 0) {
    const errors = RecheckAfterTypeEvaluation(root);
    if (errors.length > 0) {
      return Throw(errors[0]!);
    }
  }
  let recordedAMeet = false;
  // #table-meta-hooks `meet`: what two constraints have in common, or a PROOF
  // that nothing does.
  //
  // The three answers are distinguished on purpose. A constraint is the meet; a
  // *null* says nothing satisfies both, and is reported here; anything else -
  // including a meta type that declares no `meet` at all - means the meta type
  // DECLINES to say, and the intersection stands as it does today. A regular
  // expression cannot generally decide whether two patterns share a string, and
  // a hook forced to choose between a meet and an emptiness would have to answer
  // one of them wrongly.
  //
  // Every governing meta type is asked, and one empty conjunct empties the
  // whole: a value satisfies a parameterized type when it satisfies EVERY
  // governing meta type's constraint, so nothing satisfying `Dimensions` means
  // nothing at all, whatever the bounds agree about.
  for (const pair of TakeDeferredMeetChecks(root)) {
    const a = pair.left.Metadata;
    const b = pair.right.Metadata;
    const governing = new Set<object>([...GoverningMetaTypes(a).types, ...GoverningMetaTypes(b).types]);
    for (const metaType of governing) {
      if (!MetaTypeGoverns(a, metaType) && !MetaTypeGoverns(b, metaType)) {
        continue;
      }
      const met = Q(yield* ApplyMetaHook(metaType, 'meet', [
        MetadataPortion(a, metaType),
        MetadataPortion(b, metaType),
      ], pair.left.Base));
      if (met !== undefined && met !== Value.null && met !== Value.undefined) {
        // A CONSTRAINT: the pair reduces to it. Recorded for CanonicalizeType,
        // which is synchronous and cannot call the hook that produced this.
        const snapshot = EnsureCompletion(yield* SnapshotMetadataValue(met as Value));
        if (snapshot.Type === 'normal') {
          SetMetResolution(pair.left, pair.right, {
            Kind: 'parameterized', Base: pair.left.Base, Metadata: snapshot.Value as unknown as Value,
          } as unknown as TypeRecord);
          recordedAMeet = true;
        }
      }
      if (met === Value.null) {
        // Named where the pair was written at a member, as the synchronous
        // member rule names it: a reader given two constraints still has to find
        // which of the arms' members they came from.
        if (pair.member !== undefined) {
          return Throw.StaticTypeError(
            'no value is of both $1 and $2 at member $3, so their intersection is never',
            Value(displayType(pair.left)),
            Value(displayType(pair.right)),
            Value(pair.member),
          );
        }
        return Throw.StaticTypeError(
          'no value is of both $1 and $2, so their intersection is never',
          Value(displayType(pair.left)),
          Value(displayType(pair.right)),
        );
      }
    }
  }
  // Aliases rebuilt now that the meets are known. The loop far above built them
  // before any `meta` had registered a `meet`, which is an ordering the pass
  // cannot avoid - a meta names its constraint shape, so aliases come first.
  // Only where a meet was recorded, so a text with no metadata intersection
  // rebuilds nothing.
  if (recordedAMeet) {
    for (const item of items ?? []) {
      if (item.type === 'TypeAliasDeclaration' || item.type === 'InterfaceDeclaration') {
        EnsureCompletion(yield* Evaluate_RuntimeTypesBindingDeclaration(item, true));
      }
    }
  }
  // #sec-primitive-operator-blocks: a crossing into a parameterization is
  // decided by running it - a cast supplies what the value lacks, and the meta
  // types judge what it carries. Where the source is a literal the value is
  // known, so the crossing is run here rather than left to the binding.
  for (const crossing of TakeDeferredCrossingChecks(root)) {
    // #sec-literal-propagation draws a line inside this rule that the crossing
    // alone does not: "Nor does it reach a PARAMETERIZED numeric, which is
    // unreachable by a bare literal and reachable through an implicit cast the
    // program declares - so `uint32.<{ bounds: 5..=5 }>` refuses `5` until such
    // an operator is written, and admits it once one is."
    //
    // So for a parameterized NUMERIC the question is not what the metadata
    // admits but whether an operator was written, which is decidable from the
    // declarations alone - and the pass has them, #sec-type-errors listing "the
    // implicit cast operators of its `primitive` blocks" among what it
    // processes first. Running the crossing instead answers the wrong question:
    // a `subtype` hook that admits everything lets `const v: Velocity = 10`
    // through here, and the refusal then arrives when the binding runs.
    //
    // Every OTHER parameterization is value-decided - `suffixed("Id")` admits
    // "userId" and refuses "user" - and falls through to the crossing below.
    const parameterizedBase = crossing.target.Base;
    if (parameterizedBase.Kind === 'primitive' && isNumericTypeName(parameterizedBase.Name)) {
      const name = parameterizedBase.Arguments && parameterizedBase.Arguments.length > 0
        ? `${parameterizedBase.Name}${parameterizedBase.Arguments[0]}`
        : parameterizedBase.Name;
      // A bare Number is spelled `number`; a typed value names its own base.
      // Both are tried, as `ApplyImplicitCast` tries both.
      // `CastCoversTarget`, not `SameType`: the documented form declares the
      // cast against a META TYPE while a crossing's target is one
      // parameterization of it, so an exact-type test matched nothing and
      // declaring the cast changed nothing.
      const declared = ['number', name].some((key) => PrimitiveCastsFor(key)
        .some((cast) => CastCoversTarget(cast.target, crossing.target)));
      if (!declared) {
        return Throw.StaticTypeError('$1 is not assignable to $2',
          Value(inspect(crossing.value)), Value(displayType(crossing.target)));
      }
      continue;
    }
    // The BOUNDARY's question, not the conversion's. A binding is a store, and
    // #sec-requiretype is what a store performs; `ConvertValue` answers whether
    // the value could be converted, which is a different and weaker thing.
    //
    // The two part company exactly here. `string` admits a numeric source by
    // #table-sourceconversion - "ToString of the value" - so
    // `ConvertValue(5, string.<{ brand: 'P' }>)` succeeds with "5" and the pass
    // reported nothing, while the binding at run time refused: RequireType's
    // string step tests "If _t_ is `string`", and a ~parameterized~ record is
    // not that. So `let v: string.<{ brand: 'P' }> = 5` was a run-time
    // TypeError with no early error, and the same line in a function nothing
    // called raised nothing at all - which `decorators/resolver-parity` reports
    // as the checker failing to RESOLVE the annotation, though resolution was
    // never the problem: `number.<M>` and `string.<M>` resolve by the same arm.
    //
    // The bare spelling was already right - `let v: string = 5` is an early
    // error - so the parameterized one was the outlier among its own siblings.
    BeginFragmentEvaluation();
    let attempt;
    try {
      attempt = EnsureCompletion(yield* RequireType(crossing.value, crossing.target));
    } finally {
      EndFragmentEvaluation();
    }
    if (attempt.Type !== 'normal') {
      if (IsBudgetExhausted()) break;
      // The originating error, which says WHY the crossing failed - a meta type
      // that does not admit it, a `validate` that refused the value - rather
      // than a summary that names only the two types.
      return Throw.StaticTypeError('$1 is not assignable to $2: $3',
        Value(inspect(crossing.value)), Value(displayType(crossing.target)), Value(inspect(attempt.Value)));
    }
  }
  for (const pair of TakeDeferredMetadataChecks(root)) {
    const admits = Q(yield* MetadataSubtypeJudgment(pair));
    if (!admits) {
      return Throw.StaticTypeError('$1 is not assignable to $2', Value(displayType(pair.source)), Value(displayType(pair.target)));
    }
  }
  // #sec-defaultvalueof: "It is a type error to
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
  const nestedMetaNames = nestedMetaTypeNames(root);
  for (const requirement of TakeDefaultRequirements(root)) {
    // The nested-`meta` guard: a `meta` declaration where this loop cannot see it -
    // the loop scans TOP-LEVEL items - may register a default for this very
    // type at run time, and `{ meta T { default = "d"; } } let s: T;` works
    // today. Where such a declaration names the type, the question is left to
    // the evaluation-time site rather than answered wrongly here.
    const namedByNestedMeta = requirement.annotationName !== undefined
      && nestedMetaNames.has(requirement.annotationName);
    if (namedByNestedMeta || nestedMetaNames.has(requirement.display) || defaultNeedsEvaluatedClass(requirement.type)) {
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
      // The same split the runtime makes (`NoDefaultValueError`): `never` has no
      // default because it has NO VALUES, so telling a program to add an
      // initializer names a remedy that cannot exist - there is no expression of
      // type `never` to write. The record is used rather than the precomputed
      // display, which is already canonical here.
      const req = requirement.type as TypeRecord | undefined;
      if (req && req.Kind === 'union' && req.Members.length === 0) {
        return Throw.StaticTypeError('$1 has no values, so no declaration of it can be initialized', Value(requirement.display));
      }
      return Throw.StaticTypeError('$1 has no default value, so a declaration of it needs an initializer', Value(requirement.display));
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
    // #sec-metadata-narrowing: a `narrow` hook that THROWS leaves the binding un-narrowed rather than
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
    const attempt = EnsureCompletion(yield* ApplyMetaHook(metaType, 'narrow', [portion, Value(operator), constant], subject.Base));
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

/**
 * Does the source's metadata admit it into the target?
 *
 * Exported because `Reflect.isAssignable` needs the same answer: the operation
 * is specified as "the checker's own judgment exposed unchanged, so what a
 * builder branches on and what the checker enforces cannot disagree"
 * (#sec-reflect-isassignable), and a synchronous IsAssignable cannot reach a
 * `subtype` hook, which is user code.
 */
export function* MetadataSubtypeJudgment(pair: DeferredMetadataCheck): PlainEvaluator<boolean> {
  const s = pair.source.Metadata;
  const t = pair.target.Metadata;
  const governing = new Set<object>([
    ...GoverningMetaTypes(s).types,
    ...GoverningMetaTypes(t).types,
  ]);
  for (const metaType of governing) {
    if (!MetaTypeGoverns(s, metaType) && !MetaTypeGoverns(t, metaType)) {
      // Participation: both portions at the default means no
      // part taken. `subtype(default, default)` is never consulted, so a
      // hostile or throwing hook cannot veto a crossing carrying none of its
      // metadata, and no hook need be reflexive at its own default.
      continue;
    }
    const verdict = Q(yield* ApplyMetaHook(metaType, 'subtype', [
      MetadataPortion(s, metaType),
      MetadataPortion(t, metaType),
    ], pair.source.Base));
    if (verdict !== Value.true) {
      return false;
    }
  }
  const baseObject = GetTypeObject(pair.source.Base);
  const verdict = Q(yield* ApplyMetaHook(baseObject as unknown as object, 'subtype', [s as unknown as Value, t as unknown as Value], pair.source.Base));
  if (verdict !== undefined && verdict !== Value.true) {
    return false;
  }
  return true;
}
