import { X, Q } from '../completion.mts';
import {
  TypeNodeToTypeRecord, pushTypeParameterFrame, popTypeParameterFrame,
} from '../type-system/runtime.mts';
import { parameterTypeRecord, type TypeRecord } from '../type-system/records.mts';
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
import { PrivateElementRecord } from './MethodDefinitionEvaluation.mts';

/** https://tc39.es/ecma262/#sec-classfielddefinition-record-specification-type */
export interface ClassFieldDefinitionRecord {
  readonly Name: PropertyKeyValue | PrivateName;
  /**
   * proposal-runtime-types: the member's access modifier, `'protected'` or
   * absent. An access RULE rather than a layout one - README: "a protected
   * field occupies the normal layout and stays reachable through reflection or
   * an `any`-typed reference, the erasure other languages apply to it".
   */
  readonly Access?: 'protected' | undefined;
  /**
   * proposal-runtime-types (PLAN-accessor.md §2.3): a PRIVATE accessor's
   * get/set pair, as a PrivateElement.
   *
   * `accessor #internal` desugars to a private backing field PLUS A PRIVATE
   * PAIR - two Private Names for one declaration - and the pair cannot be a
   * property, so this one function has to yield two things. It returns the
   * FIELD record, which is what allocates the backing slot, and carries the
   * pair here for `ClassDefinitionEvaluation` to add to the private-element
   * container. That keeps one return value and one owner for each half.
   */
  readonly PrivateAccessor?: ReturnType<typeof PrivateElementRecord> | undefined;
  /**
   * proposal-runtime-types: the name a laid-out slot is reported under, where
   * that differs from [[Name]]. Only an `accessor` sets it - its [[Name]] is
   * the unnameable Private Name that backs the pair, and the layout reports the
   * accessor's own name instead.
   */
  readonly LayoutName?: PropertyKeyValue | undefined;
  /** proposal-runtime-types: an `accessor`'s generated get/set pair. */
  readonly AccessorPair?: { Getter: Value, Setter: Value } | undefined;
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
    // proposal-runtime-types: a field annotation inside a GENERIC class names
    // the class's type parameters, and nothing bound them here - so
    // `class B<T> { v: T; }` failed with "T is not defined", which is the
    // opening example of generics.md. Each parameter is bound to a ~parameter~
    // record, standing for what an application will supply.
    const owner = enclosingGenericDeclaration(FieldDefinition as unknown as ParseNode);
    const params = owner?.TypeParameters?.TypeParameterList ?? [];
    if (params.length > 0) {
      const frame = new Map<string, TypeRecord>();
      for (const p of params) {
        const name = (p as unknown as { BindingIdentifier?: { name: string } }).BindingIdentifier?.name;
        if (name) {
          // proposal-runtime-types #sec-higher-kinded-parameters: the arity the
          // declaration wrote is carried, so a reference to a kinded parameter
          // knows it stands for a declaration rather than a type.
          const arity = (p as unknown as { Arity?: number }).Arity ?? 0;
          frame.set(name, parameterTypeRecord(name, undefined, arity));
        }
      }
      pushTypeParameterFrame(frame);
      try {
        const record = Q(yield* TypeNodeToTypeRecord(typeAnnotation.Type));
        typeObject = GetTypeObject(record);
      } finally {
        popTypeParameterFrame();
      }
    } else {
      const record = Q(yield* TypeNodeToTypeRecord(typeAnnotation.Type));
      typeObject = GetTypeObject(record);
    }
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
    // PLAN-accessor.md §2.3, settled: `accessor #internal` desugars to a private
    // backing field PLUS A PRIVATE PAIR - two Private Names for one
    // declaration. The pair is a PrivateElement rather than a property, which
    // is the whole of what made this harder than the public case; the backing
    // Private Name is created here either way.
    const isPrivate = name instanceof PrivateName;
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
    // A PUBLIC accessor's pair goes on the home object - the prototype for an
    // instance accessor, the constructor for a static one - which is where a
    // `get`/`set` pair written by hand would go. Not enumerable, as an accessor
    // pair is not.
    //
    // A PRIVATE one cannot: a Private Name is not a property key, and passing
    // one to DefinePropertyOrThrow asserts inside the host. It becomes a
    // PrivateElement instead, carried on the returned record for the class to
    // install beside the backing field.
    let privateAccessor;
    if (isPrivate) {
      privateAccessor = PrivateElementRecord({
        Key: name as PrivateName,
        Kind: 'accessor',
        Getter: get,
        Setter: set,
      });
    } else {
      // PLAN-accessor.md §2.5, settled: `readonly accessor` is LEGAL and means
      // a GETTER-ONLY accessor. The modifier parsed and did nothing before -
      // assignment succeeded and the context did not report it - which is worse
      // than refusing the syntax, since the declaration read as a constraint
      // and enforced none.
      //
      // Installing only the getter is what makes assignment a TypeError, by the
      // ordinary rule for a getter-only property rather than by a check written
      // here. The INITIALIZER still reaches the backing, because DefineField
      // writes the Private Name directly and never goes through the setter.
      const isReadonly = (FieldDefinition as { readonly?: boolean }).readonly === true;
      Q(yield* DefinePropertyOrThrow(homeObject, name as PropertyKeyValue, Descriptor({
        Getter: get,
        Setter: isReadonly ? undefined : set,
        Enumerable: Value.false,
        Configurable: Value.true,
      })));
    }
    return ClassFieldDefinitionRecord({
      Name: backing,
      // The name the LAYOUT reports for this slot. An accessor's backing is an
      // unnameable Private Name, and a slot no program can name leaves a hole
      // in a layout walk - a serializer sees bytes it cannot label. README
      // settles that an accessor "participates in the memory layout exactly as
      // a field does", so it is reflected as one, under the name that was
      // actually written. This is deliberately NOT C#'s answer: a generated
      // `<a>k__BackingField` leaks a compiler artifact into every reflective
      // enumeration, and every tool then has to filter it back out.
      LayoutName: name as PropertyKeyValue,
      // decorators.md's replacement for `Reflect.ClassAccessor` is a
      // `{ get, set }` pair, and a replacement that cannot reach the ORIGINAL
      // storage has to invent its own - orphaning the layout slot the backing
      // occupies. Carrying the pair here lets the context expose `access`, so a
      // replacement delegates to the slot instead of abandoning it. Same
      // reasoning as TC39's `context.access`, and the reason the slot can stay
      // unconditional: layout must not depend on whether a decorator ran.
      AccessorPair: { Getter: get, Setter: set },
      PrivateAccessor: privateAccessor,
      Initializer: initializer,
      TypeAnnotation: typeAnnotation,
      TypeObject: typeObject,
      Readonly: (FieldDefinition as { readonly?: boolean }).readonly === true,
    Access: (FieldDefinition as { protected?: boolean }).protected === true ? 'protected' : undefined,
    });
  }
  return ClassFieldDefinitionRecord({
    Name: name,
    Initializer: initializer,
    TypeAnnotation: typeAnnotation,
    TypeObject: typeObject,
    Readonly: (FieldDefinition as { readonly?: boolean }).readonly === true,
    Access: (FieldDefinition as { protected?: boolean }).protected === true ? 'protected' : undefined,
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


/**
 * The nearest enclosing declaration carrying type parameters, or undefined.
 *
 * A field is evaluated during class definition, so the class node is reachable
 * only by walking up - there is no scope in hand at that point the way a method
 * body has one.
 */
function enclosingGenericDeclaration(node: ParseNode): { TypeParameters?: { TypeParameterList?: readonly ParseNode[] } } | undefined {
  let n: ParseNode | undefined = node;
  while (n) {
    const withParams = n as unknown as { TypeParameters?: { TypeParameterList?: readonly ParseNode[] } };
    if (withParams.TypeParameters?.TypeParameterList?.length) {
      return withParams;
    }
    n = (n as unknown as { parent?: ParseNode }).parent;
  }
  return undefined;
}
