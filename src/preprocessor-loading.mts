import { HostLoadImportedModule } from './host-defined/engine.mts';
import { EnsureCompletion, X, type PlainCompletion } from './completion.mts';
import { skipDebugger } from './evaluator.mts';
import { Get, GetModuleNamespace } from './abstract-ops/all.mts';
import { ObjectValue, JSStringValue } from './value.mts';
import type { AbstractModuleRecord, CyclicModuleRecord } from './modules.mts';
import type { ModuleRequestRecord } from './static-semantics/ModuleRequests.mts';
import {
  surroundingAgent,
  Throw,
  Value,
  type Realm,
} from '#self';

/**
 * `sec-preprocessor-modules`: "A preprocessor module is fetched and evaluated
 * BEFORE the importing module is parsed. The loader blocks on it as it blocks
 * for a module with top-level await."
 *
 * That is what this does, and the blocking is the point. The loading state
 * machine does not require asynchrony - `InnerModuleLoading` calls
 * `HostLoadImportedModule`, the host calls `FinishLoadingImportedModule`, and
 * that re-enters through `ContinueModuleLoading`. A host MAY complete that
 * synchronously, and where it does the whole graph resolves before
 * `LoadRequestedModules` returns.
 *
 * A host that cannot complete synchronously gets a diagnostic rather than a
 * hang. The specification says the loader blocks; it does not say what a host
 * that cannot block is owed, and a message naming the import is the honest
 * answer.
 */
/**
 * The specifiers whose load is in progress, for cycle detection.
 *
 * A preprocessor may itself use a preprocessor - a macro written with a macro is
 * an ordinary thing, and it works. A CYCLE has no fixpoint: to parse _A_ you
 * evaluate its preprocessor _B_, to parse _B_ you evaluate its preprocessor
 * _A_, and to evaluate _A_ you parse _A_.
 *
 * `sec-preprocessor-modules` makes this a Syntax Error, and a STRONGER rule than
 * ECMAScript modules have - they permit cycles, because ordinary evaluation can
 * observe a partially-initialised binding, where a partial PARSE is not a thing.
 */
const inFlight = new Set<string>();

/**
 * A refusal recorded while resolving a decorator, to be surfaced as a parse
 * error.
 *
 * `DecoratorGrammars` answers a Map and the expansion callback answers a value,
 * so neither can carry a Completion out - which is why a cycle's Syntax Error
 * was swallowed and the parse continued into an assertion.
 *
 * It lives HERE rather than beside the resolver so that a failing nested load
 * can consult it: a module whose compile failed is never recorded, and reporting
 * that as "must load synchronously" would bury the real reason under a generic
 * one at every level of the unwind.
 */
let pendingRefusal: ObjectValue | undefined;

export function RecordPreprocessorRefusal(value: ObjectValue): void {
  pendingRefusal ??= value;
}

/**
 * Reading does NOT clear. A nested parse - a preprocessor module compiled so its
 * macro can be read - must surface the refusal and LEAVE it, or the unwind that
 * follows finds nothing and reports the module it could not load rather than the
 * cycle that stopped it.
 *
 * `ClearPreprocessorRefusal` at the start of each parse is what bounds its life
 * instead. A refusal belongs to the parse that is running, and a parse beginning
 * means the last one is over - which keeps a stale refusal from reaching a later
 * compile that has nothing to do with it.
 */
export function TakePreprocessorRefusal(): ObjectValue | undefined {
  return pendingRefusal;
}

export function ClearPreprocessorRefusal(): void {
  pendingRefusal = undefined;
}

export function LoadPreprocessorModule(
  _realm: Realm,
  referrer: CyclicModuleRecord | Realm,
  specifier: string,
): PlainCompletion<AbstractModuleRecord> {
  const request: ModuleRequestRecord = {
    Specifier: specifier,
    Attributes: [{ Key: 'preprocessor', Value: 'true' }],
    Phase: 'evaluation',
    ImportedNames: 'all',
  };

  // `FinishLoadingImportedModule` appends what the host answered to the
  // referrer's [[LoadedModules]], so that is where the result is read from
  // rather than from a payload of our own: the payload shapes it recognises
  // belong to the graph loader and to dynamic import, and inventing a third
  // would be a second mechanism for the same thing.
  //
  // If nothing was appended when the call returns, the host DEFERRED - which
  // this feature cannot wait for, the importing module's PARSE being what is
  // waiting.
  if (inFlight.has(specifier)) {
    // A CYCLE is recorded, and it is the only thing that is. Every other failure
    // to resolve leaves the decoration alone - a host with no loader gets the
    // parse it would have got anyway, which is what the removed hook promised
    // and what recording a generic "did not load" would take away.
    const refusal = Throw.SyntaxError('a preprocessor module cannot import itself, directly or otherwise: $1', Value(specifier));
    const value = (refusal as { Value?: unknown }).Value;
    if (value instanceof ObjectValue) {
      RecordPreprocessorRefusal(value);
    }
    return refusal as never;
  }

  // Already loaded? `FinishLoadingImportedModule` records a module against the
  // referrer, and asserts rather than appending when asked twice - so a second
  // request for the same specifier adds nothing, and looking only at what was
  // APPENDED finds nothing and reports a load failure for a module that is
  // already there. That is what left an expansion resolving through the fallback
  // while the grammar lookup, which ran first, resolved from the module.
  const already = referrer.LoadedModules.find((r) => r.Specifier === specifier);
  if (already !== undefined) {
    return already.Module as AbstractModuleRecord;
  }

  const before = referrer.LoadedModules.length;
  inFlight.add(specifier);
  try {
    return LoadAndEvaluate(referrer, request, specifier, before);
  } finally {
    // On every path, including a throw: a specifier left in the set would refuse
    // its own module for the rest of the realm's life.
    inFlight.delete(specifier);
  }
}

