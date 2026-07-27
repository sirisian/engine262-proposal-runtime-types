import { NumberValue, ObjectValue, Value } from '../value.mts';
import { EnsureCompletion, Q, X } from '../completion.mts';
import { StringValue } from '../static-semantics/all.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { Evaluate, type PlainEvaluator, type ValueEvaluator } from '../evaluator.mts';
import { GetValue } from '../abstract-ops/all.mts';
import { GetTypeObject, isTypeObject } from '../type-system/intern.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { OriginOfNode, RecordTypeOrigin } from '../type-system/provenance.mts';
import { InstantiateGenericAlias, IsOfType, TypeNodeToTypeRecord } from '../type-system/runtime.mts';
import { builtinTypeRecord, propertyKeyValue } from '../type-system/records.mts';
import { ConvertValue } from '../abstract-ops/runtime-types.mts';
import { ApplyDecorators } from './ClassDefinitionEvaluation.mts';
import { InitializeBoundName } from './BindingInitialization.mts';
import { OrdinaryObjectCreate, CreateDataProperty } from '#self';
import { ClaimMetaKey, CreateDataPropertyOrThrow, MetadataAsObject, OrdinaryFunctionCreate, R, RegisterMetaDefaultSnapshot, RegisterMetaHook, RegisterMetaTypeName, RegisterTypeDefault, ResolveBinding, SnapshotMetadataValue, Throw, surroundingAgent } from '#self';

/**
 * proposal-runtime-types
 * Placeholder evaluation for the declarations introduced by the proposal: the
 * declared name is bound and initialized, and the declaration otherwise
 * evaluates to an empty completion. The type registry semantics that give the
 * bindings their values arrive with a later milestone.
 */
/**
 * proposal-runtime-types #sec-type-errors: the checking pass processes a source
 * text's type declarations before its body evaluates, which is what makes a
 * declaration visible to the judgments of the same source. A node the pass
 * evaluated is marked here, and its body-position evaluation becomes a no-op,
 * so registration and binding initialization happen exactly once.
 */
export const preEvaluatedTypeDeclarations = new WeakSet<ParseNode>();

