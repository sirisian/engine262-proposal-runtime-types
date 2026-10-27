import type { ParseNode } from '../parser/ParseNode.mts';
import type { TypeRecord } from './records.mts';
import { SameTypeStructural } from './relations.mts';
import { tieAliasKnot } from './resolving-aliases.mts';

export interface AliasExpansion {
  readonly declaration: ParseNode.TypeAliasDeclaration;
  readonly environment: object;
  readonly captures: ReadonlyMap<string, TypeRecord>;
  readonly arguments: readonly TypeRecord[];
  readonly placeholder: TypeRecord;
  result?: TypeRecord;
}

export interface AliasFormation {
  readonly active: AliasExpansion[];
  readonly entries: AliasExpansion[];
}

// A region belongs to one active type resolution, never to a name or an interned type.
const formations = new WeakMap<object, AliasFormation>();

export function AliasFormationFor(region: object): AliasFormation | undefined {
  return formations.get(region);
}

export function BeginAliasFormation(region: object): AliasFormation {
  const formation = { active: [], entries: [] };
  formations.set(region, formation);
  return formation;
}

export function EndAliasFormation(region: object): void {
  formations.delete(region);
}

export function MatchingAliasExpansion(formation: AliasFormation, declaration: ParseNode.TypeAliasDeclaration,
  environment: object, captures: ReadonlyMap<string, TypeRecord>, argumentsList: readonly TypeRecord[]): AliasExpansion | undefined {
  return formation.active.find((entry) => entry.declaration === declaration && entry.environment === environment
    && entry.arguments.length === argumentsList.length
    && entry.arguments.every((argument, index) => SameTypeStructural(argument, argumentsList[index]!))
    && entry.captures.size === captures.size
    && [...captures].every(([name, value]) => entry.captures.has(name) && SameTypeStructural(value, entry.captures.get(name)!)));
}

/** Resolve transparent forwarding before tying structural back edges. */
export function CompleteAliasFormation(formation: AliasFormation): AliasExpansion | undefined {
  const byPlaceholder = new Map(formation.entries.map((entry) => [entry.placeholder, entry]));
  const complete = new Set<AliasExpansion>();
  for (const entry of formation.entries) {
    const chain: AliasExpansion[] = [];
    const seen = new Set<AliasExpansion>();
    let at = entry;
    while (!complete.has(at)) {
      if (seen.has(at) || !at.result) return at;
      seen.add(at);
      chain.push(at);
      const next = byPlaceholder.get(at.result);
      if (!next) break;
      at = next;
    }
    const result = complete.has(at) ? at.placeholder : at.result!;
    for (const pending of chain.reverse()) {
      tieAliasKnot(pending.placeholder, result);
      complete.add(pending);
    }
  }
  return undefined;
}
