import { surroundingAgent, ObjectValue, Value } from '#self';
import type { PropertyKeyValue, Realm } from '#self';

/**
 * proposal-runtime-types #annex-evaluable-fragment, the LIBRARY half of the
 * fragment:
 *
 *   "A built-in is within the fragment when its result is determined by its
 *   arguments, it performs no observable mutation outside values the call
 *   created, and it depends on no host or ambient state."
 *
 * The syntactic half is `evaluable-fragment.mts` - the grammar less a rejection
 * list, decided by walking the parse tree. This half cannot be decided that way.
 * A name in the source is not the built-in it reaches: `Math.random`, a binding
 * holding it, and a computed member access all reach the same function, and a
 * denylist over source text sees only the first. So the rule is enforced where
 * the built-in is CALLED, which is also how C++ marks `constexpr` and Rust
 * `const fn` - the mark is on the function, never on the call syntax.
 *
 * The annex enumerates both sides and names its arbiter: "The conformance suite
 * fixes the exact enumeration." What is listed below is the annex's named
 * exclusions, so it is a denylist that GROWS - an impure built-in nobody has
 * named is accepted until someone names it.
 */

/**
 * The paths the annex excludes, as (intrinsic, property) pairs. An entry naming
 * no property excludes the intrinsic itself, for the ones reached by
 * construction rather than by call.
 */
const EXCLUDED: readonly (readonly [string, string?])[] = [
  // "Excluded by the same rule: `Math.random` ..."
  ['%Math%', 'random'],
  // "... Date ...": the constructor, its own methods, and the reading methods of
  // its prototype. A Date is host state read as a value.
  ['%Date%'],
  ['%Date%', 'now'],
  ['%Date.prototype%', 'getTime'],
  ['%Date.prototype%', 'valueOf'],
  ['%Date.prototype%', 'toISOString'],
  ['%Date.prototype%', 'toString'],
  // "... every locale-sensitive method ..."
  ['%String.prototype%', 'toLocaleUpperCase'],
  ['%String.prototype%', 'toLocaleLowerCase'],
  ['%String.prototype%', 'localeCompare'],
  ['%Number.prototype%', 'toLocaleString'],
  ['%BigInt.prototype%', 'toLocaleString'],
  ['%Array.prototype%', 'toLocaleString'],
  ['%Object.prototype%', 'toLocaleString'],
  ['%Date.prototype%', 'toLocaleString'],
  ['%Date.prototype%', 'toLocaleDateString'],
  ['%Date.prototype%', 'toLocaleTimeString'],
  // "... Atomics and shared memory ..."
  ['%Atomics%', 'load'],
  ['%Atomics%', 'store'],
  ['%Atomics%', 'add'],
  ['%Atomics%', 'sub'],
  ['%Atomics%', 'and'],
  ['%Atomics%', 'or'],
  ['%Atomics%', 'xor'],
  ['%Atomics%', 'exchange'],
  ['%Atomics%', 'compareExchange'],
  ['%Atomics%', 'wait'],
  ['%Atomics%', 'notify'],
  ['%Atomics%', 'isLockFree'],
  ['%SharedArrayBuffer%'],
  // "... and weak references and finalization."
  ['%WeakRef%'],
  ['%FinalizationRegistry%'],
];

const excludedByRealm = new WeakMap<object, WeakSet<ObjectValue>>();

function excludedSetFor(realm: Realm): WeakSet<ObjectValue> {
  const cached = excludedByRealm.get(realm as unknown as object);
  if (cached) {
    return cached;
  }
  const set = new WeakSet<ObjectValue>();
  // Resolved from the realm's intrinsics rather than from its global object, so
  // a program that reassigns `Math` does not change what the rule decides.
  for (const [intrinsic, property] of EXCLUDED) {
    // Through `unknown`: `Intrinsics` is a interface of named slots rather than
    // an index signature, so a direct cast is the one the compiler rejects as
    // insufficiently overlapping. The lookup is by a key from EXCLUDED, and the
    // `instanceof` below is what makes it safe.
    const holder = (realm.Intrinsics as unknown as Record<string, ObjectValue | undefined>)[intrinsic];
    if (!(holder instanceof ObjectValue)) {
      continue;
    }
    if (property === undefined) {
      set.add(holder);
      continue;
    }
    // A direct own-property read: a getter here would be host state of its own,
    // and every entry above names a data property.
    const descriptor = holder.properties.get(Value(property) as PropertyKeyValue);
    const value = descriptor?.Value;
    if (value instanceof ObjectValue) {
      set.add(value);
    }
  }
  excludedByRealm.set(realm as unknown as object, set);
  return set;
}

/**
 * The scope the rule applies in: an expression the fragment restricts is being
 * evaluated.
 *
 * Its own counter rather than the budget's frame. `BeginTypeEvaluation` is
 * opened by three operations - InstantiateGenericAlias, ApplyMetaHook and the
 * pre-evaluation check pass - and the ordinary member-default path is not one of
 * them: instrumenting a plain `type S = { p?: any = Math.max(1, 2) }` shows the
 * fragment check running twice, once with a frame open and once without. A rule
 * keyed on that frame would have missed the site that runs without one.
 */
let fragmentDepth = 0;

export function BeginFragmentEvaluation(): void {
  fragmentDepth += 1;
}

export function EndFragmentEvaluation(): void {
  fragmentDepth = Math.max(0, fragmentDepth - 1);
}

export function InFragmentEvaluation(): boolean {
  return fragmentDepth > 0;
}

/**
 * Whether `F` is a built-in the fragment excludes. False outside a fragment
 * evaluation, so an ordinary program's `Math.random()` is untouched - the rule
 * restricts what a type may be computed from, not what a program may do.
 */
export function IsExcludedFromFragment(F: ObjectValue): boolean {
  if (fragmentDepth === 0) {
    return false;
  }
  const realm = (F as unknown as { Realm?: Realm }).Realm ?? surroundingAgent.currentRealmRecord;
  if (!realm) {
    return false;
  }
  return excludedSetFor(realm).has(F);
}
