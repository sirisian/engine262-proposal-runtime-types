import { GetTypeObject } from '../type-system/intern.mts';
import { PublishedClassTypeOf } from '../type-system/check.mts';
import { AssociateClassType } from '../abstract-ops/runtime-types.mts';
import { InstallTypeObjectSurface } from '../intrinsics/TypePrototype.mts';
import { RegisterStampedClass } from '../type-system/intern.mts';
import { ObjectValue, Value } from '../value.mts';
import { Q } from '../completion.mts';
import { OutOfRange } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import {
  ClassDefinitionEvaluation,
  InstantiateOrdinaryFunctionExpression,
  InstantiateAsyncFunctionExpression,
  InstantiateGeneratorFunctionExpression,
  InstantiateAsyncGeneratorFunctionExpression,
  InstantiateArrowFunctionExpression,
  InstantiateAsyncArrowFunctionExpression,
  DecoratorListEvaluation,
} from './all.mts';
import { surroundingAgent } from '#self';
import type {
  FunctionDeclaration, FunctionObject, PrivateName, PropertyKeyValue,
} from '#self';

/** https://tc39.es/ecma262/#sec-function-definitions-runtime-semantics-namedevaluation */
//   FunctionExpression :
//     `function` `(` FormalParameters `)` `{` FunctionBody `}`
function NamedEvaluation_FunctionExpression(FunctionExpression: ParseNode.FunctionExpression, name: PropertyKeyValue | PrivateName) {
  return InstantiateOrdinaryFunctionExpression(FunctionExpression, name);
}


/** https://tc39.es/ecma262/#sec-generator-function-definitions-runtime-semantics-namedevaluation */
//   GeneratorExpression :
//     `function` `*` `(` FormalParameters `)` `{` GeneratorBody `}`
function NamedEvaluation_GeneratorExpression(GeneratorExpression: ParseNode.GeneratorExpression, name: PropertyKeyValue | PrivateName) {
  return InstantiateGeneratorFunctionExpression(GeneratorExpression, name);
}

/** https://tc39.es/ecma262/#sec-async-function-definitions-runtime-semantics-namedevaluation */
//   AsyncFunctionExpression :
//     `async` `function` `(` FormalParameters `)` `{` AsyncBody `}`
function NamedEvaluation_AsyncFunctionExpression(AsyncFunctionExpression: ParseNode.AsyncFunctionExpression, name: PropertyKeyValue | PrivateName) {
  return InstantiateAsyncFunctionExpression(AsyncFunctionExpression, name);
}

/** https://tc39.es/ecma262/#sec-asyncgenerator-definitions-namedevaluation */
//   AsyncGeneratorExpression :
//     `async` `function` `*` `(` FormalParameters `)` `{` AsyncGeneratorBody `}`
function NamedEvaluation_AsyncGeneratorExpression(AsyncGeneratorExpression: ParseNode.AsyncGeneratorExpression, name: PropertyKeyValue | PrivateName) {
  return InstantiateAsyncGeneratorFunctionExpression(AsyncGeneratorExpression, name);
}

/** https://tc39.es/ecma262/#sec-arrow-function-definitions-runtime-semantics-namedevaluation */
//   ArrowFunction :
//     ArrowParameters `=>` ConciseBody
function NamedEvaluation_ArrowFunction(ArrowFunction: ParseNode.ArrowFunction, name: PropertyKeyValue | PrivateName) {
  return InstantiateArrowFunctionExpression(ArrowFunction, name);
}

/** https://tc39.es/ecma262/#sec-arrow-function-definitions-runtime-semantics-namedevaluation */
//   AsyncArrowFunction :
//     ArrowParameters `=>` AsyncConciseBody
function NamedEvaluation_AsyncArrowFunction(AsyncArrowFunction: ParseNode.AsyncArrowFunction, name: PropertyKeyValue | PrivateName) {
  return InstantiateAsyncArrowFunctionExpression(AsyncArrowFunction, name);
}