export function* Evaluate_RuntimeTypesBindingDeclaration(node: ParseNode.TypeAliasDeclaration | ParseNode.InterfaceDeclaration | ParseNode.EnumDeclaration): PlainEvaluator {
  if (preEvaluatedTypeDeclarations.has(node)) {
    return undefined;
  }
  const name = StringValue(node.BindingIdentifier);
  const env = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  let value: Value = Value.undefined;
  if (node.type === 'TypeAliasDeclaration') {
    if (node.TypeParameters) {
      // A generic alias binds uninstantiated; instantiation substitutes the
      // parameters and interns the result.
      value = GetTypeObject({ Kind: 'nominal', Declaration: node, Arguments: [] });
    } else {
      // #sec-gettypeobject: the alias binds the interned Type Object of its Type.
      const record = Q(yield* TypeNodeToTypeRecord(node.Type));
      if (node.WhereClauses && node.WhereClauses.length > 0) {
        // proposal-runtime-types (dependentrecordtypes.md): a `where` clause
        // makes this a dependent record type. Its identity is the declaration's
        // (two textually identical `where` blocks are two types), so it binds as
        // a nominal type whose structure is the base record; the predicates ride
        // on the declaration and are checked at every boundary by IsOfType.
        value = GetTypeObject({
          Kind: 'nominal', Declaration: node, Arguments: [], Structure: record,
        });
      } else {
        value = GetTypeObject(record);
      }
    }
  } else if (node.type === 'EnumDeclaration') {
    // Enum members take their initializer's value, or the previous numeric
    // value plus one, starting from 0. The members are data properties of the
    // enum's Type Object, and membership is SameValue against the list.
    const memberValues: Value[] = [];
    const memberNames: string[] = [];
    let nextAuto = 0;
    for (const member of node.EnumMemberList) {
      let v: Value;
      if (member.Initializer) {
        const ref = Q(yield* Evaluate(member.Initializer));
        v = Q(yield* GetValue(ref));
      } else {
        v = Value(nextAuto);
      }
      if (v instanceof NumberValue) {
        nextAuto = (R(v) as number) + 1;
      } else {
        nextAuto += 1;
      }
      memberValues.push(v);
      memberNames.push(member.IdentifierName.name);
    }
    const underlying = node.TypeAnnotation
      ? Q(yield* TypeNodeToTypeRecord(node.TypeAnnotation.Type))
      : builtinTypeRecord('number') ?? undefined;
    const record: TypeRecord = {
      Kind: 'nominal', Declaration: node, Arguments: [], EnumMembers: memberValues, Underlying: underlying ?? undefined,
    };
    const obj = GetTypeObject(record);
    for (let i = 0; i < memberNames.length; i += 1) {
      X(CreateDataPropertyOrThrow(obj, Value(memberNames[i]), memberValues[i]));
      // The design's index operator: `Count[0]` is `Count.Zero` beside
      // `Count['Zero']`. By POSITION rather than by underlying value - the
      // design's own example cannot tell the two apart, since its enumerators
      // are numbered from 0, but an index operator beside a name lookup is
      // indexing the ENUMERATION, and position is what `keys()`, `values()`,
      // and `entries()` are ordered by. A lookup by VALUE already exists and
      // is spelled `Count(n)`, the reverse conversion.
      X(CreateDataPropertyOrThrow(obj, Value(String(i)), memberValues[i]));
    }
    value = obj;
  } else if (node.type === 'InterfaceDeclaration') {
    // The interface's structural shape: annotated members check their type,
    // method signatures check callability, and a member whose type cannot be
    // resolved checks presence only. Operators and index signatures join with
    // a later milestone.
    // The interface's structure is a real ~object~ record now; membership
    // rides the structural IsOfType case, while identity stays nominal.
    const Properties: { key: string, type: TypeRecord, optional: boolean, readonly: boolean }[] = [];
    for (const member of node.InterfaceMemberList) {
      if (member.type !== 'TypeMember') {
        continue;
      }
      const m = member as unknown as { PropertyName?: { name?: string, value?: string }, Readonly?: boolean, Optional?: boolean, TypeAnnotation?: ParseNode.TypeAnnotation | null, MethodSignature?: unknown };
      const key = m.PropertyName?.name ?? m.PropertyName?.value;
      if (typeof key !== 'string') {
        continue;
      }
      let resolved: TypeRecord = { Kind: 'any' };
      if (m.TypeAnnotation) {
        const attempt = EnsureCompletion(yield* TypeNodeToTypeRecord(m.TypeAnnotation.Type));
        if (attempt.Type === 'normal') {
          resolved = attempt.Value as TypeRecord;
        }
      } else if (m.MethodSignature) {
        resolved = { Kind: 'function', Signatures: [] };
      }
      Properties.push({ key, type: resolved, optional: !!m.Optional, readonly: !!m.Readonly });
    }
    const record: TypeRecord = {
      Kind: 'nominal',
      Declaration: node,
      Arguments: [],
      Structure: { Kind: 'object', Properties, IndexSignatures: [] },
    };
    value = GetTypeObject(record);
  }
  // #sec-provenance: record the declaration site this type came from. Interning
  // has already merged structurally identical shapes, so recording here IS the
  // union the clause specifies: `type A = { x: number }` and `type B = { x:
  // number }` reach one Type Object and both sites land on it. Nothing about the
  // type's identity reads this, and no program can: it is the host's channel.
  if (value !== Value.undefined) {
    RecordTypeOrigin(value as object, OriginOfNode(node, node.type, name.stringValue()));
  }
  Q(yield* InitializeBoundName(name, value, env));
  // proposal-runtime-types decorators.md: `@f enum Count { @f Zero, ... }`.
  // decorators.md "Order" puts members before their container, so the
  // ENUMERATORS run first and the enum's own decorators last - the same rule a
  // class and its fields follow, applied to a third container kind.
  if (surroundingAgent.feature('runtime-types') && node.type === 'EnumDeclaration') {
    for (const member of node.EnumMemberList ?? []) {
      const decorators = (member as { Decorators?: readonly ParseNode.Decorator[] | null }).Decorators;
      if (!decorators?.length) {
        continue;
      }
      const memberName = (member as { IdentifierName?: { name?: string } }).IdentifierName?.name;
      Q(yield* ApplyDecorators(decorators, Q(yield* EnumDecoratorContext(
        'EnumEnumerator', typeof memberName === 'string' ? Value(memberName) : Value.undefined, value,
      ))));
    }
    const own = (node as { Decorators?: readonly ParseNode.Decorator[] | null }).Decorators;
    if (own?.length) {
      Q(yield* ApplyDecorators(own, Q(yield* EnumDecoratorContext('Enum', name, value))));
    }
  }

  return undefined;
}

