import type { ParseNode } from '../parser/ParseNode.mts';
import { surroundingAgent } from '#self';

/**
 * proposal-runtime-types (spec, Provenance): the declaration sites a type came
 * from. It is not part of any type's identity, SameType does not read it, and
 * canonicalization neither reads it nor writes it into the comparison that
 * decides whether two Records are one. What canonicalization does with it is
 * union it.
 *
 * THE PROBLEM IT SOLVES is the one structural typing creates and nominal typing
 * does not. `type A = { x: number }` and `type B = { x: number }` intern to ONE
 * Type Object, which is what makes a brand a real newtype and what makes two
 * modules agree without a registry. The cost is that the object no longer knows
 * where it came from, so a tool asked "where is this type declared" has nothing
 * to answer with. Rust never meets this because it is nominal: a struct is its
 * own type with one definition site, and `DefId` is an index into a table of
 * them. TypeScript meets it exactly and answers it the same way this does, by
 * hanging declaration links off the type.
 *
 * TWO DESIGN CHOICES, both deliberate.
 *
 * Origins live in a side table keyed by the INTERNED TYPE OBJECT rather than in
 * the Type Record. The record is the thing SameType and CanonicalizeType read,
 * and a field they must be careful to ignore is a field they can fail to ignore;
 * keeping provenance out of the record makes that class of bug unreachable rather
 * than merely avoided. It also gives the union for free: two declarations of one
 * shape reach one Type Object, and both append to its list.
 *
 * An origin is an OPAQUE HANDLE, a source name and a position, and never the
 * parse node. Holding the node would keep the whole tree alive for as long as the
 * type is interned, which in an agent that never exits is a leak rather than a
 * cost. This is the `DefId` shape: identify the site, do not retain it.
 *
 * IT IS NOT REFLECTED. `Reflect.getReflection` does not expose it and no program
 * can read it. The consumer is tooling, a language server resolving a doc comment
 * or a go-to-definition, and those run in the host. Exposing it to programs would
 * buy them little and cost something real: because origins union, declaring an
 * unrelated type of the same shape in another module would change what a program
 * observes about its own type. A property that changes because a stranger wrote a
 * structurally identical declaration is a surprise nobody should meet in
 * production, and the host channel has no such hazard because a tool already
 * knows it is looking at a whole program.
 */
export interface TypeOrigin {
  /** The declaration form, for a tool that wants to say what it found. */
  readonly kind: string;
  /** The declared name, where the form has one. */
  readonly name: string | undefined;
  /** The host's name for the source, where it supplied one. */
  readonly source: string | undefined;
  readonly line: number;
  readonly column: number;
  /** Source offsets, so a tool can slice the exact text without re-parsing. */
  readonly startIndex: number;
  readonly endIndex: number;
}

/**
 * Per agent, matching the intern table this rides beside: an origin recorded by
 * one agent's program must not describe another's.
 */
const originsByAgent = new WeakMap<object, WeakMap<object, TypeOrigin[]>>();

/**
 * Per-MEMBER origins, keyed by the interned Type Object and then by member key.
 *
 * #sec-provenance: "A Property Type Record and a Type Record may carry an
 * [[Origin]]". Only the Type Record half was recorded, so a tool could say where
 * a TYPE was declared and not where any of its members was - and the reason the
 * clause gives for wanting provenance at all is a member: "`partial(User)`
 * should not cost an editor its memory of where `name` came from."
 *
 * Keyed on the interned Type Object rather than on the property record, because
 * canonicalization REBUILDS property records: the record a declaration produced
 * is not the record the interned type holds, so a table keyed on it would be
 * empty by the time a tool asked. Keying on the interned type also makes the
 * union fall out for free, exactly as it does for a Type Record - two structurally
 * identical declarations intern to one Type Object, so appending here is the
 * union canonicalization is specified to perform.
 */
const memberOriginsByAgent = new WeakMap<object, WeakMap<object, Map<string, TypeOrigin[]>>>();

function tableForAgent(): WeakMap<object, TypeOrigin[]> {
  const agent = surroundingAgent as unknown as object;
  let table = originsByAgent.get(agent);
  if (!table) {
    table = new WeakMap();
    originsByAgent.set(agent, table);
  }
  return table;
}