function LoadAndEvaluate(
  referrer: CyclicModuleRecord | Realm,
  request: ModuleRequestRecord,
  specifier: string,
  before: number,
): PlainCompletion<AbstractModuleRecord> {
  try {
    HostLoadImportedModule(referrer as never, request, undefined, { data: undefined } as never);
  } catch {
    // A host with no loader answers `FinishLoadingImportedModule` with an error,
    // which then reaches for a payload this call does not carry - the payload
    // shapes it knows belong to the graph loader and to dynamic import. Treated
    // as "did not load", which is what it is.
    return Throw.Error('a preprocessor module must load synchronously: $1', Value(specifier));
  }
  const record = referrer.LoadedModules
    .slice(before)
    .find((r) => r.Specifier === specifier);
  if (record === undefined) {
    // Nothing recorded means the host did not answer - either it deferred, or
    // the module it tried to compile was itself refused. Where a refusal is
    // already in hand it IS the reason, and saying "must load synchronously"
    // instead would replace it at every level of the unwind until only the
    // outermost generic message survived.
    if (pendingRefusal !== undefined) {
      const refusal = pendingRefusal;
      return { Type: 'throw', Value: refusal } as never;
    }
    return Throw.Error('a preprocessor module must load synchronously: $1', Value(specifier));
  }
  const module = record.Module as AbstractModuleRecord;

  // Its OWN imports resolve here, which is where a preprocessor written with a
  // preprocessor recurses - and where a cycle must be refused, having no
  // fixpoint: to parse A you evaluate B, to parse B you evaluate A, and to
  // evaluate A you parse A.
  const loading = (module as CyclicModuleRecord).LoadRequestedModules?.();
  if (loading !== undefined && !PromiseIsFulfilled(loading)) {
    return Throw.Error('a preprocessor module must load synchronously: $1', Value(specifier));
  }

  const linked = EnsureCompletion((module as CyclicModuleRecord).Link());
  if (linked.Type !== 'normal') {
    return linked as never;
  }

  // A preprocessor module cannot use top-level await: the evaluability gate
  // gives it nothing asynchronous to name. So a promise that is not already
  // fulfilled means something the gate should have caught, and saying so is
  // better than proceeding with a module that has not run.
  const evaluated = EnsureCompletion(skipDebugger((module as CyclicModuleRecord).Evaluate()));
  if (evaluated.Type !== 'normal') {
    return evaluated as never;
  }
  if (!PromiseIsFulfilled(evaluated.Value)) {
    return Throw.Error('a preprocessor module must evaluate synchronously: $1', Value(specifier));
  }
  return module;
}

/** Whether a promise has already fulfilled, without waiting for a job to run. */
function PromiseIsFulfilled(value: unknown): boolean {
  if (!(value instanceof ObjectValue)) {
    return true;
  }
  const state = (value as unknown as { PromiseState?: string }).PromiseState;
  return state === undefined || state === 'fulfilled';
}

/**
 * The value a preprocessor import binds, from the module it names.
 *
 * The EXPORT name, not the bound one: `import { jsx as h }` declares `@h` and
 * asks the module for `jsx`.
 */
export function PreprocessorExport(
  module: AbstractModuleRecord,
  exportName: string,
): PlainCompletion<ObjectValue | undefined> {
  const namespace = X(GetModuleNamespace(module, 'evaluation'));
  if (!(namespace instanceof ObjectValue)) {
    return undefined;
  }
  const value = EnsureCompletion(skipDebugger(Get(namespace, Value(exportName))));
  if (value.Type !== 'normal') {
    return value as never;
  }
  void JSStringValue;
  void surroundingAgent;
  return value.Value instanceof ObjectValue ? value.Value : undefined;
}
