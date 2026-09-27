import { Value } from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { TypeRecord } from './records.mts';
import { CanonicalWidthArgument, libraryTypeRecord, substituteTypeParameters } from './records.mts';

/** A constraint, never a storage type. Holes are private, alpha-normal names. */
export interface FamilyPatternRecord {
  readonly Kind: 'family-pattern';
  readonly Template: TypeRecord;
  readonly Wildcards: readonly string[];
}

export class FamilyPatternError extends Error {}

let resolvingPattern = 0;
export function inFamilyPattern(): boolean {
  return resolvingPattern > 0;
}
export function enterFamilyPattern(): void {
  resolvingPattern += 1;
}
export function leaveFamilyPattern(): void {
  resolvingPattern -= 1;
}

/** Retain the declaration expression until the candidate binds its operands. */
export function deferredFamilyDefault(node: ParseNode.Type, lookup: (name: string) => TypeRecord | null): TypeRecord | undefined {
  if (!resolvingPattern) return undefined;
  const bindings = new Map<string, TypeRecord>();
  walk(node, (part) => {
    const name = part.type === 'IdentifierReference' ? part.name : undefined;
    if (name) {
      const record = lookup(name);
      if (record) bindings.set(name, record);
    }
  });
  return { Kind: 'deferred', Operator: node, Operands: [...bindings.values()],
    DefaultNode: node, OperandNames: [...bindings.keys()] };
}

/** Defer the whole written default so nested computations also evaluate forward. */
export function deferredDeclarationDefault(node: ParseNode.Type, lookup: (name: string) => TypeRecord | null): TypeRecord | undefined {
  if (!resolvingPattern || node.parent?.type !== 'TypeParameter' || node.parent.TypeParameterDefault !== node) return undefined;
  let computed = false;
  walk(node, (part) => {
    if (part.type === 'ComputedType') computed = true;
  });
  return computed ? deferredFamilyDefault(node, lookup) : undefined;
}

function bareName(node: ParseNode): string | undefined {
  return node.type === 'TypeReference' && !node.TypeArguments && node.TypeName.MemberNames.length === 0
    ? node.TypeName.IdentifierReference.name : undefined;
}

/** Only a constraint gives an argument underscore its pattern meaning. */
export function inConstraint(node: ParseNode): boolean {
  let child = node;
  const seen = new Set<ParseNode>();
  for (let parent = node.parent; parent && !seen.has(parent); parent = parent.parent) {
    seen.add(parent);
    if (parent.type === 'TypeParameter') return parent.TypeParameterConstraint === child;
    child = parent;
  }
  return false;
}

function walk(node: unknown, visit: (node: ParseNode) => void, seen = new Set<object>()): void {
  if (!node || typeof node !== 'object' || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    node.forEach((n) => walk(n, visit, seen));
    return;
  }
  if (typeof (node as { type?: unknown }).type !== 'string') return;
  visit(node as ParseNode);
  for (const [key, value] of Object.entries(node)) {
    if (!['parent', 'location', 'sourceText'].includes(key)) walk(value, visit, seen);
  }
}

