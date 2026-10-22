import type { ParseNode } from '../parser/ParseNode.mts';
import { Value, type SymbolValue } from '../value.mts';
import { surroundingAgent } from '../execution-context/Agent.mts';
import { CallableGroupHostFor } from './component-patterns.mts';
import { MatchSpecializationList } from './specialization-patterns.mts';
import { IsSubtype } from './relations.mts';
import { operatorTableKey } from './overloads.mts';
import { instantiatePartialClassSelf, makePrimitive, substituteTypeParameters, type TypeRecord } from './records.mts';
import { ResolveBindingDeclaration } from './compile-time-evaluability.mts';

export function IsPartialDeclaration(node: unknown): boolean {
  const declaration = node as { Partial?: boolean, ClassModifiers?: readonly string[] } | undefined;
  return !!declaration?.Partial || !!declaration?.ClassModifiers?.includes('partial');
}

/** A bare type name in a partial body denotes that contribution's target.
 * This finds syntax only; the checker and evaluator supply their own target
 * context. No evaluated class is associated globally with a partial node.
 */
export function PartialClassSelfOf(node: ParseNode): ParseNode.ClassDeclaration | undefined {
  if (node.type !== 'TypeReference' || node.TypeArguments || node.TypeName.MemberNames.length) return undefined;
  const name = node.TypeName.IdentifierReference.name;
  const visited = new Set<ParseNode>([node]);
  for (let owner = node.parent; owner; owner = owner.parent) {
    if ((owner.type === 'ClassDeclaration' || owner.type === 'ClassExpression') && owner.BindingIdentifier?.name === name) {
      if (owner.type !== 'ClassDeclaration' || !IsPartialDeclaration(owner)
        || (owner.TypeParameters && visited.has(owner.TypeParameters))
        || (owner.ClassTail.ClassHeritage && visited.has(owner.ClassTail.ClassHeritage))) return undefined;
      const binding = ResolveBindingDeclaration(node, name);
      // A local alias, parameter, capture or nested declaration wins over self.
      for (let scope = binding?.node; scope; scope = scope.parent) {
        if (scope === owner) return undefined;
      }
      return owner;
    }
    visited.add(owner);
  }
  return undefined;
}

export interface PartialStructureContribution {
  readonly Declaration: ParseNode.ClassDeclaration | ParseNode.InterfaceDeclaration;
  readonly Structure: () => TypeRecord | null;
  readonly Resolve: (node: ParseNode) => TypeRecord | null;
  readonly Operator?: (key: string) => TypeRecord | null;
}

export interface ModulePartialContribution {
  readonly Primary: object;
  readonly Static: boolean;
  readonly Contribution: PartialStructureContribution;
}

export function PartialBindings(type: TypeRecord, part: PartialStructureContribution): Map<string, TypeRecord> | null {
  if (type.Kind !== 'nominal') return null;
  const parameters = (type.Declaration as { TypeParameters?: ParseNode.TypeParameters | null }).TypeParameters?.TypeParameterList ?? [];
  if (parameters.length !== type.Arguments.length) return null;
  const bindings = new Map<string, TypeRecord>();
  const record = (argument: TypeRecord | number): TypeRecord => typeof argument === 'number'
    ? { Kind: 'literal', Value: Value(argument), Base: makePrimitive('number') } : argument;
  parameters.forEach((p, i) => bindings.set(p.BindingIdentifier.name, record(type.Arguments[i])));
  if (part.Declaration.TypeParameters) {
    const matched = MatchSpecializationList(part.Declaration.TypeParameters, parameters.map((p) => ({
      Name: p.BindingIdentifier.name, Variadic: !!p.IsVariadic, HasDefault: !!p.TypeParameterDefault,
    })), type.Arguments, CallableGroupHostFor(part.Resolve, (a, b) => IsSubtype(a, b, [])));
    if (matched === 'no-match') return null;
    for (const capture of matched) bindings.set(capture.Capture.Name, record(capture.Value));
  }
  return bindings;
}

