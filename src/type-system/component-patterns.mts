/**
 * proposal-runtime-types #sec-primitive-operator-blocks: binding a primitive
 * block's COMPONENT list against a receiver.
 *
 * The component list of `primitive vector<float32.<const D: Dimensions>, const
 * N: uint32>` is a specialization list over `vector`'s own parameters, the
 * lane type and the lane count, so it is matched by the specialization matcher
 * (specialization-patterns.mts) rather than by rules of its own: the run time,
 * at each dispatch, and the checker, for a result's type, call this one
 * function with their own resolution of a written type, and neither keeps a
 * copy of what a pattern means.
 *
 * The positions a component list may hold (the parser enforces them): `_`, a
 * capture, a fixed type, and an application of a primitive declaring no
 * parameters with one metadata capture, `float32.<const D: Dimensions>`,
 * whose `.<...>` is a metadata position, so the capture binds the portion of
 * the lane's metadata its written meta type claims.
 */

import type { ParseNode } from '../parser/ParseNode.mts';
import { MetadataPortion, MetaTypeForConstraint } from '../abstract-ops/runtime-types.mts';
import { metadataAsObjectRecord } from '../runtime-semantics/ApplyStringOrNumericBinaryOperator.mts';
import { Value } from '../value.mts';
import { builtinTypeRecord, makePrimitive, type TypeRecord, type MetadataRecord } from './records.mts';
import { SameType } from './relations.mts';
import {
  MatchSpecializationList, MatchSpecializationPattern, PrimitiveDeclaresParameters, PrimitiveParameterKinds, PrimitiveParameterDefault,
  type PatternSlotParameter, type SpecializationMatchHost,
} from './specialization-patterns.mts';
import type { CallableGroupHost } from './specialization-selection.mts';
import { MetadataObjectFromType } from './runtime.mts';

type Argument = TypeRecord | number;

/**
 * The bindings of _list_'s captures for a receiver of the primitive _name_
 * whose arguments are _args_, or *null* where the list does not match it.
 * _resolve_ is the caller's resolution of a written type: the checker's, or
 * the run time's table resolved when the block was evaluated.
 */
export function MatchComponentList(
  list: ParseNode.TypeParameters,
  name: string,
  args: readonly Argument[],
  resolve: (node: ParseNode) => TypeRecord | null,
): Map<string, TypeRecord> | null {
  const raw = MatchComponentListRaw(list, name, args, resolve);
  if (!raw) {
    return null;
  }
  const bindings = new Map<string, TypeRecord>();
  for (const [capture, value] of raw) {
    // A value component, the lane count, binds as the literal a written value
    // argument resolves to, as a width does.
    bindings.set(capture, typeof value === 'number'
      ? { Kind: 'literal', Value: Value(value), Base: makePrimitive('number') } as unknown as TypeRecord
      : value);
  }
  return bindings;
}

/** MatchComponentList's bindings as the matcher produced them: a value component as its number. */
export function MatchComponentListRaw(
  list: ParseNode.TypeParameters,
  name: string,
  args: readonly Argument[],
  resolve: (node: ParseNode) => TypeRecord | null,
): Map<string, Argument> | null {
  const primary: PatternSlotParameter<Argument>[] = PrimitiveParameterKinds(name).map((_kind, i) => ({
    Name: `#${i}`, Variadic: false, HasDefault: false,
  }));
  let matched;
  try {
    matched = MatchSpecializationList(list, primary, args, componentHost(resolve));
  } catch {
    return null;
  }
  if (matched === 'no-match') {
    return null;
  }
  return new Map(matched.map((b) => [b.Capture.Name, b.Value]));
}

/**
 * Whether the operand annotation of a block definition, `vector.<float32.<D>,
 * N>`, admits _right_, with the block's component captures bound as
 * _bindings_: the annotation is matched as a pattern whose capture uses are
 * references, so a metadata capture compares metadata and a count compares
 * the count.
 */
export function ComponentOperandAdmits(
  operand: ParseNode,
  captures: readonly ParseNode.CaptureBinding[],
  bindings: ReadonlyMap<string, Argument>,
  right: TypeRecord,
  resolve: (node: ParseNode) => TypeRecord | null,
): boolean {
  return MatchComponentOperand(operand, captures, bindings, right, resolve) !== null;
}

