import { X, Q } from '../completion.mts';
import { TypeNodeToTypeRecord } from '../type-system/runtime.mts';
import { GetTypeObject } from '../type-system/intern.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import { Evaluate_PropertyName } from './PropertyName.mts';
import {
  surroundingAgent,
  CreateBuiltinFunction, DefinePropertyOrThrow, MakeMethod, OrdinaryFunctionCreate, PrivateGet, PrivateSet, SymbolDescriptiveString, Throw,
} from '#self';
import {
  ClassElementDefinitionRecord,
  Descriptor,
  JSStringValue,
  SymbolValue,
  Value,
  type Arguments,
  ObjectValue,
  type ECMAScriptFunctionObject, type FunctionCallContext, type FunctionObject, PrivateName, type PropertyKeyValue,
} from '#self';

/** https://tc39.es/ecma262/#sec-classfielddefinition-record-specification-type */
export interface ClassFieldDefinitionRecord {
  readonly Name: PropertyKeyValue | PrivateName;
  readonly Initializer: ECMAScriptFunctionObject | undefined;
  // proposal-runtime-types: the field's type annotation, if any, so a field
  // declared without an initializer can take its type's default (spec
  // sec-typed-classes: "a typed field takes its type's default").
  readonly TypeAnnotation?: ParseNode.TypeAnnotation | null;
  // proposal-runtime-types: the annotation RESOLVED, at class definition time,
  // where the class's lexical environment is still the running one. Resolving
  // it per instance instead crashed the host for any annotation needing a
  // binding lookup - `class C { k: K; }` asserted `env instanceof
  // EnvironmentRecord` inside the default (builtin) constructor - and it is
  // also what the store check needs, since a field's declared type must be
  // recorded on the instance for #table-check-sites to enforce it (F51).
  readonly TypeObject?: object;
  // proposal-runtime-types: whether the field is declared `readonly`, so it may
  // be assigned only in its own initializer and in the declaring class's
  // constructors (spec sec-typed-classes).
  readonly Readonly?: boolean;
}
export const ClassFieldDefinitionRecord = function ClassFieldDefinitionRecord(value: ClassFieldDefinitionRecord) {
  Object.setPrototypeOf(value, ClassFieldDefinitionRecord.prototype);
  return value;
} as {
  (value: ClassFieldDefinitionRecord): ClassFieldDefinitionRecord;
  [Symbol.hasInstance](instance: unknown): instance is ClassFieldDefinitionRecord;
};

