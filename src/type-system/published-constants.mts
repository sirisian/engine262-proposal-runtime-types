import { DeclarativeEnvironmentRecord, GlobalEnvironmentRecord, RefBindingHolder, type EnvironmentRecord } from '../execution-context/Environment.mts';
import type { AbstractModuleRecord } from '../modules.mts';
import { Value, type JSStringValue } from '../value.mts';
import type { TypeRecord } from './records.mts';

// Literal-name evidence and a binding's enforced contract are distinct. Neither
// is obtained by inspecting the runtime value or invoking environment methods.
export interface StringConstantEvidence { type: TypeRecord; namesLiteral: boolean; }
const literals = new WeakMap<object, StringConstantEvidence>();

export function PublishStringConstant(environment: EnvironmentRecord, name: JSStringValue, literal: StringConstantEvidence | undefined): void {
  const binding = RefBindingHolder(environment, name)?.bindings.get(name);
  if (literal && binding?.initialized && binding.mutable === false && !binding.indirect && !binding.refLocation) {
    literals.set(binding, literal);
  }
}

interface ConstantEvidence {
  contract?: TypeRecord;
  literal?: TypeRecord;
  stringValue?: TypeRecord;
}

function evidence(environment: EnvironmentRecord, name: JSStringValue): ConstantEvidence {
  let at: EnvironmentRecord | undefined = environment;
  let key = name;
  const seen = new Set<object>();
  while (at) {
    const binding = RefBindingHolder(at, key)?.bindings.get(key);
    if (!binding || !binding.initialized || binding.refLocation || seen.has(binding)) return {};
    seen.add(binding);
    if (binding.indirect) {
      const [module, target] = (binding as unknown as { target: [AbstractModuleRecord, JSStringValue] }).target;
      at = module.Environment;
      key = target;
      continue;
    }
    if (binding.mutable !== false) return {};
    const value = literals.get(binding);
    return { contract: binding.declaredType as TypeRecord | undefined,
      literal: value?.namesLiteral ? value.type : undefined, stringValue: value?.type };
  }
  return {};
}

/** Nearest bindings block fallback, including unknown and uninitialized ones. */
export function PublishedConstantBindings(environment: EnvironmentRecord | null | undefined): ReadonlyMap<string, ConstantEvidence> {
  const found = new Map<string, ConstantEvidence>();
  let at = environment;
  while (at) {
    if (!(at instanceof DeclarativeEnvironmentRecord) && !(at instanceof GlobalEnvironmentRecord)) break;
    const holder = at instanceof GlobalEnvironmentRecord ? at.DeclarativeRecord : at;
    for (const [name] of holder.bindings) {
      const text = name.stringValue();
      if (!found.has(text)) found.set(text, evidence(at, Value(text)));
    }
    at = at.OuterEnv;
  }
  return found;
}
