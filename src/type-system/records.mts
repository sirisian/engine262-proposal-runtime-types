import type { Value } from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';

/**
 * proposal-runtime-types #sec-types-and-type-objects
 * A Type Record describes an ECMAScript type. Each record has a [[Kind]] and
 * the fields listed for that kind. The ~never~ type is the union of no
 * members. Kinds not yet produced by the evaluator (~nominal~, ~object~,
 * ~function~, ~application~) are declared for the later milestones.
 */
export interface PropertyTypeRecord {
  readonly key: string;
  readonly type: TypeRecord;
  readonly optional: boolean;
  readonly readonly: boolean;
}

export interface SignatureRecord {
  readonly Parameters: readonly TypeRecord[];
  readonly Return: TypeRecord | null;
  // proposal-runtime-types: the declared `this` type, or null where none is
  // declared (the spec's [[ThisType]], a Type Record or ~none~). Part of the
  // signature's identity, compared as a type.
  readonly ThisType?: TypeRecord | null;
}

export interface IndexSignatureRecord {
  readonly Key: TypeRecord;
  readonly Value: TypeRecord;
}

export interface TupleElementRecord {
  readonly Type: TypeRecord;
  readonly Rest: boolean;
  readonly Initial: 'none';
}

export type TypeRecord =
  | { readonly Kind: 'any' }
  | { readonly Kind: 'void' }
  | { readonly Kind: 'primitive', readonly Name: string, readonly Arguments: readonly (TypeRecord | number)[] }
  | { readonly Kind: 'literal', readonly Value: Value, readonly Base: TypeRecord }
  | { readonly Kind: 'parameterized', readonly Base: TypeRecord, readonly Metadata: Value }
  | {
    readonly Kind: 'nominal',
    readonly Declaration: ParseNode,
    readonly Arguments: readonly (TypeRecord | number)[],
    // proposal-runtime-types M11: evaluated enum member values, and the
    // resolved structural shape of an interface, attached at declaration
    // evaluation. SameType compares by [[Declaration]] identity only.
    readonly EnumMembers?: readonly Value[],
    readonly Structure?: TypeRecord,
    // proposal-runtime-types M21: the class constructor whose instances the
    // class type contains. Identity is still by [[Declaration]]; this is the
    // resolved constructor so membership needs no name lookup.
    readonly Constructor?: Value,
    // proposal-runtime-types: a library generic type (Promise, Record) has no
    // source declaration. LibraryName gives it a stable identity: orderKey uses
    // it and SameType compares it, so `Promise.<uint32>` interns to one type
    // across a program. When present, [[Declaration]] is a shared sentinel node.
    readonly LibraryName?: string,
  }
  | { readonly Kind: 'union', readonly Members: readonly TypeRecord[] }
  | { readonly Kind: 'intersection', readonly Members: readonly TypeRecord[] }
  | { readonly Kind: 'tuple', readonly Elements: readonly TupleElementRecord[] }
  | { readonly Kind: 'array', readonly Element: TypeRecord, readonly Extent: number | 'dynamic' }
  | { readonly Kind: 'reference', readonly Target: TypeRecord }
  | { readonly Kind: 'object', readonly Properties: readonly PropertyTypeRecord[], readonly IndexSignatures: readonly IndexSignatureRecord[] }
  | { readonly Kind: 'function', readonly Signatures: readonly SignatureRecord[] };

export const anyType: TypeRecord = { Kind: 'any' };
export const voidType: TypeRecord = { Kind: 'void' };
export const neverType: TypeRecord = { Kind: 'union', Members: [] };

export function makePrimitive(Name: string, Arguments: readonly (TypeRecord | number)[] = []): TypeRecord {
  return { Kind: 'primitive', Name, Arguments };
}

/**
 * #sec-type-names: the shorthands each denote the same Type Record as their
 * expansion. Returns null when the name is not a built-in type name.
 */
/**
 * proposal-runtime-types: the shared sentinel Parse Node that stands in as the
 * [[Declaration]] of every library generic type. Library types are told apart by
 * [[LibraryName]], never by this node, so one sentinel for all of them is enough
 * and keeps the nominal shape (which requires a [[Declaration]]) well-formed.
 */
const libraryDeclarationSentinel = { type: 'LibraryType', location: { startIndex: -1 } } as unknown as ParseNode;

/**
 * The set of library generic type names this implementation resolves in type
 * position. Each is a nominal type distinguished by name and parameterized by its
 * type arguments; none has structural content of its own here (Promise.<T> and
 * Record.<K, V> are identities the reflection API and the awaited operation read).
 */
