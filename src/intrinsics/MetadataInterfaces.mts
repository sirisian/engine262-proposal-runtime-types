import { Value, ObjectValue } from '../value.mts';
import { X } from '../completion.mts';
import { GetTypeObject } from '../type-system/intern.mts';
import type { TypeRecord } from '../type-system/records.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  Descriptor, Realm, surroundingAgent,
} from '#self';

/**
 * proposal-runtime-types #sec-decorator-metadata: the intrinsic metadata
 * interfaces, `%ClassMetadata%`, `%ClassFieldMetadata%`, and one per
 * metadata-carrying context.
 *
 * A metadata object is an instance of the intrinsic interface corresponding to
 * its context, and "a program adds to one by declaring a `partial interface`
 * over it whose members are typed and Symbol-keyed, and the members it adds are
 * the only ones there are: THE INTRINSIC INTERFACES DECLARE NONE." So each is
 * an interface with an EMPTY structure - the whole of its vocabulary is what a
 * program's partials contribute - and before any partial has run it admits any
 * object, which is what an interface declaring nothing means.
 *
 * The names are decorators.md's, read off the reflection structures rather than
 * off the context table: a context has a metadata interface exactly where its
 * reflection carries a `metadata` member. That is the Class family (twelve),
 * the Function family (three), the Object family (nine), and the Enum family
 * (two) - and NOT `Reflect.Type`, the Binding contexts, the Block contexts, or
 * the Structural contexts, of which the design says in as many words: "their
 * reflection structures do not carry metadata."
 *
 * Each is a nominal type over a sentinel declaration, the same shape the
 * reflection contexts take in Reflect.mts: one module-level declaration per
 * name, so that every writing of the name interns as ONE type, which is what
 * lets the `partial interface` merge complete the record IN PLACE and have
 * every reference - past and future - see the added members. The `LibraryName`
 * supplies the display name; it cannot reach IsOfType's global-prototype-chain
 * branch, because the record's [[Structure]] answers membership first.
 *
 * The names bind on the GLOBAL, non-writable, exactly as the primitive type
 * names do (#sec-value-types: "the type names are global bindings of their
 * interned Type Objects") - which is what `partial interface ClassMetadata`
 * resolves, since the merge reads the binding.
 */

/**
 * The 26 metadata-carrying contexts' interface names, grouped as decorators.md
 * groups the reflection structures that declare their `metadata` members.
 */
export const metadataInterfaceNames = [
  // The Class family.
  'ClassMetadata',
  'ClassFieldMetadata',
  'ClassAccessorMetadata',
  'ClassGetterMetadata',
  'ClassGetterReturnMetadata',
  'ClassSetterMetadata',
  'ClassSetterParameterMetadata',
  'ClassMethodMetadata',
  'ClassMethodParameterMetadata',
  'ClassMethodReturnMetadata',
  'ClassOperatorMetadata',
  'ClassOperatorParameterMetadata',
  // The Function family.
  'FunctionMetadata',
  'FunctionParameterMetadata',
  'FunctionReturnMetadata',
  // The Object family.
  'ObjectMetadata',
  'ObjectFieldMetadata',
  'ObjectGetterMetadata',
  'ObjectGetterReturnMetadata',
  'ObjectSetterMetadata',
  'ObjectSetterParameterMetadata',
  'ObjectMethodMetadata',
  'ObjectMethodParameterMetadata',
  'ObjectMethodReturnMetadata',
  // The Enum family.
  'EnumMetadata',
  'EnumEnumeratorMetadata',
] as const;

/**
 * One sentinel declaration per name, module-level so identity is stable: the
 * intern comparison for a nominal type is by [[Declaration]], and a fresh
 * sentinel per call would make every mention of `ClassMetadata` a new type.
 */
const sentinels = new Map<string, ParseNode>(
  metadataInterfaceNames.map((name) => [name, { type: 'MetadataInterface', name } as unknown as ParseNode]),
);

/**
 * The interface's record: nominal identity over the sentinel, and an EMPTY
 * object structure - no properties, no index signatures - which is "declares
 * none" as a record. A `partial interface` over it replaces this [[Structure]]
 * with one carrying the contributed members (RuntimeTypesDeclarations.mts), so
 * the structure is built fresh per record rather than shared between names.
 */
export function metadataInterfaceRecord(name: string): TypeRecord {
  const declaration = sentinels.get(name);
  if (!declaration) {
    throw new RangeError(`${name} is not a metadata interface name`);
  }
  return {
    Kind: 'nominal',
    Declaration: declaration,
    Arguments: [],
    LibraryName: name,
    Structure: { Kind: 'object', Properties: [], IndexSignatures: [] },
  } as TypeRecord;
}

/**
 * Bind the metadata interface names on the global object. Runs from
 * SetDefaultGlobalBindings beside the primitive type names, with the same
 * descriptor: a type name is not assignable and not enumerable, and stays
 * configurable as the primitive names are.
 */
export function bindMetadataInterfaceGlobals(realmRec: Realm) {
  if (!surroundingAgent.feature('runtime-types')) {
    return;
  }
  const global = realmRec.GlobalObject as ObjectValue;
  for (const name of metadataInterfaceNames) {
    X(global.DefineOwnProperty(Value(name), Descriptor({
      Value: GetTypeObject(metadataInterfaceRecord(name), realmRec),
      Writable: Value.false,
      Enumerable: Value.false,
      Configurable: Value.true,
    })));
  }
}