/** https://tc39.es/ecma262/#sec-class-definitions-runtime-semantics-namedevaluation */
//   ClassExpression : `class` ClassTail
function* NamedEvaluation_ClassExpression(ClassExpression: ParseNode.ClassExpression, name: PropertyKeyValue | PrivateName) {
  const { ClassTail, Decorators } = ClassExpression;
  const decorators = Decorators ? Q(yield* DecoratorListEvaluation(Decorators)) : [];
  const sourceText = ClassExpression.sourceText;
  // 1. Let value be the result of ClassDefinitionEvaluation of ClassTail with arguments undefined and name.
  const value = yield* ClassDefinitionEvaluation(ClassTail, Value.undefined, name, sourceText, decorators);
  Q(value);
  // proposal-runtime-types: associate the class type; this is the named
  // evaluation path taken by `const C = class {}` and property definitions.
  if (surroundingAgent.feature('runtime-types') && value instanceof ObjectValue) {
    const published = PublishedClassTypeOf(ClassExpression as unknown as object);
    const typeObject = GetTypeObject({
      Kind: 'nominal',
      Declaration: ClassExpression,
      Arguments: [],
      Constructor: value,
      // As at ClassDeclaration: the relation
      // reads these two and this record carried neither.
      Base: published?.Kind === 'nominal' ? published.Base : undefined,
      Structure: published?.Kind === 'nominal' ? published.Structure : undefined,
    });
    // "A class's type object IS its constructor" (README, and the specification
    // twice). The record is stamped onto the constructor and the type-object
    // surface installed on it, so `V === type V` and a class name is the type
    // wherever a type is a value.
    //
    // Stamped on EVERY class, generic or not: the stamp is what makes the
    // accessors answer, while whether the bare NAME resolves to the constructor
    // is GetTypeObject's decision and excludes a generic one.
    // Only a NON-GENERIC class is stamped. An unapplied generic class is a type
    // CONSTRUCTOR rather than a type, and it is what a higher-kinded position
    // binds; giving its constructor a [[TypeRecord]] makes `isTypeObject` answer
    // *true* for it, and the kinded machinery tells a type object from a bare
    // generic declaration by exactly that test.
    const genericParameters = (typeObject as unknown as {
      TypeRecord?: { Declaration?: { TypeParameters?: { TypeParameterList?: readonly unknown[] } | null } },
    }).TypeRecord?.Declaration?.TypeParameters?.TypeParameterList?.length ?? 0;
    if (genericParameters === 0) {
      (value as unknown as { TypeRecord?: unknown }).TypeRecord = (typeObject as unknown as { TypeRecord: unknown }).TypeRecord;
      InstallTypeObjectSurface(surroundingAgent.currentRealmRecord, value as unknown as ObjectValue);
      AssociateClassType(value, value);
      RegisterStampedClass((typeObject as unknown as { TypeRecord: { Declaration: object } }).TypeRecord.Declaration, value as unknown as ObjectValue);
    } else {
      AssociateClassType(value, typeObject);
    }
  }
  // 4. Return value.
  return value;
}

export function* NamedEvaluation(F: FunctionDeclaration, name: PropertyKeyValue | PrivateName): ValueEvaluator<FunctionObject> {
  switch (F.type) {
    case 'FunctionExpression':
      return NamedEvaluation_FunctionExpression(F, name);
    case 'GeneratorExpression':
      return NamedEvaluation_GeneratorExpression(F, name);
    case 'AsyncFunctionExpression':
      return NamedEvaluation_AsyncFunctionExpression(F, name);
    case 'AsyncGeneratorExpression':
      return NamedEvaluation_AsyncGeneratorExpression(F, name);
    case 'ArrowFunction':
      return NamedEvaluation_ArrowFunction(F, name);
    case 'AsyncArrowFunction':
      return NamedEvaluation_AsyncArrowFunction(F, name);
    case 'ClassExpression':
      return yield* NamedEvaluation_ClassExpression(F, name);
    case 'ParenthesizedExpression':
      return yield* NamedEvaluation(F.Expression, name);
    default:
      throw OutOfRange.exhaustive(F);
  }
}
