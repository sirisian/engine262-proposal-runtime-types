import {
  AbstractModuleRecord,
  CyclicModuleRecord, Realm, ScriptRecord, type ModuleRequestRecord, type PlainCompletion,
} from '#self';

interface ModuleCacheEntry {
  result?: PlainCompletion<AbstractModuleRecord>;
  pending?: PromiseWithResolvers<PlainCompletion<AbstractModuleRecord>>;
}

export type ModuleCacheKeyObject = Pick<ModuleRequestRecord, 'Specifier' | 'Attributes'>;

export type ModuleCacheKey = string & { __ModuleCacheKey: never };

export type ModuleCacheLoader = (setCache: (value: PlainCompletion<AbstractModuleRecord>, cacheKey?: ModuleCacheKey) => void) => void;

export class ModuleCache {
  static fromReferer(referrer: CyclicModuleRecord | ScriptRecord | Realm) {
    const realm = referrer instanceof Realm ? referrer : referrer.Realm;
    const cache = realm.HostDefined?.resolverCache;
    if (cache instanceof ModuleCache) {
      return cache;
    }
    throw new Error('Module cache is not available in the referring realm');
  }

  #cache = new Map<ModuleCacheKey, ModuleCacheEntry>();

  static toCacheKey(moduleRequest: ModuleCacheKeyObject): ModuleCacheKey {
    const { Specifier, Attributes } = moduleRequest;
    const sorted: Record<string, string> = {};
    for (const attr of Attributes.toSorted((a, b) => (a.Key < b.Key ? -1 : 1))) {
      sorted[attr.Key] = attr.Value;
    }
    return JSON.stringify([Specifier, sorted]) as ModuleCacheKey;
  }

  toCacheKey(moduleRequest: ModuleCacheKeyObject): ModuleCacheKey {
    return this.toCacheKey(moduleRequest);
  }

  static {
    ModuleCache.prototype.toCacheKey = ModuleCache.toCacheKey;
  }

  set(key: ModuleCacheKey, result: PlainCompletion<AbstractModuleRecord>): void {
    if (!this.#cache.has(key)) {
      this.#cache.set(key, { result });
      return;
    }
    const entry = this.#cache.get(key);
    if (entry?.pending) {
      entry.pending.resolve(result);
      this.#cache.set(key, { result });
    } else {
      // cache cannot be modified.
    }
  }

  /**
   * Forget what has been cached, so the next request reaches the loader again.
   *
   * An entry is otherwise permanent: `set` declines to replace a resolved one,
   * and the cache is consulted BEFORE the loader - so a host whose sources can
   * change (an editor, a REPL with snippets) served the first compilation of a
   * specifier for the life of the realm, and editing the source had no effect
   * on a realm that had already imported it.
   *
   * Module records already linked against a forgotten entry keep working; they
   * hold their own references. What changes is that a LATER import of the same
   * specifier compiles the source again, which is what an edit is asking for.
   */
  delete(key: ModuleCacheKey): boolean {
    return this.#cache.delete(key);
  }

  clear(): void {
    this.#cache.clear();
  }

  load(key: ModuleCacheKey, loader: ModuleCacheLoader, callback: (result: PlainCompletion<AbstractModuleRecord>) => void): void {
    if (!this.#cache.has(key)) {
      const promise = Promise.withResolvers<PlainCompletion<AbstractModuleRecord>>();
      this.#cache.set(key, { pending: promise });
      loader((value, cacheKey) => {
        promise.resolve(value);
        this.#cache.set(cacheKey || key, { result: value });
        callback(value);
      });
      return;
    }
    const entry = this.#cache.get(key)!;
    if (entry.result) callback(entry.result);
    else if (entry.pending) entry.pending.promise.then(callback);
  }
}