/** #sec-partial-classes: all matching extensions contribute, with no winner. */
export function MergePartialStructures(
  type: TypeRecord,
  contributions: readonly PartialStructureContribution[],
  collision: (key: string) => void,
  staticMembers = false,
): TypeRecord {
  if (type.Kind !== 'nominal' || contributions.length === 0) return type;
  const parameters = (type.Declaration as { TypeParameters?: ParseNode.TypeParameters | null }).TypeParameters?.TypeParameterList ?? [];
  if (parameters.length !== type.Arguments.length) return type;
  const base = 'PartialBaseStructure' in type ? (type as typeof type & { PartialBaseStructure?: TypeRecord }).PartialBaseStructure : type.Structure;
  const frame = new Map<string, TypeRecord>();
  parameters.forEach((p, i) => {
    const argument = type.Arguments[i];
    frame.set(p.BindingIdentifier.name, typeof argument === 'number'
      ? { Kind: 'literal', Value: Value(argument), Base: makePrimitive('number') } : argument);
  });
  let structure = base ? substituteTypeParameters(base, frame) : null;
  // Interface-only entries describe the promised lookup surface, not an
  // existing declaration. A real partial can supply them without colliding.
  const baseLookupOnly = 'PartialBaseLookupOnlyMemberKeys' in type
    ? (type as typeof type & { PartialBaseLookupOnlyMemberKeys?: readonly (string | SymbolValue)[] }).PartialBaseLookupOnlyMemberKeys
    : type.LookupOnlyMemberKeys;
  const lookupOnly = new Set(staticMembers ? [] : baseLookupOnly ?? []);
  const keys = new Set(structure?.Kind === 'object'
    ? structure.Properties.filter((property) => !lookupOnly.has(property.key)).map((property) => property.key) : []);
  const operatorKeys = (declaration: object): Set<string> => new Set(
    ((declaration as ParseNode.ClassDeclaration).ClassTail?.ClassBody ?? [])
      .filter((member): member is ParseNode.OperatorDefinition => member.type === 'OperatorDefinition')
      .map((member) => `${member.static ? 'static ' : ''}operator ${operatorTableKey(member)}`),
  );
  const operators = operatorKeys(type.Declaration);
  for (const part of contributions) {
    const bindings = PartialBindings(type, part);
    if (!bindings) continue;
    for (const key of operatorKeys(part.Declaration)) {
      if (operators.has(key)) collision(key);
      operators.add(key);
    }
    const template = part.Structure();
    const added = template && substituteTypeParameters(instantiatePartialClassSelf(template, part.Declaration, type), bindings);
    if (!added) continue;
    if (added.Kind === 'object') for (const property of added.Properties) lookupOnly.delete(property.key);
    if (!structure) {
      structure = added;
      if (added.Kind === 'object') for (const property of added.Properties) keys.add(property.key);
      continue;
    }
    if (structure.Kind === 'function' && added.Kind === 'function') {
      structure = { Kind: 'function', Signatures: [...structure.Signatures, ...added.Signatures] };
    } else if (structure.Kind === 'object' && added.Kind === 'object') {
      for (const property of added.Properties) {
        if (keys.has(property.key)) collision(String(property.key));
        keys.add(property.key);
      }
      const addedKeys = new Set(added.Properties.map((property) => property.key));
      structure = { Kind: 'object', Properties: [...structure.Properties.filter((property) => !addedKeys.has(property.key)), ...added.Properties],
        IndexSignatures: [...structure.IndexSignatures, ...added.IndexSignatures] };
    } else collision('call signatures and named members');
  }
  return { ...type, PartialBaseStructure: base, PartialBaseLookupOnlyMemberKeys: baseLookupOnly,
    Structure: structure ?? undefined, LookupOnlyMemberKeys: [...lookupOnly] } as TypeRecord;
}

const runtimeContributions = new WeakMap<object, Map<object, PartialStructureContribution[]>>();
export function RuntimePartialContributions(declaration: object): PartialStructureContribution[] {
  let registry = runtimeContributions.get(surroundingAgent);
  if (!registry) {
    registry = new Map();
    runtimeContributions.set(surroundingAgent, registry);
  }
  let parts = registry.get(declaration);
  if (!parts) {
    parts = [];
    registry.set(declaration, parts);
  }
  return parts;
}

const publishedContributions = new WeakMap<object, Map<object, { instance: PartialStructureContribution[], static: PartialStructureContribution[] }>>();
const modulePublications = new WeakMap<object, WeakMap<object, readonly ModulePartialContribution[]>>();

/** Publish only the completed module check, replacing this source's prior pass. */
export function PublishModulePartialContributions(module: object, entries: readonly ModulePartialContribution[]): void {
  let publications = modulePublications.get(surroundingAgent);
  if (!publications) {
    publications = new WeakMap();
    modulePublications.set(surroundingAgent, publications);
  }
  for (const prior of publications.get(module) ?? []) {
    const parts = PublishedPartialContributions(prior.Primary, prior.Static);
    const index = parts.findIndex((part) => part.Declaration === prior.Contribution.Declaration);
    if (index >= 0) parts.splice(index, 1);
  }
  for (const entry of entries) PublishedPartialContributions(entry.Primary, entry.Static).push(entry.Contribution);
  publications.set(module, [...entries]);
}

export function PublishedPartialContributions(declaration: object, staticMembers = false): PartialStructureContribution[] {
  let registry = publishedContributions.get(surroundingAgent);
  if (!registry) {
    registry = new Map();
    publishedContributions.set(surroundingAgent, registry);
  }
  let parts = registry.get(declaration);
  if (!parts) {
    parts = { instance: [], static: [] };
    registry.set(declaration, parts);
  }
  return staticMembers ? parts.static : parts.instance;
}
