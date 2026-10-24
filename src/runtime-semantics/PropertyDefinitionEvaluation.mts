import {
  Value, NullValue, ObjectValue, SymbolValue, type PropertyKeyValue, JSStringValue, BooleanValue, Descriptor,
} from '../value.mts';
import {
  StringValue,
  IsAnonymousFunctionDefinition,
  IsComputedPropertyKey,
  type FunctionDeclaration,
} from '../static-semantics/all.mts';
import { Evaluate, type PlainEvaluator, type ValueEvaluator } from '../evaluator.mts';
import { StampReflectionContext } from '../type-system/reflection-contexts.mts';
import { MemberFunctionTypeRecord, FunctionSignatureReflectionOf } from './ClassDefinitionEvaluation.mts';
import { CreateArrayFromList, Get } from '../abstract-ops/all.mts';
import { AdoptTypeParameters } from '../abstract-ops/runtime-types.mts';
import { RuntimeTypeOf, SubstituteTypeArguments, contextualTypeFor, pushContextualType, popContextualType } from '../type-system/runtime.mts';
import type { TypeRecord } from '../type-system/records.mts';
import {
  Q, X,
  NormalCompletion,
} from '../completion.mts';
import { kInternal } from '../utils/internal.mts';
import { OutOfRange } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { TypeNodeToTypeRecord } from '../type-system/runtime.mts';
import { GetTypeObject } from '../type-system/intern.mts';
import { NamedEvaluation, MethodDefinitionEvaluation, Evaluate_PropertyName } from './all.mts';
import { ApplyDecorators, ApplySubTargetDecorators } from './ClassDefinitionEvaluation.mts';
import { MetadataObjectFor } from './ClassDefinitionEvaluation.mts';
import { EnsureCompletion, EvaluateResultValue, GetResultValue, RetainPropertyResult, RetainCheckedResult, RetainObjectPropertyKey, SymbolKeyDependencyOf, TakeEvaluatedMethodKey } from '#self';
import {
  surroundingAgent,
  Assert,
  CheckedConvertValue,
  DefinePropertyOrThrow,
  CreateDataPropertyOrThrow,
  CopyDataProperties,
  DefineMethodProperty,
} from '#self';
import { CreateDataProperty, OrdinaryObjectCreate } from '#self';

/** https://tc39.es/ecma262/#sec-object-initializer-runtime-semantics-propertydefinitionevaluation */
//   PropertyDefinitionList :
//     PropertyDefinitionList `,` PropertyDefinition
/**
 * The type an object type declares for a property, or null. An object record
 * carries its members in [[Properties]]; an interface or alias is a nominal
 * whose [[Structure]] does.
 */
/** The contextual type of the object literal a property definition belongs to. */
function objectLiteralContext(definition: object, literal: object | undefined): TypeRecord | undefined {
  // The definition's ancestors up to the ObjectLiteral; the first that has a
  // position is the literal's.
  let n: object | undefined = definition;
  for (let i = 0; i < 3 && n; i += 1) {
    const t = contextualTypeFor(n);
    if (t !== undefined) {
      return t;
    }
    n = (n as { parent?: object }).parent;
  }
  return literal ? contextualTypeFor(literal) : undefined;
}

/**
 * A literal method that declares no type parameters of its own, written
 * against a contextual member signature that has some, takes the signature's
 * as the function value's - see `AdoptTypeParameters`. The declarations come
 * from the signature's Type Parameter Records, which keep the |TypeParameter|
 * Parse Node each was read from, so the adopted list is what
 * SpecializeGenericFunction binds by exactly as a declared one is.
 */
/** A method's key where it is written as a plain name or string, else *undefined*. */
function staticMethodKey(PropertyDefinition: ParseNode): string | undefined {
  // A method's key is its |ClassElementName| (a |PropertyName| node), the same
  // production in an object literal as in a class body.
  const key = (PropertyDefinition as { ClassElementName?: { type?: string, name?: string, value?: unknown } }).ClassElementName;
  if (key?.type === 'IdentifierName' && typeof key.name === 'string') {
    return key.name;
  }
  if (key?.type === 'StringLiteral' && typeof key.value === 'string') {
    return key.value;
  }
  return undefined;
}

