import type { ParseNode } from '../parser/ParseNode.mts';
import type { ExecutionContext } from '../execution-context/ExecutionContext.mts';
import { DeclarativeEnvironmentRecord } from '../execution-context/Environment.mts';
import { PatternBindingNames, PatternScopeOf } from '../type-system/pattern-scopes.mts';
import { Value } from '../value.mts';

/** #sec-is-pattern: expose the successful matches governing this position. */
export function PatternEnvironmentFor(node: ParseNode, context: ExecutionContext): DeclarativeEnvironmentRecord | undefined {
  const sites = PatternScopeOf(node);
  if (!sites.length) return undefined;
  const environment = new DeclarativeEnvironmentRecord(context.LexicalEnvironment);
  for (const site of sites) {
    const captured = context.PatternEnvironments?.get(site);
    if (!captured) continue;
    for (const binding of PatternBindingNames(site.Pattern ?? null)) {
      const name = Value(binding.Name);
      const cell = captured.bindings.get(name);
      if (cell) environment.bindings.set(name, cell);
    }
  }
  // Share the immutable cells, while retaining the current outer environment:
  // a for-loop updater runs after CreatePerIterationEnvironment copies its locals.
  return environment;
}