/**
 * proposal-runtime-types
 * Evaluation of the expression forms: `is` is the IsOfType membership test,
 * `:=` applies the conversion rule, and `type` produces the interned Type
 * Object.
 */
export function* Evaluate_IsExpression({ Expression, Type }: ParseNode.IsExpression): ValueEvaluator {
  const ref = Q(yield* Evaluate(Expression));
  const value = Q(yield* GetValue(ref));
  const record = Q(yield* TypeNodeToTypeRecord(Type));
  const result = Q(yield* IsOfType(value, record));
  return result ? Value.true : Value.false;
}

export function* Evaluate_TypedConversionExpression({ Expression, Type }: ParseNode.TypedConversionExpression): ValueEvaluator {
  const ref = Q(yield* Evaluate(Expression));
  const value = Q(yield* GetValue(ref));
  const record = Q(yield* TypeNodeToTypeRecord(Type));
  return Q(yield* ConvertValue(value, record));
}

export function* Evaluate_TypeOperatorExpression({ Type }: ParseNode.TypeOperatorExpression): ValueEvaluator {
  const record = Q(yield* TypeNodeToTypeRecord(Type));
  return GetTypeObject(record);
}
/**
 * proposal-runtime-types #sec-meta-hooks: evaluate the `default` hook and
 * register it against the named type's interned Type Object.
 */
export function* Evaluate_MetaDeclaration(node: ParseNode.MetaDeclaration): PlainEvaluator {
  if (preEvaluatedTypeDeclarations.has(node)) {
    return undefined;
  }
  if (node.TypeName.MemberNames.length > 0) {
    return undefined;
  }
  const name = node.TypeName.IdentifierReference.name;
  const record = builtinTypeRecord(name);
  let typeObject: Value | null = record ? GetTypeObject(record) : null;
  if (!typeObject) {
    const ref = Q(yield* ResolveBinding(Value(name)));
    const candidate = Q(yield* GetValue(ref));
    typeObject = isTypeObject(candidate) ? candidate : null;
  }
  if (!typeObject) {
    return undefined;
  }
  // #sec-primitive-metadata: a meta type claims the property keys of its
  // constraint shape, and it is an error at the SECOND declaration for two meta
  // types to claim one key. The claim is what lets a metadata value select the
  // meta type that governs it, which is how `meta Dimensions` reaches a
  // `float32.<{ m, s }>` it never names.
  const shape = record ?? (isTypeObject(typeObject) ? (typeObject as { TypeRecord?: TypeRecord }).TypeRecord : undefined);
  if (shape && shape.Kind === 'object') {
    for (const property of shape.Properties) {
      const conflict = ClaimMetaKey(property.key, typeObject as object);
      if (conflict !== undefined) {
        return Throw.TypeError('$1 is already claimed by another meta type', propertyKeyValue(property.key));
      }
    }
  }
  let sawDefault = false;
  let sawSubtype = false;
  for (const hook of node.MetaHookList) {
    if (hook.type === 'MetaDefaultHook') {
      const ref = Q(yield* Evaluate(hook.AssignmentExpression));
      const v = Q(yield* GetValue(ref));
      RegisterTypeDefault(typeObject, v);
      // sec-metadataportion copies the default, so where the constraint shape
      // is an OBJECT type the default must be an object, and it is snapshotted
      // here, once, into the host metadata-record shape: a getter on it runs
      // at declaration and never again, and MetadataPortion starts from the
      // snapshot (the plan's Phase 1). A declaration over a non-object shape,
      // the suite's `meta uint8 { default = 0 }`, keeps its scalar default for
      // the annotated-binding path and registers no snapshot: it claims no
      // keys, so no portion of it exists to complete. The full C5 rule, that
      // the default is a VALUE OF the constraint shape, waits on the plan's
      // P1f verdict about optional-key membership.
      if (shape && shape.Kind === 'object') {
        if (!(v instanceof ObjectValue)) {
          return Throw.TypeError('a meta type whose constraint shape is an object type requires an object default');
        }
        // The full C5 rule (the plan's relocated edit 5): `default: T` means
        // the default is a VALUE OF the constraint shape, checked by ordinary
        // membership so the optional-key form (NumberBounds' `default = {}`)
        // survives, per P1f. The membership is judged over the SNAPSHOT, not
        // the live object: the snapshot is what every portion is built from,
        // so it is the artifact the rule protects, and judging it keeps a
        // getter on the default to exactly ONE read, at declaration - the
        // matrix's P1c caught the live-object check reading it a second time,
        // which the pre-Phase-4 probes structurally could not see (F46).
        const snapshot = Q(yield* SnapshotMetadataValue(v));
        if (!Q(yield* IsOfType(MetadataAsObject(snapshot), shape))) {
          return Throw.TypeError('the default of a meta type must be a value of its constraint shape');
        }
        RegisterMetaDefaultSnapshot(typeObject, snapshot);
      }
      sawDefault = true;
    } else {
      const hookName = (hook as { ClassElementName?: { name?: string } }).ClassElementName?.name;
      const body = (hook as { FunctionBody?: ParseNode.FunctionBody | null }).FunctionBody;
      const params = (hook as { UniqueFormalParameters?: ParseNode.FormalParameters }).UniqueFormalParameters;
      if (hookName === 'subtype') {
        sawSubtype = true;
      }
      if (typeof hookName === 'string' && body && params) {
        const env = surroundingAgent.runningExecutionContext.LexicalEnvironment;
        const privEnv = surroundingAgent.runningExecutionContext.PrivateEnvironment;
        const fn = OrdinaryFunctionCreate(surroundingAgent.intrinsic('%Function.prototype%'), 'meta hook', params, body, 'non-lexical-this', env, privEnv);
        RegisterMetaHook(typeObject, hookName, fn);
        RegisterMetaTypeName(typeObject as object, name);
      }
    }
  }
  // #sec-primitive-metadata: "it is an early error ... a missing `default` or
  // `subtype`". Both are required, and `subtype` is required for a reason the
  // brand makes plain: it is the meta type's half of the metadata subtype
  // judgment, so a meta type without one states no relation between two of its
  // parameterizations at all, and the crossing between them has nothing to
  // consult. `validate` stays optional, because a meta type that defines none
  // deliberately admits no bare value, which is what a brand is.
  if (!sawDefault) {
    return Throw.TypeError('$1 is not supported yet', Value(`a meta declaration for ${name} without a default hook`));
  }
  if (!sawSubtype) {
    return Throw.TypeError('a meta declaration requires a $1 hook', Value('subtype'));
  }
  return undefined;
}