/** Replace holes with private parameters, then use ordinary application binding. */
export function prepareFamilyPattern(node: ParseNode.Type, declaration: (name: string) => ParseNode | undefined):
  { readonly Node: ParseNode.Type, readonly Wildcards: readonly string[] } | undefined {
  if (!inConstraint(node)) return undefined;
  let hasHole = false;
  walk(node, (n) => {
    if (bareName(n) === '_') hasHole = true;
  });
  if (!hasHole) return undefined;
  const checked = new Set<ParseNode>();
  const checkHead = (n: ParseNode): void => {
    if (n.type === 'CaptureBinding') throw new FamilyPatternError('named captures in family bounds are not supported; use an anonymous _ argument');
    if ((n as { IsSpread?: boolean }).IsSpread) throw new FamilyPatternError('wildcard packs in family bounds are not supported');
    if (n.type !== 'TypeReference' || !n.TypeArguments || n.TypeName.MemberNames.length > 0) return;
    const decl = declaration(n.TypeName.IdentifierReference.name);
    if (!decl || checked.has(decl)) return;
    checked.add(decl);
    const params = (decl as { TypeParameters?: ParseNode.TypeParameters | null }).TypeParameters?.TypeParameterList ?? [];
    if (params.some((p) => p.IsVariadic)) throw new FamilyPatternError('wildcard applications of variadic declarations are not supported');
    if (decl.type === 'InterfaceDeclaration') throw new FamilyPatternError('structural interface family patterns are not supported; use a concrete interface bound');
    if (decl.type === 'TypeAliasDeclaration') {
      const body = decl.Type;
      if (body.type !== 'TypeReference' || !body.TypeArguments) throw new FamilyPatternError('a family-pattern alias must forward to a nominal or intrinsic application');
      walk(body, (part) => {
        if (part.type === 'ComputedType') throw new FamilyPatternError('computed alias inversion in a family pattern is not supported');
        checkHead(part);
      });
    }
  };
  walk(node, checkHead);
  const Wildcards: string[] = [];
  const clone = (value: unknown): unknown => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(clone);
    const n = value as ParseNode;
    if (typeof n.type !== 'string') return value;
    if (n.type === 'TypeReference' && bareName(n) === '_') {
      if (n.parent?.type !== 'TypeArguments') throw new FamilyPatternError('a family wildcard must occupy one type argument position');
      const name = `#family${Wildcards.length}`;
      Wildcards.push(name);
      return { ...n, TypeName: { ...n.TypeName, IdentifierReference: { ...n.TypeName.IdentifierReference, name } } };
    }
    return Object.fromEntries(Object.entries(n).map(([key, child]) => [key,
      ['parent', 'location', 'sourceText'].includes(key) ? child : clone(child)]));
  };
  return { Node: clone(node) as ParseNode.Type, Wildcards };
}

export function finishFamilyPattern(Template: TypeRecord, Wildcards: readonly string[]): FamilyPatternRecord {
  if (Template.Kind !== 'primitive' && Template.Kind !== 'nominal') {
    throw new FamilyPatternError('a family pattern requires a nominal or intrinsic application head');
  }
  if (Template.Kind === 'nominal' && Template.Declaration.type === 'InterfaceDeclaration') {
    throw new FamilyPatternError('structural interface family patterns are not supported; use a concrete interface bound');
  }
  return { Kind: 'family-pattern', Template, Wildcards };
}

type Argument = TypeRecord | number;
const asRecord = (a: Argument): TypeRecord => typeof a === 'number'
  ? { Kind: 'literal', Value: Value(a), Base: { Kind: 'primitive', Name: 'number', Arguments: [] } } : a;
const fromRecord = (a: TypeRecord): Argument => CanonicalWidthArgument(a);