/**
 * ComponentOperandAdmits with the bindings it produced: the seeded captures,
 * and any the operand binds on first use - an operator's own metadata
 * parameter, `Y` of `operator *.<Y: Dim>(rhs: float32.<Y>)`, binds the
 * right operand's portion for Y's meta type - or *null* where it does not
 * admit _right_.
 */
export function MatchComponentOperand(
  operand: ParseNode,
  captures: readonly (ParseNode.CaptureBinding | ParseNode.TypeParameter)[],
  bindings: ReadonlyMap<string, Argument>,
  right: TypeRecord,
  resolve: (node: ParseNode) => TypeRecord | null,
): Map<string, Argument> | null {
  let matched;
  try {
    matched = MatchSpecializationPattern(operand, captures as readonly ParseNode.CaptureBinding[], right, componentHost(resolve), 'specialization', bindings);
  } catch {
    return null;
  }
  if (matched === 'no-match') {
    return null;
  }
  const out = new Map(bindings);
  for (const b of matched) out.set(b.Capture.Name, b.Value);
  return out;
}

/**
 * The type a block definition's annotation denotes with the block's component
 * captures substituted: `vector.<float32.<D>, N>` with D the lanes' metadata
 * and N the count. The checker's own resolution keeps a capture as a
 * constrained parameter, which drops a metadata argument (`float32.<D>` reads
 * as `float32`) and leaves a count opaque, so the annotation is instantiated
 * here from the bindings; anything else is left to _resolve_.
 */
export function InstantiateComponentType(
  node: ParseNode,
  bindings: ReadonlyMap<string, Argument>,
  resolve: (node: ParseNode) => TypeRecord | null,
): Argument | null {
  if (node.type === 'TypeReference' && node.TypeName.MemberNames.length === 0) {
    const name = node.TypeName.IdentifierReference.name;
    if (!node.TypeArguments && bindings.has(name)) {
      return bindings.get(name)!;
    }
    if (node.TypeArguments) {
      const args = (node.TypeArguments.TypeArgumentList as unknown as ParseNode[]).map((a) => InstantiateComponentType(a, bindings, resolve));
      if (args.every((a) => a !== null)) {
        if (PrimitiveDeclaresParameters(name)) {
          return builtinTypeRecord(name, args as (TypeRecord | number)[]) ?? resolve(node);
        }
        const base = builtinTypeRecord(name, []);
        const metadata = args[0];
        if (base && args.length === 1 && typeof metadata === 'object' && metadata.Kind === 'object') {
          return { Kind: 'parameterized', Base: base, Metadata: MetadataObjectFromType(metadata) } as unknown as TypeRecord;
        }
      }
    }
  }
  return resolve(node);
}

/** The part of _metadata_ whose keys _shape_, an object type, declares; all of it where the shape is not an object type. */
function PortionByShape(metadata: MetadataRecord, shape: TypeRecord | null): MetadataRecord {
  const properties = (shape as { Kind?: string, Properties?: readonly { key?: unknown }[] } | null)?.Properties;
  if (!shape || shape.Kind !== 'object' || !properties) {
    return metadata;
  }
  const keys = new Set(properties.map((p) => (typeof p.key === 'string' ? p.key : (p.key as { stringValue?: () => string })?.stringValue?.())));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(metadata as Record<string, unknown>)) {
    if (keys.has(k)) out[k] = v;
  }
  return out as MetadataRecord;
}

/**
 * The bindings of a primitive block's METADATA captures, `X` of `primitive
 * float32<const X: D>`, for a receiver of type _receiver_: each the portion of
 * the receiver's metadata its written meta type claims, as dispatch binds it;
 * *null* where the receiver carries no metadata.
 */
export function BindMetadataCaptures(
  captures: readonly ParseNode.CaptureBinding[],
  receiver: TypeRecord,
  resolve: (node: ParseNode) => TypeRecord | null,
): Map<string, Argument> | null {
  if (receiver.Kind !== 'parameterized') {
    return null;
  }
  const host = componentHost(resolve);
  const out = new Map<string, Argument>();
  for (const c of captures) {
    if (!c.TypeParameterDomain) continue;
    const value = host.metadataOf(receiver, c.TypeParameterDomain);
    if (value === null) return null;
    out.set(c.BindingIdentifier.name, value);
  }
  return out;
}