/**
 * proposal-runtime-types M17: MemberExpression/CallExpression TypeArguments.
 * A generic alias Type Object specializes; any other base keeps its Reference
 * so member calls retain their this binding.
 */
export function* Evaluate_TypeArgumentsExpression(node: ParseNode.TypeArgumentsExpression): PlainEvaluator<unknown> {
  const ref = yield* Evaluate(node.Expression);
  const inspected = EnsureCompletion(ref);
  if (inspected.Type !== 'normal') {
    return ref;
  }
  const peeked = EnsureCompletion(yield* GetValue(inspected.Value as never));
  if (peeked.Type !== 'normal') {
    return ref;
  }
  const value = peeked.Value;
  if (isTypeObject(value)) {
    const record = value.TypeRecord;
    if (record.Kind === 'nominal' && record.Declaration.type === 'TypeAliasDeclaration' && (record.Declaration as ParseNode.TypeAliasDeclaration).TypeParameters) {
      const argRecords: TypeRecord[] = [];
      for (const argNode of node.TypeArguments.TypeArgumentList) {
        argRecords.push(Q(yield* TypeNodeToTypeRecord(argNode)));
      }
      const instantiated = Q(yield* InstantiateGenericAlias(record.Declaration as ParseNode.TypeAliasDeclaration, argRecords));
      return GetTypeObject(instantiated);
    }
  }
  return ref;
}

/** decorators.md's `EnumReflection` and `EnumEnumeratorReflection`. */
export function* EnumDecoratorContext(kind: string, name: Value, target: Value): ValueEvaluator {
  const realm = surroundingAgent.currentRealmRecord;
  const context = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
  X(CreateDataProperty(context, Value('kind'), Value(kind)));
  X(CreateDataProperty(context, Value('name'), name));
  X(CreateDataProperty(context, Value('type'), target));
  return context;
}
