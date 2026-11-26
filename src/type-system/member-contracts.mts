import type { ParseNode } from '../parser/ParseNode.mts';
import type { SymbolValue } from '../value.mts';
import { generatorDeclaredType, mentionsTypeParameter, type Known, type SignatureRecord, type TypeRecord } from './records.mts';
import { IsSubtype, IsAssignable, SameType } from './relations.mts';

export type MemberKind = 'method' | 'get' | 'set' | 'field';
export interface MemberContract {
  readonly key: string | SymbolValue;
  readonly Declaration?: ParseNode;
  readonly static: boolean;
  readonly kind: MemberKind;
  readonly abstract: boolean;
  readonly type: Known;
  readonly readonly?: boolean;
}

/** #sec-abstract-classes: placement, property identity and member kind matter. */
export function memberKind(node: ParseNode): MemberKind | null {
  if (node.type === 'FieldDefinition') return 'field';
  if (node.type === 'AbstractMethodDefinition') return node.Accessor ?? 'method';
  if (node.type === 'MethodDefinition') return node.PropertySetParameterList ? 'set' : node.UniqueFormalParameters ? 'method' : 'get';
  return ['GeneratorMethod', 'AsyncMethod', 'AsyncGeneratorMethod'].includes(node.type) ? 'method' : null;
}

/** A generator method's call returns its carrier, including shorthand yields. */
export function normalizedMemberType(node: ParseNode, type: Known): Known {
  if (type?.Kind !== 'function' || (node.type !== 'GeneratorMethod' && node.type !== 'AsyncGeneratorMethod')) return type;
  return { ...type, Signatures: type.Signatures.map((signature) => ({ ...signature,
    Return: signature.Return ? generatorDeclaredType(signature.Return, node.type === 'AsyncGeneratorMethod') : null,
  })) };
}

export function addMemberContract(members: MemberContract[], member: MemberContract): void {
  const index = members.findIndex((prior) => prior.key === member.key && prior.static === member.static && prior.kind === member.kind);
  const prior = members[index];
  if (prior?.kind === 'method' && prior.type?.Kind === 'function' && member.type?.Kind === 'function') {
    members[index] = { ...member, type: { Kind: 'function', Signatures: [...prior.type.Signatures, ...member.type.Signatures] } };
  } else if (index >= 0) members[index] = { ...prior, ...member };
  else members.push(member);
}

/** The function type of one signature, without the self `this` a class gives it. */
function armType(signature: SignatureRecord): TypeRecord {
  return { Kind: 'function', Signatures: [{ ...signature, ThisType: undefined }] } as unknown as TypeRecord;
}

/** #sec-typed-classes: one arm overrides another by its parameter types alone. */
function sameParameterTypes(a: { Parameters: readonly { Type?: Known }[] }, b: { Parameters: readonly { Type?: Known }[] }): boolean {
  return a.Parameters.length === b.Parameters.length
    && a.Parameters.every((p, i) => (!p.Type || !b.Parameters[i]!.Type ? !p.Type && !b.Parameters[i]!.Type : SameType(p.Type, b.Parameters[i]!.Type)));
}

/**
 * The chain is nearest first; unknown types defer signature compatibility.
 *
 * #sec-abstract-classes with README "Methods and Inheritance" (Question BX):
 * an abstract method's obligation is one per arm. An own arm with an abstract
 * arm's parameter types overrides it, and is refused where it does not accept
 * what the abstract arm accepts. An arm with other parameter types is an
 * overload beside it, not an implementation of it. A class not declared
 * `abstract` must discharge every abstract arm with a compatible arm declared
 * below it, a compatible full signature; an unannotated method declares
 * nothing, and discharges every arm of its name.
 */
export function abstractMemberViolation(chain: readonly (readonly MemberContract[])[], isAbstract: boolean): { kind: 'missing' | 'signature', key: string | SymbolValue } | null {
  const own = chain[0] ?? [];
  for (const member of own) {
    if (member.kind === 'field') continue;
    const inherited = chain.slice(1).flat().find((prior) => prior.key === member.key && prior.static === member.static && prior.kind === member.kind);
    if (!inherited?.abstract || !member.type || !inherited.type) continue;
    if (member.kind === 'method' && member.type.Kind === 'function' && inherited.type.Kind === 'function') {
      for (const arm of member.type.Signatures) {
        for (const obligation of inherited.type.Signatures) {
          if (sameParameterTypes(arm, obligation) && !IsSubtype(armType(arm), armType(obligation), [])) return { kind: 'signature', key: member.key };
        }
      }
    } else if (!IsSubtype(member.type, inherited.type, [])) {
      return { kind: 'signature', key: member.key };
    }
  }
  if (isAbstract) return null;
  for (const [index, level] of chain.entries()) {
    for (const obligation of level) {
      if (!obligation.abstract) continue;
      if (chain.some((members) => members.some((member) => member.kind === 'field'
        && member.key === obligation.key && member.static === obligation.static))) return { kind: 'missing', key: obligation.key };
      // The nearest declaration of the name decides its kind, and an abstract
      // redeclaration nearer than this one governs in its place.
      const nearer = chain.slice(0, index);
      if (nearer.some((members) => members.some((member) => member.abstract && member.key === obligation.key
        && member.static === obligation.static && member.kind === obligation.kind))) continue;
      let decided = false;
      for (const members of nearer) {
        const declarations = members.filter((member) => member.key === obligation.key && member.static === obligation.static);
        if (declarations.length === 0) continue;
        if (!declarations.some((member) => member.kind === obligation.kind)) return { kind: 'missing', key: obligation.key };
        decided = true;
        break;
      }
      if (!decided) return { kind: 'missing', key: obligation.key };
      const implementations = nearer.flat().filter((member) => member.key === obligation.key && member.static === obligation.static
        && member.kind === obligation.kind && !member.abstract);
      if (obligation.kind !== 'method' || obligation.type?.Kind !== 'function') {
        if (implementations.length === 0) return { kind: 'missing', key: obligation.key };
        continue;
      }
      for (const required of obligation.type.Signatures) {
        const discharged = implementations.some((member) => !member.type || member.type.Kind !== 'function'
          || member.type.Signatures.some((arm) => sameParameterTypes(arm, required) || IsSubtype(armType(arm), armType(required), [])));
        if (!discharged) return { kind: 'missing', key: obligation.key };
      }
    }
  }
  return null;
}

