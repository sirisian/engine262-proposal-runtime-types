import type { EnvironmentRecord } from '../execution-context/Environment.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { FamilyCasesOf } from '../runtime-semantics/RuntimeTypesDeclarations.mts';
import type { TypeRecord } from './records.mts';
import { LexicalFreeReferences, ResolveBindingDeclaration } from './compile-time-evaluability.mts';

interface GenericAliasContext {
  readonly Environment: EnvironmentRecord;
  readonly Bindings: ReadonlyMap<string, TypeRecord>;
}

// A generic alias is a declaration, not an expanded type. Its internal
// descriptor must survive interning without merging different captures.
// The identity is opaque; only this weak side table retains the environment.
const contexts = new WeakMap<object, GenericAliasContext>();

export function CreateGenericAliasRecord(
  declaration: ParseNode.TypeAliasDeclaration,
  environment: EnvironmentRecord,
  activeBindings: ReadonlyMap<string, TypeRecord> | undefined,
): TypeRecord {
  const bindings = new Map<string, TypeRecord>();
  // A selected case may capture an outer parameter absent from the primary.
  const references = [declaration, ...FamilyCasesOf(declaration)].flatMap(LexicalFreeReferences);
  for (const reference of references) {
    if (ResolveBindingDeclaration(reference, reference.name)?.kind !== 'type-parameter') continue;
    const bound = activeBindings?.get(reference.name);
    if (bound) bindings.set(reference.name, bound);
  }
  const identity = {};
  contexts.set(identity, { Environment: environment, Bindings: bindings });
  return { Kind: 'nominal', Declaration: declaration, DeclarationIdentity: identity, Arguments: [] };
}

export function GenericAliasContextOf(record: TypeRecord | undefined): GenericAliasContext | undefined {
  return record?.Kind === 'nominal' && record.DeclarationIdentity ? contexts.get(record.DeclarationIdentity) : undefined;
}
