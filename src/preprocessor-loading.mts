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
export function LoadPreprocessorModule(
  realm: Realm,
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
  const before = referrer.LoadedModules.length;
  HostLoadImportedModule(referrer as never, request, undefined, { data: undefined } as never);
  const record = referrer.LoadedModules
    .slice(before)
    .find((r) => r.Specifier === specifier);
  if (record === undefined) {
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
  void realm;
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