/**
 * A primitive's own parameters as pattern slots. A VALUE slot - a width of
 * `int`, `uint`, or `rational`, or `vector`'s lane count - has the domain
 * `uint32`: the spec states each as a positive integer, its range (1 to 2**16
 * for a width) being a bound apart from its type, as a const generic's type is
 * one integer type in Rust. D9 compares a written capture domain against it.
 */
export function PrimitiveSlotParameters(name: string): PatternSlotParameter<Argument>[] {
  // The spec's own parameter names: `vector.<T, N>`, `int.<N>`, `complex.<E>`.
  const names = name === 'vector' ? ['T', 'N'] : name === 'complex' ? ['E'] : ['N'];
  return PrimitiveParameterKinds(name).map((kind, i) => ({
    Name: names[i] ?? `#${i}`, Variadic: false, HasDefault: false,
    ...(kind === 'value' ? { Domain: builtinTypeRecord('uint32', []) as TypeRecord } : {}),
  }));
}

function componentHost(resolve: (node: ParseNode) => TypeRecord | null): SpecializationMatchHost<Argument> {
  const same = (a: Argument, b: Argument) => (typeof a === 'number' || typeof b === 'number' ? a === b : SameType(a, b));
  return {
    resolveFixed: (node) => {
      const record = resolve(node);
      if (!record) {
        throw new Error('a component pattern names a type that is not resolved');
      }
      return record;
    },
    sameArgument: same,
    structuralMatch: same,
    // A primitive that declares no parameters takes its `.<...>` as METADATA:
    // one metadata parameter, whose argument is the parameterized type itself.
    constructorOf: (typeName) => {
      const inner = typeName.IdentifierReference.name;
      if (typeName.MemberNames.length !== 0) {
        return null;
      }
      // A primitive that declares parameters - `vector` - exposes them.
      if (PrimitiveDeclaresParameters(inner)) {
        return {
          Name: inner,
          Parameters: PrimitiveSlotParameters(inner),
          argumentsOf: (subject) => (typeof subject === 'object' && subject.Kind === 'primitive' && subject.Name === inner ? subject.Arguments ?? [] : null),
          defaultOf: (q) => PrimitiveParameterDefault(inner, q),
        };
      }
      const base = builtinTypeRecord(inner, []);
      if (!base) {
        return null;
      }
      return {
        Name: inner,
        Parameters: [{ Name: 'metadata', Variadic: false, HasDefault: false, Metadata: true }],
        argumentsOf: (subject) => (typeof subject === 'object' && subject.Kind === 'parameterized' && SameType(subject.Base, base) ? [subject] : null),
        defaultOf: () => undefined,
      };
    },
    arrayOf: () => null,
    sequenceOf: () => null,
    makeSequence: () => {
      throw new Error('a component pattern has no sequence');
    },
    metadataOf: (subject, meta) => {
      if (typeof subject !== 'object' || subject.Kind !== 'parameterized') {
        return null;
      }
      const domain = resolve(meta as unknown as ParseNode);
      const metaType = domain ? MetaTypeForConstraint(domain) : undefined;
      // Before the meta type is registered - statically, where the checker
      // resolves a result's type ahead of evaluation - the capture binds the
      // lane's whole metadata, which is its meta type's portion wherever one
      // meta type governs the lane (as the scalar result's checking assumes).
      if (metaType !== undefined) {
        return metadataAsObjectRecord(MetadataPortion(subject.Metadata, metaType));
      }
      // Before the meta type is registered - statically - its portion is the
      // metadata's keys that its written shape declares: a portion by the
      // domain's own properties, as the run time's portion is by the keys the
      // meta type claims.
      return metadataAsObjectRecord(PortionByShape(subject.Metadata, domain));
    },
    evaluate: () => {
      throw new Error('a component pattern has no forward computation');
    },
    satisfiesBound: () => true,
  };
}