const libraryTypeNames = new Set(['Promise', 'Record']);

/**
 * Build the library generic type of the given name applied to the given
 * arguments, or null when the name is not a library type. Identity is by name and
 * arguments, so two writings of `Promise.<uint32>` are one interned type.
 */
export function libraryTypeRecord(name: string, args: readonly (TypeRecord | number)[] = []): TypeRecord | null {
  if (!libraryTypeNames.has(name)) {
    return null;
  }
  return {
    Kind: 'nominal',
    Declaration: libraryDeclarationSentinel,
    Arguments: args,
    LibraryName: name,
  };
}

export function builtinTypeRecord(name: string, args: readonly (TypeRecord | number)[] = []): TypeRecord | null {
  const m = /^(u?int)(8|16|32|64|128)$/.exec(name);
  if (m) {
    return makePrimitive(m[1], [Number(m[2])]);
  }
  switch (name) {
    case 'any': return anyType;
    case 'never': return neverType;
    case 'boolean1': return makePrimitive('uint', [1]);
    case 'float16': case 'float32': case 'float64':
    case 'number': case 'string': case 'boolean': case 'bigint': case 'symbol':
      return makePrimitive(name);
    case 'int': case 'uint': case 'rational': case 'complex': case 'vector':
      return args.length > 0 ? makePrimitive(name, args) : null;
    default:
      return null;
  }
}

/**
 * A stable structural key giving the total order that CanonicalizeType sorts
 * union and intersection members by. Any deterministic order serves.
 */
export function orderKey(t: TypeRecord): string {
  switch (t.Kind) {
    case 'any': return 'any';
    case 'void': return 'void';
    case 'primitive': return `primitive:${t.Name}:${t.Arguments.map((a) => (typeof a === 'number' ? String(a) : orderKey(a))).join(',')}`;
    case 'literal': return `literal:${orderKey(t.Base)}:${String((t.Value as { value?: unknown }).value ?? t.Value)}`;
    case 'parameterized': return `parameterized:${orderKey(t.Base)}`;
    case 'nominal': return `nominal:${t.LibraryName ? `lib:${t.LibraryName}` : (t.Declaration as { location?: { startIndex?: number } }).location?.startIndex ?? 0}${t.Arguments.length > 0 ? `<${t.Arguments.map((a) => (typeof a === 'number' ? String(a) : orderKey(a))).join(',')}>` : ''}`;
    case 'union': return `union:${t.Members.map(orderKey).join('|')}`;
    case 'intersection': return `intersection:${t.Members.map(orderKey).join('&')}`;
    case 'tuple': return `tuple:${t.Elements.map((e) => `${e.Rest ? '...' : ''}${orderKey(e.Type)}`).join(',')}`;
    case 'array': return `array:${orderKey(t.Element)}:${t.Extent}`;
    case 'reference': return `reference:${orderKey(t.Target)}`;
    case 'object': return `object:${t.Properties.map((p) => `${p.readonly ? 'readonly ' : ''}${p.key}${p.optional ? '?' : ''}:${orderKey(p.type)}`).join(',')};${t.IndexSignatures.map((ix) => `[${orderKey(ix.Key)}]:${orderKey(ix.Value)}`).join(',')}`;
    case 'function': return `function:${t.Signatures.map((g) => `${g.ThisType ? `this:${orderKey(g.ThisType)};` : ''}(${g.Parameters.map(orderKey).join(',')})=>${g.Return ? orderKey(g.Return) : ''}`).join('|')}`;
    default: return 'unknown';
  }
}

/** A readable rendering of a Type Record for error messages. */
export function displayType(t: TypeRecord): string {
  switch (t.Kind) {
    case 'any': return 'any';
    case 'void': return 'void';
    case 'primitive': return t.Arguments.length > 0 ? `${t.Name}.<${t.Arguments.map((a) => (typeof a === 'number' ? String(a) : displayType(a))).join(', ')}>` : t.Name;
    case 'literal': return `a literal type of ${displayType(t.Base)}`;
    case 'union': return t.Members.length === 0 ? 'never' : t.Members.map(displayType).join(' | ');
    case 'intersection': return t.Members.map(displayType).join(' & ');
    case 'array': return `[${t.Extent === 'dynamic' ? '' : t.Extent}].<${displayType(t.Element)}>`;
    case 'tuple': return `[${t.Elements.map((e) => displayType(e.Type)).join(', ')}]`;
    default: return t.Kind;
  }
}
