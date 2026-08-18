import type { ModuleCacheKey, ModuleCacheKeyObject, ModuleCacheLoader } from '../module.mts';
import {
  AbstractModuleRecord,
  Assert,
  JSStringValue,
  ManagedRealm, ModuleCache, NormalCompletion, OutOfRange, Realm,
  ThrowCompletion,
  ValueOfNormalCompletion,
  type ModuleLoader,
} from '#self';

export type BuiltinModuleSource = string | ((realm: Realm) => AbstractModuleRecord) | Uint8Array;

export interface BuiltinModuleLoaderOptions {
  getModuleCache?: (realm: ManagedRealm) => ModuleCache;
  /** preloaded builtin module */
  builtinModules?: Map<ModuleCacheKeyObject, BuiltinModuleSource>;
  /** dynamically loaded builtin module */
  loadBuiltinModule?: (moduleRequest: ModuleCacheKeyObject, realm: Realm, callback: (result: BuiltinModuleSource | NormalCompletion<BuiltinModuleSource> | ThrowCompletion<JSStringValue>) => void) => void;
  isBuiltinModule?: (specifier: string) => boolean;
}

export function createBuiltinModuleLoader(options: BuiltinModuleLoaderOptions = {}): ModuleLoader {
  const {
    getModuleCache = (realm) => realm.HostDefined.resolverCache,
    builtinModules,
    loadBuiltinModule,
    // starts with ".", "/", "#", or "<scheme>:" are not built-in modules
    isBuiltinModule = (specifier) => !/^(\.|\/|#|\w+:)/.test(specifier),
  } = options;

  const modules = new Map<ModuleCacheKey, BuiltinModuleSource>();
  if (builtinModules) {
    for (const [key, source] of builtinModules) {
      modules.set(ModuleCache.toCacheKey(key), source);
    }
  }

  return (referrer, moduleRequest, _hostDefined, finish, suggestError) => {
    if (!isBuiltinModule(moduleRequest.Specifier)) {
      finish(undefined);
      return;
    }
    const realm = (referrer instanceof Realm ? referrer : referrer.Realm) as ManagedRealm;
    const cache = getModuleCache(realm);
    const requestKey = ModuleCache.toCacheKey(moduleRequest);
    // Declined BEFORE the cache is touched. Inside `load` this had to answer
    // `finish` directly - there is no module to cache - which left the entry
    // `cache.load` had already created pending with nothing to resolve it, so
    // the next request for the same specifier waited on it forever.
    if (!modules.has(requestKey) && !loadBuiltinModule) {
      suggestError(`Module "${moduleRequest.Specifier}" is not a builtin module`);
      finish(undefined);
      return;
    }
    // `callback`, NOT `finish`.
    //
    // `ModuleCache.load` records an entry as pending, hands the loader a
    // `setCache` to resolve it with, and passes results to the callback. A
    // loader that answers `finish` directly delivers the module to the chain
    // and tells the cache nothing: the entry stays pending, and the SECOND
    // request for that key - `entry.result` unset, `entry.pending` present -
    // awaits a promise nothing will ever settle.
    //
    // Two requests for one specifier is the ordinary case now rather than a
    // corner: a preprocessor module is loaded once at parse time, by
    // `LoadPreprocessorModule` so its macro can be read, and again at
    // evaluation as an ordinary import of the module that named it. So the
    // console hung on every module carrying a preprocessor import - silently,
    // since a load that never completes reports nothing.
    //
    // Uncached, `load` is called with `finish`, so `callback` IS `finish` and
    // this path is unchanged.
    const load: ModuleCacheLoader = (callback) => {
      const next = (source: BuiltinModuleSource) => {
        if (typeof source === 'string') {
          callback(realm.compileModule(source, { specifier: moduleRequest.Specifier }));
        } else if (source instanceof Uint8Array) {
          callback(realm.createBytesModule(source));
        } else if (typeof source === 'function') {
          callback(NormalCompletion(source(realm)));
        } else throw OutOfRange.exhaustive(source);
      };
      if (modules.has(requestKey)) {
        next(modules.get(requestKey)!);
      } else {
        loadBuiltinModule!(moduleRequest, realm, (result) => {
          if (result instanceof ThrowCompletion) {
            callback(result);
            return;
          }
          const value = ValueOfNormalCompletion(result);
          Assert(typeof value === 'string' || value instanceof Uint8Array || value instanceof AbstractModuleRecord);
          next(value);
        });
      }
    };

    if (cache) {
      cache.load(requestKey, load, finish);
    } else {
      load(finish);
    }
  };
}
