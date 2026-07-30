import { NumberValue, ObjectValue, SymbolValue, Value } from '../value.mts';
import { StampReflectionContext } from '../type-system/reflection-contexts.mts';
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
import { JSStringValue as JSStringValueClass } from '../value.mts';
import { SameValue } from '../abstract-ops/all.mts';
 import { Evaluate_PropertyName } from './PropertyName.mts';
import { ApplyDecorators } from './ClassDefinitionEvaluation.mts';
import { InitializeBoundName } from './BindingInitialization.mts';
import { MetadataObjectFor } from './ClassDefinitionEvaluation.mts';
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
    const Properties: { key: string | SymbolValue, type: TypeRecord, optional: boolean, readonly: boolean, initial?: Value }[] = [];
    for (const member of node.InterfaceMemberList) {
      if (member.type !== 'TypeMember') {
        continue;
      }
      const m = member as unknown as { PropertyName?: ParseNode & { name?: string, value?: string }, Readonly?: boolean, Optional?: boolean, TypeAnnotation?: ParseNode.TypeAnnotation | null, MethodSignature?: unknown };
      // A SYMBOL-KEYED member is written `[k]: T`, a COMPUTED property name -
      // an index signature needs an identifier and a `:` inside the brackets,
      // so the two forms do not collide. Its key has to be EVALUATED, and this
      // walk had taken only a literal name and dropped everything else: a
      // Property Type Record's [[Key]] is "a property key", which is a String
      // or a Symbol, and the record has held both since it was widened - only
      // this walk never produced one.
      //
      // That is what blocked the metadata half of the decorators extension.
      // decorators.md adds metadata through `partial interface ClassMetadata {
      // [myMetadata]: string }`, and a symbol key is the collision escape hatch
      // the design gives third-party libraries; the member merged and then
      // vanished, so nothing was ever enforced against it.
      let key: string | SymbolValue | undefined = m.PropertyName?.name ?? m.PropertyName?.value;
      if (typeof key !== 'string' && m.PropertyName) {
        const evaluated = EnsureCompletion(yield* Evaluate_PropertyName(m.PropertyName as never));
        if (evaluated.Type !== 'normal') {
          return evaluated;
        }
        const evaluatedKey = evaluated.Value;
        key = evaluatedKey instanceof SymbolValue
          ? evaluatedKey
          : (evaluatedKey as { stringValue?: () => string }).stringValue?.();
      }
      if (key === undefined) {
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
      // The DECLARED DEFAULT travels with the member: a typed composite
      // creation fills it before freezing, so it is part of the contents that
      // intern.
      let initial;
      const memberInitializer = (m as { Initializer?: ParseNode | null }).Initializer;
      if (memberInitializer) {
        const attempt = EnsureCompletion(yield* Evaluate(memberInitializer));
        if (attempt.Type === 'normal') {
          initial = Q(yield* GetValue(attempt.Value as never));
        }
      }
      Properties.push({ key, type: resolved, optional: !!m.Optional, readonly: !!m.Readonly, initial });
    }
    // proposal-runtime-types decorators.md, #sec-metadata-objects: a `partial
    // interface` EXTENDS an interface someone else declared, and its members
    // join that interface's. It may contribute FIELDS where a partial class may
    // not, and the reason is the whole of why this is an interface: an
    // interface declares a SHAPE and adds no instance state, so nothing gains a
    // slot, no class's layout moves, and no sealed hierarchy is enlarged - the
    // three reasons the partial class clause gives for its own restriction.
    //
    // The shape stays complete at compile time, which is what an engine needs
    // to specialize access to it; what it does not do is put every declared key
    // on every object.
    if ((node as { Partial?: boolean }).Partial) {
      const existingRef = Q(yield* ResolveBinding(Value(name.stringValue())));
      const existing = Q(yield* GetValue(existingRef));
      if (!isTypeObject(existing)) {
        return Throw.TypeError('$1 is not an interface', name);
      }
      const priorRecord = existing.TypeRecord as TypeRecord & { Structure?: { Properties?: readonly { key: string | SymbolValue }[] } };
      const prior = priorRecord.Structure?.Properties ?? [];
      const seen = new Set(prior.map((pp) => pp.key));
      for (const added of Properties) {
        if (seen.has(added.key)) {
          // Two declarations of one member is a conflict rather than a merge:
          // silently taking the later would make the meaning of an interface
          // depend on load order.
          // A symbol key has no string spelling, so it is named by its
          // description in the message rather than rendered as one.
          return Throw.TypeError('$1 is already declared on this interface', typeof added.key === 'string'
            ? Value(added.key)
            : (added.key as SymbolValue));
        }
      }
      // The added members COMPLETE the existing record in place rather than
      // producing a new one to rebind.
      //
      // Type identity is by [[Declaration]], and a `partial interface` has a
      // declaration of its own - so a merged record built here would intern as
      // a SECOND type, and every type-position reference to the name would keep
      // resolving through the ORIGINAL declaration to the unmerged one. That is
      // cycle 104's lesson at a second site: rebinding the name is not the same
      // as changing the type, because a reference in type position reads the
      // declaration and not the binding.
      (priorRecord as { Structure?: { Kind: string, Properties: unknown[], IndexSignatures: unknown[] } }).Structure = {
        Kind: 'object',
        Properties: [...prior, ...Properties],
        IndexSignatures: [],
      };
      return undefined;
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
export function* Evaluate_IsExpression({ Expression, Type, Pattern }: ParseNode.IsExpression): ValueEvaluator {
  const ref = Q(yield* Evaluate(Expression));
  const value = Q(yield* GetValue(ref));
  // proposal-runtime-types `sec-is-pattern`: "`subject is P` is the one-arm
  // `match`, exactly." A |Type| is one |MatchPattern| form and keeps the path it
  // always had, so every existing `is` is unchanged.
  if (Pattern) {
    const matched = Q(yield* PatternMatches(Pattern, value));
    return matched ? Value.true : Value.false;
  }
  const record = Q(yield* TypeNodeToTypeRecord(Type!));
  const result = Q(yield* IsOfType(value, record));
  return result ? Value.true : Value.false;
}

/**
 * `sec-matchconstant`: the sameValue comparison WITHIN ONE TYPE - *false* where
 * the operands' types differ, the type's sameValue where they are of one
 * numeric type, SameValue otherwise.
 *
 * A third relation beside SameValue and SameValueZero. The BARE-ZERO rule is
 * deliberately NOT here: `PatternMatches`' literal step applies it, because
 * inside this operation it would reach every constant comparison, including
 * interpolations and enumerators.
 */
export function MatchConstant(a: Value, b: Value): boolean {
  return SameValue(a, b);
}

/**
 * `sec-patternmatches`, the forms phase one of PLAN-pattern-matching.md
 * carries: combinators, `_`, literals, and the type pattern.
 *
 * It returns at the FIRST failure, so "user code a pattern can reach ... runs at
 * most once and only up to the deciding test" - which is why `and` returns
 * before evaluating its right operand on a miss, rather than computing both and
 * combining.
 */
export function* PatternMatches(P: ParseNode.MatchPattern, subject: Value): PlainEvaluator<boolean> {
  switch (P.type) {
    case 'MatchOrPattern': {
      if (Q(yield* PatternMatches(P.Left, subject))) {
        return true;
      }
      return Q(yield* PatternMatches(P.Right, subject));
    }
    case 'MatchAndPattern': {
      if (!Q(yield* PatternMatches(P.Left, subject))) {
        return false;
      }
      return Q(yield* PatternMatches(P.Right, subject));
    }
    case 'MatchNotPattern':
      return !Q(yield* PatternMatches(P.Operand, subject));
    case 'MatchWildcardPattern':
      return true;
    case 'MatchLiteralPattern': {
      const ref = Q(yield* Evaluate(P.Literal as never));
      const literal = Q(yield* GetValue(ref as never));
      // The BARE-ZERO step: a bare `0` matches both zeros of the position's
      // type, while an explicit `+0` or `-0` distinguishes them.
      if (P.BareZero && literal instanceof NumberValue && R(literal) === 0
          && subject instanceof NumberValue && R(subject) === 0) {
        return true;
      }
      return MatchConstant(subject, literal);
    }
    case 'MatchTypePattern': {
      const record = Q(yield* TypeNodeToTypeRecord(P.Type));
      return Q(yield* IsOfType(subject, record));
    }
    default:
      return false;
  }
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
  StampReflectionContext(context, kind);
  X(CreateDataProperty(context, Value('name'), name));
  X(CreateDataProperty(context, Value('type'), target));
  // The enum's own metadata under the empty member, an enumerator's under its
  // name - so `@f enum E { @g A }` gives two objects rather than one shared.
  const memberName = kind === 'Enum' ? '' : (name instanceof JSStringValueClass ? name.stringValue() : kind);
  X(CreateDataProperty(context, Value('metadata'), MetadataObjectFor(target, undefined, memberName)));
  return context;
}
