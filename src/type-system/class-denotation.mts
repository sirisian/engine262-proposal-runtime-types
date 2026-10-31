import type { ParseNode } from '../parser/ParseNode.mts';
import { RefBindingHolder, ResolveInitializedBinding, type EnvironmentRecord } from '../execution-context/Environment.mts';
import { Value, JSStringValue } from '../value.mts';
import { isModuleNamespaceObject } from '../abstract-ops/module-namespace-exotic-objects.mts';
import type { TypeRecord } from './records.mts';

interface ClassDenotation {
  declaration: ParseNode.ClassDeclaration;
  constructor: Value;
  record: TypeRecord;
}

// The key is the evaluated binding, not its spelling or current value. A
// successful declaration remains its type after an ordinary assignment.
const denotations = new WeakMap<object, ClassDenotation>();

export function RecordClassDenotation(environment: EnvironmentRecord, name: JSStringValue,
  declaration: ParseNode.ClassDeclaration, constructor: Value, record: TypeRecord): void {
  const binding = RefBindingHolder(environment, name)?.bindings.get(name);
  if (binding?.initialized && !binding.indirect && !binding.refLocation) {
    binding.declaredClass = constructor;
    denotations.set(binding, { declaration, constructor, record });
  }
}

export function PublishedClassDenotation(environment: EnvironmentRecord | null | undefined, name: string): ClassDenotation | undefined {
  const binding = ResolveInitializedBinding(environment, name);
  return binding && denotations.get(binding);
}

export function NamespaceClassDenotation(namespace: Value, name: string): ClassDenotation | undefined {
  if (!isModuleNamespaceObject(namespace)) return undefined;
  const resolution = namespace.Module.ResolveExport(Value(name));
  if (!resolution || resolution === 'ambiguous' || !(resolution.BindingName instanceof JSStringValue)) return undefined;
  return PublishedClassDenotation(resolution.Module.Environment, resolution.BindingName.stringValue());
}
