import type { ParseNode } from '../parser/ParseNode.mts';
import type { TypeRecord } from './records.mts';

/**
 * proposal-runtime-types #sec-type-alias-declarations: "An alias may refer to
 * itself, directly or through other aliases, provided every cycle passes
 * through a position that holds a reference rather than an inline layout."
 *
 * A self-reference cannot read the alias's binding, which is in its temporal
 * dead zone for the whole of its own initializer, and it cannot read the
 * alias's record either, because that record is what is being built. So the
 * declaration publishes an EMPTY record here before resolving its Type, and
 * a reference to the alias from within that Type resolves to it. When the Type
 * is resolved the declaration fills that same object in place - the knot is
 * tied - and every reference taken during resolution is already pointing at
 * the finished record.
 *
 * The record is keyed on the DECLARATION node rather than on the name, so a
 * shadowed alias in an inner scope resolves to its own declaration and not to
 * the outer one that happens to share its name.
 *
 * A record is only in this map while its declaration is being evaluated. The
 * declaration removes it on the way out, including on an abrupt completion,
 * so a failed declaration does not leave a half-built type visible to the
 * next one.
 */
const resolving = new Map<ParseNode, TypeRecord>();

/** The in-progress record for a declaration, or undefined outside its evaluation. */
export function resolvingAlias(declaration: ParseNode): TypeRecord | undefined {
  return resolving.get(declaration);
}

/** Publish the placeholder a self-reference will resolve to. */
export function beginResolvingAlias(declaration: ParseNode, placeholder: TypeRecord): void {
  resolving.set(declaration, placeholder);
}

/** Withdraw it, whether the declaration completed normally or abruptly. */
export function endResolvingAlias(declaration: ParseNode): void {
  resolving.delete(declaration);
}

/**
 * Fill the placeholder in place with the resolved record, so that the
 * references taken during resolution - which hold THIS object - see the
 * finished type. Records are plain objects and are not frozen; the `readonly`
 * on TypeRecord is a compile-time discipline over records that are not under
 * construction, which is exactly the window this is confined to.
 */
export function tieAliasKnot(placeholder: TypeRecord, resolved: TypeRecord): void {
  const target = placeholder as Record<string, unknown>;
  for (const key of Object.keys(target)) {
    delete target[key];
  }
  Object.assign(target, resolved);
}

/**
 * What a type alias RESOLVED TO, by name, per realm.
 *
 * PLAN-declarative-checker-facts.md phase 2. The checker resolves an annotation
 * by walking the Type node, and a |ComputedType| - `type G = makeG();` -
 * resolves by EVALUATING rather than by walking, so the walk answers nothing
 * and every annotation of `G` degrades to ~any~.
 *
 * Two earlier attempts keyed this on the DECLARATION NODE, and both failed for
 * reasons worth keeping: a node key is unreachable from a source text that only
 * MENTIONS the alias and declares nothing, which is the whole cross-text case;
 * and within one source text the record does not exist yet when the checker
 * runs. The name is the key a mention has. The realm scopes it, because two
 * realms may bind the same name to different types and a module map would let
 * one see the other's.
 *
 * This does not by itself fix the same-source-text case: `type G = makeG()`
 * cannot be pre-evaluated while `makeG` is an uninitialized binding of the text
 * being checked. It fixes the case where the alias evaluated earlier - another
 * script, or an imported module - and it is the registry any fix for the first
 * case would write into.
 */
const resolvedByRealm = new WeakMap<object, Map<string, TypeRecord>>();

export function recordResolvedAlias(realm: object, name: string, record: TypeRecord): void {
  let byName = resolvedByRealm.get(realm);
  if (byName === undefined) {
    byName = new Map();
    resolvedByRealm.set(realm, byName);
  }
  byName.set(name, record);
}

export function resolvedAlias(realm: object | undefined, name: string): TypeRecord | undefined {
  return realm === undefined ? undefined : resolvedByRealm.get(realm)?.get(name);
}