/** No value conversion or structural existential search occurs here. */
export function matchesFamilyPattern(candidate: TypeRecord, pattern: FamilyPatternRecord,
  same: (a: TypeRecord, b: TypeRecord) => boolean,
  evaluateDefault?: (record: Extract<TypeRecord, { Kind: 'deferred' }>) => TypeRecord | undefined): boolean {
  if (candidate.Kind === 'parameterized' || candidate.Kind === 'literal') return matchesFamilyPattern(candidate.Base, pattern, same, evaluateDefault);
  if (candidate.Kind === 'parameter') return !!candidate.Constraint && matchesFamilyPattern(candidate.Constraint, pattern, same, evaluateDefault);
  if (candidate.Kind === 'union') return candidate.Members.every((m) => matchesFamilyPattern(m, pattern, same, evaluateDefault));
  // Matching an open source template proves inclusion. Source holes remain
  // opaque, so a fixed target cannot accidentally accept an unrestricted slot.
  const source = candidate.Kind === 'family-pattern' ? candidate.Template : candidate;
  const holes = new Set(pattern.Wildcards);
  const env = new Map<string, TypeRecord>();
  const delayed: [Argument, Argument][] = [];
  const equal = (a: Argument, b: Argument): boolean => {
    a = typeof a === 'number' ? a : CanonicalWidthArgument(a);
    b = typeof b === 'number' ? b : CanonicalWidthArgument(b);
    return typeof a === 'number' || typeof b === 'number' ? a === b : same(a, b);
  };
  const match = (subject: Argument, wanted: Argument): boolean => {
    if (typeof wanted !== 'number' && wanted.Kind === 'parameter' && holes.has(wanted.Name)) {
      const before = env.get(wanted.Name);
      if (before) return equal(subject, fromRecord(before));
      env.set(wanted.Name, asRecord(subject));
      return true;
    }
    if (typeof wanted !== 'number' && typeof subject !== 'number'
        && (wanted.Kind === 'primitive' || wanted.Kind === 'nominal') && wanted.Kind === subject.Kind) {
      const correctHead = wanted.Kind === 'primitive' ? subject.Kind === 'primitive' && wanted.Name === subject.Name
        : subject.Kind === 'nominal' && (wanted.LibraryName ? wanted.LibraryName === subject.LibraryName : wanted.Declaration === subject.Declaration);
      if (!correctHead || wanted.Arguments.length !== subject.Arguments.length) return false;
      return wanted.Arguments.every((argument, i) => match(subject.Arguments[i], argument));
    }
    delayed.push([subject, wanted]);
    return true;
  };
  const witnesses: TypeRecord[] = [source];
  const seen = new Set<TypeRecord>();
  while (witnesses.length) {
    const witness = witnesses.shift()!;
    if (seen.has(witness)) continue;
    seen.add(witness);
    env.clear(); delayed.length = 0;
    if (match(witness, pattern.Template) && delayed.every(([subject, wanted]) => {
      if (typeof wanted === 'number') return equal(subject, wanted);
      const substituted = substituteTypeParameters(wanted, env)!;
      if (substituted.Kind === 'deferred' && substituted.DefaultNode) {
        if (typeof subject !== 'number' && same(subject, substituted)) return true;
        // The checker defers an ordinary candidate to the runtime binder. An
        // inclusion proof never assumes the result of a user computation.
        if (!evaluateDefault) return candidate.Kind !== 'family-pattern';
        const evaluated = evaluateDefault(substituted);
        return !!evaluated && equal(subject, fromRecord(evaluated));
      }
      return equal(subject, fromRecord(substituted));
    })) return true;
    if (witness.Kind === 'nominal') {
      if (witness.Base) {
        const params = (witness.Declaration as { TypeParameters?: ParseNode.TypeParameters | null }).TypeParameters?.TypeParameterList ?? [];
        const bindings = new Map(params.filter((_, i) => witness.Arguments[i] !== undefined).map((p, i) => [p.BindingIdentifier.name, asRecord(witness.Arguments[i]) ]));
        witnesses.push(substituteTypeParameters(witness.Base, bindings)!);
      }
      if (witness.LibraryName && ['Range', 'RangeFrom', 'RangeTo', 'RangeFull'].includes(witness.LibraryName)) {
        witnesses.push(libraryTypeRecord('RangeBounds', witness.Arguments.slice(0, 1))!);
      }
    }
  }
  return false;
}


export function hasDeferredFamilyDefault(record: TypeRecord, seen = new Set<TypeRecord>()): boolean {
  if (seen.has(record)) return false;
  seen.add(record);
  if (record.Kind === 'deferred') return !!record.DefaultNode;
  if (record.Kind === 'family-pattern') return hasDeferredFamilyDefault(record.Template, seen);
  if (record.Kind === 'parameter') return !!record.Constraint && hasDeferredFamilyDefault(record.Constraint, seen);
  if (record.Kind === 'nominal' || record.Kind === 'primitive') return record.Arguments.some((a) => typeof a !== 'number' && hasDeferredFamilyDefault(a, seen));
  return false;
}