function adoptContextualTypeParameters(PropertyDefinition: ParseNode, closure: ObjectValue): void {
  if (!surroundingAgent.feature('runtime-types')) {
    return;
  }
  const own = (PropertyDefinition as { TypeParameters?: { TypeParameterList?: readonly unknown[] } | null }).TypeParameters?.TypeParameterList;
  if (own && own.length > 0) {
    return;
  }
  const literal = (PropertyDefinition as { parent?: ParseNode }).parent;
  const keyName = staticMethodKey(PropertyDefinition);
  if (!literal || keyName === undefined) {
    return;
  }
  const ctx = contextualTypeFor(literal as object) as TypeRecord | null | undefined;
  const member = propertyContextualType(ctx, Value(keyName));
  if (!member || member.Kind !== 'function') {
    return;
  }
  const parameters = member.Signatures[0]?.TypeParameters;
  if (parameters?.length) {
    AdoptTypeParameters(closure, member.Signatures[0]);
  }
}

function propertyContextualType(contextual: TypeRecord | null | undefined, key: unknown): TypeRecord | null {
  if (!contextual || !(key instanceof JSStringValue)) {
    return null;
  }
  const shape = contextual.Kind === 'object'
    ? contextual
    : (contextual.Kind === 'nominal' && contextual.Structure
      ? SubstituteTypeArguments(contextual.Structure, contextual.Declaration, contextual.Arguments) : undefined);
  if (!shape || shape.Kind !== 'object') {
    return null;
  }
  const name = key.stringValue();
  const property = (shape as { Properties?: readonly { key: string, type: TypeRecord }[] }).Properties?.find((p) => p.key === name);
  return property?.type ?? null;
}

export function* PropertyDefinitionEvaluation_PropertyDefinitionList(PropertyDefinitionList: ParseNode.PropertyDefinitionList, object: ObjectValue, enumerable: BooleanValue<true>): PlainEvaluator {
  for (const PropertyDefinition of PropertyDefinitionList) {
    Q(yield* PropertyDefinitionEvaluation_PropertyDefinition(PropertyDefinition, object, enumerable));
  }
}

