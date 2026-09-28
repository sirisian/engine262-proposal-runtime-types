import type { ParseNode } from '../parser/ParseNode.mts';
import type { SymbolValue } from '../value.mts';
import { generatorDeclaredType, mentionsTypeParameter, type Known } from './records.mts';
import { IsSubtype, IsAssignable, SameType } from './relations.mts';

export type MemberKind = 'method' | 'get' | 'set' | 'field';
export interface MemberContract {
  readonly key: string | SymbolValue;
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
  } else if (index >= 0) members[index] = member;
  else members.push(member);
}

/** The chain is nearest first; unknown types defer signature compatibility. */
export function abstractMemberViolation(chain: readonly (readonly MemberContract[])[], isAbstract: boolean): { kind: 'missing' | 'signature', key: string | SymbolValue } | null {
  const own = chain[0] ?? [];
  for (const member of own) {
    if (member.kind === 'field') continue;
    const inherited = chain.slice(1).flat().find((prior) => prior.key === member.key && prior.static === member.static && prior.kind === member.kind);
    if (inherited?.abstract && member.type && inherited.type && !IsSubtype(member.type, inherited.type, [])) {
      return { kind: 'signature', key: member.key };
    }
  }
  if (isAbstract) return null;
  for (const obligation of chain.flat()) {
    if (!obligation.abstract) continue;
    if (chain.some((level) => level.some((member) => member.kind === 'field'
      && member.key === obligation.key && member.static === obligation.static))) return { kind: 'missing', key: obligation.key };
    for (const level of chain) {
      const declarations = level.filter((member) => member.key === obligation.key && member.static === obligation.static);
      if (declarations.length === 0) continue;
      const implementation = declarations.find((member) => member.kind === obligation.kind);
      if (!implementation || implementation.abstract) return { kind: 'missing', key: obligation.key };
      break;
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