/** The type nodes of a component list the matcher may resolve: its fixed entries and its captures' domains. */
export function ComponentListTypeNodes(list: ParseNode.TypeParameters): ParseNode[] {
  const nodes: ParseNode[] = [];
  for (const entry of list.SpecializationEntryList ?? []) {
    const pattern = entry.Pattern as unknown as ParseNode;
    const captures = (list.Captures ?? []).filter((c) => contains(pattern, c));
    if (captures.length === 0 && !(pattern.type === 'TypeReference' && pattern.TypeName.IdentifierReference.name === '_')) {
      nodes.push(pattern);
    }
  }
  for (const c of list.Captures ?? []) {
    if (c.TypeParameterDomain) {
      nodes.push(c.TypeParameterDomain as unknown as ParseNode);
    }
  }
  return nodes;
}

function contains(root: unknown, target: object): boolean {
  if (root === target) {
    return true;
  }
  if (!root || typeof root !== 'object') {
    return false;
  }
  if (Array.isArray(root)) {
    return root.some((r) => contains(r, target));
  }
  return Object.entries(root).some(([k, v]) => k !== 'parent' && k !== 'location' && contains(v, target));
}

/**
 * The maximal subtrees of the type node _node_ that name none of _names_ - the
 * fixed parts of an operand annotation, which the run time resolves once so the
 * synchronous matcher can read them.
 */
export function FixedTypeSubtrees(node: ParseNode, names: ReadonlySet<string>): ParseNode[] {
  const mentions = (n: unknown): boolean => {
    if (!n || typeof n !== 'object') return false;
    if (Array.isArray(n)) return n.some(mentions);
    const v = n as { type?: string, name?: string };
    if (v.type === 'IdentifierReference' && typeof v.name === 'string' && names.has(v.name)) return true;
    return Object.entries(v).some(([k, x]) => k !== 'parent' && k !== 'location' && mentions(x));
  };
  const out: ParseNode[] = [];
  const visit = (n: ParseNode): void => {
    if (!mentions(n)) {
      out.push(n);
      return;
    }
    if (n.type === 'TypeReference' && n.TypeArguments) {
      (n.TypeArguments.TypeArgumentList as unknown as ParseNode[]).forEach(visit);
    }
  };
  visit(node);
  return out;
}

/**
 * Plan section 3.8: the host the checker's callable group analysis
 * (`AnalyzeCallableGroup`) runs over. It matches and orders patterns as the
 * component host does, and judges whether an owner's slot admits a case's
 * entry: a type slot admits a type (within its `extends` bound), and a value
 * slot a literal of its domain.
 */
export function CallableGroupHostFor(
  resolve: (node: ParseNode) => TypeRecord | null,
  isSubtype: (sub: TypeRecord, sup: TypeRecord) => boolean,
): CallableGroupHost<Argument> {
  const base = componentHost(resolve);
  const slotOf = (parameter: unknown) => parameter as { Kind?: 'type' | 'value', Binder?: ParseNode.TypeParameter };
  return {
    ...base,
    boundIncludes: (wide, narrow) => {
      const w = resolve(wide as unknown as ParseNode);
      const n = resolve(narrow as unknown as ParseNode);
      return !!w && !!n && isSubtype(n, w);
    },
    admits: (entry, parameter) => {
      const slot = slotOf(parameter);
      const resolved = resolve(entry);
      if (!resolved) {
        return false;
      }
      if (slot.Kind === 'value') {
        const domain = slot.Binder?.TypeParameterDomain ?? slot.Binder?.TypeParameterConstraint;
        const domainRecord = domain ? resolve(domain as unknown as ParseNode) : null;
        return resolved.Kind === 'literal' && (!domainRecord || isSubtype(resolved, domainRecord));
      }
      const bound = slot.Binder?.TypeParameterConstraint;
      if (bound && slot.Binder?.TypeParameterDomain) {
        const boundRecord = resolve(bound as unknown as ParseNode);
        return !boundRecord || isSubtype(resolved, boundRecord);
      }
      return true;
    },
    admitsStructure: (_entry, parameter) => slotOf(parameter).Kind !== 'value',
  };
}
