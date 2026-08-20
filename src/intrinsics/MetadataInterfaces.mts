import { Value, ObjectValue } from '../value.mts';
import { X } from '../completion.mts';
import { GetTypeObject } from '../type-system/intern.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { anyType, makePrimitive, RegisterBoundTypeRecord } from '../type-system/records.mts';
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
  'ClassOperatorReturnMetadata',
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
/**
 * proposal-runtime-types: `Token`, the record a replacement decorator RETURNS.
 *
 * A decorator receives a TokenStream and answers a token sequence - an
 * array-like of these. The asymmetry is deliberate: a TokenStream carries spans
 * the engine assigns and refuses construction, so a decorator that rewrites
 * assembles ordinary records instead. Without this name the RETURN of every
 * macro in the companion documents could not be annotated, though its parameters
 * could.
 *
 * Structural rather than nominal-by-prototype, because a macro builds these with
 * object literals and they are instances of nothing. `span` and `tokens` are
 * optional: a created token carries no span until the engine assigns one, and
 * only a group carries tokens.
 */
const tokenDeclaration = { type: 'ReflectionContext', name: 'Token' } as unknown as ParseNode;

export function tokenRecord(): TypeRecord {
  const string = makePrimitive('string');
  const property = (key: string, type: TypeRecord, optional: boolean) => ({
    key, type, optional, readonly: false,
  });
  return {
    Kind: 'nominal',
    Declaration: tokenDeclaration,
    Arguments: [],
    LibraryName: 'Token',
    Structure: {
      Kind: 'object',
      Properties: [
        property('kind', string, false),
        property('value', string, false),
        property('span', anyType, true),
        property('tokens', anyType, true),
      ],
      IndexSignatures: [],
    },
  } as unknown as TypeRecord;
}

export function bindMetadataInterfaceGlobals(realmRec: Realm) {
  if (!surroundingAgent.feature('runtime-types')) {
    return;
  }
  const global = realmRec.GlobalObject as ObjectValue;
  const token = tokenRecord();
  // Registered as it is bound, so the checker resolves exactly the record the
  // runtime does - `PLAN-checker-type-resolution.md stage A`. Building a second
  // record for the checker is what stage A's disproved first attempt did:
  // `Token` resolved to a bare nominal tested by a prototype chain rather than
  // to this one, whose [[Structure]] is what an object literal satisfies.
  RegisterBoundTypeRecord('Token', token);
  X(global.DefineOwnProperty(Value('Token'), Descriptor({
    Value: GetTypeObject(token, realmRec),
    Writable: Value.false,
    Enumerable: Value.false,
    Configurable: Value.true,
  })));
  for (const name of metadataInterfaceNames) {
    const record = metadataInterfaceRecord(name);
    RegisterBoundTypeRecord(name, record);
    X(global.DefineOwnProperty(Value(name), Descriptor({
      Value: GetTypeObject(record, realmRec),
      Writable: Value.false,
      Enumerable: Value.false,
      Configurable: Value.true,
    })));
  }
}
