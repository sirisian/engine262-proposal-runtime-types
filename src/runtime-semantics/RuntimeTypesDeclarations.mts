import { RegisterFunctionTypeParameterScope, copyTypeParameterFrame, bindTypeParameter } from '../type-system/runtime.mts';
import { DeclaredMemberImplements } from '../type-system/implements-member.mts';
import { ApplyGenericMap, GenericMapTypeOf } from '../abstract-ops/generic-map.mts';
import { CreateGenericAliasRecord } from '../type-system/generic-alias-context.mts';
import { LexicalFreeReferences, ResolveBindingDeclaration } from '../type-system/compile-time-evaluability.mts';
import { InstallTypeLayoutProperties } from '../type-system/layout-properties.mts';
import { RememberArrayCapacity } from '../type-system/array-capacity-origin.mts';
import { IsPartialDeclaration, MergePartialStructures, RuntimePartialContributions, PartialBindings } from '../type-system/partial-types.mts';
import { InstantiateCheckedBindings } from '../type-system/checked-bindings.mts';
import { keyAdmittedBy } from '../type-system/literal-fit.mts';
import { operatorTableKey } from '../type-system/overloads.mts';
import { FixedTypeSubtrees } from '../type-system/component-patterns.mts';
import { NominalRecordsOf } from '../type-system/intern.mts';
import { bindIntrinsicArguments } from '../type-system/intrinsic-generics.mts';
import { setCaseSpecializationLookup } from '../type-system/layout.mts';
import { PatternBindingNames } from '../type-system/pattern-scopes.mts';
import { GenericWhereVerified } from '../type-system/generic-where.mts';
import { RequiredModuleInputFailure } from '../type-system/required-module-inputs.mts';
import { IsGenericBuiltin } from '../type-system/generic-builtins.mts';
import { BigIntValue, NumberValue, ObjectValue, SymbolValue, Value, isTypedNumber, wellKnownSymbols, Descriptor } from '../value.mts';
import { DefinePropertyOrThrow } from '../abstract-ops/all.mts';
import { SelfThisTypeRecord, PatternLiteralTypeOf, PublishedClassTypeOf, DeclaredClassContractOf, DeclaredClassFieldTypeOf } from '../type-system/check.mts';
import { SelectClassCase, CaseGroupMembers, SelectExplicitCase, StoredCaseValue, RecordSelection, InCallableDeclarationContext } from '../abstract-ops/callable-selection.mts';
import { StampTypedArray } from '../abstract-ops/array-view.mts';
import { CheckedConvertValue, LookupClassOperator, OverloadSignatureOf, functionWhereClauses, functionTypeParameters, classFrameOfObject, classFrameOfMethod } from '../abstract-ops/runtime-types.mts';
import { CreateDecimalValue, decimalAdd, isDecimalObject, type DecimalObject, DecimalFromResult, CreateDecimalSpecial } from '../intrinsics/Decimal.mts';
import { isFloat128Object, Float128ToBinary128, Binary128ToFloat128 } from '../intrinsics/Float128.mts';
import { add as float128Add, finite as float128Finite } from '../intrinsics/Float128Arithmetic.mts';
import { JSStringValue, TypedString, TypedBigInt } from '../value.mts';
import type { Arguments, ReferenceRecord } from '../value.mts';
import { ClaimEnumerator } from '../abstract-ops/runtime-types.mts';
import { CreateArrayFromList } from '../abstract-ops/all.mts';
import { IsAssignable, SameType } from '../type-system/relations.mts';
import { TypedNumberValue } from '../value.mts';
import { StampReflectionContext } from '../type-system/reflection-contexts.mts';
import { EnsureCompletion, NormalCompletion, Q, X } from '../completion.mts';
import { RetainTypeResultContext } from '../type-system/type-result-context.mts';
import { StringValue } from '../static-semantics/all.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { FirstNonEvaluableForm } from '../type-system/evaluable-fragment.mts';
import { BeginFragmentEvaluation, EndFragmentEvaluation } from '../type-system/fragment-library.mts';
import { IsBudgetExhausted, EvaluateWithTypeBudget } from '../type-system/budget.mts';
import { Evaluate, type PlainEvaluator, type ValueEvaluator } from '../evaluator.mts';
import { GetValue } from '../abstract-ops/all.mts';
import { iterationInterfaceRecord } from '../type-system/iteration-types.mts';
import { CanonicalizeType } from '../type-system/intern.mts';
import { GetTypeObject, isTypeObject } from '../type-system/intern.mts';
import { InjectedClassOf, instantiatePartialClassSelf, mentionsTypeParameter, substituteFreeTypeParameters, parameter, type TypeRecord, type SignatureRecord } from '../type-system/records.mts';
import { beginResolvingAlias, endResolvingAlias, tieAliasKnot, recordResolvedAlias, recordGenericAliasDeclaration } from '../type-system/resolving-aliases.mts';
import { FirstInlineCycle } from '../type-system/layout.mts';
import { OriginOfNode, RecordTypeOrigin, RecordDeclaredMemberOrigins } from '../type-system/provenance.mts';
import { BindTypeParameterTyped, toNumericArgument,
  SubstituteTypeArguments, GenericAliasDeclarationShape, InstantiateGenericAlias, ApplyGenericInterface, IsOfType, TypeNodeToTypeRecord, spreadElementsOf,
  pushTypeParameterFrame, popTypeParameterFrame, ResolveTypeName, functionRecordFromSignature, functionRecordFromCallSignatures, RegisterSpecializedFunctionType, TypeArgumentAsDeclaration } from '../type-system/runtime.mts';
import { currentTypeParameterFrame, BindPartialClassSelf, BindTypeArgumentsInto, MetadataObjectFromType, publishedReturnTypeOfFunction, WithClassInterfaceChecks } from '../type-system/runtime.mts';
import { InferGenericBindings, TypeParameterValue, TakePendingCalleeContext, contextualTypeFor, pushContextualType, popContextualType } from '../type-system/runtime.mts';
import { bindLibraryTypeArguments, RememberLibraryApplication } from '../type-system/library-type-arguments.mts';
import { classTypeParameterFrame } from './CallExpression.mts';
import { substituteParameterRecords } from '../type-system/relations.mts';
import { typeArgumentNameOf } from '../type-system/type-argument-order.mts';
import { builtinTypeRecord, displayType, propertyKeyValue } from '../type-system/records.mts';
import { markBuiltinFunctionAsConstructor } from '../abstract-ops/function-operations.mts';
import { DefaultValueOf } from '../type-system/runtime.mts';
import { anyType } from '../type-system/records.mts';
import { ConvertValue, AssociateClassType, LookupClassType } from '../abstract-ops/runtime-types.mts';
import { JSStringValue as JSStringValueClass } from '../value.mts';
import {
  SameValue, HasProperty, Get, Call, IsCallable, IteratorToList, GetIterator,
  GetMethod, LengthOfArrayLike, ToBoolean, ToNumber, ArrayCreate, CreateBuiltinFunction,
  GetPrototypeFromConstructor,
} from '../abstract-ops/all.mts';
import { R as MathematicalValue } from "../abstract-ops/all.mjs";
import { ThrowCompletion } from '../completion.mts';
import { DeclarativeEnvironmentRecord, GlobalEnvironmentRecord, DeclarativeBindingIdentity, UninitializedBindingIdentity } from '../execution-context/Environment.mts';
import { ClassDefinitionEvaluation, PartialClassMergeEvaluation, OwnClassMemberContractsOf } from './ClassDefinitionEvaluation.mts';
 import { Evaluate_PropertyName } from './PropertyName.mts';
import { ApplyDecorators } from './ClassDefinitionEvaluation.mts';
import { InitializeBoundName } from './BindingInitialization.mts';
import { MetadataObjectFor } from './ClassDefinitionEvaluation.mts';
import { EnvironmentRecord, RefBindingHolder, Assert, OrdinaryObjectCreate, CreateDataProperty, InCapturedTypeContext, BindTypeArgumentRecordsInto, specializationDepthExhausted, CompleteSpecializationResult, ClassMethodThisTypeOf, type CapturedTypeContext } from '#self';
import { ClaimMetaKey, MetaTypeClaiming, OrdinaryFunctionCreate, R, RegisterMetaDefaultSnapshot, RegisterMetaShape, NormalizeMetadataRecord, MetadataSatisfiesShape, RegisterMetaHook, RegisterMetaTypeName, RegisterMetaTypeParameterName, SnapshotMetadataValue, Throw, surroundingAgent } from '#self';

/**
 * proposal-runtime-types
 * Placeholder evaluation for the declarations introduced by the proposal: the
 * declared name is bound and initialized, and the declaration otherwise
 * evaluates to an empty completion. The type registry semantics that give the
 * bindings their values are not implemented yet.
 */
/**
 * proposal-runtime-types #sec-type-errors: the checking pass processes a source
 * text's type declarations before its body evaluates, which is what makes a
 * declaration visible to the judgments of the same source. A node the pass
 * evaluated is marked here, and its body-position evaluation becomes a no-op,
 * so registration and binding initialization happen exactly once.
 */
export const preEvaluatedTypeDeclarations = new WeakSet<ParseNode>();

// #sec-declaration-preparation-state: nested checking suspends the outer group.
const declarationPreparationFrames = new WeakMap<object, Set<object>[]>();

/** Open an activation-local group and return its exception-safe cleanup. */
export function BeginTypeDeclarationPreparation(environment: EnvironmentRecord, names: readonly string[]): () => void {
  let frames = declarationPreparationFrames.get(surroundingAgent);
  if (!frames) {
    frames = [];
    declarationPreparationFrames.set(surroundingAgent, frames);
  }
  const identities = new Set<object>();
  for (const name of names) {
    const identity = DeclarativeBindingIdentity(environment, Value(name));
    if (identity) identities.add(identity);
  }
  frames.push(identities);
  return () => {
    Assert(frames[frames.length - 1] === identities);
    frames.pop();
  };
}

/** An unresolved read can refer only to a pending declaration in this activation. */
export function IsPendingTypeDeclarationReference(error: unknown): boolean {
  const identity = UninitializedBindingIdentity(error);
  const frames = declarationPreparationFrames.get(surroundingAgent);
  return identity !== undefined && (frames?.[frames.length - 1]?.has(identity) ?? false);
}

// Records under construction belong to actual bindings in the current agent.
// They are never successful fallback types and leave no evidence on failure.
const resolvingInterfaces = new WeakMap<object, Map<object, TypeRecord>>();
const interfaceTypeContexts = new WeakMap<object, CapturedTypeContext>();

export function InterfaceTypeContextOf(record: TypeRecord): CapturedTypeContext | undefined {
  return record.Kind === 'nominal' && record.DeclarationIdentity
    ? interfaceTypeContexts.get(record.DeclarationIdentity) : undefined;
}

/** Resolve an interface graph in its declaration environment without initializing its binding. */
export function* ResolveInterfaceDeclaration(node: ParseNode.InterfaceDeclaration, environment: EnvironmentRecord): PlainEvaluator<TypeRecord> {
  const identity = DeclarativeBindingIdentity(environment, Value(node.BindingIdentifier.name));
  Assert(identity !== undefined);
  let active = resolvingInterfaces.get(surroundingAgent);
  if (!active) {
    active = new Map();
    resolvingInterfaces.set(surroundingAgent, active);
  }
  const pending = active.get(identity);
  if (pending) return pending;
  const outermost = active.size === 0;
  let completed = false;
  const structure: TypeRecord = { Kind: 'object', Properties: [], IndexSignatures: [] };
  const record: TypeRecord = { Kind: 'nominal', Declaration: node, DeclarationIdentity: identity, Arguments: [], Structure: structure };
  active.set(identity, record);
  const context = surroundingAgent.runningExecutionContext;
  interfaceTypeContexts.set(identity, {
    Environment: environment, PrivateEnvironment: context.PrivateEnvironment,
    TypeParameterFrame: currentTypeParameterFrame(), Realm: context.Realm, ScriptOrModule: context.ScriptOrModule,
  });
  const outer = context.LexicalEnvironment;
  context.LexicalEnvironment = environment;
  try {
    Q(yield* Evaluate_RuntimeTypesBindingDeclaration(node, true, (resolved) => {
      Assert(resolved.Kind === 'nominal' && resolved.Structure !== undefined);
      tieAliasKnot(structure, resolved.Structure);
    }));
    completed = true;
    return record;
  } finally {
    context.LexicalEnvironment = outer;
    if (!completed) interfaceTypeContexts.delete(identity);
    // Reuse completed subgraphs only within this formation, including diamonds.
    if (outermost) active.clear();
    else if (!completed) active.delete(identity);
  }
}

/**
 * @param rebind Rebuild the Type Object for a declaration already evaluated, and
 *   UPDATE its binding rather than initializing one.
 *
 *   The checking pass needs this because of an ordering it cannot avoid: a `meta`
 *   declaration names its constraint shape, so aliases must be evaluated BEFORE
 *   metas; and a `meet` hook is registered BY a meta, so an alias whose type is a
 *   metadata intersection must be built AFTER them. The two are different
 *   declarations, so the cycle breaks - but only if the alias loop can run twice.
 *
 *   Without this the second run asserted, the operation building the Type Object
 *   and initializing the binding together: `binding !== undefined &&
 *   binding.initialized === false`.
 */