export function* ClassFieldDefinitionEvaluation(FieldDefinition: ParseNode.FieldDefinition, homeObject: ObjectValue): PlainEvaluator<ClassFieldDefinitionRecord> {
  const { ClassElementName, Initializer } = FieldDefinition;
  // 1. Let name be the result of evaluating ClassElementName.
  const name = Q(yield* Evaluate_PropertyName(ClassElementName));
  // 3. If Initializer is present, then
  let initializer;
  if (Initializer) {
    // a. Let formalParameterList be an instance of the production FormalParameters : [empty].
    const formalParameterList: readonly [] = [];
    // b. Let scope be the LexicalEnvironment of the running execution context.
    const scope = surroundingAgent.runningExecutionContext.LexicalEnvironment;
    // c. Let privateScope be the running execution context's PrivateEnvironment.
    const privateScope = surroundingAgent.runningExecutionContext.PrivateEnvironment;
    // d. Let sourceText be the empty sequence of Unicode code points.
    const sourceText = '';
    // e. Let initializer be ! OrdinaryFunctionCreate(%Function.prototype%, sourceText, formalParameterList, Initializer, non-lexical-this, scope, privateScope).
    initializer = X(OrdinaryFunctionCreate(
      surroundingAgent.intrinsic('%Function.prototype%'),
      sourceText,
      formalParameterList,
      Initializer,
      'non-lexical-this',
      scope,
      privateScope,
    ));
    // f. Perform MakeMethod(initializer, homeObject).
    MakeMethod(initializer, homeObject);
    // g. Set initializer.[[ClassFieldInitializerName]] to name.
    initializer.ClassFieldInitializerName = name;
  } else { // 4. Else,
    // a. Let initializer be empty.
    initializer = undefined;
  }
  // 5. Return the ClassFieldDefinition Record { [[Name]]: name, [[Initializer]]: initializer }.
  const typeAnnotation = (FieldDefinition as { TypeAnnotation?: ParseNode.TypeAnnotation | null }).TypeAnnotation;
  let typeObject;
  if (typeAnnotation && surroundingAgent.feature('runtime-types')) {
    const record = Q(yield* TypeNodeToTypeRecord(typeAnnotation.Type));
    typeObject = GetTypeObject(record);
  }
  // PLAN-accessor.md stage B. README: "An `accessor` field declares a typed
  // field together with a getter and setter over it. It desugars to a private
  // typed field and the matching pair."
  //
  // The desugaring is REAL rather than special-cased, and that is what makes it
  // cheap: the backing is an ordinary field record whose [[Name]] is a Private
  // Name, so DefineField initializes it per instance, applies the declared
  // type's DEFAULT when no initializer is written, and hangs the TypeObject on
  // the Private Name - which is what makes PrivateSet enforce the type. The
  // setter therefore checks its argument without this code checking anything.
  //
  // The Private Name is created HERE, once per class evaluation, so every
  // instance shares one key and no source syntax can name it. That is TC39's
  // answer (an unnameable BackingStorageKey) and Kotlin's (`field`, reachable
  // only from inside the accessor); C#'s reflection-visible backing field is
  // the one this deliberately does not copy.
  if (surroundingAgent.feature('runtime-types') && (FieldDefinition as { accessor?: boolean }).accessor === true) {
    // A PRIVATE accessor is stage B's remainder, and it is an open design
    // question rather than plumbing: PLAN-accessor.md §2.3 asks what
    // `accessor #internal` desugars to, since "a private field plus a public
    // pair" becomes a private field plus a PRIVATE pair - two private names for
    // one declaration. The pair would also have to be a PrivateElement rather
    // than a property, so this function would have to return two records where
    // it returns one. Refused explicitly, because passing a Private Name to
    // DefinePropertyOrThrow asserts inside the host instead.
    if (name instanceof PrivateName) {
      return Throw.TypeError('$1 is not supported yet', Value('a private `accessor` field'));
    }
    const backing = new PrivateName(Value('accessor storage'));
    const get = CreateBuiltinFunction(function* accessorGet(_args: Arguments, { thisValue }: FunctionCallContext) {
      if (!(thisValue instanceof ObjectValue)) {
        return Throw.TypeError('$1 is not an object', thisValue);
      }
      return Q(yield* PrivateGet(thisValue, backing));
    } as never, 0, name, []);
    const set = CreateBuiltinFunction(function* accessorSet([value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext) {
      if (!(thisValue instanceof ObjectValue)) {
        return Throw.TypeError('$1 is not an object', thisValue);
      }
      Q(yield* PrivateSet(thisValue, backing, value));
      return Value.undefined;
    } as never, 1, name, []);
    // The pair goes on the home object - the prototype for an instance
    // accessor, the constructor for a static one - which is where a `get`/`set`
    // pair written by hand would go. Not enumerable, as an accessor pair is not.
    Q(yield* DefinePropertyOrThrow(homeObject, name as PropertyKeyValue, Descriptor({
      Getter: get,
      Setter: set,
      Enumerable: Value.false,
      Configurable: Value.true,
    })));
    return ClassFieldDefinitionRecord({
      Name: backing,
      Initializer: initializer,
      TypeAnnotation: typeAnnotation,
      TypeObject: typeObject,
      Readonly: (FieldDefinition as { readonly?: boolean }).readonly === true,
    });
  }
  return ClassFieldDefinitionRecord({
    Name: name,
    Initializer: initializer,
    TypeAnnotation: typeAnnotation,
    TypeObject: typeObject,
    Readonly: (FieldDefinition as { readonly?: boolean }).readonly === true,
  });
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-runtime-semantics-classfielddefinitionevaluation */
export function* ClassFieldDefinitionEvaluation_decorator(FieldDefinition: ParseNode.FieldDefinition, homeObject: ObjectValue): PlainEvaluator<ClassElementDefinitionRecord> {
  const { ClassElementName, Initializer, accessor } = FieldDefinition;

  if (!accessor) {
    const name = Q(yield* Evaluate_PropertyName(ClassElementName));
    const initializers: FunctionObject[] = [];
    const extraInitializers: FunctionObject[] = [];
    if (Initializer) {
      const initializer = CreateFieldInitializerFunction(homeObject, name, Initializer);
      // TODO(decorator): spec bug. ApplyDecoratorsToElementDefinition unshift decorator initializers into this array, but read it in order, so the spec order is wrong (be like [decorator2, decorator1, syntaxInit], but the correct order should be [syntaxInit, decorator2, decorator1])
      if (surroundingAgent.feature('decorators.no-bugfix.1')) {
        initializers.push(initializer);
      } else {
        initializers[-1] = initializer;
      }
    }
    return ClassElementDefinitionRecord({
      Kind: 'field',
      Key: name,
      Initializers: initializers,
      ExtraInitializers: extraInitializers,
      Decorators: undefined,
    });
  } else {
    const name = Q(yield* Evaluate_PropertyName(ClassElementName));
    let readableName: JSStringValue;
    if (name instanceof PrivateName) {
      readableName = name.Description;
    } else if (name instanceof SymbolValue) {
      readableName = SymbolDescriptiveString(name);
    } else {
      readableName = name;
    }
    const privateStateDesc = `${readableName.stringValue()} accessor storage`;
    const privateStateName = new PrivateName(Value(privateStateDesc));
    const getter = MakeAutoAccessorGetter(homeObject, name, privateStateName);
    const setter = MakeAutoAccessorSetter(homeObject, name, privateStateName);
    const initializers = [];
    const extraInitializers: FunctionObject[] = [];
    if (Initializer) {
      const initializer = CreateFieldInitializerFunction(homeObject, name, Initializer);
      // TODO(decorator): spec bug. ApplyDecoratorsToElementDefinition unshift decorator initializers into this array, but read it in order, so the spec order is wrong (be like [decorator2, decorator1, syntaxInit], but the correct order should be [syntaxInit, decorator2, decorator1])
      if (surroundingAgent.feature('decorators.no-bugfix.1')) {
        initializers.push(initializer);
      } else {
        initializers[-1] = initializer;
      }
    }
    if (!(name instanceof PrivateName)) {
      const desc = new Descriptor({
        Getter: getter,
        Setter: setter,
        Enumerable: Value.true,
        Configurable: Value.true,
      });
      Q(yield* DefinePropertyOrThrow(homeObject, name, desc));
    }
    return ClassElementDefinitionRecord({
      Kind: 'accessor',
      Key: name,
      Get: getter,
      Set: setter,
      BackingStorageKey: privateStateName,
      Initializers: initializers,
      ExtraInitializers: extraInitializers,
      Decorators: undefined,
    });
  }
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-createfieldinitializerfunction */
export function CreateFieldInitializerFunction(homeObject: ObjectValue, propName: PropertyKeyValue | PrivateName, Initializer: ParseNode.AssignmentExpressionOrHigher) {
  const formalParameterList: readonly [] = [];
  const scope = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  const privateScope = surroundingAgent.runningExecutionContext.PrivateEnvironment;
  const sourceText = '';
  const initializer = OrdinaryFunctionCreate(
    surroundingAgent.intrinsic('%Function.prototype%'),
    sourceText,
    formalParameterList,
    Initializer,
    'non-lexical-this',
    scope,
    privateScope,
  );
  MakeMethod(initializer, homeObject);
  initializer.ClassFieldInitializerName = propName;
  return initializer;
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-makeautoaccessorgetter */
export function MakeAutoAccessorGetter(_homeObject: ObjectValue, _name: PropertyKeyValue | PrivateName, privateStateName: PrivateName) {
  const getterClosure = function* getterClosure(_args: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
    const o = thisValue as ObjectValue;
    return Q(yield* PrivateGet(o, privateStateName));
  };
  const getter = CreateBuiltinFunction(getterClosure, 0, Value('get'), []);
  // TODO(decorator): spec bug, SetFunctionName only accepts ECMAScriptFunctionObject, but the name is already set when calling CreateBuiltinFunction
  // SetFunctionName(getter, name, Value('get'));
  // TODO(decorator): https://github.com/tc39/proposal-decorators/issues/568
  // MakeMethod(getter, homeObject);
  return getter;
}

export function MakeAutoAccessorSetter(_homeObject: ObjectValue, _name: PropertyKeyValue | PrivateName, privateStateName: PrivateName) {
  const setterClosure = function* setterClosure([value = Value.undefined]: Arguments, { thisValue }: FunctionCallContext): ValueEvaluator {
    const o = thisValue as ObjectValue;
    Q(yield* PrivateSet(o, privateStateName, value));
    return Value.undefined;
  };
  const setter = CreateBuiltinFunction(setterClosure, 1, Value('set'), []);
  // TODO(decorator): spec bug
  // SetFunctionName(setter, name, Value('set'));
  // TODO(decorator): https://github.com/tc39/proposal-decorators/issues/568
  // MakeMethod(setter, homeObject);
  return setter;
}