// PropertyDefinition :
//   `...` AssignmentExpression
//   IdentifierReference
//   PropertyName `:` AssignmentExpression
function* PropertyDefinitionEvaluation_PropertyDefinition(PropertyDefinition: ParseNode.PropertyDefinitionLike, object: ObjectValue, enumerable: BooleanValue<true>) {
  // proposal-runtime-types decorators.md: an object literal's members take the
  // OBJECT contexts, which mirror the class ones one for one. The result is
  // evaluated first and the decorators applied after, as everywhere else - "a
  // decorator runs when the declaration it decorates is evaluated".
  const decorators = (PropertyDefinition as { Decorators?: readonly ParseNode.Decorator[] | null }).Decorators;
  if (surroundingAgent.feature('runtime-types')) {
    const result = Q(yield* PropertyDefinitionEvaluation_PropertyDefinitionInner(PropertyDefinition, object, enumerable));
    if (PropertyDefinition.type === 'MethodDefinition' || PropertyDefinition.type === 'GeneratorMethod'
        || PropertyDefinition.type === 'AsyncMethod' || PropertyDefinition.type === 'AsyncGeneratorMethod') {
      const key = TakeEvaluatedMethodKey(PropertyDefinition);
      if (key instanceof SymbolValue) RetainObjectPropertyKey(object, key, SymbolKeyDependencyOf(PropertyDefinition.ClassElementName));
    }
    const kind = objectMemberContextKind(PropertyDefinition);
    const name = objectMemberName(PropertyDefinition);
    // The SUB-TARGETS run whether or not the member itself is decorated: a
    // parameter's decorator belongs to the parameter, and gating it on the
    // member's own list made `{ m(@f p) {} }` silently do nothing. The class
    // path already ran them unconditionally; this one did not, which is the
    // kind of divergence between two parallel families that only a test
    // written for the undecorated-owner case can find.
    Q(yield* ApplySubTargetDecorators(PropertyDefinition as never, kind, name, object as Value));
    if (decorators?.length) {
      const replacement = Q(yield* ApplyDecorators(decorators, Q(yield* ObjectMemberDecoratorContext(kind, name, object as Value, PropertyDefinition as never)), true));
      // The table gives ObjectMethod, ObjectGetter and ObjectSetter a
      // replacement and gives ObjectField none - "the field's initial value" is
      // a CLASS row, and an object literal's field is already its value, so
      // there is nothing separate to replace.
      if (replacement !== undefined && kind !== 'ObjectField' && name instanceof JSStringValue) {
        const existing = Q(yield* (object as ObjectValue).GetOwnProperty(name));
        const prior = existing instanceof Descriptor ? existing as { Getter?: Value, Setter?: Value } : undefined;
        const descriptor = kind === 'ObjectGetter'
          ? Descriptor({ Getter: replacement as never, Setter: prior?.Setter as never, Enumerable: enumerable, Configurable: Value.true })
          : kind === 'ObjectSetter'
            ? Descriptor({ Setter: replacement as never, Getter: prior?.Getter as never, Enumerable: enumerable, Configurable: Value.true })
            : Descriptor({ Value: replacement, Writable: Value.true, Enumerable: enumerable, Configurable: Value.true });
        Q(yield* DefinePropertyOrThrow(object as ObjectValue, name, descriptor));
      }
    }
    return result;
  }
  return yield* PropertyDefinitionEvaluation_PropertyDefinitionInner(PropertyDefinition, object, enumerable);
}

/** Which object-family context a member declaration takes. */
function objectMemberContextKind(node: ParseNode): string {
  const n = node as unknown as { UniqueFormalParameters?: unknown, PropertySetParameterList?: unknown, type?: string };
  if (n.type !== 'MethodDefinition' && n.type !== 'GeneratorMethod' && n.type !== 'AsyncMethod' && n.type !== 'AsyncGeneratorMethod') {
    return 'ObjectField';
  }
  // Same discriminator the class members use: a setter has a
  // PropertySetParameterList, a method has UniqueFormalParameters, a getter has
  // neither. Sharing it is what keeps the two families one for one.
  if (n.PropertySetParameterList) {
    return 'ObjectSetter';
  }
  if (!n.UniqueFormalParameters) {
    return 'ObjectGetter';
  }
  return 'ObjectMethod';
}

/** The written name of an object literal member. */
function objectMemberName(node: ParseNode): Value {
  const n = node as unknown as {
    PropertyName?: { PropertyName?: { name?: string }, name?: string, value?: unknown },
    ClassElementName?: { PropertyName?: { name?: string }, name?: string },
  };
  const written = n.PropertyName?.PropertyName?.name ?? n.PropertyName?.name
    ?? n.ClassElementName?.PropertyName?.name ?? n.ClassElementName?.name;
  return typeof written === 'string' ? Value(written) : Value.undefined;
}