export function* Evaluate_RuntimeTypesBindingDeclaration(node: ParseNode.TypeAliasDeclaration | ParseNode.InterfaceDeclaration | ParseNode.EnumDeclaration, rebind = false, shapeOnly?: (type: TypeRecord) => void): PlainEvaluator {
  if (preEvaluatedTypeDeclarations.has(node) && !rebind) {
    return undefined;
  }
  if (node.type === 'InterfaceDeclaration' && node.Partial && !shapeOnly) return yield* RegisterPartialInterface(node);
  // An alias CASE is inert where it is written; an application of
  // its family selects it.
  if ((node.type === 'TypeAliasDeclaration' || node.type === 'InterfaceDeclaration') && node.TypeParameters && node.TypeParameters.ListKind !== 'parameters' && !IsPartialDeclaration(node)) {
    return undefined;
  }
  const name = StringValue(node.BindingIdentifier);
  const env = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  let value: Value = Value.undefined;
  let aliasContext: TypeRecord | undefined;
  if (node.type === 'TypeAliasDeclaration') {
    if (node.TypeParameters) {
      // A generic alias binds uninstantiated; instantiation substitutes the
      // parameters and interns the result.
      value = GetTypeObject(CreateGenericAliasRecord(node, env, currentTypeParameterFrame()));
    } else {
      // #sec-gettypeobject: the alias binds the interned Type Object of its Type.
      //
      // #sec-type-alias-declarations lets the Type refer to the alias itself.
      // The binding is in its dead zone throughout, and the record does not
      // exist yet, so an empty placeholder is published for the declaration and
      // a self-reference resolves to it (TypeNodeToTypeRecord). Once the Type is
      // resolved that same object is filled in place, which ties the knot, and
      // only THEN is anything canonicalized or interned: a union type node is
      // built uncanonicalized, so the one canonicalization that matters is the
      // GetTypeObject below, and by then the placeholder is the finished record.
      const placeholder = { Kind: 'object', Properties: [], IndexSignatures: [] } as unknown as TypeRecord;
      beginResolvingAlias(node, placeholder);
      let record;
      try {
        record = Q(yield* TypeNodeToTypeRecord(node.Type));
      } finally {
        endResolvingAlias(node);
      }
      if (record === placeholder) {
        // `type L = L;` - the alias's Type is the alias, so there is no
        // structure to be recursive THROUGH. It is not the finite-layout case
        // (there is no field closing a cycle) and it never denotes a type.
        return Throw.TypeError('$1 is defined as itself, so it denotes no type', Value(name.stringValue()));
      }
      tieAliasKnot(placeholder, record);
      // #sec-type-alias-declarations: "It is a type error if a cycle never
      // does, since the type would demand an infinite inline layout, which is
      // the same rule sec-typed-classes applies to a value type class
      // containing itself."
      const cycle = FirstInlineCycle(record);
      if (cycle !== null) {
        return Throw.TypeError('$1 contains itself through field $2, so it has no finite layout', Value(name.stringValue()), Value(cycle));
      }
      if (node.WhereClauses && node.WhereClauses.length > 0) {
        // proposal-runtime-types (dependentrecordtypes.md): a `where` clause
        // makes this a dependent record type. Its identity is the declaration's
        // (two textually identical `where` blocks are two types), so it binds as
        // a nominal type whose structure is the base record; the predicates ride
        // on the declaration and are checked at every boundary by IsOfType.
        aliasContext = { Kind: 'nominal', Declaration: node, Arguments: [], Structure: record };
        value = GetTypeObject(aliasContext);
      } else {
        value = GetTypeObject(record);
        // The context keeps the declaration's own binders where an equal
        // interned type shares its Type Object. Where interning REDUCED the
        // record instead - a meta `meet` folding an intersection of
        // parameterizations into one - the reduced record is the type, and
        // the context must be it too: with the unreduced intersection as the
        // context, `const c: C = 7` was refused against the intersection
        // (meet-literal, meet-scope).
        const interned = (value as unknown as { TypeRecord: TypeRecord }).TypeRecord;
        aliasContext = SameType(interned, record) ? record : interned;
      }
    }
  } else if (node.type === 'EnumDeclaration') {
    // Enum members take their initializer's value, or the previous numeric
    // value plus one, starting from 0. The members are data properties of the
    // enum's Type Object, and membership is SameValue against the list.
    // The underlying type is resolved BEFORE the members, because every one of
    // them passes through it.
    const underlyingRecord = node.TypeAnnotation
      ? Q(yield* TypeNodeToTypeRecord(node.TypeAnnotation.Type))
      : builtinTypeRecord('int32') ?? undefined;
    // Numeric in the sense the clause means: an enumeration that numbers itself
    // from 0 needs a type those numbers are values of.
    const underlyingIsNumeric = underlyingRecord !== undefined
      && underlyingRecord.Kind === 'primitive'
      && /^(u?int|float|decimal)/.test(underlyingRecord.Name)
      && underlyingRecord.Name !== 'number'
      ? true
      : underlyingRecord?.Kind === 'primitive' && underlyingRecord.Name === 'number';

    const memberValues: Value[] = [];
    const memberNames: string[] = [];
    // Built before the members so each one can be tagged with it. `EnumMembers`
    // is the same array the loop fills, so the record is complete by the time
    // anything reads it.
    const enumRecord: TypeRecord = {
      Kind: 'nominal', Declaration: node, Arguments: [], EnumMembers: memberValues, Underlying: underlyingRecord ?? undefined,
    };
    let nextAuto = 0;
    let previous: Value | undefined;
    // The most recently given generator function, which a following enumerator
    // with no initializer is given the result of calling, "until an initializer
    // replaces it". An initializer that is not such a function sets its own
    // value "without disturbing the function for those after it".
    let generator: Value | undefined;
    // #sec-enums already sequences these - "a later enumerator with no
    // initializer takes the result of applying ... `operator++` to THE PREVIOUS
    // ENUMERATOR'S VALUE" - so each is evaluated in order with the previous
    // value in hand. What was missing is that an earlier enumerator's NAME was
    // not in scope for a later initializer, so `enum E: uint8 { A = 1, B = A + 1 }`
    // was a *ReferenceError*: the dependency existed and the spelling for it did
    // not, though `B = A + 1` is the ordinary idiom of C, C#, Java and
    // TypeScript alike.
    //
    // A scope of its own, pushed for the member list and popped after it, with
    // each name bound as its value is settled. The enum's OWN name is not bound
    // here: `E.A` stays a *ReferenceError* while `E` is uninitialized, which is
    // the ordinary temporal dead zone and a separate question from this one.
    const enumContext = surroundingAgent.runningExecutionContext;
    const outerEnvironment = enumContext.LexicalEnvironment;
    const memberScope = new DeclarativeEnvironmentRecord(outerEnvironment);
    enumContext.LexicalEnvironment = memberScope;
    try {
    for (const member of node.EnumMemberList) {
      let v: Value;
      if (member.Initializer) {
        // #sec-enums: "EVERY INITIALIZER IS EVALUATED IN THE COMPILE-TIME
        // EVALUABLE FRAGMENT, since an enumerator is a constant of the program."
        //
        // It was evaluated outside one, and the checking pass was hiding it:
        // that pass evaluates a closed initializer under the fragment, so
        // `enum E { A = Math.random() }` was refused there and never reached
        // here. An initializer the pass could not resolve - one naming a binding
        // it cannot read, `const r = Math.random; enum E { A = r() }` - was
        // skipped there and then evaluated HERE with no fragment in force. It
        // produced a real random number and failed the range check against it,
        // so the diagnostic named a different value on every run and the rule
        // that should have refused it never ran.
        //
        // The fragment is enforced on the FUNCTION at the call
        // (`fragment-library.mts`), which is why this is all that was missing:
        // the call simply has to happen inside one. The generator-function call
        // below is inside it too - that function produces the enumerator's
        // value, so it is as much "the initializer" as the expression that named
        // it.
        BeginFragmentEvaluation();
        try {
          const ref = Q(yield* Evaluate(member.Initializer));
          v = Q(yield* GetValue(ref));
          // "An enumerator initialized with a function of two parameters is given
          // the result of calling that function" - with the enumerator's index
          // and name, which is the design's
          // `enum Count: float32 { Zero = (index, name) => index * 100, One, Two }`.
          // The value was being converted as a function and refused.
          const arity = IsCallable(v)
            ? Q(yield* Get(v as ObjectValue, Value('length')))
            : Value.undefined;
          if (arity instanceof NumberValue && (R(arity) as number) === 2) {
            generator = v;
            v = Q(yield* Call(generator, Value.undefined, [Value(memberValues.length), Value(member.IdentifierName.name)]));
          }
        } finally {
          EndFragmentEvaluation();
        }
      } else if (previous === undefined) {
        // #sec-enums: "The first enumerator, when it has no initializer, takes
        // 0, and it is a type error when the underlying type is not numeric,
        // since a non-numeric enumeration must define its starting value."
        if (!underlyingIsNumeric) {
          return Throw.TypeError('$1 is not assignable to $2', Value('an enumerator with no initializer'), Value('an enum whose underlying type is not numeric; give it a value'));
        }
        v = Value(nextAuto);
      } else if (generator !== undefined) {
        v = Q(yield* Call(generator, Value.undefined, [Value(memberValues.length), Value(member.IdentifierName.name)]));
      } else if (!underlyingIsNumeric) {
        // #sec-enums: a later enumerator with no initializer "takes the result
        // of applying the underlying type's prefix increment operator
        // `operator++` to the previous enumerator's value, with the previous
        // enumerator itself unmodified; where the underlying type declares no
        // prefix increment, it takes a value equal to the previous one".
        //
        // Reading only the Number family for that made EVERY other underlying
        // type take the repeat rule, so a `bigint` enumeration counted 1, 1, 1
        // and the design document's own `class A { operator++() }` example gave
        // every enumerator after the first the same value - silently, since the
        // declaration is accepted either way. The two arms below are the types
        // that DO declare a prefix increment and are not Number-family.
        const incOp = previous instanceof ObjectValue
          ? LookupClassOperator(previous, 'unary ++')
          : null;
        if (incOp !== null) {
          v = Q(yield* Call(incOp, previous, []));
        } else if (previous instanceof BigIntValue) {
          v = Value((R(previous as BigIntValue) as bigint) + 1n);
        } else {
          v = previous;
        }
      } else if (isFloat128Object(previous)) {
        // A float128 declares a prefix increment - `++` steps it by an exact 1,
        // rounded once - and, like a decimal, its value cannot be reached through
        // a Number: the Number counter below would count in doubles and produce a
        // Number, not a float128. So the step is taken IN the type.
        v = Binary128ToFloat128(float128Add(Float128ToBinary128(previous), float128Finite(1n, 0)), surroundingAgent.currentRealmRecord);
      } else if (isDecimalObject(previous)) {
        // A decimal declares a prefix increment like any other numeric type, but
        // the value it produces cannot be reached through a Number: a decimal
        // carries a cohort member - `1.0` is 10 x 10^-1 where `1.00` is
        // 100 x 10^-2 - and converting a double to one is refused for exactly
        // that reason. So the step is taken IN the type, by adding the decimal
        // one at the previous enumerator's own width.
        const one = CreateDecimalValue(1n, 0, previous.DecimalWidth, surroundingAgent.currentRealmRecord);
        v = Q(DecimalFromResult(decimalAdd(previous, one as DecimalObject), surroundingAgent.currentRealmRecord));
      } else {
        // "A later enumerator with no initializer takes the result of applying
        // the underlying type's prefix increment operator to the one before."
        v = Value(nextAuto);
      }
      // #sec-enums: an enumerator's value is a value of the underlying type, so
      // it passes that type's boundary - `enum E: uint8 { A = 300 }` is the
      // mistake `let a: uint8 = 300` is, and was accepted here because nothing
      // read the underlying type the declaration had already resolved.
      if (underlyingRecord !== undefined) {
        v = Q(yield* CheckedConvertValue(v, underlyingRecord));
        // #sec-enums: "`Reflect.typeOf(Count.Zero)` reports `Count`, by the rule
        // that a value's runtime type is the most specific type of which it is
        // a value." The conversion above is what CHECKS the value and what
        // normalizes it; leaving the underlying type on it made an enumerator
        // report `uint8` where the clause says it reports the enum, and
        // membership in the underlying type follows from the subtype relation
        // rather than from a second runtime type.
        // #sec-enums: "Reflect.typeOf(Count.Zero) reports Count." An enumerator
        // carries its enum, which is also what lets membership tell one
        // declaration's value from another's - without it a value of one enum
        // satisfied an unrelated enum over the same underlying type.
        //
        // Each family takes the carrier its representation allows, and each is a
        // SUBCLASS or a fresh instance rather than a wrapper, so the value stays
        // usable as its underlying type: `S.A === "x"`, `1n === B.A`, and a
        // decimal's own equality all hold. Only TypedNumberValue is a sibling of
        // its base, which is the numeric family's own rule.
        if (v instanceof TypedNumberValue) {
          v = new TypedNumberValue((v as TypedNumberValue).value, enumRecord);
        } else if (v instanceof JSStringValue) {
          v = TypedString((v as JSStringValue).stringValue(), enumRecord);
        } else if (v instanceof BigIntValue) {
          v = TypedBigInt(R(v as BigIntValue) as bigint, enumRecord);
        } else if (isDecimalObject(v)) {
          // A fresh decimal rather than a slot on the one the program wrote: an
          // enumerator may be written from a shared binding, and tagging that
          // would claim someone else's object. A decimal is compared by content,
          // so the copy is SameValue-equal to the original.
          v = v.DecimalSpecial !== undefined ? CreateDecimalSpecial(v.DecimalSpecial, v.DecimalWidth, surroundingAgent.currentRealmRecord, enumRecord) : CreateDecimalValue(
            v.DecimalSignificand,
            v.DecimalExponent,
            v.DecimalWidth,
            surroundingAgent.currentRealmRecord,
            enumRecord,
          );
        } else if (v instanceof SymbolValue || v instanceof ObjectValue) {
          // A symbol, a class instance, and a function are compared by IDENTITY,
          // so the enumerator IS the value the program wrote - which is what
          // keeps `A.X === k`, `A.X.v`, and `A.X instanceof K` true. There is
          // nowhere on such a value to put an enum that belongs to one of
          // possibly several, so the claim is recorded outside it.
          //
          // #sec-enums: a value may be an enumerator of at most one enum. Without
          // that rule two enums share the value, and then `A.X is B` is true, a
          // B-typed parameter takes an A value, and `Reflect.typeOf` has no
          // single answer to give.
          const claimedBy = ClaimEnumerator(v, enumRecord);
          if (claimedBy !== undefined && !SameType(claimedBy, enumRecord)) {
            return Throw.TypeError(
              '$1 is already an enumerator of $2, and a value may be an enumerator of at most one enum',
              Value(member.IdentifierName.name),
              Value(displayType(claimedBy)),
            );
          }
        }
      }
      // #sec-enums: "A later enumerator with no initializer takes the result of
      // applying the underlying type's prefix increment operator to the one
      // before." Continue from the value just stored, whatever it converted to
      // - a converted enumerator is a TypedNumberValue rather than a Number, so
      // reading only the Number case counted from 0 again and made
      // `enum E: uint8 { A = 10, B }` report 1 rather than 11, and hid the
      // overflow in `{ A = 255, B }` behind the same reset.
      const numeric = NumericValueOfEnumerator(v);
      nextAuto = numeric === undefined ? nextAuto + 1 : numeric + 1;
      // #sec-enums: "It is a type error if two enumerators of one declaration
      // have the same name." Nothing checked it, so `enum E { A, A }` was
      // accepted and the later enumerator silently won - the same failure the
      // interface check above exists to prevent, where the meaning of a
      // declaration depends on which member is read.
      if (memberNames.includes(member.IdentifierName.name)) {
        return Throw.TypeError('$1 is already an enumerator of this enum', Value(member.IdentifierName.name));
      }
      previous = v;
      memberValues.push(v);
      memberNames.push(member.IdentifierName.name);
      // Bound AFTER the value is settled, so an initializer naming its own
      // enumerator finds nothing and stays the error it was.
      X(memberScope.CreateImmutableBinding(Value(member.IdentifierName.name), Value.true));
      X(memberScope.InitializeBinding(Value(member.IdentifierName.name), v));
    }
    } finally {
      enumContext.LexicalEnvironment = outerEnvironment;
    }
    const obj = GetTypeObject(enumRecord);
    // #sec-enums: an enumerator is "a constant of the program", and the enum
    // switch and match judgments read enumerator values at compile time, so
    // the enumerator properties are non-writable and non-configurable and the
    // Type Object admits no further members. They were ordinary data
    // properties, so `E.A = 5` succeeded and read back 5.
    const constant = (v: Value): Descriptor => Descriptor({ Value: v, Writable: Value.false, Enumerable: Value.true, Configurable: Value.false });
    for (let i = 0; i < memberNames.length; i += 1) {
      X(yield* DefinePropertyOrThrow(obj, Value(memberNames[i]), constant(memberValues[i])));
      // The design's index operator: `Count[0]` is `Count.Zero` beside
      // `Count['Zero']`. By POSITION rather than by underlying value - the
      // design's own example cannot tell the two apart, since its enumerators
      // are numbered from 0, but an index operator beside a name lookup is
      // indexing the ENUMERATION, and position is what `keys()`, `values()`,
      // and `entries()` are ordered by. A lookup by VALUE already exists and
      // is spelled `Count(n)`, the reverse conversion.
      X(yield* DefinePropertyOrThrow(obj, Value(String(i)), constant(memberValues[i])));
    }
    X(yield* obj.PreventExtensions());
    value = obj;
  } else if (node.type === 'InterfaceDeclaration' && !shapeOnly) {
    value = GetTypeObject(Q(yield* ResolveInterfaceDeclaration(node, env)));
  } else if (node.type === 'InterfaceDeclaration') {
    // The interface's structural shape: annotated members check their type,
    // method signatures retain their full contracts. An unresolved annotation
    // propagates its completion rather than reducing the member to presence.
    // The interface's structure is a real ~object~ record now; membership
    // rides the structural IsOfType case, while identity stays nominal.
    // The runtime half. A generic
    // interface's members were resolved with its type parameters OUT of scope,
    // so `T` fell to ~any~ and [[Structure]] was `{ x: any }` for EVERY
    // application. Membership then admitted any argument - `o is P.<string>`
    // for a `uint8` field - and object-to-interface subtyping admitted it too,
    // because both read this structure.
    //
    // The frame is pushed so `TypeNodeToTypeRecord` answers a ~parameter~
    // record, which `lookupTypeParameter` already does for any bound name. The
    // CHECKER builds its own structure and needs the same push there; neither
    // half shows any effect without the other, nor without the substitution at
    // the membership site.
    const ifaceParams = (node as { TypeParameters?: { TypeParameterList?: readonly ParseNode[] } })
      .TypeParameters?.TypeParameterList ?? [];
    const ifaceFrame = new Map<string, TypeRecord>();
    for (const tp of ifaceParams) {
      const pname = (tp as { BindingIdentifier?: { name?: string } })?.BindingIdentifier?.name;
      if (typeof pname === 'string') {
        ifaceFrame.set(pname, { Kind: 'parameter', Name: pname } as TypeRecord);
      }
    }
    if (ifaceFrame.size > 0) {
      pushTypeParameterFrame(ifaceFrame);
    }
    try {
    const Properties: { key: string | SymbolValue, type: TypeRecord, optional: boolean, readonly: boolean, initial?: Value }[] = [];
    // An interface's INDEX SIGNATURES. The structure below hardcoded
    // `IndexSignatures: []` and this walk skipped every non-TypeMember, so a
    // declared signature was dropped HERE as well as in the checker - which is
    // why `({ x: "s" } is I)` answered *true* for
    // `interface I { [k: string]: int32 }`, where the ALIAS spelling answers
    // *false*. Two spellings of one type disagreeing on a value question.
    //
    // Both sides are needed: a checker that enforced a signature the run time
    // did not would make `is` and an annotation disagree the other way.
    const IndexSignatures: { Key: TypeRecord, Value: TypeRecord }[] = [];
    // #sec-object-types: "An object type OR INTERFACE whose members are all call
    // signatures denotes the ~function~ Type Record whose [[Signatures]] are
    // those signatures in declaration order." README, "Function Interfaces":
    // `interface IExample { ({ a: uint32 }): uint32 }` and a call `a({ a: 1 })`
    // through a parameter of that type. The member walk below builds an object
    // structure and refused a call signature - "not supported yet" - so the
    // interface spelling of a function type did not exist while the object-type
    // spelling beside it did. The same builder answers both; the Structure is
    // the function record, and everything reading a Structure - the parameter
    // boundary, `is`, satisfaction - sees a function type, which is what the
    // clause says the interface denotes. A mix gets the clause's error.
    const callable = Q(yield* functionRecordFromCallSignatures(node.InterfaceMemberList as readonly ParseNode[]));
    if (callable !== undefined) {
      const fnRecord: TypeRecord = {
        Kind: 'nominal',
        Declaration: node,
        Arguments: [],
        Structure: callable,
      } as unknown as TypeRecord;
      if (shapeOnly) {
        shapeOnly(fnRecord);
        return undefined;
      }
      value = GetTypeObject(fnRecord);
    } else {
    for (const member of node.InterfaceMemberList) {
      if (member.type === 'IndexSignature') {
        const ix = member as unknown as {
          KeyTypeAnnotation?: { Type: ParseNode.Type },
          ValueTypeAnnotation?: { Type: ParseNode.Type },
        };
        if (ix.KeyTypeAnnotation && ix.ValueTypeAnnotation) {
          IndexSignatures.push({
            Key: Q(yield* TypeNodeToTypeRecord(ix.KeyTypeAnnotation.Type)) as TypeRecord,
            Value: Q(yield* TypeNodeToTypeRecord(ix.ValueTypeAnnotation.Type)) as TypeRecord,
          });
        }
        continue;
      }
      if (member.type !== 'TypeMember') {
        continue;
      }
      const m = member as unknown as { PropertyName?: ParseNode & { name?: string, value?: string }, Readonly?: boolean, Optional?: boolean, TypeAnnotation?: ParseNode.TypeAnnotation | null, MethodSignature?: unknown };
      // #sec-object-types admits a CALL SIGNATURE (a member with no name); an
      // interface made of them denotes a function type, which the interface
      // record here (an object structure) cannot yet hold. Refused loudly
      // rather than bound to a nameless key; the function-typed reading with
      // generic-signature satisfaction is not implemented.
      // A call signature among named members reached here only if the mix
      // check above did not fire, which it always does for one; kept as an
      // assertion of that.
      if (m.PropertyName === null && m.MethodSignature) {
        return Throw.TypeError('$1', Value('call signatures do not mix with named members in one object type'));
      }
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
        // Recursive interface references return the pending graph node; an
        // unrelated failed read must retain its original completion.
        resolved = Q(yield* TypeNodeToTypeRecord(m.TypeAnnotation.Type));
      } else if (m.MethodSignature) {
        // This was a STUB - a function type
        // with NO signatures - so every comparison against a method member
        // failed and `Reflect.isAssignable` answered *false* for a
        // method-bearing interface from a declaring class and from a matching
        // object type alike, while the checker accepted all of them. The same
        // family of defect: the runtime record carrying less than the checker's.
        //
        // Resolved through the operation the ~function~ TYPE node already uses,
        // so a method member and a `(x: uint8) => uint8` member reach the same
        // record from the same code.
        const method = m.MethodSignature as ParseNode.MethodSignature;
        // A method's OWN type parameters are in scope across its signature
        // (as for an OBJECT TYPE in `runtime.mts`). Needed HERE too
        // the moment the signature's failures are reported: without it
        // `interface I { m<T>(v: T): T; }` began answering `"T" is not defined`,
        // because `T` reached a binding lookup like any other name.
        const methodTypeParameters = (method as unknown as {
          TypeParameters?: { TypeParameterList?: readonly ParseNode[] } | null,
        }).TypeParameters?.TypeParameterList ?? [];
        const methodFrame = new Map<string, TypeRecord>();
        for (const q of methodTypeParameters) {
          const pname = (q as unknown as { BindingIdentifier?: { name?: string } }).BindingIdentifier?.name;
          if (pname) {
            methodFrame.set(pname, { Kind: 'any' } as TypeRecord);
          }
        }
        if (methodFrame.size > 0) {
          pushTypeParameterFrame(methodFrame);
        }
        let attempt;
        try {
          // The method's own type parameters are PASSED, so the signature
          // record carries [[TypeParameters]] as #sec-signature-records says and
          // as the object-type spelling of the same member already did. They
          // were computed above for the frame and then not handed on, so an
          // interface's generic method was `(x: T) => T` at run time - not
          // generic, and a literal written against it could adopt nothing.
          attempt = EnsureCompletion(yield* functionRecordFromSignature(
            method.FunctionTypeParameterList,
            method.TypeAnnotation,
            methodTypeParameters as readonly ParseNode.TypeParameter[],
          ));
        } finally {
          if (methodFrame.size > 0) {
            popTypeParameterFrame();
          }
        }
        const built = Q(attempt);
        resolved = built.Kind === 'function'
          ? { Kind: 'function', Signatures: built.Signatures.map((sig) => ({ ...sig, ThisType: SelfThisTypeRecord })) }
          : built;
      }
      // The DECLARED DEFAULT travels with the member: a typed composite
      // creation fills it before freezing, so it is part of the contents that
      // intern.
      let initial;
      const memberInitializer = (m as { Initializer?: ParseNode | null }).Initializer;
      if (memberInitializer) {
        // The syntactic half of that requirement, checked before evaluating: a
        // form outside #annex-evaluable-fragment is refused by name rather than
        // by whatever its evaluation happens to do. An interface member and the
        // same member written in an object type are one thing, so both walks
        // apply it.
        const outsideMember = FirstNonEvaluableForm(memberInitializer as never);
        if (outsideMember !== undefined) {
          return Throw.TypeError('a member default must be compile-time evaluable, and $1 is not', Value(outsideMember));
        }
        // #sec-object-types: "The |Initializer| must be compile-time evaluable
        // ... and it is a type error otherwise." The failure was SWALLOWED, so a
        // member whose default could not be evaluated silently had none - the
        // author wrote a default, got no default, and was told nothing. The
        // originating error is propagated rather than replaced, because WHY it
        // was not evaluable is the useful half of the diagnostic.
        // The same scope as the object-type walk: the two spellings mean one
        // thing, so an excluded built-in is refused in both.
        BeginFragmentEvaluation();
        try {
          initial = Q(yield* GetValue(Q(EnsureCompletion(yield* Evaluate(memberInitializer))) as never));
          if (!mentionsTypeParameter(resolved)) {
            initial = Q(yield* CheckedConvertValue(initial, resolved));
          }
        } finally {
          EndFragmentEvaluation();
        }
      }
      Properties.push({ key, type: resolved, optional: !!m.Optional, readonly: !!m.Readonly, initial });
    }
    // proposal-runtime-types decorators.md, #sec-partial-classes: a `partial
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
      const existingRef = Q(yield* ResolveTypeName(Value(name.stringValue())));
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
      // the same lesson at a second site: rebinding the name is not the same
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
      Structure: { Kind: 'object', Properties, IndexSignatures },
    };
    if (shapeOnly) {
      shapeOnly(record);
      return undefined;
    }
    value = GetTypeObject(record);
    }
    } finally {
      if (ifaceFrame.size > 0) {
        popTypeParameterFrame();
      }
    }
  }
  // #sec-provenance: record the declaration site this type came from. Interning
  // has already merged structurally identical shapes, so recording here IS the
  // union the clause specifies: `type A = { x: number }` and `type B = { x:
  // number }` reach one Type Object and both sites land on it. Nothing about the
  // type's identity reads this, and no program can: it is the host's channel.
  if (shapeOnly && isTypeObject(value)) {
    shapeOnly(value.TypeRecord);
    return undefined;
  }
  if (value !== Value.undefined) {
    RecordTypeOrigin(value as object, OriginOfNode(node, node.type, name.stringValue()));
    // ...and the members, which is the half #sec-provenance also specifies - "A
    // Property Type Record and a Type Record may carry an [[Origin]]" - and the
    // half the clause's own motivation needs: "`partial(User)` should not cost an
    // editor its memory of where `name` came from" is a question about a MEMBER.
    //
    // Walked from the declaration's own member nodes, so each member's origin is
    // its own source position rather than the type's. A member the declaration
    // does not write - one a spread brought in, or one a builder minted - gets
    // none here, which is the correct answer for the same reason a minted record
    // has none.
    RecordDeclaredMemberOrigins(value as object, node);
  }
  // An alias binding is immutable to the program (Q20), but the engine's own
  // rebuild of an already evaluated declaration still replaces its value.
  const holder = env instanceof GlobalEnvironmentRecord ? env.DeclarativeRecord : env;
  const ownBinding = holder instanceof DeclarativeEnvironmentRecord ? holder.bindings.get(name) : undefined;
  if (rebind && ownBinding && ownBinding.mutable === false && ownBinding.initialized) {
    ownBinding.value = value;
  } else if (rebind) {
    // The binding exists and is initialized; give it the rebuilt Type Object.
    // Tolerant of an environment that refuses, because a rebind is an
    // improvement on the first answer rather than a correctness requirement:
    // where it cannot be applied the type stays as it was.
    const set = EnsureCompletion(yield* env.SetMutableBinding(name, value, Value.false));
    if (set.Type !== 'normal') {
      return undefined;
    }
  } else {
    Q(yield* InitializeBoundName(name, value, env));
  }
  // Publication follows successful initialization/rebinding. A failed or
  // shape-only preparation must not lend a record to another binding.
  if ((node.type === 'InterfaceDeclaration' || node.type === 'TypeAliasDeclaration' && !node.TypeParameters)
    && isTypeObject(value)) {
    recordResolvedAlias(env, name, node, value.TypeRecord, aliasContext ?? value.TypeRecord);
  }
  // A generic alias is published for a later script's checker too (Q20, A+).
  if (node.type === 'TypeAliasDeclaration' && node.TypeParameters && isTypeObject(value)) {
    recordGenericAliasDeclaration(env, name, node);
  }
  // proposal-runtime-types decorators.md: `@f enum Count { @f Zero, ... }`.
  // decorators.md "Order" puts members before their container, so the
  // ENUMERATORS run first and the enum's own decorators last - the same rule a
  // class and its fields follow, applied to a third container kind.
  if (surroundingAgent.feature('runtime-types') && node.type === 'EnumDeclaration') {
    const members = node.EnumMemberList ?? [];
    for (let index = 0; index < members.length; index += 1) {
      const member = members[index];
      const decorators = (member as { Decorators?: readonly ParseNode.Decorator[] | null }).Decorators;
      if (!decorators?.length) {
        continue;
      }
      const memberName = (member as { IdentifierName?: { name?: string } }).IdentifierName?.name;
      Q(yield* ApplyDecorators(decorators, Q(yield* EnumDecoratorContext(
        'EnumEnumerator', typeof memberName === 'string' ? Value(memberName) : Value.undefined, value, { index },
      ))));
    }
    const own = (node as { Decorators?: readonly ParseNode.Decorator[] | null }).Decorators;
    if (own?.length) {
      // #sec-reflection-shape-enum: `valueType` is the Type Object of the type
      // the enumerators take their values in - the enum's Underlying, which the
      // declaration resolves and stores and nothing read until now. It reports
      // the DEFAULT where the program wrote no annotation, so a reader need not
      // know whether one was written.
      const underlyingRecord = (value as { TypeRecord?: { Underlying?: TypeRecord } }).TypeRecord?.Underlying;
      Q(yield* ApplyDecorators(own, Q(yield* EnumDecoratorContext('Enum', name, value, {
        size: members.length,
        valueType: underlyingRecord ? GetTypeObject(underlyingRecord) as Value : undefined,
      }))));
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
export function* Evaluate_IsExpression(node: ParseNode.IsExpression): ValueEvaluator {
  const { Expression, Type, Pattern } = node;
  const ref = Q(yield* Evaluate(Expression));
  const value = Q(yield* GetValue(ref));
  // proposal-runtime-types `sec-is-pattern`: "`subject is P` is the one-arm
  // `match`, exactly." A |Type| is one |MatchPattern| form and keeps the path it
  // always had, so every existing `is` is unchanged.
  if (Pattern) {
    const context = surroundingAgent.runningExecutionContext;
    const outer = context.LexicalEnvironment;
    const env = new DeclarativeEnvironmentRecord(outer);
    const names = new Set(PatternBindingNames(Pattern).map((binding) => binding.Name));
    for (const name of names) {
      X(env.CreateImmutableBinding(Value(name), Value.true));
    }
    context.LexicalEnvironment = env;
    try {
      const matched = Q(yield* PatternMatches(Pattern, value));
      if (matched && names.size) {
        (context.PatternEnvironments ??= new Map()).set(node, env);
      }
      return matched ? Value.true : Value.false;
    } finally {
      context.LexicalEnvironment = outer;
    }
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
 * `sec-patternmatches`, the forms carried: combinators, `_`, literals, and the
 * type pattern.
 *
 * It returns at the FIRST failure, so "user code a pattern can reach ... runs at
 * most once and only up to the deciding test" - which is why `and` returns
 * before evaluating its right operand on a miss, rather than computing both and
 * combining.
 */
/**
 * `sec-match-evaluation`.
 *
 * THE SUBJECT IS EVALUATED ONCE, before any pattern, and ONE cache serves every
 * clause - which is what makes "every pattern of one `match` sees the same
 * values" true and what lets arms agree about a getter they both name.
 *
 * Clauses are tried in source order and the first whose pattern matches
 * evaluates its body; "if no clause matches, a `TypeError` is thrown - and the
 * exhaustiveness rules make that throw statically impossible exactly where the
 * types can prove it", which is phase five's half.
 */
/** The names a clause's pattern binds, with whether each is `const`. */
function MatchClauseBoundNames(clause: ParseNode.MatchClause): { name: string, isConst: boolean }[] {
  return MatchPatternBoundNames(clause.Pattern);
}

/** The names a pattern binds, with whether each is `const`. */
function MatchPatternBoundNames(pattern: ParseNode.MatchPattern | null): { name: string, isConst: boolean }[] {
  const names: { name: string, isConst: boolean }[] = [];
  const walk = (p: ParseNode.MatchPattern | null): void => {
    if (!p) {
      return;
    }
    switch (p.type) {
      case 'MatchBindingPattern':
        names.push({ name: p.Name, isConst: p.IsConst });
        break;
      case 'MatchOrPattern':
      case 'MatchAndPattern':
        walk(p.Left);
        walk(p.Right);
        break;
      case 'MatchNotPattern':
        walk(p.Operand);
        break;
      case 'MatchObjectPattern':
        p.Properties.forEach((prop) => walk(prop.Pattern));
        walk(p.Rest ?? null);
        break;
      case 'MatchArrayPattern':
        p.Elements.forEach(walk);
        break;
      case 'MatchExtractorPattern':
        p.Elements.forEach(walk);
        break;
      // A juxtaposition binds through its SHAPE; the head is a type and binds
      // nothing. Three walks over a pattern's bindings exist - this one, the
      // scope walker, and the checker's - and a form missing from any of them
      // is a form whose bindings are declared in one place and read in another.
      case 'MatchJuxtapositionPattern':
        walk(p.Shape as ParseNode.MatchPattern);
        break;
      default:
        break;
    }
  };
  walk(pattern);
  return names;
}

export function* Evaluate_MatchExpression(node: ParseNode.MatchExpression): ValueEvaluator {
  const subjectRef = Q(yield* Evaluate(node.Expression as never));
  const subject = Q(yield* GetValue(subjectRef as never));
  const cache = NewMatchCache();
  // `match all` collects instead of returning: every clause is tried, every one
  // that matches contributes its arm's value, and the result is an Array in arm
  // order. An abrupt completion still propagates, which is what makes a
  // throwing arm abort the collection - the arms before it have already run.
  const collected: Value[] = [];
  const contextual = contextualTypeFor(node);
  const armContext = node.All ? (contextual?.Kind === 'array' ? contextual.Element : null) : contextual ?? null;
  for (const clause of node.Clauses) {
    // "A fresh declarative environment per clause with the clause's BoundNames
    // created" - so a binding of one arm is invisible to the next, and a `const`
    // binding is immutable where a `let` one is not.
    const outerEnv = surroundingAgent.runningExecutionContext.LexicalEnvironment;
    const clauseEnv = new DeclarativeEnvironmentRecord(outerEnv);
    const names = new Map(MatchClauseBoundNames(clause).map((binding) => [binding.name, binding.isConst]));
    for (const [name, isConst] of names) {
      if (isConst) {
        X(clauseEnv.CreateImmutableBinding(Value(name), Value.true));
      } else {
        X(clauseEnv.CreateMutableBinding(Value(name), Value.false));
      }
    }
    surroundingAgent.runningExecutionContext.LexicalEnvironment = clauseEnv;
    let matched = clause.Pattern === null;
    if (clause.Pattern) {
      const attempt = EnsureCompletion(yield* PatternMatches(clause.Pattern, subject, cache));
      if (attempt.Type !== 'normal') {
        surroundingAgent.runningExecutionContext.LexicalEnvironment = outerEnv;
        return attempt as never;
      }
      matched = attempt.Value as unknown as boolean;
    }
    // A GUARD runs AFTER the pattern matches, and "a falsy guard fails the arm
    // and matching continues" - it does not abandon the match.
    if (matched && clause.Guard) {
      const guardRef = Q(yield* Evaluate(clause.Guard as never));
      const guard = Q(yield* GetValue(guardRef as never));
      matched = ToBoolean(guard) === Value.true;
    }
    if (!matched) {
      surroundingAgent.runningExecutionContext.LexicalEnvironment = outerEnv;
      continue;
    }
    if (clause.IsBlock) {
      // proposal-runtime-types #sec-do-expression-modifications: a match arm's
      // Block IS a `do` expression's Block, and its value is its completion
      // value - which a Block already produces, so nothing special is computed
      // here. That was true under the narrower rule this replaces as well, so
      // no program changes meaning: what changes is that an arm may now END in
      // an `if` with an `else`, a `try`, or a `switch`, where the old rule made
      // those ~void~ and unreadable at the use site, and that an arm ending in
      // a declaration is a Syntax Error naming it rather than a silent ~void~.
      // A `return` or `break` inside propagates as the abrupt completion it is,
      // which is what makes the arm a block rather than a function body.
      pushContextualType(armContext, clause.Body);
      let blockResult;
      try {
        blockResult = EnsureCompletion(yield* Evaluate(clause.Body as never));
      } finally {
        popContextualType();
      }
      // The clause environment must be dropped on EVERY exit, not only the ones
      // that fall through to the next clause. Leaving it installed made the
      // running context's LexicalEnvironment a child of the one the surrounding
      // code expects, so a `for` head containing a match then asked its loop
      // environment for a binding that lives one link up:
      //
      //   for (let i = match ([1]) { when [_]: 1; default: 0; }; i < 3; i++)
      //
      // crashed on `Assert(binding !== undefined)` inside
      // CreatePerIterationEnvironment. `var` was unaffected, having no
      // per-iteration environment to copy, and a match with no bound names
      // crashed too, since the clause environment is created either way - which
      // is why this is not about the bindings.
      surroundingAgent.runningExecutionContext.LexicalEnvironment = outerEnv;
      if (blockResult.Type !== 'normal') {
        return blockResult as never;
      }
      let blockValue = (blockResult.Value ?? Value.undefined) as unknown as Value;
      if (armContext) blockValue = Q(yield* CheckedConvertValue(blockValue, armContext));
      if (node.All) {
        collected.push(blockValue);
        continue;
      }
      return blockValue;
    }
    pushContextualType(clause.IsThrow ? null : armContext, clause.Body);
    let bodyRef;
    try {
      bodyRef = EnsureCompletion(yield* Evaluate(clause.Body as never));
    } finally {
      popContextualType();
    }
    const body = bodyRef.Type === 'normal'
      ? EnsureCompletion(yield* GetValue(bodyRef.Value as never))
      : bodyRef;
    surroundingAgent.runningExecutionContext.LexicalEnvironment = outerEnv;
    if (body.Type !== 'normal') {
      return body as never;
    }
    if (clause.IsThrow) {
      return ThrowCompletion(body.Value) as never;
    }
    if (node.All) {
      let value = body.Value as Value;
      if (armContext) value = Q(yield* CheckedConvertValue(value, armContext));
      collected.push(value);
      continue;
    }
    return body.Value as Value;
  }
  if (node.All) {
    // No arm matching is an ANSWER rather than a missing case, which is why
    // exhaustiveness is not required of a `match all`. An empty list is what
    // "none of these hold" looks like.
    return X(CreateArrayFromList(collected));
  }
  return Throw.TypeError('$1 matched no clause of this match', subject);
}

export interface MatchCacheRecord {
  readonly Reads: { Object: Value, Key: string, Present: boolean, Value: Value }[];
  readonly Iterations: { Object: Value, Elements: Value[], Done: boolean }[];
}

/**
 * `sec-match-expression`: "A Match Cache Record has a [[Reads]] field ... and an
 * [[Iterations]] field ... It memoizes what a `match` reads of its subject, so
 * that a property is read at most once and an iterator is obtained at most once
 * however many patterns look, and every pattern of one `match` sees the same
 * values."
 *
 * A CORRECTNESS requirement, not an optimization: a getter that ran per test
 * would give different arms different values of one member.
 */
export function NewMatchCache(): MatchCacheRecord {
  return { Reads: [], Iterations: [] };
}

/**
 * The members of a type that may be matched MEMBER BY MEMBER through the cache,
 * or *undefined* where it may not.
 *
 * Three kinds of object type cannot be, each measured:
 *
 * - **OPTIONAL members**: `{ g?: uint8 }` matches `{}`, where a member-by-member
 *   test would require `g` present and answer *false*.
 * - **INDEX SIGNATURES**: `{ [k: string]: uint8 }` names no members to walk.
 * - **NOMINAL types**: a class rejects a plain object with the right members, so
 *   it can never become a structural test. An INTERFACE is structural here - a
 *   plain object matches one - and so may be routed through its Structure.
 */
function StructuralMemberTypes(t: TypeRecord): readonly { key: string, type: TypeRecord }[] | undefined {
  const shape = t.Kind === 'object'
    ? t
    : (t.Kind === 'nominal' && (t as { Declaration?: unknown }).Declaration === undefined
      ? (t as { Structure?: TypeRecord }).Structure
      : undefined);
  if (!shape || shape.Kind !== 'object') {
    return undefined;
  }
  if (shape.IndexSignatures.length > 0) {
    return undefined;
  }
  const members = [];
  for (const p of shape.Properties) {
    if (p.optional || typeof p.key !== 'string') {
      return undefined;
    }
    members.push({ key: p.key, type: p.type as TypeRecord });
  }
  return members.length > 0 ? members : undefined;
}

export function* PatternMatches(P: ParseNode.MatchPattern, subject: Value, cache: MatchCacheRecord = NewMatchCache()): PlainEvaluator<boolean> {
  switch (P.type) {
    case 'MatchOrPattern': {
      const env = surroundingAgent.runningExecutionContext.LexicalEnvironment;
      Assert(env instanceof DeclarativeEnvironmentRecord);
      const bindings = PatternBindingNames(P.Left).map((binding) => {
        const name = Value(binding.Name);
        return [name, { ...env.bindings.get(name)! }] as const;
      });
      if (Q(yield* PatternMatches(P.Left, subject, cache))) {
        return true;
      }
      // #sec-patternmatches: retry with the original bindings, retaining effects in the match cache.
      for (const [name, binding] of bindings) {
        env.bindings.set(name, binding);
      }
      return Q(yield* PatternMatches(P.Right, subject, cache));
    }
    case 'MatchAndPattern': {
      if (!Q(yield* PatternMatches(P.Left, subject, cache))) {
        return false;
      }
      return Q(yield* PatternMatches(P.Right, subject, cache));
    }
    case 'MatchNotPattern':
      return !Q(yield* PatternMatches(P.Operand, subject, cache));
    case 'MatchWildcardPattern':
      return true;
    case 'MatchBindingPattern': {
      // "A binding always matches and always binds", and an ANNOTATED binding
      // tests first - which is `catch (e: TypeError)` in a new position.
      if (P.TypeAnnotation) {
        const record = Q(yield* TypeNodeToTypeRecord(P.TypeAnnotation));
        if (!Q(yield* IsOfType(subject, record))) {
          return false;
        }
      }
      const env = surroundingAgent.runningExecutionContext.LexicalEnvironment;
      X(env.InitializeBinding(Value(P.Name), subject));
      return true;
    }
    case 'MatchLiteralPattern': {
      const ref = Q(yield* Evaluate(P.Literal as never));
      let literal = Q(yield* GetValue(ref as never));
      const position = PatternLiteralTypeOf(P);
      if (position) literal = Q(yield* CheckedConvertValue(literal, position));
      // The BARE-ZERO step: a bare `0` matches both zeros of the position's
      // type, while an explicit `+0` or `-0` distinguishes them.
      if (P.BareZero && literal instanceof NumberValue && R(literal) === 0
          && subject instanceof NumberValue && R(subject) === 0) {
        return true;
      }
      return MatchConstant(subject, literal);
    }
    case 'MatchInterpolationPattern': {
      // "`${expression}` evaluates the expression and matches by SameValue
      // against the result, whatever the result is" - the escape hatch from
      // every cleverer rule, where a type pattern would test membership and an
      // expression pattern would consult a matcher.
      const ref = Q(yield* Evaluate(P.Expression as never));
      const value = Q(yield* GetValue(ref as never));
      return MatchConstant(subject, value);
    }
    case 'MatchObjectPattern': {
      // `sec-match-structural`. Presence is the `in` test, so an OPTIONAL
      // MEMBER THAT IS ABSENT FAILS the pattern rather than matching
      // *undefined* - and a member the pattern does not name is ignored, since
      // this type system has width subtyping and no exact object type.
      if (!(subject instanceof ObjectValue)) {
        return false;
      }
      for (const prop of P.Properties) {
        let read = cache.Reads.find((r) => r.Object === subject && r.Key === prop.Key);
        if (!read) {
          // ONE cached touch per key: a HasProperty and at most one Get,
          // however many patterns name it, so a getter runs once and every
          // pattern of one match sees the same value.
          const present = Q(yield* HasProperty(subject, Value(prop.Key)));
          const value = present === Value.true ? Q(yield* Get(subject, Value(prop.Key))) : Value.undefined;
          read = { Object: subject, Key: prop.Key, Present: present === Value.true, Value: value };
          cache.Reads.push(read);
        }
        if (!read.Present) {
          return false;
        }
        if (!Q(yield* PatternMatches(prop.Pattern, read.Value, cache))) {
          return false;
        }
      }
      // "The rest binding, where present, collects the REMAINING own enumerable
      // members" - remaining meaning those the pattern did not name, which is
      // why the named keys are excluded rather than the read ones: a key read
      // through the cache by an EARLIER pattern is still a member this one did
      // not name.
      const rest = (P as { Rest?: ParseNode.MatchBindingPattern | null }).Rest;
      if (rest) {
        const named = new Set(P.Properties.map((prop) => prop.Key));
        const remaining = OrdinaryObjectCreate(surroundingAgent.currentRealmRecord.Intrinsics['%Object.prototype%']);
        const keys = Q(yield* subject.OwnPropertyKeys());
        for (const key of keys) {
          if (!(key instanceof JSStringValueClass) || named.has((key as JSStringValueClass).stringValue())) {
            continue;
          }
          const desc = Q(yield* subject.GetOwnProperty(key as never));
          if (desc !== Value.undefined && (desc as { Enumerable?: unknown }).Enumerable === Value.true) {
            X(CreateDataProperty(remaining, key, Q(yield* Get(subject, key))));
          }
        }
        if (!Q(yield* PatternMatches(rest, remaining, cache))) {
          return false;
        }
      }
      return true;
    }
    case 'MatchArrayPattern': {
      // `sec-match-array`: matched "through ITERATION rather than through an
      // array test, which is what reaches every array-shaped value of this
      // proposal - a `[N].<T>` need not be an Array exotic object, a tuple
      // composite is iterable by kind rather than by prototype, and a typed
      // view answers no array predicate". A pattern that meant `Array.isArray`
      // would match the one shape that needed it least.
      let memo = cache.Iterations.find((it) => it.Object === subject);
      if (!memo) {
        memo = { Object: subject, Elements: [], Done: false };
        cache.Iterations.push(memo);
      }
      // Elements are pulled AS PATTERNS NEED THEM and memoized per subject, so
      // alternatives over array patterns of different lengths pull each element
      // once between them.
      const need = P.Elements.length + 1;
      if (!memo.Done && memo.Elements.length < need) {
        const iter = EnsureCompletion(yield* GetIterator(subject, 'sync'));
        if (iter.Type !== 'normal') {
          return false;
        }
        const iterated = EnsureCompletion(yield* IteratorToList(iter.Value as never));
        if (iterated.Type !== 'normal') {
          return false;
        }
        memo.Elements = iterated.Value as Value[];
        memo.Done = true;
      }
      // Without a rest element the iterator must be EXHAUSTED at the pattern's
      // length: `[let a, let b]` matches exactly two.
      if (memo.Elements.length !== P.Elements.length) {
        return false;
      }
      for (let i = 0; i < P.Elements.length; i += 1) {
        if (!Q(yield* PatternMatches(P.Elements[i]!, memo.Elements[i]!, cache))) {
          return false;
        }
      }
      return true;
    }
    case 'MatchRangePattern': {
      // `sec-matchrange`: containment, "at most two comparisons" - the form
      // that makes a FLOAT subject matchable at all, since a float has no cases
      // to enumerate.
      const ref = Q(yield* Evaluate(P.Range as never));
      const range = Q(yield* GetValue(ref as never));
      if (!(range instanceof ObjectValue)) {
        return false;
      }
      const contains = Q(yield* Get(range, Value('contains')));
      if (!IsCallable(contains)) {
        return false;
      }
      const answer = Q(yield* Call(contains, range, [subject]));
      return answer === Value.true;
    }
    case 'MatchRegExpPattern': {
      // `sec-matchregexp`: it matches the ENTIRE subject - "the whole-string
      // discipline this proposal uses everywhere a pattern constrains a
      // string" - so a search is spelled by writing the pattern as one.
      if (!(subject instanceof JSStringValueClass)) {
        return false;
      }
      const ref = Q(yield* Evaluate(P.RegExp as never));
      const re = Q(yield* GetValue(ref as never));
      if (!(re instanceof ObjectValue)) {
        return false;
      }
      const exec = Q(yield* Get(re, Value('exec')));
      if (!IsCallable(exec)) {
        return false;
      }
      const result = Q(yield* Call(exec, re, [subject]));
      if (!(result instanceof ObjectValue)) {
        return false;
      }
      const matched = Q(yield* Get(result, Value('0')));
      const index = Q(yield* Get(result, Value('index')));
      return matched instanceof JSStringValueClass
        && index instanceof NumberValue && MathematicalValue(index) === 0
        && matched.stringValue().length === subject.stringValue().length;
    }
    case 'MatchExtractorPattern': {
      // `sec-patternmatches`, the `MatchNamePattern ( MatchPatternList? )`
      // steps. "The typed protocol is a method, usually static, from the
      // subject to a tuple or `null`."
      const ref = Q(yield* Evaluate(P.Head as never));
      const head = Q(yield* GetValue(ref as never));
      if (!(head instanceof ObjectValue)) {
        return Throw.TypeError('$1 is not an object', head);
      }
      const matcher = Q(yield* GetMethod(head, wellKnownSymbols.customMatcher));
      if (matcher === Value.undefined) {
        return Throw.TypeError('$1 has no custom matcher', head);
      }
      const r = Q(yield* Call(matcher, head, [subject]));
      // "`null` is no match."
      if (r === Value.null) {
        return false;
      }
      if (!(r instanceof ObjectValue)) {
        // A BOOLEAN matcher takes no parentheses - "a boolean matcher with
        // parentheses, or a tuple matcher without them, is a type error, so the
        // two protocols cannot be confused silently".
        return Throw.TypeError('$1 is not a tuple', r);
      }
      const len = Q(yield* LengthOfArrayLike(r));
      if (len !== P.Elements.length) {
        // "A runtime TypeError where the counts disagree, so an extractor
        // reached through `any` FAILS LOUDLY rather than part-matching."
        return Throw.TypeError('$1 does not match the pattern\'s length', r);
      }
      for (let i = 0; i < P.Elements.length; i += 1) {
        const element = Q(yield* Get(r, Value(String(i))));
        if (!Q(yield* PatternMatches(P.Elements[i]!, element, cache))) {
          return false;
        }
      }
      return true;
    }
    case 'MatchJuxtapositionPattern': {
      // #sec-match-patterns leaves the juxtaposition's test unwritten, but the
      // overlap rule fixes it: a |MatchNamePattern| and a |Type| "overlap where
      // a name is both; the name form is preferred, and THE TWO READINGS AGREE
      // wherever both exist, since a name denoting a type matches by membership
      // under either". So `P` tests membership, and `P { ... }` must agree with
      // `P` about whether a `P` matches - membership first, then the shape.
      //
      // Both halves are reused rather than rewritten: the head goes through the
      // same path a bare name pattern takes, and the shape through the object
      // arm above, with THE SAME CACHE - the clause promises "the subject is
      // evaluated once and the cache is shared across clauses, so a property is
      // read at most once however many patterns look at it", which a private
      // cache here would quietly break.
      // "It is a type error if the |MatchNamePattern| of a juxtaposition ...
      // resolves to a binding: THE JUXTAPOSED HEAD MUST DENOTE A TYPE",
      // "decided at the site where the head's Static Type is known and at run
      // time otherwise". It is otherwise: a head naming a value binding and one
      // naming a class through a namespace object are both unresolvable
      // statically, so the decision is here.
      //
      // Without it a head that denotes a value took the membership path and
      // brought the engine down - `let Foo = 5; when Foo { x: let n }` crashed
      // with "Value [object Object] is out of range" rather than naming the
      // mistake.
      const headRecord = EnsureCompletion(yield* TypeNodeToTypeRecord(P.Head as never));
      if (headRecord.Type !== 'normal' || !headRecord.Value) {
        // No interpolation. The formatter takes Values, so a Parse Node made
        // the diagnostic throw a RangeError out of `exhaustive` - the rule
        // fired and then died formatting its own message - and `sourceText` is
        // not a function on this node either. The sentence names the rule; the
        // site names the place.
        return Throw.TypeError('a juxtaposed head must denote a type');
      }
      const headPattern = { type: 'MatchTypePattern', Type: P.Head } as unknown as ParseNode.MatchPattern;
      if (!Q(yield* PatternMatches(headPattern, subject, cache))) {
        return false;
      }
      return Q(yield* PatternMatches(P.Shape as ParseNode.MatchPattern, subject, cache));
    }
    case 'MatchTypePattern': {
      // A bare name that resolves to a VALUE with a custom matcher is a
      // MEMBERSHIP TEST through it - the parenthesis-free form `Composite`
      // uses. Reached here because a bare name parses as a |Type|; the type
      // path answers first where the name denotes one, which is what makes
      // `when Circle:` and `when Count.Zero:` read as the tests they are.
      const asType = EnsureCompletion(yield* TypeNodeToTypeRecord(P.Type));
      if (asType.Type === 'normal') {
        // QUESTION-match-cache-type-path.md: a STRUCTURAL object type is matched
        // MEMBER BY MEMBER THROUGH THE CACHE rather than by `IsOfType` on the
        // whole.
        //
        // The Match Cache Record is specified to memoize reads "so that a
        // property is read at most once HOWEVER MANY PATTERNS LOOK, and every
        // pattern of one `match` sees the same values" - but `IsOfType` is given
        // no cache at any of its five call sites, while every other
        // subject-touching operation takes one. Measured, that is not a
        // performance difference: with a getter returning 1 then 2,
        // `when { g: 2 }` / `when { g: 1 }` selected NO ARM through `IsOfType`
        // and `{ g: 1 }` through the pattern path. **The two spellings chose
        // different arms**, and which one a member takes is invisible in the
        // source.
        //
        // The reads are moved to where the cache already is, rather than the
        // cache into the type system: `IsOfType` keeps its signature and every
        // other caller is untouched.
        const structural = StructuralMemberTypes(asType.Value as TypeRecord);
        if (structural && subject instanceof ObjectValue) {
          for (const member of structural) {
            let read = cache.Reads.find((r) => r.Object === subject && r.Key === member.key);
            if (!read) {
              const present = Q(yield* HasProperty(subject, Value(member.key)));
              const value = present === Value.true ? Q(yield* Get(subject, Value(member.key))) : Value.undefined;
              read = { Object: subject, Key: member.key, Present: present === Value.true, Value: value };
              cache.Reads.push(read);
            }
            if (!read.Present) {
              return false;
            }
            if (!Q(yield* IsOfType(read.Value, member.type))) {
              return false;
            }
          }
          return true;
        }
        return Q(yield* IsOfType(subject, asType.Value as TypeRecord));
      }
      // Not a type: evaluate the name as the member expression it spells and
      // dispatch on the VALUE. A boolean matcher reached WITHOUT parentheses is
      // a membership test - the form `Composite` uses - and "a matcher that
      // returns an object there is a TypeError, as parentheses on a boolean
      // matcher are, so the two protocols cannot be confused silently".
      const nameRef = EnsureCompletion(yield* Evaluate(P.Type as never));
      if (nameRef.Type !== 'normal') {
        return Q(asType);
      }
      const named = Q(yield* GetValue(nameRef.Value as never));
      if (named instanceof ObjectValue) {
        const nameMatcher = Q(yield* GetMethod(named, wellKnownSymbols.customMatcher));
        if (nameMatcher !== Value.undefined) {
          const answer = Q(yield* Call(nameMatcher, named, [subject]));
          if (answer instanceof ObjectValue) {
            return Throw.TypeError('$1 returned a tuple where a Boolean was required', named);
          }
          return ToBoolean(answer) === Value.true;
        }
      }
      // "Anything else is a constant compared by SameValue, which for an
      // interned composite is one pointer comparison."
      return MatchConstant(subject, named);
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
  return RetainTypeResultContext(NormalCompletion(GetTypeObject(record)), record);
}
/**
 * proposal-runtime-types #sec-meta-declarations: evaluate the `default` hook and
 * register it against the named type's interned Type Object.
 */
/** The meta declaration each Type Object carries, for the one-per-type rule. */
const metaDeclarationByType = new WeakMap<object, ParseNode.MetaDeclaration>();

/** Checking-unit reservations establish conflicts without publishing a protocol. */
export interface MetaDeclarationClaims {
  owners: Map<object, ParseNode.MetaDeclaration>;
  keys: Map<string | SymbolValue, object>;
}

export function* Evaluate_MetaDeclaration(node: ParseNode.MetaDeclaration, claims?: MetaDeclarationClaims): PlainEvaluator {
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
    const ref = Q(yield* ResolveTypeName(Value(name)));
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
  // A GENERIC constraint shape resolves
  // to the alias's nominal record rather than to its body - `type G<T> = { … }`
  // binds as `Kind: 'nominal'` with `Declaration` the |TypeAliasDeclaration| -
  // so the object guard below saw no ~object~ and claimed no keys. The
  // declaration parsed, registered
  // its hooks, its default and its name, and then governed nothing, because
  // claiming is what lets a metadata value FIND the meta type that governs it.
  //
  // The body is resolved once with each parameter left FREE - a ~parameter~
  // record standing for it - because the keys of a constraint shape do not
  // depend on the argument: `{ bounds?: RangeBounds.<T>, nonZero?: boolean }`
  // claims `bounds` and `nonZero` for every `T`. That is also why claiming stays
  // at the declaration rather than moving to each instantiation: two
  // instantiations claiming one key is what the flat rule forbids.
  const aliasDeclaration = shape && shape.Kind === 'nominal'
    ? (shape as { Declaration?: ParseNode.TypeAliasDeclaration }).Declaration
    : undefined;
  // #sec-metadata-decomposition: it is an early
  // error "for its constraint shape to take a number of type parameters other
  // than the number the declaration takes". The parameter names the BASE and is
  // threaded into the shape, so a shape that takes a different number has
  // nowhere to put it - or expects one the declaration never supplies.
  //
  // Checked HERE rather than at the parser because the count on the other side
  // belongs to the constraint shape, which is not known until the |TypeName| is
  // resolved. The parser checks the declaration's own count, which it has.
  // #sec-meta-declarations: "a second declaration for one type" is an error.
  // Keyed by the TYPE OBJECT, not the name: `type A = { k: uint8 }` and `type B
  // = { k: uint8 }` intern to one Type Object, so `meta A` and `meta B` are two
  // declarations for it - which the parser's by-name duplicate check cannot
  // see, and which the key-claim check below let through because it found
  // the same claimant twice. The checker reports it early where both shapes
  // resolve; this is the deferred half. A re-evaluation of one declaration
  // (the checking pass pre-evaluates, then evaluation runs) is not a second
  // declaration, so the registry records the declaration that claimed.
  const priorDeclaration = metaDeclarationByType.get(typeObject as object) ?? claims?.owners.get(typeObject as object);
  if (priorDeclaration !== undefined && priorDeclaration !== node) {
    return Throw.TypeError('a second meta declaration for one type: $1', Value(name));
  }
  const declaredParameterCount = node.TypeParameters?.TypeParameterList?.length ?? 0;
  const shapeParameterCount = aliasDeclaration?.type === 'TypeAliasDeclaration'
    ? (aliasDeclaration.TypeParameters?.TypeParameterList?.length ?? 0)
    : 0;
  if (declaredParameterCount !== shapeParameterCount) {
    return Throw.TypeError(
      'a meta type takes $1 type parameter(s) and its constraint shape takes $2',
      Value(String(declaredParameterCount)),
      Value(String(shapeParameterCount)),
    );
  }
  const claimShape = aliasDeclaration?.type === 'TypeAliasDeclaration' && aliasDeclaration.TypeParameters
    ? Q(yield* GenericAliasDeclarationShape(aliasDeclaration, shape!))
    : shape;
  const claimedKeys = claimShape?.Kind === 'object' ? claimShape.Properties.map((property) => property.key) : [];
  const keyConflict = () => {
    for (const key of claimedKeys) {
      const owner = MetaTypeClaiming(key) ?? claims?.keys.get(key);
      if (owner !== undefined && owner !== typeObject) {
        return Throw.TypeError('$1 is already claimed by another meta type', propertyKeyValue(key));
      }
    }
    return undefined;
  };
  const conflict = keyConflict();
  if (conflict) return conflict;
  // Even if its default needs a later binding, an available declaration shape
  // already establishes which subsequent declarations would conflict with it.
  claims?.owners.set(typeObject as object, node);
  for (const key of claimedKeys) claims?.keys.set(key, typeObject as object);
  // Stage the whole declaration. A failed or unavailable default must not
  // leave an owner, any subset of its keys, or callable protocol hooks behind.
  const hooks = new Map<string, Value>();
  let defaultSnapshot: Value | undefined;
  function* evaluateDefault(expression: ParseNode.AssignmentExpressionOrHigher): PlainEvaluator<Value | undefined> {
    const v = Q(yield* GetValue(Q(yield* Evaluate(expression))));
    if (claimShape?.Kind !== 'object') return undefined;
    if (!(v instanceof ObjectValue)) {
      return Throw.TypeError('a meta type whose constraint shape is an object type requires an object default');
    }
    // Check the snapshot, never reread the live object. Numeric leaves receive
    // the claim shape's literal context; ordinary binding defaults are separate.
    const snapshot = Q(yield* SnapshotMetadataValue(v, true));
    const converted = NormalizeMetadataRecord(snapshot, claimShape);
    if (!Q(yield* MetadataSatisfiesShape(converted, claimShape))) {
      return Throw.TypeError('the default of a meta type must be a value of its constraint shape');
    }
    return converted as unknown as Value;
  }
  let sawDefault = false;
  let sawSubtype = false;
  for (const hook of node.MetaHookList) {
    if (hook.type === 'MetaDefaultHook') {
      BeginFragmentEvaluation();
      try {
        defaultSnapshot = Q(yield* EvaluateWithTypeBudget(`${name}'s default`, evaluateDefault(hook.AssignmentExpression)));
      } finally {
        EndFragmentEvaluation();
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
        RegisterFunctionTypeParameterScope(fn, node.TypeParameters?.TypeParameterList ?? []);
        hooks.set(hookName, fn);
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
  // A default may have caused a nested declaration to complete. Recheck
  // ownership before the non-yielding publication step; never overwrite it.
  const completed = metaDeclarationByType.get(typeObject as object);
  if (completed !== undefined && completed !== node) {
    return Throw.TypeError('a second meta declaration for one type: $1', Value(name));
  }
  const finalConflict = keyConflict();
  if (finalConflict) return finalConflict;
  if (IsBudgetExhausted()) return Throw.TypeError('the type evaluation budget was exhausted while declaring a meta type');
  metaDeclarationByType.set(typeObject as object, node);
  if (claimShape?.Kind === 'object') RegisterMetaShape(typeObject as object, claimShape);
  for (const key of claimedKeys) ClaimMetaKey(key, typeObject as object);
  if (defaultSnapshot !== undefined) RegisterMetaDefaultSnapshot(typeObject, defaultSnapshot);
  for (const [hookName, fn] of hooks) RegisterMetaHook(typeObject, hookName, fn);
  RegisterMetaTypeName(typeObject as object, name);
  const parameterName = node.TypeParameters?.TypeParameterList?.[0]?.BindingIdentifier?.name;
  if (parameterName !== undefined) RegisterMetaTypeParameterName(typeObject as object, parameterName);
  return undefined;
}

/**
 * proposal-runtime-types: MemberExpression/CallExpression TypeArguments.
 * A generic alias Type Object specializes; any other base keeps its Reference
 * so member calls retain their this binding.
 */
/**
 * proposal-runtime-types: the constructor of an array type written in
 * expression position, one per interned type so that two mentions of
 * `[4].<uint8>` are one constructor.
 *
 * An instance is an ordinary Array carrying the element type, which is what a
 * typed array is everywhere else in this implementation - so the element store
 * check, the array methods, and `length` all work on one without a second kind
 * of object to teach them about. A fixed extent is filled with the element
 * type's default value, since `new [100].<uint8>()` is asking for a hundred of
 * them; a dynamic one starts empty and grows.
 */
const arrayTypeConstructors = new Map<unknown, ObjectValue>();

function* ArrayTypeConstructorFor(node: ParseNode.TypeArgumentsExpression): ValueEvaluator {
  const literal = node.Expression as unknown as ParseNode.ArrayLiteral;
  const elements = (literal.ElementList ?? []) as readonly ParseNode[];
  // `[]` is dynamic; `[N]` is a fixed extent. Anything else is not an array
  // type, so it keeps its reading as a literal with type arguments.
  let extent: number | 'dynamic' = 'dynamic';
  if (elements.length === 1) {
    const only = elements[0] as { type?: string, value?: unknown };
    if (only.type === 'NumericLiteral' && typeof only.value === 'number') {
      extent = only.value;
    } else {
      // An extent written over generic parameters - the design's `[W * H]` -
      // is an expression, evaluable once an application has bound them.
      const computed = Q(yield* GetValue(Q(yield* Evaluate(only as never))));
      const n = computed instanceof NumberValue
        ? Number((computed as unknown as { value: number }).value)
        : Number((computed as unknown as { value?: number }).value ?? NaN);
      if (!Number.isInteger(n) || n < 0) {
        return Throw.TypeError('$1 is not a type', Value('an array type needs a numeric extent or none'));
      }
      extent = n;
    }
  } else if (elements.length > 1) {
    return Throw.TypeError('$1 is not a type', Value('an array type needs a numeric extent or none'));
  }
  const args = node.TypeArguments.TypeArgumentList;
  const element = args.length > 0 ? Q(yield* TypeNodeToTypeRecord(args[0]!)) : anyType;
  const record = CanonicalizeType({ Kind: 'array', Element: element, Extent: extent } as never);
  // Keyed by the INTERNED Type Object rather than the record: canonicalizing
  // yields an equal record each time but not the same one, so a Map over
  // records never hit and `[4].<uint8>` gave a fresh constructor per mention.
  const key = GetTypeObject(record);
  const cached = arrayTypeConstructors.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const realm = surroundingAgent.currentRealmRecord;
  const ctor = CreateBuiltinFunction(markBuiltinFunctionAsConstructor(function* ArrayTypeConstructor(_args: readonly (Value | undefined)[], context: { NewTarget?: Value }): ValueEvaluator {
    const { NewTarget } = context;
    if (NewTarget === Value.undefined) {
      return Throw.TypeError('$1 requires new', Value(displayType(record as never)));
    }
    const length = extent === 'dynamic' ? 0 : extent;
    const array = X(ArrayCreate(length)) as ObjectValue & { TypedElement?: unknown };
    // A fixed extent is populated, since its elements exist from the start.
    if (extent !== 'dynamic') {
      const dflt = (Q(yield* DefaultValueOf(element as never)) ?? Value.undefined) as Value;
      for (let i = 0; i < length; i += 1) {
        X(CreateDataProperty(array, Value(String(i)), dflt));
      }
    }
    // A subclass constructs through here with itself as NewTarget, so the
    // instance takes the subclass prototype and its methods.
    //
    // BEFORE the stamp, which is what makes the two agree. `StampTypedArray`
    // gives an array "its element type AND the prototype that carries the
    // capacity operations", swapping only where the array still has the
    // ordinary `%Array.prototype%` - a guard written so that a class deriving
    // from an array type keeps its own. Stamping FIRST and setting the prototype
    // after inverted that: the swap happened and was then overwritten, because a
    // direct `new [4].<uint32>()` has the constructor itself as NewTarget and
    // the constructor's own `prototype` is `%Array.prototype%`. The array was
    // left with its element type and the ordinary prototype - typed for every
    // purpose except the members that describe its allocation, which is exactly
    // the drift the helper's comment says routing through one place prevents.
    //
    // In this order the guard does the work it was written for: a direct
    // construction has the ordinary prototype here and is swapped, a subclass
    // has its own and is left alone.
    const proto = Q(yield* GetPrototypeFromConstructor(NewTarget as never, '%Array.prototype%'));
    X(array.SetPrototypeOf(proto));
    StampTypedArray(array as unknown as ObjectValue, element);
    // #sec-array-and-tuple-types: a fixed extent is part of the type, so a
    // constructed array carries it exactly as a converted one does - otherwise
    // `new [4].<float32>()` could be grown where `const a: [4].<float32>`
    // could not, and the same type would have two behaviours.
    if (extent !== 'dynamic') {
      (array as { TypedExtent?: number }).TypedExtent = extent;
    }
    return array;
  }), 0, displayType(record as never), [], realm) as ObjectValue;
  // The prototype a subclass inherits from: array instances are Arrays, so the
  // methods come from %Array.prototype%.
  X(CreateDataProperty(ctor, Value('prototype'), realm.Intrinsics['%Array.prototype%']));
  // `[].<T>` in expression position evaluates to this CONSTRUCTOR, not to the
  // interned Type Object it was keyed on. So `isTypeObject` - which is
  // `'TypeRecord' in value` - answered false for it, and
  // `Reflect.getReflection([].<uint32>)` threw "is not a type" while every other
  // type reflected. Carrying the record here makes the constructor a Type Object
  // in its own right, which is the same shape the design already gives a class:
  // "a class's type object is its constructor".
  (ctor as unknown as { TypeRecord?: unknown }).TypeRecord = record;
  X(InstallTypeLayoutProperties(ctor, record));
  // README "Capacity": the static `[].<T>.withCapacity(n)` builds an EMPTY array
  // of T with room for at least n. It belongs here because this is the object
  // the design writes it on - an earlier attempt attached it at GetTypeObject,
  // which never sees an array type.
  const withCapacity = CreateBuiltinFunction(function* withCapacitySteps([wanted0 = Value.undefined]: Arguments): ValueEvaluator {
    // #sec-toindextype: a COUNT is checked as a count rather than coerced.
    // `reserve` refuses `a.reserve("4")` because its parameter is the index
    // type; `withCapacity` followed its clause's `ToLength` and accepted the
    // String, so the two operations that take a count disagreed about what one
    // is. Both clauses now say ToIndexType, and this is the second half.
    if (!isTypedNumber(wanted0 as Value) && !(wanted0 instanceof NumberValue)) {
      return Throw.TypeError('$1 is not assignable to $2', wanted0, Value('the index type'));
    }
    const wanted = Q(yield* ToNumber(wanted0));
    const n = Math.max(0, Math.trunc(Number(wanted.numberValue())));
    // #sec-array-type-withcapacity: the same ceiling `reserve` enforces. A
    // `[` `]` `.` `<` T `>` is an Array, so a capacity past (2 ** 32) - 1 is
    // room the array could never use. The clause specified this from the
    // start; the construction path did not perform it, so `withCapacity`
    // was the one way to obtain the unusable capacity `reserve` refuses.
    if (n > (2 ** 32) - 1) {
      // See `reserve`: specified but not reachable in this engine (#index-type).
      return Throw.TypeError('a count above the maximum array length is specified but not implemented in this engine');
    }
    const arr = X(ArrayCreate(0)) as unknown as ObjectValue & { TypedElement?: unknown, TypedCapacity?: number };
    StampTypedArray(arr as unknown as ObjectValue, element);
    arr.TypedCapacity = n;
    return arr;
  }, 1, Value('withCapacity'), []);
  X(CreateDataProperty(ctor as unknown as ObjectValue, Value('withCapacity'), withCapacity));
  RememberArrayCapacity(key, ctor, withCapacity);
  // proposal-runtime-types #sec-instanceof-for-type-objects: "A Type Object has
  // a %Symbol.hasInstance% method. When called with argument v, it returns ?
  // IsOfType(v, the Type Object's [[TypeRecord]])."
  //
  // An array type in expression position is a CONSTRUCTOR, so it inherited
  // `Function.prototype[%Symbol.hasInstance%]` and answered by walking the
  // prototype chain instead. Every Array is an Array, so `x instanceof
  // [].<uint32>` was *true* for a plain untyped array, for an array of the
  // wrong element type, and for a fixed-extent array - while `is` answered
  // correctly in all three. Two membership operators disagreeing is the thing
  // the clause exists to prevent.
  const hasInstance = CreateBuiltinFunction(function* hasInstanceSteps([v = Value.undefined]: Arguments): ValueEvaluator {
    const member = Q(yield* IsOfType(v, record));
    return member ? Value.true : Value.false;
  }, 1, Value('[Symbol.hasInstance]'), []);
  X((ctor as unknown as ObjectValue).DefineOwnProperty(wellKnownSymbols.hasInstance, {
    Value: hasInstance as unknown as Value,
    Writable: Value.false,
    Enumerable: Value.false,
    Configurable: Value.false,
  } as never));
  arrayTypeConstructors.set(key, ctor);
  return ctor;
}

/**
 * A stable identity for one type argument. Interned Type Objects are one per
 * type, so an id per object distinguishes arguments that RENDER alike - `C.<4>`
 * and `C.<8>` both display as their base type, and keying on the rendering made
 * them one specialization.
 */
const specializationIds = new WeakMap<object, number>();
let nextSpecializationId = 0;
function specializationKeyOf(record: TypeRecord): string {
  const interned = GetTypeObject(record) as unknown as object;
  // A nongeneric forward class has a Type Object before its constructor is
  // stamped. Completing it changes that representative, not argument identity.
  const identity = record.Kind === 'nominal' && record.Arguments.length === 0
    && (record.Declaration.type === 'ClassDeclaration' || record.Declaration.type === 'ClassExpression')
    && !record.Declaration.TypeParameters?.TypeParameterList.length && record.DeclarationIdentity
    ? record.DeclarationIdentity : interned;
  let id = specializationIds.get(identity);
  if (id === undefined) {
    id = nextSpecializationId;
    nextSpecializationId += 1;
    specializationIds.set(identity, id);
  }
  return String(id);
}

type PartialClassExtension = {
  node: ParseNode.ClassDeclaration,
  environment: EnvironmentRecord,
  privateEnvironment: typeof surroundingAgent.runningExecutionContext.PrivateEnvironment,
};
const partialClassExtensions = new WeakMap<object, PartialClassExtension[]>();
const partialTypeContexts = new WeakMap<object, CapturedTypeContext>();
function currentPartialTypeContext(): CapturedTypeContext {
  const context = surroundingAgent.runningExecutionContext;
  return { Environment: context.LexicalEnvironment, PrivateEnvironment: context.PrivateEnvironment,
    TypeParameterFrame: currentTypeParameterFrame(), Realm: context.Realm, ScriptOrModule: context.ScriptOrModule };
}


function* PartialPatternTypes(node: ParseNode.ClassDeclaration | ParseNode.InterfaceDeclaration): PlainEvaluator<Map<ParseNode, TypeRecord>> {
  const resolved = new Map<ParseNode, TypeRecord>();
  const list = node.TypeParameters;
  const names = new Set((list?.Captures ?? []).map((c) => c.BindingIdentifier.name));
  const nodes = (list?.SpecializationEntryList ?? []).flatMap((entry) => FixedTypeSubtrees(entry.Pattern as ParseNode, names));
  const bounds = (list?.Captures ?? []).flatMap((c) => [c.TypeParameterDomain, c.TypeParameterConstraint].filter(Boolean) as ParseNode[]);
  nodes.push(...bounds.flatMap((bound) => [...FixedTypeSubtrees(bound, names), bound]));
  for (const type of nodes) {
    const attempt = EnsureCompletion(yield* TypeNodeToTypeRecord(type as ParseNode.Type));
    if (attempt.Type === 'normal') resolved.set(type, attempt.Value);
  }
  return resolved;
}

function* RegisterPartialInterface(node: ParseNode.InterfaceDeclaration): PlainEvaluator<void> {
  const reference = Q(yield* ResolveTypeName(Value(node.BindingIdentifier.name)));
  const existing = Q(yield* GetValue(reference));
  if (!isTypeObject(existing) || existing.TypeRecord.Kind !== 'nominal'
    || (existing.TypeRecord.Declaration.type !== 'InterfaceDeclaration' && !existing.TypeRecord.LibraryName)) return Throw.TypeError('$1 is not an interface', Value(node.BindingIdentifier.name));
  const primary = existing.TypeRecord.Declaration as ParseNode.InterfaceDeclaration;
  const frame = new Map<string, TypeRecord>();
  for (const p of [...(primary.TypeParameters?.TypeParameterList ?? []), ...(node.TypeParameters?.Captures ?? [])]) {
    frame.set(p.BindingIdentifier.name, { Kind: 'parameter', Name: p.BindingIdentifier.name } as TypeRecord);
  }
  let structure: TypeRecord | null = null;
  let types: Map<ParseNode, TypeRecord>;
  pushTypeParameterFrame(frame);
  try {
    types = Q(yield* PartialPatternTypes(node));
    Q(yield* Evaluate_RuntimeTypesBindingDeclaration({ ...node, Partial: false, TypeParameters: null }, false,
      (type) => {
        if (type.Kind === 'nominal') structure = type.Structure ?? null;
      }));
  } finally {
    popTypeParameterFrame();
  }
  const parts = RuntimePartialContributions(existing.TypeRecord.DeclarationIdentity ?? primary);
  if (parts.some((part) => part.Declaration === node)) return undefined;
  const contribution = { Declaration: node, Structure: () => structure, Resolve: (type: ParseNode) => types.get(type) ?? null };
  partialTypeContexts.set(contribution, currentPartialTypeContext());
  parts.push(contribution);
  const updates: { record: TypeRecord, merged: TypeRecord }[] = [];
  let conflict: string | undefined;
  for (const record of NominalRecordsOf(primary)) {
    if (record.Kind !== 'nominal' || record.DeclarationIdentity !== existing.TypeRecord.DeclarationIdentity) continue;
    const merged = MergePartialStructures(record, parts, (key) => {
      conflict ??= key;
    });
    updates.push({ record, merged });
  }
  if (conflict) {
    parts.pop();
    return Throw.TypeError('$1 is already declared on this interface', Value(conflict));
  }
  for (const { record, merged } of updates) Object.assign(record, merged);
  return undefined;
}

function* ApplyPartialClass(extension: PartialClassExtension, primary: ParseNode.ClassDeclaration, ctor: Value,
  args: readonly (TypeRecord | number)[]): PlainEvaluator<void> {
  const context = surroundingAgent.runningExecutionContext;
  const priorEnvironment = context.LexicalEnvironment;
  const priorPrivate = context.PrivateEnvironment;
  context.LexicalEnvironment = extension.environment;
  context.PrivateEnvironment = extension.privateEnvironment;
  const frame = new Map<string, TypeRecord>();
  (primary.TypeParameters?.TypeParameterList ?? []).forEach((p, i) => {
    const a = args[i];
    frame.set(p.BindingIdentifier.name, typeof a === 'number' ? { Kind: 'literal', Value: Value(a), Base: builtinTypeRecord('uint32')! } : a);
  });
  pushTypeParameterFrame(frame);
  try {
    if (extension.node.TypeParameters) {
      const selected = Q(yield* SelectClassCase(primary as never, [extension.node] as never, args));
      if (!selected) return undefined;
      for (const [name, type] of selected.Frame) frame.set(name, type);
    }
    const published = PublishedClassTypeOf(primary);
    const completed = LookupClassType(ctor as object);
    BindPartialClassSelf(frame, extension.node, completed && isTypeObject(completed) ? completed.TypeRecord : {
      ...(published?.Kind === 'nominal' ? published : {}),
      Kind: 'nominal', Declaration: primary, DeclarationIdentity: ClassFamilyIdentityOf(ctor),
      Arguments: args, Constructor: ctor, Base: RuntimeClassBaseOf(ctor),
    });
    Q(yield* PartialClassMergeEvaluation(ctor as never, extension.node.ClassTail));
  } finally {
    popTypeParameterFrame();
    context.LexicalEnvironment = priorEnvironment;
    context.PrivateEnvironment = priorPrivate;
  }
}

function* RegisterPartialClassStructure(primary: ParseNode.ClassDeclaration, node: ParseNode.ClassDeclaration, family?: Value): PlainEvaluator<void> {
  const frame = new Map<string, TypeRecord>();
  for (const parameter of [...(primary.TypeParameters?.TypeParameterList ?? []), ...(node.TypeParameters?.Captures ?? [])]) {
    frame.set(parameter.BindingIdentifier.name, { Kind: 'parameter', Name: parameter.BindingIdentifier.name });
  }
  pushTypeParameterFrame(frame);
  let types: Map<ParseNode, TypeRecord>;
  try {
    types = Q(yield* PartialPatternTypes(node));
  } finally {
    popTypeParameterFrame();
  }
  const published = PublishedClassTypeOf(node);
  if (published?.Kind !== 'nominal') return undefined;
  const parts = RuntimePartialContributions(family ? ClassFamilyIdentityOf(family) : primary);
  if (!parts.some((part) => part.Declaration === node)) {
    const contribution = { Declaration: node, Structure: () => published.Structure ?? null, Resolve: (type: ParseNode) => types.get(type) ?? null };
    partialTypeContexts.set(contribution, currentPartialTypeContext());
    parts.push(contribution);
  }
  const updates: { record: TypeRecord, merged: TypeRecord }[] = [];
  let conflict: string | undefined;
  for (const record of NominalRecordsOf(primary)) {
    if (family && (record.Kind !== 'nominal' || record.DeclarationIdentity !== ClassFamilyIdentityOf(family))) continue;
    updates.push({ record, merged: MergePartialStructures(record, parts, (key) => {
      conflict ??= key;
    }) });
  }
  if (conflict) return Throw.TypeError('$1 is already declared on this class', Value(conflict));
  for (const { record, merged } of updates) Object.assign(record, merged);
  return undefined;
}

/** #sec-partial-classes: extend existing applications and every later one. */
export function* RegisterPartialClass(ctor: Value, node: ParseNode.ClassDeclaration): PlainEvaluator<void> {
  const declaration = GenericClassDeclarationOf(ctor);
  const extension = { node, environment: surroundingAgent.runningExecutionContext.LexicalEnvironment,
    privateEnvironment: surroundingAgent.runningExecutionContext.PrivateEnvironment };
  if (!declaration) {
    const type = LookupClassType(ctor as object);
    if (type && isTypeObject(type) && type.TypeRecord.Kind === 'nominal' && type.TypeRecord.Declaration.type === 'ClassDeclaration') {
      Q(yield* ApplyPartialClass(extension, type.TypeRecord.Declaration as ParseNode.ClassDeclaration, ctor, type.TypeRecord.Arguments));
      Q(yield* RegisterPartialClassStructure(type.TypeRecord.Declaration as ParseNode.ClassDeclaration, node));
    } else {
      Q(yield* PartialClassMergeEvaluation(ctor as never, node.ClassTail));
    }
    return undefined;
  }
  const extensions = partialClassExtensions.get(ClassFamilyOf(ctor)) ?? [];
  if (extensions.some((entry) => entry.node === node && entry.environment === extension.environment)) return undefined;
  for (const specialized of classSpecializations.get(ClassFamilyOf(ctor))?.values() ?? []) {
    const type = LookupClassType(specialized);
    if (type && isTypeObject(type) && type.TypeRecord.Kind === 'nominal') {
      Q(yield* ApplyPartialClass(extension, declaration, specialized, type.TypeRecord.Arguments));
    }
  }
  Q(yield* RegisterPartialClassStructure(declaration, node, ClassFamilyOf(ctor)));
  extensions.push(extension);
  partialClassExtensions.set(ClassFamilyOf(ctor), extensions);
  return undefined;
}

/** One specialization per evaluated family and ordered argument list. */
const classSpecializations = new WeakMap<Value, Map<string, Value>>();
const classFamilies = new WeakMap<Value, Value>();

const classFamilyIdentities = new WeakMap<Value, object>();
const classFamilyConstructors = new WeakMap<object, Value>();
const classBindingIdentities = new WeakMap<object, object>();
const lexicalClassFamilies = new WeakMap<EnvironmentRecord, Map<ParseNode, Value>>();

/** Find this declaration's evaluated family without reading a program binding. */
export function LexicalClassFamily(declaration: ParseNode, environment: EnvironmentRecord): Value | undefined {
  for (let scope: EnvironmentRecord | null = environment; scope; scope = scope.OuterEnv) {
    const family = lexicalClassFamilies.get(scope)?.get(declaration);
    if (family) return family;
  }
  return undefined;
}

function registerLexicalClassFamily(declaration: ParseNode, environment: EnvironmentRecord, constructor: Value): void {
  let declarations = lexicalClassFamilies.get(environment);
  if (!declarations) lexicalClassFamilies.set(environment, declarations = new Map());
  declarations.set(declaration, constructor);
}

/** Publish only a successfully initialized immutable class-expression binding.
 * This is its own creation dependency, not a type chosen from a tested instance.
 */
export function RetainClassExpressionBinding(reference: ReferenceRecord, initializer: ParseNode): void {
  if (!(reference.Base instanceof EnvironmentRecord) || !(reference.ReferencedName instanceof JSStringValue)) return;
  let source = initializer;
  while (source.type === 'ParenthesizedExpression') source = source.Expression;
  if (source.type !== 'ClassExpression') return;
  const binding = RefBindingHolder(reference.Base, reference.ReferencedName)?.bindings.get(reference.ReferencedName);
  if (!binding?.initialized || binding.mutable !== false || binding.indirect || binding.refLocation || !binding.value) return;
  const object = LookupClassType(binding.value);
  if (!isTypeObject(object) || object.TypeRecord.Kind !== 'nominal' || object.TypeRecord.Declaration !== source) return;
  registerLexicalClassFamily(source, reference.Base, ClassFamilyOf(binding.value));
}

/** A forward type and the class which later initializes its binding agree. */
export function ClassDeclarationIdentity(environment: EnvironmentRecord, name: string): object | undefined {
  const binding = DeclarativeBindingIdentity(environment, Value(name));
  return binding && (classBindingIdentities.get(binding) ?? binding);
}

export function ClassFamilyConstructorOf(identity: object): Value | undefined {
  return classFamilyConstructors.get(identity);
}

export function ClassFamilyIdentityOf(ctor: Value): object {
  const family = ClassFamilyOf(ctor);
  return classFamilyIdentities.get(family) ?? family;
}

/** The evaluated family shared by its declaration and concrete constructors. */
export function ClassFamilyOf(ctor: Value): Value {
  return classFamilies.get(ctor) ?? ctor;
}

// Exact in-progress applications allow recursive self references without
// conflating another argument list or another evaluation of the same syntax.
// ClassDefinitionEvaluation records the fresh constructor before static fields
// run; neither source text nor the most recently evaluated declaration is a key.
const specializationsInProgress = new WeakMap<Value, Map<string, { declaration: ParseNode.ClassDeclaration, ctor?: Value }>>();

/**
 * Create the specialization for an application, whatever named it.
 *
 * `SpecializedClassConstructor` only FINDS one, and an annotation that missed
 * fell back to the declaration's constructor - so `let _g_: G.<4>;` alone gave a
 * different type than `new G.<4>()` did, and writing a construction first changed
 * the answer. The application is named either way; what named it should not
 * decide what it is.
 *
 * The class body is evaluated here, so a static block runs when a type is first
 * NAMED rather than first constructed. That is one more occasion of an effect
 * that already happens per specialization - a static block, a static field and a
 * computed key each run once per distinct application today - and it replaces an
 * order-dependent number of occasions with one a reader can count.
 *
 * Answers *undefined* for a variadic parameter list, where binding is the
 * engine's rather than positional, and for a declaration already in progress.
 */
/* eslint-disable-next-line no-unused-vars */
export function* MaterializeSpecialization(
  declaration: ParseNode.ClassDeclaration,
  argRecords: readonly (TypeRecord | number)[],
  declarationConstructor?: Value,
): ValueEvaluator {
  if (!declarationConstructor) return undefined as never;
  const family = ClassFamilyOf(declarationConstructor);
  const captured = classTypeContexts.get(family);
  if (!captured) return undefined as never;
  return yield* InCapturedTypeContext(captured, () => MaterializeClassApplication(declaration, argRecords, family));
}

function* MaterializeClassApplication(declaration: ParseNode.ClassDeclaration,
  argRecords: readonly (TypeRecord | number)[], family: Value): ValueEvaluator {
  const params = declaration.TypeParameters?.TypeParameterList ?? [];
  // Only a CLASS is specialized by evaluating a body. A generic INTERFACE
  // reaches this same annotation arm and has no |ClassTail|, so it has nothing
  // to evaluate and takes the record it had.
  // An argument that is still a PARAMETER names no particular application.
  // `Box.<T>` written inside a generic function has `T` unbound until the
  // function is applied, and specializing on it would build one class for a
  // value the program has not chosen yet.
  const unbound = argRecords.some((a) => typeof a !== 'number'
    && ((a as { Kind?: string }).Kind === 'parameter' || (a as { Kind?: string }).Kind === 'deferred'));
  if (declaration.ClassTail === undefined
    || unbound
    || params.some((q) => (q as { IsVariadic?: boolean }).IsVariadic === true)
    || params.length !== argRecords.length) {
    return undefined as never;
  }
  const frame = new Map<string, TypeRecord>();
  const key: string[] = [];
  for (let i = 0; i < argRecords.length; i += 1) {
    const param = params[i];
    const name = (param as { BindingIdentifier?: { name?: string } }).BindingIdentifier?.name;
    const record = argRecords[i];
    if (name) {
      Q(yield* BindTypeParameterTyped(frame, name, record as TypeRecord, param));
    }
    key.push(specializationKeyOf(record as never));
  }
  return yield* SpecializeFromFrame(declaration, frame, argRecords, key.join(','), family);
}

/**
 * proposal-runtime-types #sec-constructing-a-generic-class: the DECLARATION of a generic class,
 * where _ctor_ is that declaration's own constructor and not one of its
 * specializations; undefined for anything else.
 *
 * A specialization is a fresh class object with its own [[Arguments]]; the
 * declaration's constructor carries the record with none. It is the declaration
 * whose [[Construct]] has no body that can run - `T` is bound in no frame there
 * - so it is the declaration that resolves a specialization and constructs that.
 * A non-generic class is its own Type Object with no type parameters and is not
 * this; a generic INTERFACE has no |ClassTail| and is not constructible at all.
 */
// Defaults are evaluated in the class declaration's scope, including for a
// built-in default constructor that has no ECMAScript [[Environment]] slot.
const classTypeEnvironments = new WeakMap<Value, EnvironmentRecord>();
const classTypeContexts = new WeakMap<Value, CapturedTypeContext>();
export function RegisterClassTypeEnvironment(ctor: Value, environment: EnvironmentRecord,
  privateEnvironment = surroundingAgent.runningExecutionContext.PrivateEnvironment,
  application: { family?: Value, key?: string, declaration?: ParseNode.ClassDeclaration | ParseNode.ClassExpression } = {}): void {
  const { family, key: applicationKey, declaration } = application;
  classTypeEnvironments.set(ctor, environment);
  classFamilies.set(ctor, family ?? ctor);
  const name = declaration?.BindingIdentifier?.name;
  const outerIdentity = declaration?.type === 'ClassDeclaration' && name && environment.OuterEnv
    ? ClassDeclarationIdentity(environment.OuterEnv, name) : undefined;
  const identity = family ? ClassFamilyIdentityOf(family) : outerIdentity ?? ctor;
  classFamilyIdentities.set(ctor, identity);
  if (!family) classFamilyConstructors.set(identity, ctor);
  // A declaration template is instantiated per lexical activation. Keep this
  // association even if its mutable source binding is subsequently assigned.
  // Specializations must not replace the family's entry. An expression owns
  // its fresh inner class scope; its outer const binding is published only
  // after successful initialization by RetainClassExpressionBinding.
  if (!family && declaration) {
    registerLexicalClassFamily(declaration, environment, ctor);
    if (declaration.type === 'ClassDeclaration' && environment.OuterEnv) {
      registerLexicalClassFamily(declaration, environment.OuterEnv, ctor);
    }
  }
  const inner = name && DeclarativeBindingIdentity(environment, Value(name));
  if (inner) classBindingIdentities.set(inner, identity);
  const progress = family && applicationKey !== undefined && specializationsInProgress.get(family)?.get(applicationKey);
  if (progress) progress.ctor = ctor;
  const context = surroundingAgent.runningExecutionContext;
  classTypeContexts.set(ctor, {
    Environment: environment, PrivateEnvironment: privateEnvironment,
    TypeParameterFrame: currentTypeParameterFrame(), Realm: context.Realm, ScriptOrModule: context.ScriptOrModule,
  });
}
/** The actual class activation owns normalization of inferred arguments too. */
export function ClassTypeContextOf(ctor: Value): CapturedTypeContext | undefined {
  return classTypeContexts.get(ctor);
}

export function ClassTypeEnvironmentOf(ctor: Value): EnvironmentRecord | undefined {
  return classTypeEnvironments.get(ctor) ?? (ctor as { Environment?: EnvironmentRecord }).Environment;
}

/** The evaluated superclass retains its actual interface binding instances. */
export function RuntimeClassBaseOf(ctor: Value): TypeRecord | undefined {
  const parent = (ctor as { Prototype?: Value }).Prototype;
  if (!(parent instanceof ObjectValue)) return undefined;
  const type = LookupClassType(parent);
  return isTypeObject(type) ? type.TypeRecord : undefined;
}

/** An open target cannot read its interface binding until this class is applied. */
function classInterfaceTargetIsOpen(target: ParseNode.Type,
  owner: ParseNode.ClassDeclaration | ParseNode.ClassExpression): boolean {
  if (!owner.TypeParameters?.TypeParameterList.length) return false;
  return LexicalFreeReferences(target).some((reference) => {
    const binding = ResolveBindingDeclaration(reference, reference.name);
    if (binding?.kind === 'type-parameter' && binding.node === owner) return true;
    // A bare self type in the clause injects the class's own parameters, even
    // though none of their names appears in the written target.
    const typeReference = reference.parent?.type === 'TypeName' ? reference.parent.parent : undefined;
    return InjectedClassOf(typeReference)?.classNode === owner;
  });
}

/** Read declaration evidence in the evaluated class's own captured context. */
function* declaredClassEvidence(node: ParseNode.ClassDeclaration | ParseNode.ClassExpression, ctor: Value,
  application?: TypeRecord, seen = new Set<Value>()): PlainEvaluator<{
    Properties: Extract<TypeRecord, { Kind: 'object' }>['Properties'],
    Fields: readonly (string | SymbolValue)[],
    Operators: ReadonlyMap<string, TypeRecord>,
    Call: TypeRecord | 'noncallable' | null,
  }> {
  const empty = { Properties: [], Fields: [], Operators: new Map(), Call: null };
  if (seen.has(ctor)) return empty;
  seen.add(ctor);
  const declared = DeclaredClassContractOf(node);
  if (!declared) return empty;
  const captured = classTypeContexts.get(ctor);
  const read = function* () {
    const bindings = currentTypeParameterFrame() ?? new Map();
    const instantiate = (type: TypeRecord): TypeRecord => InstantiateCheckedBindings(new Map([
      ['contract', substituteFreeTypeParameters(type, currentTypeParameterFrame() ?? new Map())!],
    ]), surroundingAgent.runningExecutionContext.LexicalEnvironment, application).get('contract')!;
    const shape = instantiate(declared.Structure);
    Assert(shape.Kind === 'object');
    const own = { Properties: shape.Properties, Fields: declared.Fields,
      Operators: new Map([...declared.Operators].map(([key, signature]) => [key, instantiate(signature)])),
      Call: declared.Call && declared.Call !== 'noncallable' ? instantiate(declared.Call) : declared.Call };
    const primary = GenericClassDeclarationOf(ClassFamilyOf(ctor)) ?? node;
    const partialApplication: Extract<TypeRecord, { Kind: 'nominal' }> = { Kind: 'nominal', Declaration: primary,
      DeclarationIdentity: ClassFamilyIdentityOf(ctor), Constructor: ctor, Arguments:
      (primary.TypeParameters?.TypeParameterList ?? []).map((p) => bindings.get(p.BindingIdentifier.name) ?? anyType) };
    for (const part of RuntimePartialContributions(ClassFamilyIdentityOf(ctor))) {
      const bound = PartialBindings(partialApplication, part);
      const contribution = DeclaredClassContractOf(part.Declaration);
      if (!bound || !contribution) continue;
      const readPart = function* () {
        const closeSelf = (type: TypeRecord): TypeRecord => instantiate(instantiatePartialClassSelf(type, part.Declaration, partialApplication)!);
        const shape = closeSelf(contribution.Structure);
        Assert(shape.Kind === 'object');
        return { shape, operators: new Map([...contribution.Operators].map(([key, type]) => [key, closeSelf(type)])) };
      };
      // instantiate reads the active context and its free bindings.
      const added = Q(yield* InCapturedTypeContext(partialTypeContexts.get(part) ?? captured!, readPart, bound));
      own.Properties = [...own.Properties, ...added.shape.Properties];
      own.Fields = [...own.Fields, ...contribution.Fields];
      own.Operators = new Map([...own.Operators, ...added.operators]);
    }
    // Static symbol keys are symbolic checking identities. The evaluated
    // declaration registry supplies actual String/Symbol keys, including
    // computed keys, without rerunning key expressions or reading getters.
    const evaluated = OwnClassMemberContractsOf(ctor).filter((member) => !member.static);
    const properties = new Map(own.Properties.filter((property) => typeof property.key === 'string')
      .map((property) => [property.key as string | SymbolValue, property]));
    const fields = new Set<string | SymbolValue>(own.Fields.filter((key) => typeof key === 'string'));
    for (const key of new Set(evaluated.map((member) => member.key))) {
      const members = evaluated.filter((member) => member.key === key);
      const field = members.find((member) => member.kind === 'field');
      if (field) {
        fields.add(key);
        // A field declaration's runtime contract has its evaluated key and
        // substituted storage type, even before any instance is constructed.
        const checked = field.Declaration && DeclaredClassFieldTypeOf(field.Declaration);
        const type = field.type ?? checked;
        properties.set(key, { ...properties.get(key), key, type: type ? instantiate(type) : anyType,
          optional: false, readonly: !!field.readonly, ...(!field.type ? { writeType: anyType } : {}) });
        continue;
      }
      if (properties.has(key)) continue;
      const method = members.find((member) => member.kind === 'method');
      if (method) {
        const untyped = { Parameters: [], Return: null, Untyped: true, ThisType: SelfThisTypeRecord };
        const type = method.type ? instantiate(method.type) : undefined;
        properties.set(key, { key, type: type?.Kind === 'function' ? { ...type,
          Signatures: type.Signatures.map((signature) => ({ ...signature, ThisType: SelfThisTypeRecord })) }
          : { Kind: 'function', Signatures: [untyped] },
        optional: false, readonly: false });
        continue;
      }
      const getter = members.find((member) => member.kind === 'get');
      const setter = members.find((member) => member.kind === 'set');
      const read = getter?.type?.Kind === 'function' ? getter.type.Signatures[0]?.Return : undefined;
      const write = setter?.type?.Kind === 'function' ? setter.type.Signatures[0]?.Parameters[0]?.Type : undefined;
      properties.set(key, { key, type: getter ? read ? instantiate(read) : anyType : builtinTypeRecord('undefined')!,
        optional: false, readonly: !setter, ...(setter ? { writeType: write ? instantiate(write) : anyType } : {}) });
    }
    own.Properties = [...properties.values()];
    own.Fields = [...fields];
    const base = RuntimeClassBaseOf(ctor);
    if (base?.Kind !== 'nominal' || !base.Constructor) return own;
    const baseCtor = base.Constructor as Value;
    const baseNode = selectedDeclarations.get(baseCtor as object) ?? base.Declaration;
    if (baseNode.type !== 'ClassDeclaration' && baseNode.type !== 'ClassExpression') return own;
    const inherited = Q(yield* declaredClassEvidence(baseNode, baseCtor, undefined, seen));
    // Own storage outranks prototype declarations, including inherited fields.
    const merged = new Map(inherited.Properties.map((property) => [property.key, property]));
    for (const property of own.Properties) {
      if (!inherited.Fields.includes(property.key) || own.Fields.includes(property.key)) merged.set(property.key, property);
    }
    return { ...own, Properties: [...merged.values()], Fields: [...new Set([...inherited.Fields, ...own.Fields])],
      Operators: new Map([...inherited.Operators, ...own.Operators]) };
  };
  return captured ? yield* InCapturedTypeContext(captured, read) : yield* read();
}

/** Verify the claim from declared contracts, never from the claim itself. */
function* verifyImplementedInterface(node: ParseNode.ClassDeclaration | ParseNode.ClassExpression,
  ctor: Value, target: TypeRecord, application?: TypeRecord): PlainEvaluator<void> {
  if (target.Kind !== 'nominal' || target.Declaration.type !== 'InterfaceDeclaration') {
    return Throw.TypeError('$1', Value('an implements target must denote an interface'));
  }
  const evidence = Q(yield* declaredClassEvidence(node, ctor, application));
  const shape = target.Structure && SubstituteTypeArguments(target.Structure, target.Declaration, target.Arguments);
  const fail = (member: string) => Throw.TypeError('$1 does not implement $2: $3',
    Value(node.BindingIdentifier?.name ?? 'the class'), Value(displayType(target)), Value(member));
  if (shape?.Kind === 'function') {
    if (evidence.Call === 'noncallable') return fail('instances are not callable');
    if (evidence.Call && !IsAssignable(evidence.Call, shape)) return fail('incompatible call signature');
  }
  if (shape?.Kind === 'object') {
    for (const wanted of shape.Properties) {
      const actual = evidence.Properties.find((property) => property.key === wanted.key);
      if (!actual) {
        if (!wanted.optional) return fail(`missing member ${String(wanted.key)}`);
      } else if (!DeclaredMemberImplements(actual, wanted)) {
        return fail(`incompatible member ${String(wanted.key)}`);
      }
    }
    for (const key of evidence.Fields) {
      if (shape.Properties.some((property) => property.key === key)) continue;
      const field = evidence.Properties.find((property) => property.key === key);
      if (!field) continue;
      for (const index of shape.IndexSignatures) {
        if (keyAdmittedBy(key, index.Key) && !IsAssignable(field.type, index.Value)) return fail(`incompatible field ${String(key)}`);
      }
    }
  }
  // Operators have no property slot. Resolve their signatures in the
  // interface's declaration context, retaining ref/rest/default capabilities.
  const verifyOperators = function* (declaration: ParseNode.InterfaceDeclaration): PlainEvaluator<void> {
    for (const member of declaration.InterfaceMemberList) {
      if (member.type !== 'OperatorDefinition') continue;
      const key = operatorTableKey(member);
      const actual = evidence.Operators.get(key);
      if (!actual) return fail(`missing operator ${key}`);
      if (!member.TypeAnnotation && !(member.FormalParameters ?? []).some((p) => 'TypeAnnotation' in p && p.TypeAnnotation)) continue;
      const Parameters = [];
      for (const formal of member.FormalParameters ?? []) {
        const p = formal as ParseNode.SingleNameBinding & { Ref?: boolean, Optional?: boolean };
        const type = p.TypeAnnotation ? Q(yield* TypeNodeToTypeRecord(p.TypeAnnotation.Type)) : anyType;
        Parameters.push(parameter(type, { Name: p.BindingIdentifier?.name ?? '', Ref: !!p.Ref,
          Optional: !!p.Optional || !!p.Initializer, DeclaredDefault: !!p.Initializer, Rest: formal.type === 'BindingRestElement' }));
      }
      const Return = member.TypeAnnotation ? Q(yield* TypeNodeToTypeRecord(member.TypeAnnotation.Type)) : anyType;
      if (!IsAssignable(actual, { Kind: 'function', Signatures: [{ Parameters, Return }] })) return fail(`incompatible operator ${key}`);
    }
    return undefined;
  };
  const captured = InterfaceTypeContextOf(target);
  Assert(captured !== undefined);
  const bindings = new Map<string, TypeRecord>();
  (target.Declaration.TypeParameters?.TypeParameterList ?? []).forEach((p, i) => {
    const argument = target.Arguments[i];
    if (argument !== undefined) bindings.set(p.BindingIdentifier.name, typeof argument === 'number'
      ? { Kind: 'literal', Value: Value(argument), Base: builtinTypeRecord('number')! } : argument);
  });
  Q(yield* InCapturedTypeContext(captured, () => verifyOperators(target.Declaration as ParseNode.InterfaceDeclaration), bindings));
  for (const part of RuntimePartialContributions(target.DeclarationIdentity ?? target.Declaration)) {
    if (part.Declaration.type !== 'InterfaceDeclaration') continue;
    const bound = PartialBindings(target, part);
    if (bound) {
      Q(yield* InCapturedTypeContext(partialTypeContexts.get(part) ?? captured,
        () => verifyOperators(part.Declaration as ParseNode.InterfaceDeclaration), bound));
    }
  }
  return undefined;
}

/** Resolve actual interface bindings when publishing a class's runtime contract. */
export function* ResolveImplementedInterfaces(node: ParseNode.ClassDeclaration | ParseNode.ClassExpression,
  ctor: Value, args?: readonly (TypeRecord | number)[]): PlainEvaluator<readonly TypeRecord[] | undefined> {
  if (!node.ClassTail.ImplementsClause?.length) return undefined;
  const captured = classTypeContexts.get(ctor);
  // The selected case's captures and outer generic bindings belong to this
  // constructor, not to the caller that happens to request its contract.
  return captured
    ? yield* InCapturedTypeContext(captured, () => resolveImplementedInterfacesInContext(node, ctor, args))
    : yield* resolveImplementedInterfacesInContext(node, ctor, args);
}

function* resolveImplementedInterfacesInContext(node: ParseNode.ClassDeclaration | ParseNode.ClassExpression,
  ctor: Value, args?: readonly (TypeRecord | number)[]): PlainEvaluator<readonly TypeRecord[]> {
  const targets = node.ClassTail.ImplementsClause!;
  const context = surroundingAgent.runningExecutionContext;
  const outer = context.LexicalEnvironment;
  context.LexicalEnvironment = ClassTypeEnvironmentOf(ctor) ?? outer;
  const frame = new Map<string, TypeRecord>();
  (node.TypeParameters?.TypeParameterList ?? []).forEach((parameter, i) => {
    const argument = args?.[i];
    frame.set(parameter.BindingIdentifier.name, typeof argument === 'number'
      ? { Kind: 'literal', Value: Value(argument), Base: builtinTypeRecord('uint32')! }
      : argument ?? { Kind: 'parameter', Name: parameter.BindingIdentifier.name, Declaration: parameter } as TypeRecord);
  });
  const interfaces: TypeRecord[] = [];
  let self: TypeRecord | undefined;
  if (node.BindingIdentifier) {
    const published = PublishedClassTypeOf(node);
    self = {
      ...(published?.Kind === 'nominal' ? published : {}),
      Kind: 'nominal', Declaration: node, Constructor: ctor,
      DeclarationIdentity: ClassFamilyIdentityOf(ctor),
      Arguments: (node.TypeParameters?.TypeParameterList ?? []).map((p) => frame.get(p.BindingIdentifier.name)!),
      Implements: interfaces,
      Base: RuntimeClassBaseOf(ctor),
    };
    frame.set(node.BindingIdentifier.name, self);
  }
  pushTypeParameterFrame(frame);
  try {
    const resolve = function* (): PlainEvaluator<readonly TypeRecord[]> {
      for (const target of targets) {
        // Publishing a family is not an application, even under a same-named
        // enclosing parameter frame. Closed targets retain their ordinary read;
        // dependent targets retain source obligations, not completed contracts.
        if (args === undefined && classInterfaceTargetIsOpen(target, node)) continue;
        const resolved = Q(yield* TypeNodeToTypeRecord(target));
        if (resolved.Kind !== 'nominal' || resolved.Declaration.type !== 'InterfaceDeclaration') {
          return Throw.TypeError('$1', Value('an implements target must denote an interface'));
        }
        interfaces.push(resolved);
      }
      // Resolve targets first so recursive member signatures can refer to the
      // whole local graph. Presence/capability is always proved by declarations,
      // and no relation is published or cached until every check succeeds.
      if (args !== undefined || !node.TypeParameters?.TypeParameterList.length) {
        for (const target of interfaces) {
          Q(yield* verifyImplementedInterface(node, ctor, target, self));
        }
      }
      return interfaces;
    };
    return self ? yield* WithClassInterfaceChecks(self, resolve) : yield* resolve();
  } finally {
    popTypeParameterFrame();
    context.LexicalEnvironment = outer;
  }
}

export function GenericClassDeclarationOf(ctor: Value): ParseNode.ClassDeclaration | undefined {
  const typeObject = LookupClassType(ctor);
  if (typeObject === undefined) {
    return undefined;
  }
  const record = (typeObject as unknown as { TypeRecord?: TypeRecord }).TypeRecord;
  if (!record || record.Kind !== 'nominal') {
    return undefined;
  }
  if (((record as { Arguments?: readonly unknown[] }).Arguments?.length ?? 0) > 0) {
    return undefined;
  }
  const declaration = record.Declaration as ParseNode.ClassDeclaration | undefined;
  const params = declaration?.TypeParameters?.TypeParameterList;
  if (!declaration || !params || params.length === 0 || declaration.ClassTail === undefined) {
    return undefined;
  }
  return declaration;
}

/**
 * proposal-runtime-types #sec-constructing-a-generic-class: the bindings a construction's
 * CONTEXTUAL type supplies before its arguments are looked at.
 *
 * #sec-contextual-types names the positions; generics.md "Inferring from the
 * expected type" says a parameter the arguments leave open takes what the
 * position requires. Here the context is read FIRST and a binding it fixes is
 * treated as an explicit one - fixed, with the arguments then checked against
 * it - because that is the only order under which the ordinary spelling
 * `const b: Box.<uint8> = new Box(1)` works: an untyped literal binds `number`
 * when it is looked at first, and `Box.<number>` is not a `Box.<uint8>`. Read
 * first, `T` is `uint8` and the literal takes it, exactly as `new Box.<uint8>(1)`.
 *
 * The context seeds only an instantiation of the constructed declaration (or a
 * union one of whose members is); an `any` argument is the family wildcard and
 * seeds nothing in its position; a parameter record is not yet a type. An
 * interface, a supertype, or a structural type contributes nothing - this
 * proposal's inference is positional.
 */
export function contextualBindingsFor(
  declaration: ParseNode.ClassDeclaration,
  params: readonly ParseNode.TypeParameter[],
  contextual: TypeRecord | null | undefined,
  familyIdentity?: object,
): Map<string, TypeRecord> | undefined {
  if (!contextual) {
    return undefined;
  }
  let candidate: TypeRecord | undefined;
  if (contextual.Kind === 'nominal' && contextual.Declaration === declaration) {
    candidate = contextual;
  } else if (contextual.Kind === 'union') {
    candidate = contextual.Members.find((m) => m.Kind === 'nominal' && m.Declaration === declaration);
  }
  if (!candidate || candidate.Kind !== 'nominal') {
    return undefined;
  }
  if (candidate.DeclarationIdentity !== undefined && familyIdentity !== undefined
    && candidate.DeclarationIdentity !== familyIdentity) return undefined;
  const args = (candidate as { Arguments?: readonly (TypeRecord | number)[] }).Arguments ?? [];
  if (args.length !== params.length) {
    return undefined;
  }
  const bound = new Map<string, TypeRecord>();
  for (let i = 0; i < params.length; i += 1) {
    const a = args[i];
    if (typeof a !== 'object' || a === null || a.Kind === 'any' || a.Kind === 'parameter') {
      continue;
    }
    const name = (params[i] as { BindingIdentifier?: { name?: string } }).BindingIdentifier?.name;
    if (name) {
      bound.set(name, a);
    }
  }
  return bound.size > 0 ? bound : undefined;
}

/**
 * proposal-runtime-types #sec-constructing-a-generic-class: the specialization a BARE
 * construction of a generic class constructs.
 *
 * The ladder: a binding the contextual type fixes, then one inferred from the
 * argument a constructor formal annotated with the parameter receives, then the
 * declared default (InferGenericBindings, the same core a generic call runs).
 * The bindings name an application, and MaterializeSpecialization builds or
 * finds it, so a bare construction and `new Box.<uint8>(1)` reach one class
 * object and one type. Answers undefined where no specialization can be
 * materialized (a variadic parameter list, a declaration in progress), and the
 * caller falls back to the declaration.
 */
export function* SpecializationForConstruction(
  declaration: ParseNode.ClassDeclaration,
  ctor: Value,
  args: readonly Value[],
): PlainEvaluator<Value | undefined> {
  const params = declaration.TypeParameters?.TypeParameterList ?? [];
  const formals = ((ctor as unknown as { FormalParameters?: readonly ParseNode[] }).FormalParameters) ?? [];
  // The contextual type is the CONSTRUCTION's own position, handed in by
  // EvaluateNew or the target-typed form (TakePendingCalleeContext); a
  // `Reflect.construct` has none. Read before the scope below changes.
  const preBound = contextualBindingsFor(declaration, params, TakePendingCalleeContext(), ClassFamilyIdentityOf(ctor));
  const family = ClassFamilyOf(ctor);
  const captured = classTypeContexts.get(family);
  if (!captured) return undefined;
  return yield* InCapturedTypeContext(captured, function* infer(): PlainEvaluator<Value | undefined> {
    const frame = Q(yield* InferGenericBindings(params, formals, args, preBound));
    const argRecords: TypeRecord[] = [];
    for (const param of params) {
      const name = (param as { BindingIdentifier?: { name?: string } }).BindingIdentifier?.name;
      const record = name ? frame.get(name) : undefined;
      if (!record) {
        return undefined;
      }
      argRecords.push(record);
    }
    return yield* MaterializeClassApplication(declaration, argRecords, family);
  });
}

/**
 * proposal-runtime-types #sec-constructing-a-generic-class: the specialization a generic class
 * names when written BARE in a type position - every parameter at its default -
 * built for `class S extends Box { }`, where the heritage is an expression
 * that evaluated to the declaration's constructor. A parameter with no default
 * is the naming TypeError the ladder gives an unreached parameter, since a
 * subclass of the open declaration would inherit a `v: T` that checks nothing.
 * No contextual type takes part: a heritage is not a position that
 * requires a type.
 */
export function* DefaultSpecializationOf(
  declaration: ParseNode.ClassDeclaration,
  ctor: Value,
): PlainEvaluator<Value | undefined> {
  const params = declaration.TypeParameters?.TypeParameterList ?? [];
  const family = ClassFamilyOf(ctor);
  const captured = classTypeContexts.get(family);
  if (!captured) return undefined;
  return yield* InCapturedTypeContext(captured, function* defaults(): PlainEvaluator<Value | undefined> {
    const frame = Q(yield* InferGenericBindings(params, [], [], undefined));
    const argRecords: TypeRecord[] = [];
    for (const param of params) {
      const name = (param as { BindingIdentifier?: { name?: string } }).BindingIdentifier?.name;
      const record = name ? frame.get(name) : undefined;
      if (!record) {
        return undefined;
      }
      argRecords.push(record);
    }
    return yield* MaterializeClassApplication(declaration, argRecords, family);
  });
}

/**
 * proposal-runtime-types #sec-constructing-a-generic-class: whether some object on _O_'s prototype
 * chain is the prototype of a SPECIALIZATION of _declaration_.
 *
 * A specialization is a fresh class object whose prototype chain does not pass
 * through the declaration's `prototype`, so the ordinary walk in
 * OrdinaryHasInstance answers *false* for `new Box.<uint8>(1) instanceof Box` -
 * and, once a bare construction yields a specialization, for `new Box(1)
 * instanceof Box`. The declaration is the FAMILY: `x instanceof Box` is true
 * when x is an instance of any specialization of Box, or of a class extending
 * one. Read from the specialization table rather than through a `constructor`
 * property, so no user getter is observed.
 */
export function* IsInstanceOfSomeSpecialization(family: Value, O: ObjectValue): PlainEvaluator<boolean> {
  const byArgs = classSpecializations.get(ClassFamilyOf(family));
  if (byArgs === undefined || byArgs.size === 0) {
    return false;
  }
  const prototypes = new Set<Value>();
  for (const ctor of byArgs.values()) {
    const proto = (ctor as unknown as { properties?: Map<unknown, { Value?: Value }> }).properties?.get(Value('prototype'))?.Value;
    if (proto instanceof ObjectValue) {
      prototypes.add(proto);
    }
  }
  let current: Value = Q(yield* O.GetPrototypeOf());
  while (current instanceof ObjectValue) {
    if (prototypes.has(current)) {
      return true;
    }
    current = Q(yield* current.GetPrototypeOf());
  }
  return false;
}

/**
 * #sec-specialization-lists: a class family's CASES - the class declarations in the
 * primary's own statement list, of the same name, whose list specializes the
 * family. A case anywhere else - another block, another module - is not the
 * family's: replacement is confined to the owning declaration group.
 */
function ClassCasesOf(declaration: ParseNode.ClassDeclaration): ParseNode.ClassDeclaration[] {
  const name = declaration.BindingIdentifier?.name;
  if (!name) return [];
  let holder = declaration as unknown as { type?: string, parent?: object };
  let container = holder.parent as { type?: string, parent?: object } | undefined;
  if (container?.type === 'ExportDeclaration') {
    holder = container;
    container = container.parent as typeof container;
  }
  if (!container) return [];
  const siblings = Object.values(container).find((v) => Array.isArray(v) && v.includes(holder)) as readonly unknown[] | undefined;
  if (!siblings) return [];
  const out: ParseNode.ClassDeclaration[] = [];
  for (const item of siblings) {
    const node = ((item as { type?: string }).type === 'ExportDeclaration' ? (item as { Declaration?: unknown }).Declaration : item) as
      { type?: string, BindingIdentifier?: { name?: string } | null, TypeParameters?: { ListKind?: string } | null } | undefined;
    if (node && node !== (declaration as unknown) && node.type === (declaration as { type: string }).type && node.BindingIdentifier?.name === name
      && node.TypeParameters && node.TypeParameters.ListKind !== 'parameters' && !IsPartialDeclaration(node)) {
      out.push(node as unknown as ParseNode.ClassDeclaration);
    }
  }
  return out;
}

/** The tail both entry points share, so one specialization is built by one path. */
function* SpecializeFromFrame(
  declaration: ParseNode.ClassDeclaration,
  frame: Map<string, TypeRecord>,
  argRecords: readonly (TypeRecord | number)[],
  cacheKey: string,
  family: Value,
): ValueEvaluator {
  let byArgs = classSpecializations.get(family);
  if (byArgs === undefined) {
    byArgs = new Map();
    classSpecializations.set(family, byArgs);
  }
  const cached = byArgs.get(cacheKey);
  if (cached !== undefined) {
    return cached as never;
  }
  // A SELF-REFERENCE from inside the body being evaluated: `Bx.<T>` written in
  // a static field initializer of `class Bx<T>`, reached while `Bx.<uint8>` is
  // being built with `T` bound to `uint8`, names the very class under
  // construction. Its cache entry is not written until the body finishes, so
  // without this it missed the cache and re-entered here, and
  // `classes/declared-zero`'s `static default = new Bx.<T>()` recursed. The
  // class evaluation records the constructor the inner binding holds,
  // and the same key means the same class.
  let progress = specializationsInProgress.get(family);
  const underWay = progress?.get(cacheKey);
  if (underWay !== undefined) {
    return underWay.ctor as never;
  }
  // Phase 5: the application selects its body - a case's, complete, or the
  // primary's - once per family and binding tuple (the cache above), and the
  // case's captures join the frame. Identity stays the family's.
  let body = declaration;
  let bodyFrame = frame;
  const cases = ClassCasesOf(declaration);
  if (cases.length > 0) {
    const selected = Q(yield* SelectClassCase(declaration as never, cases as never, argRecords));
    if (selected) {
      body = selected.Declaration as unknown as ParseNode.ClassDeclaration;
      bodyFrame = copyTypeParameterFrame(frame);
      for (const [name, bound] of selected.Frame) {
        const capture = body.TypeParameters?.Captures?.find((entry) => entry.BindingIdentifier.name === name);
        bindTypeParameter(bodyFrame, name, bound, capture);
      }
    }
  }
  pushTypeParameterFrame(bodyFrame);
  if (!progress) {
    progress = new Map();
    specializationsInProgress.set(family, progress);
  }
  progress.set(cacheKey, { declaration });
  // Keep recursive applications attached to this constructor until its
  // implemented-interface graph and layout have both been admitted.
  try {
    let specialized;
    try {
      const className = Value(declaration.BindingIdentifier?.name ?? '');
      specialized = EnsureCompletion(yield* ClassDefinitionEvaluation(
        body.ClassTail,
        className,
        className,
        // The declaration's own source text, so that the constructor this
        // evaluation creates can be matched back to the declaration while its
        // body is still running - the window in which `AssociateClassType`
        // below has not happened yet and `LookupClassType` answers nothing.
        (body as unknown as { sourceText?: string }).sourceText ?? '',
        [],
        true,
        family,
        cacheKey,
      ));
      if (specialized.Type === 'normal') {
        // Applicable partial members, including computed keys, belong to the
        // application being admitted. Evaluate them once while the constructor
        // is still in progress, before verifying its complete declaration graph.
        for (const extension of partialClassExtensions.get(family) ?? []) {
          Q(yield* ApplyPartialClass(extension, declaration, specialized.Value as Value, argRecords));
        }
      }
    } finally {
      popTypeParameterFrame();
    }
    if (specialized.Type !== 'normal') {
      return specialized as never;
    }
    const ctor = specialized.Value as Value;
    const published = PublishedClassTypeOf(body);
    let conflict: string | undefined;
    const record = MergePartialStructures({
      ...(published?.Kind === 'nominal' ? published : {}),
      Kind: 'nominal', Declaration: declaration as never, DeclarationIdentity: ClassFamilyIdentityOf(family), Arguments: argRecords, Constructor: ctor,
      Implements: Q(yield* ResolveImplementedInterfaces(body, ctor, argRecords)),
      Base: RuntimeClassBaseOf(ctor) ?? (published?.Kind === 'nominal' ? published.Base : undefined),
    } as TypeRecord, RuntimePartialContributions(ClassFamilyIdentityOf(family)), (key) => {
      conflict ??= key;
    });
    if (conflict) return Throw.TypeError('$1 is already declared on this class', Value(conflict));
    Q(yield* InstallTypeLayoutProperties(ctor as ObjectValue, record));
    AssociateClassType(ctor, GetTypeObject(record));
    byArgs.set(cacheKey, ctor);
    selectedDeclarations.set(ctor as object, body);
    if (body !== declaration) {
      caseBuiltConstructors.add(ctor as object);
    }
    return ctor as never;
  } finally {
    progress.delete(cacheKey);
    if (progress.size === 0) specializationsInProgress.delete(family);
  }
}

/**
 * A class's or an alias's CASES (#sec-specialization-lists): the declarations of the same kind
 * and name in its own statement list whose list specializes the family.
 */
export function FamilyCasesOf(declaration: ParseNode.ClassDeclaration | ParseNode.TypeAliasDeclaration): ParseNode.ClassDeclaration[] {
  return ClassCasesOf(declaration as ParseNode.ClassDeclaration);
}

/** Whether a class family has cases: its applications' layouts come from the selected body. */
export function HasClassCases(declaration: unknown): boolean {
  const d = declaration as ParseNode.ClassDeclaration | undefined;
  return !!d && d.type === 'ClassDeclaration' && ClassCasesOf(d).length > 0;
}

/**
 * The declaration whose body built each application's constructor - a case,
 * or the primary, so the selected declaration is
 * discoverable.
 */
const selectedDeclarations = new WeakMap<object, ParseNode.ClassDeclaration>();
/** The selected declaration of an application's constructor, as written: `Box<boolean>`, `Box<T: type>`. */
export function SelectedDeclarationOf(ctor: unknown): string | undefined {
  const d = ctor && typeof ctor === 'object' ? selectedDeclarations.get(ctor) : undefined;
  if (!d) return undefined;
  const list = (d.TypeParameters as { sourceText?: string } | null | undefined)?.sourceText ?? '';
  return `${d.BindingIdentifier?.name ?? ''}${list}`;
}

/** Constructors built from a CASE body; layout reads their own. */
const caseBuiltConstructors = new WeakSet<object>();
setCaseSpecializationLookup((declaration, args, constructor) => {
  const ctor = SpecializedClassConstructor(declaration, args, constructor as Value | undefined);
  return ctor !== undefined && caseBuiltConstructors.has(ctor as object) ? ctor : undefined;
});

export function SpecializedClassConstructor(
  declaration: unknown,
  argRecords: readonly (TypeRecord | number)[],
  constructor?: Value,
): Value | undefined {
  if (!constructor) return undefined;
  const family = ClassFamilyOf(constructor);
  if (GenericClassDeclarationOf(family) !== declaration) return undefined;
  const byArgs = classSpecializations.get(family);
  if (byArgs === undefined) {
    return undefined;
  }
  return byArgs.get(argRecords.map((a) => specializationKeyOf(a as never)).join(','));
}

function* SpecializeGenericClass(declaration: ParseNode.ClassDeclaration,
  node: ParseNode.TypeArgumentsExpression, ctor: Value): ValueEvaluator {
  const params = declaration.TypeParameters?.TypeParameterList ?? [];
  if (params.some((p) => p.IsVariadic) || node.TypeArguments.TypeArgumentList.some((a) => (a as { IsSpread?: boolean }).IsSpread)) {
    const exhausted = specializationDepthExhausted();
    if (exhausted) return exhausted;
  }
  const args: TypeRecord[] = [];
  const names: (string | undefined)[] = [];
  // Written arguments resolve in the caller. Defaults, constraints, selection
  // and class evaluation belong to the actual evaluated family below.
  for (const nodeArg of node.TypeArguments.TypeArgumentList) {
    const name = typeArgumentNameOf(nodeArg);
    const param = name === undefined ? params[args.length] : params.find((p) => p.BindingIdentifier.name === name);
    const asDeclaration = Q(yield* TypeArgumentAsDeclaration(nodeArg, param?.Arity ?? 0));
    let record = asDeclaration;
    if (!record) {
      record = Q(yield* TypeNodeToTypeRecord(nodeArg));
    }
    if ((nodeArg as { IsSpread?: boolean }).IsSpread) {
      const elements = spreadElementsOf(record);
      if (!elements) return Throw.TypeError('$1', Value('a spread class type argument must be a tuple or an array of stated extent'));
      args.push(...elements);
      names.push(...elements.map(() => undefined));
    } else {
      args.push(record);
      names.push(name);
    }
  }
  const family = ClassFamilyOf(ctor);
  const captured = classTypeContexts.get(family);
  if (!captured) return undefined as never;
  return yield* InCapturedTypeContext(captured, function* apply(): ValueEvaluator {
    const frame = new Map<string, TypeRecord>();
    const bound = Q(yield* BindTypeArgumentRecordsInto(params, args, names, frame, declaration.BindingIdentifier?.name ?? 'a class'));
    // A class's own `where` clauses hold of every specialization (round 5
    // follow-up, Q11): evaluated with each parameter bound to its argument,
    // as a function specialization's are.
    const clauses = (declaration.ClassTail as { WhereClauses?: readonly ParseNode.WhereClause[] | null }).WhereClauses;
    if (clauses?.length) {
      const context = surroundingAgent.runningExecutionContext;
      const outer = context.LexicalEnvironment;
      const scope = new DeclarativeEnvironmentRecord(outer);
      for (const parameter of params) {
        const name = parameter.BindingIdentifier.name;
        const binding = frame.get(name);
        if (!binding) continue;
        const value = Q(yield* TypeParameterValue(binding));
        X(scope.CreateImmutableBinding(Value(name), Value.true));
        X(scope.InitializeBinding(Value(name), value));
      }
      context.LexicalEnvironment = scope;
      try {
        for (const clause of clauses) {
          const verdict = Q(yield* GetValue(Q(yield* Evaluate(clause.RefinementPredicate as never))));
          if (verdict === Value.false || verdict === Value.undefined || verdict === Value.null) {
            return Throw.TypeError('a $1 clause is not satisfied by this application', Value('where'));
          }
        }
      } finally {
        context.LexicalEnvironment = outer;
      }
    }
    return yield* SpecializeFromFrame(declaration, frame, bound, bound.map(specializationKeyOf).join(','), family);
  });
}

/**
 * The Type Object a parameterized primitive family denotes when applied, or
 * *undefined* where the base does not name one.
 *
 * `builtinTypeRecord` already carries the rule this has to honour: its arm for
 * these families answers a record when arguments are present and *null* when
 * the name is bare, so the bare name cannot be produced here by construction.
 */
function* FamilyApplicationFor(node: ParseNode.TypeArgumentsExpression): PlainEvaluator<unknown> {
  const name = (node.Expression as unknown as { name?: string }).name;
  if (name !== 'int' && name !== 'uint' && name !== 'vector' && name !== 'rational' && name !== 'complex') {
    return undefined;
  }
  const args: (TypeRecord | number)[] = [];
  for (const argument of node.TypeArguments.TypeArgumentList ?? []) {
    const resolved = Q(yield* TypeNodeToTypeRecord(argument as ParseNode.Type));
    // Through the same reading type position uses: a numeric argument is a
    // WIDTH or a LANE COUNT, so `int.<8>` carries the number 8 rather than a
    // literal type of 8. Building the record with the literal type instead
    // produces a family record with no layout - it resolves, and then has no
    // byteLength and interns unequal to `int8`.
    args.push(toNumericArgument(resolved as TypeRecord));
  }
  const bound = bindIntrinsicArguments(name, args, node.TypeArguments.TypeArgumentList.map(typeArgumentNameOf))!;
  if ('Error' in bound) return Throw.TypeError('$1', Value(bound.Error));
  const record = builtinTypeRecord(name, bound.Arguments);
  if (record === null) {
    return undefined;
  }
  return GetTypeObject(record);
}

/** One specialization per (function object, ordered bindings). */
const genericFunctionSpecializations = new WeakMap<object, Map<string, Value>>();

/**
 * Set by the call paths around evaluating a `TypeArgumentsExpression` CALLEE,
 * and consumed at the top of Evaluate_TypeArgumentsExpression: an explicit call
 * binds its own type arguments (with its own diagnostics and `where` check), so
 * the callee must evaluate to the bare function there, not to a specialization
 * that would be bound twice.
 */
export type TypeArgumentsCallTarget = { reference?: Value | ReferenceRecord };
let evaluatingTypeArgumentsCallee: boolean | TypeArgumentsCallTarget = false;
export function MarkTypeArgumentsCallee(target?: TypeArgumentsCallTarget): void {
  evaluatingTypeArgumentsCallee = target ?? true;
}
export function ClearTypeArgumentsCallee(): void {
  evaluatingTypeArgumentsCallee = false;
}

/**
 * proposal-runtime-types #sec-generic-function-values: a generic function
 * applied in expression position, `f.<uint8>`,
 * denotes its SPECIALIZATION as a value - a function object interned per
 * function and ordered bindings, so `f.<uint8> === f.<uint8>` and `f.<uint8> ===
 * f.<T: uint8>`, a Map keyed on one round-trips, and `arr.map(f.<uint8>)` runs
 * the specialized body. Its `where` clauses run once, here; it captures no
 * receiver (`obj.m.<uint8>` is the method's specialization, receiver
 * independent, and a call supplies `this` as any member call does); and its
 * type is the instantiated signature while the bare name keeps the generic one.
 * Before this the expression evaluated to the bare function and the bindings
 * were lost.
 */
export function* SpecializeGenericFunction(fn: ObjectValue, ref: unknown, node: ParseNode.TypeArgumentsExpression | undefined, params: readonly ParseNode.TypeParameter[], preBound?: Map<string, TypeRecord>): ValueEvaluator {
  const frame = preBound ?? new Map<string, TypeRecord>();
  const fnName = ((fn as unknown as { ECMAScriptCode?: { parent?: { BindingIdentifier?: { name?: string } } } }).ECMAScriptCode?.parent?.BindingIdentifier?.name) ?? 'the function';
  let bound: TypeRecord[];
  if (preBound) bound = params.map((p) => preBound.get(p.BindingIdentifier.name)!);
  else bound = Q(yield* BindTypeArgumentsInto(params, node!.TypeArguments.TypeArgumentList, frame, fnName, fn as never));
  // The declaration context's TypeParameterEnvironment answers a read of a
  // parameter from the frame it is given; given an empty one, an
  // object-literal method's `const s = o.f.<0>` reported `N` "cannot be used
  // before initialization" (round 5, Q6). The bound frame is what the clause
  // and the body read.
  return yield* InCallableDeclarationContext(fn, frame, classFrameOfMethod(fn), function* specialize(): ValueEvaluator {
    const key = bound.map(specializationKeyOf).join('|');
    let table = genericFunctionSpecializations.get(fn as unknown as object);
    if (!table) {
      table = new Map<string, Value>();
      genericFunctionSpecializations.set(fn as unknown as object, table);
    }
    const existing = table.get(key);
    if (existing) {
      return existing;
    }
    // #sec-generic-where: checked once, at creation, over the class's frame (a
    // method's clause may name its class's parameters) and this one.
    const whereClauses = functionWhereClauses(fn as never);
    if (whereClauses && whereClauses.length > 0) {
      const classFrame = classTypeParameterFrame(ref);
      if (classFrame) {
        pushTypeParameterFrame(classFrame);
      }
      pushTypeParameterFrame(frame);
      try {
        for (const clause of whereClauses) {
              if (GenericWhereVerified(clause, frame)) continue;
          const predicate = (clause as unknown as { RefinementPredicate?: ParseNode }).RefinementPredicate;
          if (!predicate) {
            continue;
          }
          const verdict = Q(yield* GetValue(Q(yield* Evaluate(predicate as never))));
          if (verdict === Value.false || verdict === Value.undefined || verdict === Value.null) {
            return Throw.TypeError('a $1 clause is not satisfied by this application', Value('where'));
          }
        }
      } finally {
        popTypeParameterFrame();
        if (classFrame) {
          popTypeParameterFrame();
        }
      }
    }
    const specialized = CreateBuiltinFunction(function* SpecializedCall(args: Arguments, context: { thisValue?: Value }): ValueEvaluator {
      pushTypeParameterFrame(frame);
      try {
        return yield* Call(fn, context.thisValue ?? Value.undefined, Array.from(args, (a) => a ?? Value.undefined));
      } finally {
        popTypeParameterFrame();
      }
    }, 0, Value(fnName), []);
    // The instantiated signature: the declared one, its ~parameter~ records
    // replaced by the bindings.
    const declared = EnsureCompletion(yield* OverloadSignatureOf(fn as never));
    if (declared.Type === 'normal') {
      const sig = declared.Value as { Parameters: readonly unknown[], ReturnType?: TypeRecord, Narrows?: SignatureRecord['Narrows'], TypeParameters?: readonly { Name: string, Parameter?: TypeRecord }[] };
      const bindings = new Map<TypeRecord, TypeRecord>();
      for (const tp of sig.TypeParameters ?? []) {
        const b = frame.get(tp.Name);
        if (tp.Parameter && b) {
          bindings.set(tp.Parameter, b);
        }
      }
      const generic = { Kind: 'function', Signatures: [{ Parameters: sig.Parameters,
        ...(ClassMethodThisTypeOf(fn) ? { ThisType: SelfThisTypeRecord } : {}),
        Return: sig.ReturnType ?? publishedReturnTypeOfFunction(fn, frame) ?? null,
        Narrows: sig.Narrows, TypeParameters: sig.TypeParameters }] } as unknown as TypeRecord;
      RegisterSpecializedFunctionType(specialized as unknown as object, substituteParameterRecords(generic, bindings));
    }
    const unavailable = RequiredModuleInputFailure();
    if (unavailable) return unavailable;
    table.set(key, specialized);
    return specialized;
  });
}

export function* Evaluate_TypeArgumentsExpression(node: ParseNode.TypeArgumentsExpression, evaluatedReference?: ReferenceRecord): PlainEvaluator<unknown> {
  const asCallee = evaluatingTypeArgumentsCallee;
  evaluatingTypeArgumentsCallee = false;
  // proposal-runtime-types (README "Typed Arrays"): an ARRAY TYPE written in
  // expression position - `new [100].<uint8>()`, or `class G extends
  // [W * H].<uint8>` - denotes the type's constructor.
  //
  // The base of such an expression parses as an array LITERAL, since that is
  // what `[100]` is where an expression is expected, and its type arguments
  // were evaluated and discarded: `new [100].<uint8>()` reported "[object
  // Array] is not a constructor" and `extends [4].<uint8>` the same for its
  // superclass. Resolved here, before the base is evaluated as a literal,
  // because evaluating it is exactly the reading that has to be avoided.
  if (surroundingAgent.feature('runtime-types') && node.Expression.type === 'ArrayLiteral') {
    return Q(yield* ArrayTypeConstructorFor(node));
  }
  const ref = evaluatedReference ?? (yield* Evaluate(node.Expression));
  const inspected = EnsureCompletion(ref);
  if (inspected.Type !== 'normal') {
    return ref;
  }
  const peeked = EnsureCompletion(yield* GetValue(inspected.Value as never));
  if (peeked.Type !== 'normal') {
    // proposal-runtime-types #sec-types-in-expression-position: "A type name is
    // already an expression, since a type is a value, so `uint8` and
    // `Map.<string, uint8>` may be written where a value is expected."
    //
    // A PARAMETERIZED PRIMITIVE FAMILY has no binding to evaluate - `int`,
    // `uint` and `vector` are types only when applied, and #sec-vector-widths
    // is explicit that "a bare parameterized primitive is not a value", so
    // binding them is not the fix. The application is resolved here instead,
    // where the reference has just failed to resolve, and only there: these are
    // ORDINARY IDENTIFIERS a program may bind -
    //
    //   let int = 5;        // legal, and keeps its meaning
    //   int.<8>             // only reaches this arm when nothing bound `int`
    //
    // so resolving before the lookup would shadow a working program. Confined
    // to the unresolvable case, this changes behaviour exactly where a
    // ReferenceError was thrown and nowhere else.
    if (surroundingAgent.feature('runtime-types') && node.Expression.type === 'IdentifierReference') {
      const familyType = Q(yield* FamilyApplicationFor(node));
      if (familyType !== undefined) {
        return familyType;
      }
    }
    return ref;
  }
  const value = peeked.Value;
  if (surroundingAgent.feature('runtime-types') && value instanceof Value && GenericMapTypeOf(value)) {
    const specialized = Q(yield* ApplyGenericMap(value, node.TypeArguments.TypeArgumentList));
    // The call owns this handoff. The one-shot marker was consumed before
    // evaluating the callee or type arguments, so nested evaluation cannot
    // steal it. Keep the already selected receiver without reading a getter twice.
    if (typeof asCallee === 'object') asCallee.reference = inspected.Value as Value | ReferenceRecord;
    return specialized;
  }

  // complex's concrete default and family declaration share their public
  // spelling. Reapplication of that unshadowed intrinsic spelling binds the
  // family, without creating an identity-distinct default Type Object.
  if (surroundingAgent.feature('runtime-types') && node.Expression.type === 'IdentifierReference'
      && isFamilyShorthandTypeObject((node.Expression as unknown as { name: string }).name, value)) {
    const familyType = Q(yield* FamilyApplicationFor(node));
    if (familyType !== undefined) {
      return familyType;
    }
  }
  if (surroundingAgent.feature('runtime-types') && value instanceof ObjectValue && IsCallable(value)) {
    // #sec-generic-function-values: a STORED application, `f.<A>` as a
    // value, of a group holding a specialized case selects as a direct call
    // would (the value count unknown): a case becomes a callable bound to its
    // captures, identical for an identical selection; the owner's fallback is
    // any generic function's specialization.
    // A call's callee passes through: the call path selects (steps 2 to 4),
    // for a group with no owner as for one with an owner.
    if (asCallee && CaseGroupMembers(value)) return ref;
    const caseMembers = asCallee ? undefined : CaseGroupMembers(value);
    if (caseMembers) {
      const inner = (node as unknown as { Expression?: { type?: string, name?: string } }).Expression;
      const groupName = inner?.type === 'IdentifierReference' && inner.name ? inner.name : 'this function';
      const choice = Q(yield* SelectExplicitCase(caseMembers, node.TypeArguments.TypeArgumentList as unknown as ParseNode[], groupName, undefined,
        classFrameOfObject((ref as { Base?: unknown } | undefined)?.Base)));
      if (!choice.owner && choice.frame) {
        return CompleteSpecializationResult(StoredCaseValue(choice.fn, choice.frame, groupName, value));
      }
      const specialized = Q(yield* SpecializeGenericFunction(choice.fn as ObjectValue, inspected.Value, node, functionTypeParameters(choice.fn as never) ?? [], choice.frame));
      // The owner's fallback records its group, for reflection.
      RecordSelection(specialized as Value, value, choice.fn, undefined);
      return CompleteSpecializationResult(specialized);
    }
    // A GENERIC FUNCTION (a declaration or a method with its own type
    // parameters) applied in expression position is its specialization value.
    // Read through `functionTypeParameters` rather than the declaration alone,
    // so a literal that ADOPTED a generic contextual signature is generic here
    // too (`AdoptTypeParameters`).
    const fnParams = functionTypeParameters(value as never) ?? undefined;
    // Not for a call's callee (the call binds), and not for a higher-kinded
    // list (#sec-higher-kinded-parameters: its argument is a declaration, bound
    // by the explicit call alone).
    const kindedFn = fnParams?.some((q) => ((q as { Arity?: number }).Arity ?? 0) > 0) ?? false;
    if (!asCallee && !kindedFn && fnParams && fnParams.length > 0 && !LookupClassType(value as unknown as object)) {
      const specialized = Q(yield* SpecializeGenericFunction(value, inspected.Value, node, fnParams));
      return CompleteSpecializationResult(specialized);
    }
    if (fnParams?.length && !LookupClassType(value as unknown as object)) return ref;
    // MakeOverloadedFunction's dispatcher keeps the declarations in its slots;
    // its own ECMAScriptCode is absent. A generic member can bind at the call.
    const members = (value as { OverloadFunctions?: readonly Value[] }).OverloadFunctions;
    if (asCallee && members?.some((member) => functionTypeParameters(member as never)?.length)) return ref;
  }
  if (surroundingAgent.feature('runtime-types') && value instanceof ObjectValue) {
    const classType = LookupClassType(value as unknown as object);
    let declaration = classType && isTypeObject(classType) && classType.TypeRecord.Kind === 'nominal'
      ? classType.TypeRecord.Declaration as unknown as { type?: string, TypeParameters?: { TypeParameterList?: readonly unknown[] }, ClassTail?: unknown, BindingIdentifier?: { name?: string } }
      : undefined;
    // Registration associates the in-progress constructor with its exact
    // family before static initializers run. Source text is not identity.
    if (declaration === undefined) {
      declaration = [...(specializationsInProgress.get(ClassFamilyOf(value))?.values() ?? [])].find((entry) => entry.ctor === value)?.declaration as typeof declaration;
    }
    const params = declaration?.TypeParameters?.TypeParameterList;
    // A kinded parameter no longer excludes specialization: its argument
    // resolves as a declaration above, and `#sec-higher-kinded-parameters`
    // requires that two applications binding different declarations be distinct
    // types.
    if (declaration !== undefined && params && params.length > 0 && declaration.ClassTail) {
      return Q(yield* SpecializeGenericClass(declaration as never, node, value));
    }
  }
  if (isTypeObject(value)) {
    const record = value.TypeRecord;
    const intrinsic = intrinsicDeclarationName(record);
    if (intrinsic) {
      const args: (TypeRecord | number)[] = [];
      for (const argument of node.TypeArguments.TypeArgumentList) {
        args.push(toNumericArgument(Q(yield* TypeNodeToTypeRecord(argument))));
      }
      const bound = bindIntrinsicArguments(intrinsic, args, node.TypeArguments.TypeArgumentList.map(typeArgumentNameOf))!;
      if ('Error' in bound) return Throw.TypeError('$1', Value(bound.Error));
      return GetTypeObject((builtinTypeRecord(intrinsic, bound.Arguments) ?? libraryTypeRecord(intrinsic, bound.Arguments))!);
    }

    if (record.Kind === 'nominal' && record.Declaration.type === 'TypeAliasDeclaration' && (record.Declaration as ParseNode.TypeAliasDeclaration).TypeParameters) {
      const argRecords: TypeRecord[] = [];
      const argNames: (string | undefined)[] = [];
      for (const argNode of node.TypeArguments.TypeArgumentList) {
        const argument = Q(yield* TypeNodeToTypeRecord(argNode));
        if ((argNode as { IsSpread?: boolean }).IsSpread) {
          const elements = spreadElementsOf(argument);
          if (!elements) return Throw.TypeError('$1', Value('a spread alias type argument must be a tuple or an array of stated extent'));
          argRecords.push(...elements);
          argNames.push(...elements.map(() => undefined));
        } else {
          argNames.push(typeArgumentNameOf(argNode));
          argRecords.push(argument);
        }
      }
      // The alias
      // honoured names in TYPE position and dropped them in expression
      // position, so `G8` and `type G8 = Grid.<Cols: 8>` disagreed.
      const aliasDecl = record.Declaration as ParseNode.TypeAliasDeclaration;
      const instantiated = Q(yield* InstantiateGenericAlias(aliasDecl, argRecords, record, argNames));
      return GetTypeObject(instantiated);
    }
    if (record.Kind === 'nominal' && record.Declaration.type === 'InterfaceDeclaration'
      && record.Declaration.TypeParameters?.TypeParameterList.length) {
      const bound = Q(yield* ApplyGenericInterface(record, node.TypeArguments.TypeArgumentList));
      let conflict: string | undefined;
      const applied = MergePartialStructures(bound, RuntimePartialContributions(record.DeclarationIdentity ?? record.Declaration), (key) => {
        conflict ??= key;
      });
      if (conflict) return Throw.TypeError('$1 is already declared on this interface', Value(conflict));
      return GetTypeObject(CanonicalizeType(applied));
    }
    // proposal-runtime-types: everything that is NOT a generic alias fell
    // through to the unapplied base, so `Iterable.<uint8>` in expression
    // position evaluated to bare `Iterable` and `Iterable === Iterable.<uint8>`
    // was *true*. An alias worked, which is what made the gap hard to see: the
    // one shape with a handler behaved correctly and every other shape silently
    // discarded its arguments.
    const argRecords: TypeRecord[] = [];
    for (const argNode of node.TypeArguments.TypeArgumentList) {
      argRecords.push(Q(yield* TypeNodeToTypeRecord(argNode)));
    }
    // A built-in interface is rebuilt from its name, because its record carries
    // members rather than arguments and there is nothing to attach them to.
    const baseName = node.Expression.type === 'IdentifierReference'
      ? (node.Expression as unknown as { name: string }).name
      : undefined;
    if (baseName !== undefined) {
      const rebuilt = iterationInterfaceRecord(baseName, argRecords);
      if (rebuilt) {
        return GetTypeObject(rebuilt);
      }
    }
    // #sec-parameterized-types: a single object-typed argument over a base that
    // takes no type parameters is METADATA, not a type argument - `float32.<{
    // m: 1 }>` is the same application in expression position that
    // TypeNodeToTypeRecord reads in type position, and this is that arm's twin.
    //
    // Without it a ~primitive~ record matched none of the arms here, fell out of
    // the Type Object branch entirely, and reached the callable test below,
    // where a Type Object IS callable (it converts) and is not a registered
    // generic builtin - so the application was refused with "type arguments
    // require a generic function". The annotation `let x: float32.<{ m: 1 }>`
    // worked throughout, so the two positions disagreed about the same source.
    //
    // Guarded on the parameter count for the reason the annotation path guards
    // on it: a GENERIC base takes type arguments, and an object-typed one is a
    // type argument like any other. `class C<T>` applied to `{ a: uint8 }` must
    // stay a specialization.
    const baseTypeParameters = record.Kind === 'nominal'
      ? ((record.Declaration as { TypeParameters?: { TypeParameterList?: readonly unknown[] } } | undefined)
        ?.TypeParameters?.TypeParameterList?.length ?? 0)
      : 0;
    if (baseTypeParameters === 0 && argRecords.length === 1 && argRecords[0]!.Kind === 'object') {
      return GetTypeObject(CanonicalizeType({
        Kind: 'parameterized',
        Base: record,
        Metadata: Q(MetadataObjectFromType(argRecords[0]!, record)),
      } as unknown as TypeRecord, new Map()));
    }
    // A concrete intrinsic alias can be reapplied. Resolve its declaration's
    // domains and defaults before constructing the replacement application,
    // just as a direct family spelling does. Non-generic primitives fall through.
    if (record.Kind === 'primitive') {
      const supplied = argRecords.map(toNumericArgument);
      const bound = bindIntrinsicArguments(record.Name, supplied, node.TypeArguments.TypeArgumentList.map(typeArgumentNameOf));
      if (bound && 'Error' in bound) return Throw.TypeError('$1', Value(bound.Error));
      const reapplied = bound ? builtinTypeRecord(record.Name, bound.Arguments) : null;
      if (reapplied && reapplied.Kind === 'primitive'
        && bound) {
        return GetTypeObject(reapplied);
      }
    }
    // A nominal takes its arguments directly, which is what the annotation path
    // does for the same types.
    if (record.Kind === 'nominal') {
      // #sec-type-arguments-and-placement-new-in-expression-position: "The
      // value must be generic ... otherwise a specialization of a non-generic
      // value throws a *TypeError* exception." A nominal whose declaration
      // takes no type parameters is not generic, and applying arguments to it
      // used to mint a fresh record `{ ...record, Arguments }` - so `A.<uint8>`
      // for `class A {}` evaluated to a Type Object that was neither `A` nor
      // an error, and `A.<uint8> === A` was *false* with no diagnostic. The
      // declaration's own parameter list is the test; a nominal with none
      // takes none.
      const nominalParams = (record.Declaration as { TypeParameters?: { TypeParameterList?: readonly unknown[] } | null } | undefined)
        ?.TypeParameters?.TypeParameterList;
      if (!nominalParams || nominalParams.length === 0) {
        return Throw.TypeError('$1 is not generic and takes no type arguments', displayType(record));
      }
      let conflict: string | undefined;
      const applied = MergePartialStructures({ ...record, Arguments: argRecords }, RuntimePartialContributions(record.DeclarationIdentity ?? record.Declaration), (key) => {
        conflict ??= key;
      });
      if (conflict) return Throw.TypeError('$1 is already declared on this interface', Value(conflict));
      return GetTypeObject(CanonicalizeType(applied));
    }
    // A Type Object of any other kind - a primitive that consumed no argument
    // above, an object type, a union - is not generic either.
    return Throw.TypeError('$1 is not generic and takes no type arguments', displayType(record));
  }
  if (surroundingAgent.feature('runtime-types') && value instanceof ObjectValue && IsCallable(value)) {
    if (IsGenericBuiltin(value)) {
      const intrinsics = surroundingAgent.currentRealmRecord.Intrinsics as unknown as Record<string, Value>;
      const name = ['Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'WeakRef', 'FinalizationRegistry', 'Proxy']
        .find((candidate) => intrinsics[`%${candidate}%`] === value);
      if (name) {
        const arguments_: TypeRecord[] = [];
        const names: (string | undefined)[] = [];
        for (const argument of node.TypeArguments.TypeArgumentList) {
          const type = Q(yield* TypeNodeToTypeRecord(argument));
          if ((argument as { IsSpread?: boolean }).IsSpread) {
            const elements = spreadElementsOf(type);
            if (!elements) return Throw.TypeError('a spread type argument must have a stated extent');
            arguments_.push(...elements);
            names.push(...elements.map(() => undefined));
          } else {
            arguments_.push(type);
            names.push(typeArgumentNameOf(argument));
          }
        }
        const bound = bindLibraryTypeArguments(name, arguments_, names)!;
        if ('Error' in bound) return Throw.TypeError('$1', Value(bound.Error));
        if (node.parent?.type === 'NewExpression' && node.parent.MemberExpression === node) RememberLibraryApplication(node, name, bound.Arguments);
      }
      return ref;
    }
    return Throw.TypeError('type arguments require a generic function');
  }
  // A primitive VALUE - `x.<uint8>` for a `let x: uint8` - is not generic, and
  // the clause names it: "a specialization of a non-generic value throws a
  // *TypeError* exception". This was the one shape that reached here and
  // evaluated to the value itself, so `x.<uint8>` was silently `x`.
  //
  // Not in CALLEE position. A built-in application such as
  // `SoA.withCapacity.<T>(n)` is implemented by the call expression, and the
  // property is not a value at all - `SoA.withCapacity` reads as *undefined* -
  // so the reference is handed back for the call to bind, as it always was,
  // and the call is where a callee that is not a builtin application is
  // refused (see `RegisterGenericBuiltin`).
  if (surroundingAgent.feature('runtime-types') && !asCallee) {
    return Throw.TypeError('a specialization of a non-generic value: type arguments require a generic function, class, or parameterized type');
  }
  return ref;
}

/** decorators.md's `EnumReflection` and `EnumEnumeratorReflection`. */
export function* EnumDecoratorContext(kind: string, name: Value, target: Value, extra?: { size?: number, index?: number, valueType?: Value }): ValueEvaluator {
  const realm = surroundingAgent.currentRealmRecord;
  const context = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
  X(CreateDataProperty(context, Value('kind'), Value(kind)));
  StampReflectionContext(context, kind);
  X(CreateDataProperty(context, Value('name'), name));
  // proposal-runtime-types #sec-reflection-shape-enum. An Enum reflection
  // reports the enum's `type`, the `valueType` its enumerators take their
  // values in, and its `size`. An ENUMERATOR reports its `value` and its
  // `index` and NO type - the type is the enum's, and repeating it per member
  // would be the same Type Object once per enumerator.
  if (kind === 'Enum') {
    X(CreateDataProperty(context, Value('type'), target));
    X(CreateDataProperty(context, Value('valueType'), extra?.valueType ?? Value.undefined));
    X(CreateDataProperty(context, Value('size'), extra?.size === undefined ? Value.undefined : Value(extra.size)));
  } else {
    const memberValue = name === Value.undefined ? Value.undefined : Q(yield* Get(target as ObjectValue, name as never));
    X(CreateDataProperty(context, Value('value'), memberValue));
    // Declaration order, which is not the value wherever a program assigns
    // values explicitly.
    X(CreateDataProperty(context, Value('index'), extra?.index === undefined ? Value.undefined : Value(extra.index)));
  }
  // The enum's own metadata under the empty member, an enumerator's under its
  // name - so `@f enum E { @g A }` gives two objects rather than one shared.
  const memberName = kind === 'Enum' ? '' : (name instanceof JSStringValueClass ? name.stringValue() : kind);
  X(CreateDataProperty(context, Value('metadata'), MetadataObjectFor(target, undefined, memberName)));
  return context;
}


/**
 * The number an enumerator continues from, or *undefined* where its value is not
 * numeric. A converted enumerator is a TypedNumberValue and an unconverted one a
 * NumberValue, and both carry the same reading.
 */
function NumericValueOfEnumerator(v: Value): number | undefined {
  const n = (v as unknown as { numberValue?: () => number }).numberValue;
  if (typeof n === 'function') {
    const read = n.call(v);
    return typeof read === 'number' ? read : undefined;
  }
  return v instanceof NumberValue ? (R(v) as number) : undefined;
}

/** Whether the source names complex's intrinsic default Type Object. */
function isFamilyShorthandTypeObject(name: string, value: Value): boolean {
  if (name !== 'complex') {
    return false;
  }
  const record = builtinTypeRecord(name, []);
  return !!record && isTypeObject(value) && GetTypeObject(record as TypeRecord) === value;
}

import { intrinsicDeclarationName } from '../type-system/records.mts';
import { libraryTypeRecord } from '../type-system/records.mts';
