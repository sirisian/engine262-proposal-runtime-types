import type { ParseNode } from '../parser/ParseNode.mts';
import { Value } from '../value.mts';
import { surroundingAgent } from '../execution-context/Agent.mts';
import { CallableGroupHostFor } from './component-patterns.mts';
import { MatchSpecializationList } from './specialization-patterns.mts';
import { IsSubtype } from './relations.mts';
import { operatorTableKey } from './overloads.mts';
import { makePrimitive, substituteTypeParameters, type TypeRecord } from './records.mts';

export function IsPartialDeclaration(node: unknown): boolean {
  const declaration = node as { Partial?: boolean, ClassModifiers?: readonly string[] } | undefined;
  return !!declaration?.Partial || !!declaration?.ClassModifiers?.includes('partial');
}

export interface PartialStructureContribution {
  readonly Declaration: ParseNode.ClassDeclaration | ParseNode.InterfaceDeclaration;
  readonly Structure: () => TypeRecord | null;
  readonly Resolve: (node: ParseNode) => TypeRecord | null;
  readonly Operator?: (key: string) => TypeRecord | null;
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
    const added = template && substituteTypeParameters(template, bindings);
    if (!added) continue;
    if (!structure) {
      structure = added;
      continue;
    }
    if (structure.Kind === 'function' && added.Kind === 'function') {
      structure = { Kind: 'function', Signatures: [...structure.Signatures, ...added.Signatures] };
    } else if (structure.Kind === 'object' && added.Kind === 'object') {
      const keys = new Set(structure.Properties.map((p) => p.key));
      for (const property of added.Properties) if (keys.has(property.key)) collision(String(property.key));
      structure = { Kind: 'object', Properties: [...structure.Properties, ...added.Properties],
        IndexSignatures: [...structure.IndexSignatures, ...added.IndexSignatures] };
    } else collision('call signatures and named members');
  }
  return { ...type, PartialBaseStructure: base, Structure: structure ?? undefined } as TypeRecord;
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