/** decorators.md's `ObjectFieldReflection` and its siblings. */
export function* ObjectMemberDecoratorContext(kind: string, name: Value, target: Value, node?: ParseNode): ValueEvaluator {
  const realm = surroundingAgent.currentRealmRecord;
  const context = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
  X(CreateDataProperty(context, Value('kind'), Value(kind)));
  StampReflectionContext(context, kind);
  // proposal-runtime-types #sec-reflection-shape-structural: a Tuple or Record
  // reflects a composite VALUE and its whole shape is `type` - no name, no
  // metadata, the Structural family being one of those sec-decorator-metadata
  // gives none. A reader wanting the structure walks `type` with Reflect.Type.
  if (kind === 'Tuple' || kind === 'Record') {
    X(CreateDataProperty(context, Value('type'), GetTypeObject(RuntimeTypeOf(target), realm) as Value));
    return context;
  }
  // #sec-reflection-shape-object gives the Object reflection `type` and
  // `metadata` and NO name. An object literal has no name to report: the
  // language names an anonymous function or class from the binding it is
  // assigned to and pointedly not an object literal, and a name taken from the
  // binding would be a property of where the value went rather than of the
  // value - which the family being keyed on the INSTANCE already says it is
  // not. It read *undefined* in every position anyway.
  if (kind !== 'Object') {
    X(CreateDataProperty(context, Value('name'), name));
  }
  // proposal-runtime-types #sec-reflection-shape-object: every member of this
  // family reports its `type` - the annotation for a field, the FUNCTION type
  // for a method, getter, or setter, which is how the Class family reads the
  // same two shapes. The builder took no node, so five of the family's nine
  // contexts answered nothing about what they hold. A member that annotates
  // nothing still reports nothing, rather than a type of all-`any`.
  if (node && kind !== 'Object') {
    let memberType;
    if (kind === 'ObjectField') {
      // An object literal's field carries no annotation - `{ a: uint8 = 1 }`
      // parses as the property `a` holding the ASSIGNMENT EXPRESSION
      // `uint8 = 1`, not as an annotated field, which is why it stores 300 for
      // `{ a: uint8 = 300 }` rather than refusing it. So the type a field
      // reports is the type of the value it holds, which is the answer that
      // suits a family reached from an INSTANCE rather than a declaration
      // (#sec-reflection-shape-object).
      const held = Q(yield* Get(target as ObjectValue, name as never));
      memberType = RuntimeTypeOf(held);
    } else {
      memberType = Q(yield* MemberFunctionTypeRecord(node));
    }
    if (memberType) {
      X(CreateDataProperty(context, Value('type'), GetTypeObject(memberType, realm) as Value));
    }
  }
  if (kind === 'ObjectMethod' && node) {
    const one = Q(yield* FunctionSignatureReflectionOf(node, realm));
    X(CreateDataProperty(context, Value('signatures'), X(CreateArrayFromList([one]))));
  }
  // "For objects the metadata is on the INSTANCE", so an object member's
  // context points at the object rather than at a constructor.
  X(CreateDataProperty(context, Value('objectContext'), target));
  // Keyed by the OBJECT and the member: "for objects the metadata is on the
  // instance", so two objects of the same shape have separate metadata and two
  // members of one object have separate metadata from each other.
  const memberName = name instanceof JSStringValue ? name.stringValue() : undefined;
  X(CreateDataProperty(context, Value('metadata'), MetadataObjectFor(target, undefined, memberName ?? kind)));
  return context;
}