export interface FieldContract {
  readonly type: NonNullable<Known>;
  readonly readonly: boolean;
  readonly protected: boolean;
  readonly controls?: import('./layout.mts').FieldControls;
}

/** Unknown layout controls defer; established storage types are invariant. */
export function sameFieldContract(a: FieldContract, b: FieldContract): boolean {
  return SameType(a.type, b.type) && a.readonly === b.readonly && a.protected === b.protected
    && (!a.controls || !b.controls || (['align', 'offset', 'offsetBit', 'endian'] as const)
      .every((key) => a.controls![key] === b.controls![key]));
}

/** #sec-typed-classes: an own field must preserve the inherited member's use. */
export function inheritedFieldViolation(chain: readonly (readonly MemberContract[])[], receiver?: Known): string | SymbolValue | null {
  if (!(chain[0] ?? []).some((member) => member.kind === 'field' && !member.static && member.type)) return null;
  // Runtime specialization has resolved the field records even when the
  // published declaration still names parameters. Rebuild only the read view
  // needed by an explicit receiver contract; no property is read from a value.
  const members = chain.flat().filter((member) => !member.static);
  const keys = new Set(members.map((member) => member.key));
  const shape: NonNullable<Known> = { Kind: 'object', IndexSignatures: [], Properties: [...keys].map((key) => {
    const declarations = members.filter((member) => member.key === key);
    const field = declarations.find((member) => member.kind === 'field');
    const member = field ?? declarations.find((member) => member.kind !== 'set') ?? declarations[0]!;
    const type = member.kind === 'get' && member.type?.Kind === 'function'
      ? member.type.Signatures[0]?.Return : member.type;
    return { key, type: type ?? { Kind: 'any' }, optional: false,
      readonly: field ? !!field.readonly : member.kind === 'method' || !declarations.some((part) => part.kind === 'set') };
  }) };
  const actual = receiver?.Kind === 'nominal' ? { ...receiver, Structure: shape } : shape;
  const callable = (type: Known): Known => type?.Kind === 'function' ? { ...type,
    Signatures: type.Signatures.map((signature) => ({ ...signature,
      ThisType: signature.ThisType?.Kind === 'nominal' && signature.ThisType.Declaration.type === ('SelfThisMarker' as string)
        ? undefined : signature.ThisType,
    })),
  } : type;
  for (const field of chain[0] ?? []) {
    if (field.kind !== 'field' || field.static || !field.type || field.type.Kind === 'any' || mentionsTypeParameter(field.type)) continue;
    // An inherited own field already masks every prototype descriptor. Its
    // independent storage redeclaration rule owns this case.
    if (chain.slice(1).some((level) => level.some((member) => !member.static && member.key === field.key && member.kind === 'field'))) continue;
    const inherited = chain.slice(1).map((level) => level.filter((member) => !member.static && member.key === field.key))
      .find((level) => level.length > 0) ?? [];
    for (const member of inherited) {
      if (member.abstract || !member.type || member.type.Kind === 'any' || mentionsTypeParameter(member.type)) continue;
      if (member.kind === 'method') {
        let supplied = callable(field.type)!;
        if (supplied.Kind === 'function') supplied = { ...supplied, Signatures: supplied.Signatures
          .filter((signature) => !signature.ThisType || mentionsTypeParameter(signature.ThisType)
            || mentionsTypeParameter(actual) || IsAssignable(actual, signature.ThisType))
          .map((signature) => ({ ...signature, ThisType: undefined })) };
        if (!IsSubtype(supplied, callable(member.type)!, [])) return field.key;
      } else if (member.type.Kind === 'function') {
        for (const signature of member.type.Signatures) {
          const required = member.kind === 'get' ? signature.Return ?? signature.InferredReturn : signature.Parameters[0]?.Type;
          if (!required || required.Kind === 'any') continue;
          if (member.kind === 'get' ? !IsSubtype(field.type, required, [])
            : field.readonly || !IsSubtype(required, field.type, [])) return field.key;
        }
      }
    }
  }
  return null;
}
