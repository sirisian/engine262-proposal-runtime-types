// Compiler-owned input snapshots. These are neither runtime value copies nor
// type-equivalence keys; a query must still validate its required dependencies.
const identityFields = new Set(['Declaration', 'DeclarationIdentity', 'Operator', 'DefaultEnvironment']);

const syntaxNode = (value: object): boolean => typeof (value as { type?: unknown }).type === 'string';
const plainRecord = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value);
  return Array.isArray(value) || proto === Object.prototype || proto === null;
};
const stableKey = (key: unknown): boolean => !key || typeof key !== 'object' || syntaxNode(key);

/** Whether this context can cross declaration-preparation passes. */
export function ReusableCheckingContext(value: unknown, reusableAtom: (value: object) => boolean | undefined = () => undefined): boolean {
  const seen = new Set<object>();
  const pending = [value];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    if (syntaxNode(item)) continue;
    const atom = reusableAtom(item);
    if (atom !== undefined) {
      if (!atom) return false;
      continue;
    }
    if (item instanceof Map) {
      for (const [key, child] of item) {
        if (!stableKey(key)) return false;
        pending.push(child);
      }
    } else if (item instanceof Set) {
      for (const key of item) if (!stableKey(key)) return false;
    } else {
      if (!plainRecord(item)) return false;
      for (const key of Reflect.ownKeys(item)) {
        const child = (item as Record<PropertyKey, unknown>)[key];
        // Activation identities and deferred environments stay in their
        // original worklist; structural similarity cannot export a contract.
        if ((key === 'DeclarationIdentity' || key === 'DefaultEnvironment') && child !== undefined) return false;
        pending.push(child);
      }
    }
  }
  return true;
}

/** Preserve historical compiler records and every opaque identity they name. */
export function SnapshotCheckingContext<T>(value: T): T {
  const seen = new Map<object, unknown>();
  const pending: (() => void)[] = [];
  const copy = (item: unknown): unknown => {
    if (!item || typeof item !== 'object') return item;
    if (seen.has(item)) return seen.get(item);
    if (syntaxNode(item) || !plainRecord(item) && !(item instanceof Map) && !(item instanceof Set)) return item;
    if (item instanceof Map) {
      const result = new Map();
      seen.set(item, result);
      pending.push(() => {
        for (const [key, child] of item) result.set(key, copy(child));
      });
      return result;
    }
    if (item instanceof Set) {
      const result = new Set(item);
      seen.set(item, result);
      return result;
    }
    const result: Record<PropertyKey, unknown> = Array.isArray(item)
      ? [] as unknown as Record<PropertyKey, unknown> : Object.create(Object.getPrototypeOf(item));
    seen.set(item, result);
    pending.push(() => {
      for (const key of Reflect.ownKeys(item)) {
        const child = (item as Record<PropertyKey, unknown>)[key];
        result[key] = typeof key === 'string' && identityFields.has(key) ? child : copy(child);
      }
    });
    return result;
  };
  const result = copy(value);
  for (let i = 0; i < pending.length; i += 1) pending[i]();
  return result as T;
}

/** Exact input-record comparison, with a caller-supplied primitive-value rule. */
export function SameCheckingContext(a: unknown, b: unknown,
  sameAtom: (left: object, right: object) => boolean | undefined = () => undefined): boolean {
  const seen = new Map<object, Set<object>>();
  const pending: [unknown, unknown][] = [[a, b]];
  while (pending.length) {
    const [left, right] = pending.pop()!;
    if (Object.is(left, right)) continue;
    if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
    const atom = sameAtom(left, right);
    if (atom !== undefined) {
      if (!atom) return false;
      continue;
    }
    if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right) || syntaxNode(left)
      || !plainRecord(left) && !(left instanceof Map) && !(left instanceof Set)) return false;
    if (seen.get(left)?.has(right)) continue;
    if (!seen.has(left)) seen.set(left, new Set());
    seen.get(left)!.add(right);
    if (left instanceof Map && right instanceof Map) {
      if (left.size !== right.size) return false;
      for (const [key, child] of left) {
        if (!right.has(key)) return false;
        pending.push([child, right.get(key)]);
      }
    } else if (left instanceof Set && right instanceof Set) {
      if (left.size !== right.size) return false;
      for (const key of left) if (!right.has(key)) return false;
    } else {
      const keys = Reflect.ownKeys(left);
      if (keys.length !== Reflect.ownKeys(right).length) return false;
      for (const key of keys) {
        if (!Object.hasOwn(right, key)) return false;
        const x = (left as Record<PropertyKey, unknown>)[key];
        const y = (right as Record<PropertyKey, unknown>)[key];
        if (typeof key === 'string' && identityFields.has(key)) {
          if (!Object.is(x, y)) return false;
        } else pending.push([x, y]);
      }
    }
  }
  return true;
}