function* PropertyDefinitionEvaluation_PropertyDefinitionInner(PropertyDefinition: ParseNode.PropertyDefinitionLike, object: ObjectValue, enumerable: BooleanValue<true>) {
  switch (PropertyDefinition.type) {
    case 'IdentifierReference':
      return yield* PropertyDefinitionEvaluation_PropertyDefinition_IdentifierReference(PropertyDefinition, object, enumerable);
    case 'PropertyDefinition':
      break;
    case 'MethodDefinition':
    case 'GeneratorMethod':
    case 'AsyncMethod':
    case 'AsyncGeneratorMethod': {
      if (surroundingAgent.feature('decorators')) {
        const methodDefinition = Q(yield* MethodDefinitionEvaluation(PropertyDefinition, object));
        if (methodDefinition.Kind === 'method') {
          adoptContextualTypeParameters(PropertyDefinition, methodDefinition.Value);
        }
        Q(yield* DefineMethodProperty(object, methodDefinition, true));
        return undefined;
      } else {
        const result = yield* MethodDefinitionEvaluation(PropertyDefinition, object, enumerable);
        // The evaluation defines the property and returns nothing, so the
        // closure is read back off the object by its (static) key.
        const keyName = staticMethodKey(PropertyDefinition);
        if (keyName !== undefined) {
          const desc = X(object.GetOwnProperty(Value(keyName)));
          if (desc !== Value.undefined && (desc as { Value?: unknown }).Value instanceof ObjectValue) {
            adoptContextualTypeParameters(PropertyDefinition, (desc as { Value: ObjectValue }).Value);
          }
        }
        return result;
      }
    }
    default:
      throw OutOfRange.nonExhaustive(PropertyDefinition);
  }
  // PropertyDefinition :
  //   PropertyName `:` AssignmentExpression
  //   `...` AssignmentExpression
  const { PropertyName, AssignmentExpression } = PropertyDefinition;
  if (!PropertyName) {
    // 1. Let exprValue be the result of evaluating AssignmentExpression.
    const sourceResult = EnsureCompletion(yield* EvaluateResultValue(AssignmentExpression));
    if (sourceResult.Type !== 'normal') return sourceResult;
    const fromValue = sourceResult.Value;
    // 3. Let excludedNames be a new empty List.
    const excludedNames: PropertyKeyValue[] = [];
    // 4. Return ? CopyDataProperties(object, fromValue, excludedNames).
    return Q(yield* CopyDataProperties(object, fromValue, excludedNames, sourceResult));
  }
  // 1. Let propKey be the result of evaluating PropertyName.
  const propKey = Q(yield* Evaluate_PropertyName(PropertyName));
  // 3. If this PropertyDefinition is contained within a Script which is being evaluated for JSON.parse, then
  let isProtoSetter;
  if (surroundingAgent.runningExecutionContext?.HostDefined?.[kInternal]?.json) {
    isProtoSetter = false;
  } else if (!IsComputedPropertyKey(PropertyName) && (propKey as JSStringValue).stringValue() === '__proto__') { // 3. Else, If _propKey_ is the String value *"__proto__"* and if IsComputedPropertyKey(|PropertyName|) is *false*,
    // a. Let isProtoSetter be true.
    isProtoSetter = true;
  } else { // 4. Else,
    // a. Let isProtoSetter be false.
    isProtoSetter = false;
  }
  let propValue;
  let propResult: object | undefined;
  // 5. If IsAnonymousFunctionDefinition(AssignmentExpression) is true and isProtoSetter is false, then
  if (IsAnonymousFunctionDefinition(AssignmentExpression) && !isProtoSetter) {
    // a. Let propValue be NamedEvaluation of AssignmentExpression with argument propKey.
    propValue = yield* NamedEvaluation(AssignmentExpression as FunctionDeclaration, propKey);
  } else { // 6. Else,
    // a. Let exprValueRef be the result of evaluating AssignmentExpression.
    // proposal-runtime-types #sec-contextual-types: "a property of an object
    // literal at a position of known object type" takes "the type the object
    // type declares for that property". The literal's own contextual type is
    // the stack top (its position pushed it); the property's is read off it,
    // and null is pushed where it declares none so the OBJECT's type does not
    // leak into a member that is not it.
    let exprValueRef;
    if (surroundingAgent.feature('runtime-types')) {
      // The literal's own position (its parent is the ObjectLiteral).
      const definition = PropertyDefinition as unknown as { parent?: { parent?: object } };
      const literal = definition.parent?.parent ?? (definition as { parent?: object }).parent;
      pushContextualType(propertyContextualType(objectLiteralContext(PropertyDefinition as object, literal), propKey), AssignmentExpression as object);
      try {
        exprValueRef = EnsureCompletion(yield* Evaluate(AssignmentExpression));
      } finally {
        popContextualType();
      }
    } else {
      exprValueRef = EnsureCompletion(yield* Evaluate(AssignmentExpression));
    }
    // b. Let propValue be ? GetValue(exprValueRef).
    if (exprValueRef.Type !== 'normal') return exprValueRef;
    const readResult = EnsureCompletion(yield* GetResultValue(exprValueRef));
    if (readResult.Type !== 'normal') return readResult;
    propResult = readResult;
    propValue = readResult.Value;
  }
  // 7. If isProtoSetter is true, then
  if (isProtoSetter) {
    // a. If Type(propValue) is either Object or Null, then
    if (propValue instanceof ObjectValue || propValue instanceof NullValue) {
      // i. Return object.[[SetPrototypeOf]](propValue).
      return yield* object.SetPrototypeOf(propValue);
    }
    // b. Return NormalCompletion(empty).
    return NormalCompletion(undefined);
  }
  // proposal-runtime-types (spec, object types): the typed own property form
  // `{ (a: uint8): 1 }` declares the property's type at creation. It is defined
  // through the ordinary [[DefineOwnProperty]] carrying the declared type, which
  // is the same path Object.defineProperty's `type` key takes, so the initial
  // value is checked against the type and the property is recorded as typed. A
  // later write is then checked and a delete refused, exactly as for a property
  // declared the other way.
  const annotation = (PropertyDefinition as { TypeAnnotation?: ParseNode.TypeAnnotation }).TypeAnnotation;
  if (annotation) {
    const record = Q(yield* TypeNodeToTypeRecord(annotation.Type));
    const typeObject = GetTypeObject(record);
    // The value is written in a typed position, so it crosses a typed boundary and
    // takes the checked conversion a typed binding takes: an in-range literal
    // becomes a value of the declared type, and one that cannot be represented
    // exactly is an error rather than a silent wrap.
    const converted = Q(yield* CheckedConvertValue(X(propValue), record));
    const defined = Q(yield* DefinePropertyOrThrow(object, propKey as PropertyKeyValue, Descriptor({
      Type: typeObject,
      Value: converted,
      Writable: Value.true,
      Enumerable: Value.true,
      Configurable: Value.true,
    }) as Descriptor));
    if (propResult) {
      RetainCheckedResult(propResult, record);
      RetainPropertyResult(object, propKey as PropertyKeyValue, propResult);
    }
    RetainObjectPropertyKey(object, propKey as PropertyKeyValue, SymbolKeyDependencyOf(PropertyName));
    return defined;
  }
  // 8. Assert: enumerable is true.
  Assert(enumerable === Value.true);
  // 9. Assert: object is an ordinary, extensible object with no non-configurable properties.
  // 10. Return ! CreateDataPropertyOrThrow(object, propKey, propValue).
  const created = X(CreateDataPropertyOrThrow(object, propKey as PropertyKeyValue, X(propValue)));
  if (propResult) RetainPropertyResult(object, propKey as PropertyKeyValue, propResult);
  RetainObjectPropertyKey(object, propKey as PropertyKeyValue, SymbolKeyDependencyOf(PropertyName));
  return created;
}

// PropertyDefinition : IdentifierReference
function* PropertyDefinitionEvaluation_PropertyDefinition_IdentifierReference(IdentifierReference: ParseNode.IdentifierReference, object: ObjectValue, enumerable: BooleanValue<true>): ValueEvaluator {
  // 1. Let propName be StringValue of IdentifierReference.
  const propName = StringValue(IdentifierReference);
  // 2. Let exprValue be the result of evaluating IdentifierReference.
  const propResult = EnsureCompletion(yield* EvaluateResultValue(IdentifierReference));
  if (propResult.Type !== 'normal') return propResult;
  const propValue = propResult.Value;
  // 4. Assert: enumerable is true.
  Assert(enumerable === Value.true);
  // 5. Assert: object is an ordinary, extensible object with no non-configurable properties.
  // 6. Return ! CreateDataPropertyOrThrow(object, propName, propValue).
  const created = X(CreateDataPropertyOrThrow(object, propName, propValue));
  RetainPropertyResult(object, propName, propResult);
  return created;
}
