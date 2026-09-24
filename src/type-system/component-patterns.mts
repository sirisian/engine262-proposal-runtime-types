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
import { builtinTypeRecord, makePrimitive, type TypeRecord } from './records.mts';
import { SameType } from './relations.mts';
import {
  MatchSpecializationList, MatchSpecializationPattern, PrimitiveDeclaresParameters, PrimitiveParameterKinds, PrimitiveParameterDefault,
  type PatternSlotParameter, type SpecializationMatchHost,
} from './specialization-patterns.mts';
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
  list: ParseNode.TypeParameters,
  bindings: ReadonlyMap<string, Argument>,
  right: TypeRecord,
  resolve: (node: ParseNode) => TypeRecord | null,
): boolean {
  try {
    return MatchSpecializationPattern(operand, list.Captures ?? [], right, componentHost(resolve), 'specialization', bindings) !== 'no-match';
  } catch {
    return false;
  }
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
          Parameters: PrimitiveParameterKinds(inner).map((_kind, i) => ({ Name: `#${i}`, Variadic: false, HasDefault: false })),
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
      return metadataAsObjectRecord(metaType === undefined ? subject.Metadata : MetadataPortion(subject.Metadata, metaType));
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
