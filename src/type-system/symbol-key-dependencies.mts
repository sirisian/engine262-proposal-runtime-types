import { SymbolValue, JSStringValue, EnvironmentRecord, RefBindingHolder, surroundingAgent,
  type ReferenceRecord, type ParseNode, type Value } from '#self';

// Checking identities describe declarations; they are not the Symbols created
// by executing those declarations. No table is keyed by a description or value
// being admitted, and no operation below invokes a binding read or key coercion.
const declarations = new WeakMap<SymbolValue, ParseNode>();
const propertyKeys = new WeakMap<object, string | SymbolValue>();
const initialized = new WeakMap<EnvironmentRecord, Map<object, SymbolValue>>();

export function RegisterSymbolKeyDeclaration(key: SymbolValue, declaration: ParseNode): void {
  declarations.set(key, declaration);
}

export function IsSymbolicPropertyKey(key: string | SymbolValue): key is SymbolValue {
  return key instanceof SymbolValue && declarations.has(key);
}

export function RememberCheckedPropertyKey(node: object, key: string | SymbolValue | undefined): void {
  if (key === undefined) propertyKeys.delete(node);
  else propertyKeys.set(node, key);
}

export function CheckedPropertyKeyOf(node: object): string | SymbolValue | undefined {
  return propertyKeys.get(node);
}

export function SymbolKeyDependencyOf(node: object): SymbolValue | undefined {
  const key = propertyKeys.get(node);
  return key !== undefined && IsSymbolicPropertyKey(key) ? key : undefined;
}

/** Publish only after ordinary immutable initialization has succeeded. */
export function RetainSymbolBinding(reference: ReferenceRecord, declaration: ParseNode, value: Value): void {
  if (!(value instanceof SymbolValue) || !(reference.Base instanceof EnvironmentRecord)
      || !(reference.ReferencedName instanceof JSStringValue)) return;
  const holder = RefBindingHolder(reference.Base, reference.ReferencedName);
  const binding = holder?.bindings.get(reference.ReferencedName);
  if (!holder || !binding?.initialized || binding.mutable !== false || binding.indirect || binding.refLocation) return;
  let entries = initialized.get(holder);
  if (!entries) initialized.set(holder, entries = new Map());
  entries.set(declaration, value);
}

/** Use lexical environments, never the dynamic caller or an equal spelling. */
export function InitializedSymbolKey(key: SymbolValue): SymbolValue | undefined {
  const declaration = declarations.get(key);
  if (!declaration) return undefined;
  let environment: EnvironmentRecord | null | undefined = surroundingAgent.runningExecutionContext?.LexicalEnvironment;
  while (environment) {
    const value = initialized.get(environment)?.get(declaration);
    if (value) return value;
    // A global lexical binding belongs to its declarative record.
    const global = (environment as EnvironmentRecord & { DeclarativeRecord?: EnvironmentRecord }).DeclarativeRecord;
    const globalValue = global && initialized.get(global)?.get(declaration);
    if (globalValue) return globalValue;
    environment = environment.OuterEnv;
  }
  return undefined;
}