/** Build an opaque handle for a declaration node, retaining none of it. */
export function OriginOfNode(node: ParseNode, kind: string, name?: string): TypeOrigin {
  const location = (node as { location?: { startIndex: number, endIndex: number, start: { line: number, column: number } } }).location;
  const host = (node as { sourceText?: unknown }) as { scriptOrModule?: { HostDefined?: { specifier?: string } } };
  return {
    kind,
    name,
    source: host?.scriptOrModule?.HostDefined?.specifier,
    line: location?.start?.line ?? 0,
    column: location?.start?.column ?? 0,
    startIndex: location?.startIndex ?? 0,
    endIndex: location?.endIndex ?? 0,
  };
}

/**
 * Record that a Type Object came from a declaration site. Interning has already
 * merged the shapes, so appending here IS the union canonicalization is specified
 * to perform. A site is recorded once: re-evaluating one declaration, as a
 * function body containing it may, does not grow the list.
 */
export function RecordTypeOrigin(typeObject: object, origin: TypeOrigin): void {
  const table = tableForAgent();
  let list = table.get(typeObject);
  if (!list) {
    list = [];
    table.set(typeObject, list);
  }
  if (list.some((o) => o.startIndex === origin.startIndex && o.endIndex === origin.endIndex && o.source === origin.source)) {
    return;
  }
  list.push(origin);
}

/**
 * The declaration sites a Type Object came from, in the order they were seen.
 * This is the host-facing channel: an embedder, an inspector, or a language
 * server calls it, and no program can.
 */
export function TypeOrigins(typeObject: object): readonly TypeOrigin[] {
  return tableForAgent().get(typeObject) ?? [];
}

function memberTableForAgent(): WeakMap<object, Map<string, TypeOrigin[]>> {
  const agent = surroundingAgent as unknown as object;
  let table = memberOriginsByAgent.get(agent);
  if (!table) {
    table = new WeakMap();
    memberOriginsByAgent.set(agent, table);
  }
  return table;
}

/**
 * Record that a member of an interned Type Object came from a declaration site.
 * Recorded once per site, as a Type Record's is: re-evaluating one declaration
 * does not grow the list.
 */
export function RecordMemberOrigin(typeObject: object, key: string, origin: TypeOrigin): void {
  const table = memberTableForAgent();
  let byKey = table.get(typeObject);
  if (!byKey) {
    byKey = new Map();
    table.set(typeObject, byKey);
  }
  let list = byKey.get(key);
  if (!list) {
    list = [];
    byKey.set(key, list);
  }
  if (list.some((o) => o.startIndex === origin.startIndex && o.endIndex === origin.endIndex && o.source === origin.source)) {
    return;
  }
  list.push(origin);
}

/**
 * The declaration sites a member came from, in the order they were seen. The
 * host-facing channel for a member, as `TypeOrigins` is for a type: an embedder
 * or a language server calls it, and no program can.
 *
 * A member a BUILDER minted has none, for the reason a minted record has none -
 * "nothing declared it" - and the fallback #sec-provenance names is the
 * application that produced it.
 */
export function MemberOrigins(typeObject: object, key: string): readonly TypeOrigin[] {
  return memberTableForAgent().get(typeObject)?.get(key) ?? [];
}

/**
 * Record an origin for each member a declaration WRITES, from the member's own
 * position rather than the declaration's.
 *
 * The object type is found by walking past the forms that wrap one - a type
 * alias holds it under its annotation, an interface holds its members directly -
 * and anything else records nothing, since a member origin is only meaningful
 * where a member was written down.
 */
export function RecordDeclaredMemberOrigins(typeObject: object, declaration: ParseNode): void {
  const node = declaration as unknown as {
    type?: string,
    TypeMemberList?: readonly object[],
    // An interface holds its members under its own name, not the object type's.
    InterfaceMemberList?: readonly object[],
    Type?: { type?: string, TypeMemberList?: readonly object[] },
    TypeAnnotation?: { Type?: { type?: string, TypeMemberList?: readonly object[] } },
  };
  const members = node.TypeMemberList
    ?? node.InterfaceMemberList
    ?? node.Type?.TypeMemberList
    ?? node.TypeAnnotation?.Type?.TypeMemberList;
  if (!members) {
    return;
  }
  for (const raw of members) {
    const member = raw as {
      type?: string,
      PropertyName?: { name?: string, value?: string | number | bigint },
    };
    if (member.type === 'IndexSignature') {
      // No key to record one against: an index signature declares a rule, not a
      // member.
      continue;
    }
    const named = member.PropertyName;
    const key = named?.name ?? (named?.value === undefined ? undefined : String(named.value));
    if (key === undefined) {
      continue;
    }
    RecordMemberOrigin(typeObject, key, OriginOfNode(raw as ParseNode, member.type ?? 'TypeMember', key));
  }
}
