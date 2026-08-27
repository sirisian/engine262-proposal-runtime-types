export * from './abstract-ops/all.mts';
// proposal-runtime-types: loading a preprocessor module before the importing
// module is parsed, which `sec-preprocessor-modules` requires and which the
// host hook it replaces was never in the specification to do.
export * from './preprocessor-loading.mts';
// proposal-runtime-types: the `kind` a replacement decorator's context reports.
export * from './syntax-context.mts';
export * from './execution-context/all.mts';
export * from './static-semantics/all.mts';
export * from './runtime-semantics/all.mts';
export * from './value.mts';
// Test hook for the bounds proof (sec-bounds-checks), which is otherwise
// unreachable: the elision is unobservable and the set is keyed on a root.
export { BoundsProvenCountForLastCheck } from './type-system/check.mts';
// PLAN-devtools-type-inspection.md F193/F194. The inspector renders a Type
// Object, so it needs the predicate that recognises one and the canonical-form
// function that describes it. Exported here rather than reached through a deep
// path, which would pull `src/` into the inspector's own bundle.
export { isTypeObject, GetTypeObject, type TypeObject } from './type-system/intern.mts';
export { canonicalTypeText } from './type-system/records.mts';
export * from './host-defined/engine.mts';
export { runSingleJobInQueue, type JobQueue, BasicJobQueue } from './host-defined/job-queue.mts';
export { ThreadCluster, runJobOn } from './host-defined/thread-cluster.mts';
export {
  type EventLoop, type EventLoopRunType, type NodeJSJobType, AbstractEventLoop, MicroTaskEventLoop, WebLikeEventLoop, NodeJSLikeEventLoop,
} from './host-defined/event-loop.mts';
export * from './completion.mts';
export * from './parse.mts';
export * from './modules.mts';
export * from './host-defined/inspect.mts';
export { performDevtoolsEval, type DevtoolsEvalReport } from './host-defined/devtoolsEval.mts';
export { type Formattable, Throw } from './host-defined/error-messages.mts';
export * from './evaluator.mts';

// proposal-runtime-types (spec, Provenance): the host-facing channel. A tool
// resolves a doc comment or a go-to-definition through this; no program can read
// it, deliberately, because origins union across structurally identical
// declarations and a program observing that would see its own type change
// because an unrelated module declared the same shape.
export { TypeOrigins, type TypeOrigin } from './type-system/provenance.mts';


export {
  gc, type ManagedRealmHostDefined, ManagedRealm,
} from './api.mts';
export type { ParseNode } from './parser/ParseNode.mts';
// proposal-runtime-types: exposed for parser-level tests.
export { Parser } from './parser/Parser.mts';
export { Token, TokenNames } from './parser/tokens.mts';
export { DiscriminatingChainOf, DenotedUnionOf, SetAssertedTypeResolver, type DiscriminatingChain } from './type-system/DiscriminatingChain.mts';
export { Atoms, AtomsOfType, type Atom } from './type-system/Atoms.mts';
export { CreateTokenStream, TokenStreamText, isTokenStream } from './intrinsics/TokenStream.mts';
export { TokensOf, tokenizeText, sourceTextOf, type TokenRecord, type SpanRecord, type SourceRefRecord, type TokenKind } from './parser/TokensOf.mts';
export { createTest262Intrinsics, boostTest262Harness, importBundledTest262Harness } from './host-defined/test262-intrinsics.mts';
export { type Mutable, OutOfRange } from './utils/language.mts';
export { kInternal } from './utils/internal.mts';
export { JSStringMap, JSStringSet, PropertyKeyMap } from './utils/container.mts';
export {
  CallSite, CallFrame, captureStack, getHostDefinedErrorDetails, getCurrentStack,
} from './utils/stack.mts';
export { ModuleCache, type ModuleCacheKey, type ModuleCacheLoader } from './utils/module.mts';
export {
  type ModuleLoader, type ModuleLoaderResultWithCacheKey, type ModuleLoaderResultWithoutCacheKey, composeModuleLoaders,
} from './utils/module-loader.mts';
export { createBuiltinModuleLoader, type BuiltinModuleSource, type BuiltinModuleLoaderOptions } from './utils/module-loaders/builtin-loader.mts';

export { isBoundFunctionObject, type BoundFunctionObject } from './intrinsics/FunctionPrototype.mts';
export { isMapObject, type MapObject } from './intrinsics/Map.mts';
export { isSetObject, type SetObject } from './intrinsics/Set.mts';
export { isRegExpObject, type RegExpObject } from './intrinsics/RegExp.mts';
export { isWeakMapObject, type WeakMapObject } from './intrinsics/WeakMap.mts';
export { isWeakSetObject, type WeakSetObject } from './intrinsics/WeakSet.mts';
export { isDataViewObject, type DataViewObject } from './intrinsics/DataView.mts';
export { isDateObject, type DateObject } from './intrinsics/Date.mts';
export { DateProto_toISOString } from './intrinsics/DatePrototype.mts';
export { isPromiseObject, SafePerformPromiseAll, type PromiseObject } from './intrinsics/Promise.mts';
export { isTypedArrayObject, type TypedArrayObject } from './intrinsics/TypedArray.mts';
export { isProxyExoticObject, type ProxyObject } from './intrinsics/Proxy.mts';
export { isWeakRef, type WeakRefObject } from './intrinsics/WeakRef.mts';
export { isFinalizationRegistryObject, type FinalizationRegistryObject } from './intrinsics/FinalizationRegistry.mts';
export { isErrorObject, type ErrorObject } from './intrinsics/Error.mts';
export { isShadowRealmObject, type ShadowRealmObject } from './intrinsics/ShadowRealm.mts';
export { type ModuleSourceObject } from './intrinsics/AbstractModuleSource.mts';

export { isTemporalDurationObject, type TemporalDurationObject } from './intrinsics/Temporal/Duration.mts';
export { isTemporalInstantObject, type TemporalInstantObject } from './intrinsics/Temporal/Instant.mts';
export { isTemporalPlainDateObject, type TemporalPlainDateObject } from './intrinsics/Temporal/PlainDate.mts';
export { isTemporalPlainDateTimeObject, type TemporalPlainDateTimeObject } from './intrinsics/Temporal/PlainDateTime.mts';
export { isTemporalPlainMonthDayObject, type TemporalPlainMonthDayObject } from './intrinsics/Temporal/PlainMonthDay.mts';
export { isTemporalPlainTimeObject, type TemporalPlainTimeObject } from './intrinsics/Temporal/PlainTime.mts';
export { isTemporalPlainYearMonthObject, type TemporalPlainYearMonthObject } from './intrinsics/Temporal/PlainYearMonth.mts';
export { isTemporalZonedDateTimeObject, type TemporalZonedDateTimeObject } from './intrinsics/Temporal/ZonedDateTime.mts';
