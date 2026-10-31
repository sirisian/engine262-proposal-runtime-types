import type { TypeRecord } from './records.mts';
import { IsAssignable } from './relations.mts';

type Evidence = 'compatible' | 'incompatible' | 'unknown';

/**
 * Evidence for a receiving judgment, not an extension of IsAssignable.
 * A missing superclass origin is not a known end of the superclass chain.
 * Unknown evidence must retain runtime admission and cannot license elision.
 */
export function NominalAssignmentEvidence(source: TypeRecord, target: TypeRecord): Evidence {
  if (IsAssignable(source, target)) return 'compatible';
  if (source.Kind === 'union') {
    const members = source.Members.map((member) => NominalAssignmentEvidence(member, target));
    return members.includes('incompatible') ? 'incompatible' : members.includes('unknown') ? 'unknown' : 'compatible';
  }
  if (target.Kind === 'union') {
    const members = target.Members.map((member) => NominalAssignmentEvidence(source, member));
    return members.includes('compatible') ? 'compatible' : members.includes('unknown') ? 'unknown' : 'incompatible';
  }
  if (target.Kind === 'intersection') {
    const members = target.Members.map((member) => NominalAssignmentEvidence(source, member));
    return members.includes('incompatible') ? 'incompatible' : members.includes('unknown') ? 'unknown' : 'compatible';
  }
  if (source.Kind !== 'nominal' || target.Kind !== 'nominal') return 'incompatible';
  const targetDeclaration = target.Declaration;
  if (targetDeclaration.type !== 'ClassDeclaration' && targetDeclaration.type !== 'ClassExpression') return 'incompatible';
  const visited = new Set<TypeRecord>();
  for (let current: TypeRecord | undefined = source; current?.Kind === 'nominal'; current = current.Base) {
    if (visited.has(current)) return 'unknown';
    visited.add(current);
    // An established application of this declaration already supplies its
    // arguments/identity. Missing ancestry cannot erase their incompatibility.
    if (current.Declaration === target.Declaration
        && current.DeclarationIdentity === target.DeclarationIdentity) return 'incompatible';
    if (current.UnresolvedHeritage && !current.Base) return 'unknown';
  }
  return 'incompatible';
}
