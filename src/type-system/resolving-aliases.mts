import type { ParseNode } from '../parser/ParseNode.mts';
import { DeclarativeEnvironmentRecord, GlobalEnvironmentRecord, RefBindingHolder, type EnvironmentRecord } from '../execution-context/Environment.mts';
import type { AbstractModuleRecord } from '../modules.mts';
import { Value, JSStringValue } from '../value.mts';
import type { TypeRecord } from './records.mts';
import { isModuleNamespaceObject } from '../abstract-ops/module-namespace-exotic-objects.mts';

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
 * A completed alias belongs to its actual initialized binding. Neither a name
 * in the same realm nor another activation of the same declaration is that
 * binding. Weak keys do not retain dead environments or publish local aliases
 * into later source texts.
 */
const resolvedByBinding = new WeakMap<object, { declaration: ParseNode, record: TypeRecord, context: TypeRecord }>();

export function recordResolvedAlias(environment: EnvironmentRecord, name: JSStringValue, declaration: ParseNode, record: TypeRecord, context = record): void {
  const binding = RefBindingHolder(environment, name)?.bindings.get(name);
  if (binding?.initialized && !binding.indirect && !binding.refLocation) {
    resolvedByBinding.set(binding, { declaration, record, context });
  }
}

/**
 * Read publication metadata without executing HasBinding/GetBindingValue or
 * user code. Every nearer binding blocks fallback, including an uninitialized
 * or non-alias binding. Imports retain their target's binding identity. An
 * object environment is not statically traversable by this lookup.
 */
export function resolvedAlias(environment: EnvironmentRecord | null | undefined, name: string, declaration?: ParseNode): TypeRecord | undefined {
  const published = resolvedPublication(environment, name, declaration);
  return published?.declaration.type === 'TypeAliasDeclaration' ? published.record : undefined;
}

/** A declaration's resolved signature context is not its interned Type Object.
 * Keep its binders/captures when equal types share a public identity. Ordinary
 * value reads and reflection continue to use the interned object. */
export function resolvedAliasContext(environment: EnvironmentRecord | null | undefined, name: string): TypeRecord | undefined {
  const published = resolvedPublication(environment, name);
  return published?.declaration.type === 'TypeAliasDeclaration' ? published.context : undefined;
}

/** Called after the ordinary namespace read, preserving its TDZ and import effects. */
export function resolvedNamespaceAliasContext(namespace: Value, name: string): TypeRecord | undefined {
  if (!isModuleNamespaceObject(namespace)) return undefined;
  const resolution = namespace.Module.ResolveExport(Value(name));
  if (!resolution || resolution === 'ambiguous' || !(resolution.BindingName instanceof JSStringValue)) return undefined;
  return resolvedAliasContext(resolution.Module.Environment, resolution.BindingName.stringValue());
}

function resolvedPublication(environment: EnvironmentRecord | null | undefined, name: string, declaration?: ParseNode):
  { declaration: ParseNode, record: TypeRecord, context: TypeRecord } | undefined {
  let at = environment;
  let key = Value(name);
  let imported = false;
  const seen = new Set<object>();
  while (at) {
    if (!(at instanceof DeclarativeEnvironmentRecord) && !(at instanceof GlobalEnvironmentRecord)) return undefined;
    const binding = RefBindingHolder(at, key)?.bindings.get(key);
    if (binding) {
      if (!binding.initialized || binding.refLocation || seen.has(binding)) return undefined;
      seen.add(binding);
      if (binding.indirect) {
        const [module, target] = (binding as unknown as { target: [AbstractModuleRecord, JSStringValue] }).target;
        at = module.Environment;
        key = target;
        imported = true;
        continue;
      }
      const published = resolvedByBinding.get(binding);
      return published && (!declaration || published.declaration === declaration) ? published : undefined;
    }
    // An import target is a direct binding in its Module Environment, not a
    // fresh lexical search through the target module's outer environments.
    if (imported) return undefined;
    at = at.OuterEnv;
  }
  return undefined;
}

/** Find an already published dependency by source identity, including renamed
 * imports. No binding value is read. Ambiguous activations remain unresolved.
 */
export function resolvedDeclaration(environment: EnvironmentRecord, declaration: ParseNode): TypeRecord | undefined {
  const names = new Set<string>();
  let found: TypeRecord | undefined;
  for (let at: EnvironmentRecord | null = environment; at; at = at.OuterEnv) {
    if (!(at instanceof DeclarativeEnvironmentRecord) && !(at instanceof GlobalEnvironmentRecord)) return undefined;
    const holder = at instanceof GlobalEnvironmentRecord ? at.DeclarativeRecord : at;
    for (const key of holder.bindings.keys()) {
      const name = key.stringValue();
      if (names.has(name)) continue;
      names.add(name);
      const record = resolvedPublication(at, name, declaration)?.record;
      if (!record) continue;
      if (found && found !== record) return undefined;
      found = record;
    }
    // The nearest activation containing this declaration owns the dependency.
    if (found) return found;
  }
  return undefined;
}

/** Locate a foreign declaration's actual source Module Environment through the
 * linked import graph. This reads import metadata, never binding values, and
 * does not initialize a module or choose among local declaration activations.
 */
export function declarationModuleEnvironment(environment: EnvironmentRecord, declaration: ParseNode): EnvironmentRecord | undefined {
  let source = declaration;
  while (source.parent) source = source.parent;
  if (source.type !== 'Module') return undefined;
  const seen = new Set<EnvironmentRecord>();
  const pending: (EnvironmentRecord | null | undefined)[] = [environment];
  let found: EnvironmentRecord | undefined;
  while (pending.length) {
    const at = pending.pop();
    if (!at || seen.has(at)) continue;
    seen.add(at);
    if (!(at instanceof DeclarativeEnvironmentRecord) && !(at instanceof GlobalEnvironmentRecord)) return undefined;
    const holder = at instanceof GlobalEnvironmentRecord ? at.DeclarativeRecord : at;
    for (const binding of holder.bindings.values()) {
      if (!binding.indirect) continue;
      const [module] = (binding as unknown as { target: [AbstractModuleRecord, JSStringValue] }).target;
      if ('ECMAScriptCode' in module && module.ECMAScriptCode === source && module.Environment) {
        if (found && found !== module.Environment) return undefined;
        found = module.Environment;
      }
      pending.push(module.Environment);
    }
    pending.push(at.OuterEnv);
  }
  return found;
}
