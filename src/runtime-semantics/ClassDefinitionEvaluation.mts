import { SetIntegrityLevel, TestIntegrityLevel } from '../abstract-ops/all.mts';
import { TypeNodeToTypeRecord } from '../type-system/runtime.mts';
import { CallDecorator } from '../abstract-ops/runtime-types.mts';
import { StampReflectionContext } from '../type-system/reflection-contexts.mts';
import { GetTypeObject } from '../type-system/intern.mts';
import { TakePendingPlacement } from '../abstract-ops/placement.mts';
import { ComputeClassLayout, type ClassControls, type ClassLayout, type FieldControls } from '../type-system/layout.mts';
import type { ThrowCompletion } from '../completion.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { Descriptor } from '../value.mts';
import {
  Value, NullValue, ObjectValue, PrivateName,
  BooleanValue,
  JSStringValue,
  type Arguments,
  type FunctionCallContext,
  UndefinedValue,
  type PropertyKeyValue,
  ReferenceRecord,
  SymbolValue,
} from '../value.mts';
import { Evaluate, type PlainEvaluator, type ValueEvaluator } from '../evaluator.mts';
import {
  IsStatic,
  ConstructorMethod,
  NonConstructorElements,
  PrivateBoundIdentifiers,
} from '../static-semantics/all.mts';
import {
  Q, X,
  AbruptCompletion,
} from '../completion.mts';
import { __ts_cast__, OutOfRange, type Mutable } from '../utils/language.mts';
import type { Location, ParseNode } from '../parser/ParseNode.mts';
import { ArgumentListEvaluation } from './ArgumentListEvaluation.mts';
import {
  DefineMethod,
  MethodDefinitionEvaluation,
  ClassFieldDefinitionEvaluation,
  PrivateElementRecord,
  ClassFieldDefinitionRecord,
  ClassStaticBlockDefinitionEvaluation,
  ClassStaticBlockDefinitionRecord,
  ClassFieldDefinitionEvaluation_decorator,
} from './all.mts';
import {
  surroundingAgent,
  OrdinaryFunctionCreate,
  RegisterClassOperator,
  DeclarativeEnvironmentRecord,
  PrivateEnvironmentRecord,

  CreateDataPropertyOrThrow, HasProperty, InitializeFieldOrAccessor, InitializePrivateMethods, IsPropertyKey, markBuiltinFunctionAsConstructor, PrivateElementFind, PrivateGet, PrivateSet, Set, Throw,
} from '#self';
import {
  Assert,
  Call,
  Construct,
  CreateBuiltinFunction,
  Get,
  GetValue,
  IsConstructor,
  MakeConstructor,
  MakeClassConstructor,
  SetFunctionName,
  CreateMethodProperty,
  OrdinaryObjectCreate,
  CreateDataProperty,
  EnsureCompletion,
  OrdinaryCreateFromConstructor,
  PrivateMethodOrAccessorAdd,
  InitializeInstanceElements,
  DefineField,
  type ECMAScriptFunctionObject,
  type BuiltinFunctionObject,
  type FunctionObject,
  DefineMethodProperty,
  IsCallable,
  getActiveScriptId,
} from '#self';

/** https://tc39.es/ecma262/#sec-static-semantics-classelementevaluation */
// -decorator
/**
 * The class whose elements are being evaluated, so a member's decorator context
 * can carry its `classContext`. ClassElementEvaluation does not receive the
 * class - it takes the prototype object - and threading a name through three
 * overload signatures for one property is worse than a scoped current-class,
 * which is how the engine already carries a pending placement and a pending
 * SoA type argument.
 */
// Left undefined rather than initialized to `Value.undefined`: this module is
// evaluated before the value intrinsics are, so touching `Value.undefined` at
// module scope throws during load.
let currentClassName: Value | undefined;

export function SetCurrentClassName(name: Value | undefined): Value | undefined {
  const previous = currentClassName;
  currentClassName = name;
  return previous;
}

function ClassElementEvaluation(node: ParseNode.MethodDefinition | ParseNode.GeneratorMethod | ParseNode.AsyncMethod | ParseNode.AsyncGeneratorMethod | ParseNode.FieldDefinition | ParseNode.ClassStaticBlock, object: ObjectValue, enumerable: BooleanValue): PlainEvaluator<PrivateElementRecord | ClassFieldDefinitionRecord | void>
// +decorator
function ClassElementEvaluation(node: ParseNode.MethodDefinition | ParseNode.GeneratorMethod | ParseNode.AsyncMethod | ParseNode.AsyncGeneratorMethod | ParseNode.FieldDefinition | ParseNode.ClassStaticBlock, object: ObjectValue): PlainEvaluator<ClassElementDefinitionRecord | ClassStaticBlockDefinitionRecord | void>
function* ClassElementEvaluation(node: ParseNode.MethodDefinition | ParseNode.GeneratorMethod | ParseNode.AsyncMethod | ParseNode.AsyncGeneratorMethod | ParseNode.FieldDefinition | ParseNode.ClassStaticBlock, object: ObjectValue, enumerable?: BooleanValue): PlainEvaluator<ClassElementDefinitionRecord | ClassFieldDefinitionRecord | ClassStaticBlockDefinitionRecord | PrivateElementRecord | void> {
  switch (node.type) {
    case 'MethodDefinition':
    case 'GeneratorMethod':
    case 'AsyncMethod':
    case 'AsyncGeneratorMethod': {
      if (surroundingAgent.feature('decorators')) {
        const decorators = node.Decorators ? Q(yield* DecoratorListEvaluation(node.Decorators)) : [];
        const methodDefinition = Q(yield* MethodDefinitionEvaluation(node, object));
        methodDefinition.Decorators = decorators;
        return methodDefinition;
      } else {
        const method = yield* MethodDefinitionEvaluation(node, object, enumerable!);
        if (surroundingAgent.feature('runtime-types')) {
          // decorators.md "Order": "A declaration's sub-targets apply before the
          // declaration itself: parameter decorators in parameter order, then
          // the return's, then the method's own." A method's decorator
          // therefore sees a method whose parts are already decorated, which is
          // the same reason a class decorator runs after its members.
          Q(yield* ApplySubTargetDecorators(node, memberContextKind(node), MemberKeyOf(node, method), object as Value));
        }
        if (surroundingAgent.feature('runtime-types') && node.Decorators) {
          // decorators.md distinguishes a method from an accessor from an
          // operator by CONTEXT TYPE rather than by a `kind` string a decorator
          // has to test, so the position decides which context is built and
          // overload resolution does the rest.
          Q(yield* ApplyDecorators(node.Decorators, Q(yield* ClassMemberDecoratorContext(
            memberContextKind(node),
            MemberKeyOf(node, method),
            (node as { static?: boolean }).static === true,
            currentClassName ?? Value.undefined,
            object as Value,
          ))));
        }
        return method;
      }
    }
    case 'FieldDefinition': {
      if (surroundingAgent.feature('decorators')) {
        const decorators = node.Decorators ? Q(yield* DecoratorListEvaluation(node.Decorators)) : [];
        const fieldDefinition = Q(yield* ClassFieldDefinitionEvaluation_decorator(node, object));
        fieldDefinition.Decorators = decorators;
        return fieldDefinition;
      } else {
        // PLAN-accessor.md stage A opens the GRAMMAR and nothing else. An
        // `accessor` field desugars to a private typed field and a get/set pair
        // whose backing participates in the memory layout (stage B), and none of
        // that is built - so the declaration is REFUSED rather than evaluated as
        // the plain field it currently resembles. A plain field would get and
        // set, which is close enough to an accessor to read as support while
        // reflecting as `ClassField` and occupying the wrong kind of slot.
        // Refusing is the honest state, and it is the same answer
        // `reservedOnlyDecorators` gives for a decorator this engine cannot run.
        const plain = Q(yield* ClassFieldDefinitionEvaluation(node, object));
        if (surroundingAgent.feature('runtime-types')) {
          // The decorators run AFTER the field definition is evaluated, because
          // "a decorator runs when the declaration it decorates is evaluated"
          // and a context that described a half-built field would be describing
          // something the program never has.
          const key = (plain as { Name?: Value }).Name;
          Q(yield* ApplyDecorators(node.Decorators, Q(yield* ClassFieldDecoratorContext(
            key ?? Value.undefined, node, currentClassName ?? Value.undefined, object as Value,
          ))));
        }
        (plain as { LayoutControls?: FieldControls }).LayoutControls = readFieldControls(node.Decorators);
        return plain;
      }
    }
    case 'ClassStaticBlock':
      return ClassStaticBlockDefinitionEvaluation(node, object);
    default:
      throw OutOfRange.exhaustive(node);
  }
}

export interface DefaultConstructorBuiltinFunction extends BuiltinFunctionObject {
  // -decorator
  readonly PrivateMethods: ECMAScriptFunctionObject['PrivateMethods'];
  readonly Fields: ECMAScriptFunctionObject['Fields'];
  // +decorator (PrivateMethods => Initializers, Fields => Elements)
  readonly Initializers: ECMAScriptFunctionObject['Initializers'];
  readonly Elements: ECMAScriptFunctionObject['Elements'];
  readonly SourceText: ECMAScriptFunctionObject['SourceText'];
  readonly ConstructorKind: ECMAScriptFunctionObject['ConstructorKind'];
  /**
   * Note: this is different than InitialName, which is used and observable in Function.prototype.toString.
   * This is only used in the inspector.
  */
  readonly HostInitialName: PropertyKeyValue | PrivateName;
  readonly HostLocation: [scriptId: string | undefined, location: Location];
}

// ClassTail : ClassHeritage? `{` ClassBody? `}`
/** https://tc39.es/ecma262/#sec-runtime-semantics-classdefinitionevaluation */
/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-runtime-semantics-classdefinitionevaluation */

/**
 * proposal-runtime-types (operatoroverloading.md): the key an operator declaration
 * takes in the class operator table. A no-parameter declaration is the unary form,
 * and a `set operator[]` is the write half of the index accessor, kept apart from
 * the read half so a write dispatches to its own declaration.
 */

/**
 * proposal-runtime-types #sec-layout-control: the seven RESERVED names. They
 * are recognized by name and never evaluated, because they are not decorators
 * in the sense of this proposal's decorators extension: a decorator there is
 * identified by the TYPE of its context parameter and resolved by overloading,
 * while these name no function at all and set property-descriptor keys. They
 * share the `@` and nothing else.
 *
 * A decorator whose name is not one of the seven is left for the decorators
 * extension, which this engine does not implement - see reservedOnlyDecorators.
 */
function reservedLayoutControl(decorator: ParseNode.Decorator): { name: string, argument: unknown } | null {
  const bare = decorator.subtype === 'MemberExpression'
    ? (decorator as { MemberExpression?: { name?: string } }).MemberExpression
    : undefined;
  if (bare && typeof bare.name === 'string') {
    return { name: bare.name, argument: undefined };
  }
  if (decorator.subtype === 'CallExpression') {
    const call = (decorator as { CallExpression?: { CallExpression?: { name?: string }, Arguments?: readonly { value?: unknown, type?: string }[] } }).CallExpression;
    const target = call?.CallExpression;
    if (target && typeof target.name === 'string') {
      const first = call?.Arguments && call.Arguments.length > 0 ? call.Arguments[0] : undefined;
      // Only a literal argument is read: a control is part of the layout, which
      // #sec-layout-properties calls a compile-time constant.
      const value = first && (first.type === 'NumericLiteral' || first.type === 'StringLiteral')
        ? (first as { value?: unknown }).value
        : undefined;
      return { name: target.name, argument: value };
    }
  }
  return null;
}

const CLASS_CONTROLS: readonly string[] = ['packed', 'alignAll', 'size'];
const FIELD_CONTROLS: readonly string[] = ['align', 'offset', 'offsetBit', 'endian'];

export function readClassControls(decorators: readonly ParseNode.Decorator[] | null | undefined): ClassControls {
  const out: { packed?: boolean, alignAll?: number, size?: number } = {};
  for (const d of decorators ?? []) {
    const control = reservedLayoutControl(d);
    if (!control || !CLASS_CONTROLS.includes(control.name)) {
      continue;
    }
    if (control.name === 'packed') {
      out.packed = true;
    } else if (typeof control.argument === 'number') {
      if (control.name === 'alignAll') {
        out.alignAll = control.argument;
      } else {
        out.size = control.argument;
      }
    }
  }
  return out;
}

export function readFieldControls(decorators: readonly ParseNode.Decorator[] | null | undefined): FieldControls {
  const out: { align?: number, offset?: number, offsetBit?: number, endian?: string } = {};
  for (const d of decorators ?? []) {
    const control = reservedLayoutControl(d);
    if (!control || !FIELD_CONTROLS.includes(control.name)) {
      continue;
    }
    if (control.name === 'endian') {
      if (typeof control.argument === 'string') {
        out.endian = control.argument;
      }
    } else if (typeof control.argument === 'number') {
      out[control.name as 'align' | 'offset' | 'offsetBit'] = control.argument;
    }
  }
  return out;
}

/**
 * proposal-runtime-types, decorators.md "Order": a decorator's EXPRESSION is
 * evaluated in document order, and the decorators are APPLIED innermost first
 * and in reverse source order — so on one declaration the decorator written
 * closest to it is applied first. The two phases run in opposite directions,
 * which is TC39's rule and Python's, and following it means a reader who knows
 * either knows these.
 *
 * That is why this evaluates the whole list before applying any of it, rather
 * than evaluating and calling each in turn: `@a(f()) @b(g()) x` must call `f()`
 * before `g()` and apply `b` before `a`, and one pass cannot do both.
 *
 * A RESERVED LAYOUT CONTROL is skipped in both phases. #sec-memory-layout says
 * the controls are "recognized syntactically and never evaluated", so `@packed`
 * is not a function call and has no expression to evaluate — which is also what
 * lets `@packed @audit a: uint8;` carry one of each.
 */
export function* ApplyDecorators(decorators: readonly ParseNode.Decorator[] | null | undefined, context: Value): PlainEvaluator<void> {
  const list = decorators ?? [];
  const applicable: ParseNode.Decorator[] = [];
  const evaluated: Value[] = [];
  const args: Value[][] = [];
  // Phase one, document order.
  for (const d of list) {
    const control = reservedLayoutControl(d);
    if (control && (CLASS_CONTROLS.includes(control.name) || FIELD_CONTROLS.includes(control.name))) {
      continue;
    }
    applicable.push(d);
    // #sec-decorator-application: "`@f`, `@f(0)`, and `@f('a')` may name three
    // declarations of f and SELECT AMONG THEM THE WAY ANY CALL DOES", and the
    // clause's note: "giving one an argument is EDITING ITS PARAMETER LIST
    // rather than rewriting it into a factory". So a decoration with arguments
    // evaluates its CALLEE and its ARGUMENTS - both in document order, both
    // part of the decorator expression - and calls once, with the written
    // arguments and the context last. Evaluating `f(0)` as a call and applying
    // its result to the context is the TC39 factory model, which this clause
    // exists to replace: it never passes the context to `f` at all.
    if (d.subtype === 'CallExpression') {
      const call = (d as unknown as { CallExpression: ParseNode.CallExpression }).CallExpression;
      const ref = Q(yield* Evaluate(call.CallExpression as ParseNode));
      const fn = Q(yield* GetValue(ref as never));
      evaluated.push(fn);
      // The plain positional evaluation: the written arguments are a PREFIX of
      // the call, not the whole of it, so the by-name evaluator cannot be used
      // here - it validates that every required parameter has an argument, and
      // the context has not been appended yet.
      args.push(Q(yield* ArgumentListEvaluation(call.Arguments)) as unknown as Value[]);
    } else {
      const expr = (d as unknown as { MemberExpression: ParseNode.MemberExpression }).MemberExpression;
      const ref = Q(yield* Evaluate(expr as ParseNode));
      evaluated.push(Q(yield* GetValue(ref as never)));
      // `@f` and `@f()` are ONE FORM: both resolve with no explicit argument.
      args.push([]);
    }
  }
  // Phase two, reverse source order.
  for (let i = applicable.length - 1; i >= 0; i -= 1) {
    const fn = evaluated[i]!;
    if (!IsCallable(fn)) {
      return Throw.TypeError('$1 is not a function', fn);
    }
    // "A decorator is an ordinary function whose LAST PARAMETER is annotated
    // with a reflection context", and the decoration BINDS the context there
    // rather than appending it: a parameter between the written arguments and
    // the context takes its own default, and the candidate needing the fewest
    // defaults wins. CallDecorator carries that rule, because it has to see
    // each candidate signature BEFORE resolution rather than after.
    Q(yield* CallDecorator(fn, args[i]!, context));
  }
  return undefined;
}

/**
 * Under `runtime-types` the ONLY decorators this engine implements are the
 * reserved layout controls. This proposal's decorators extension - context
 * types, overload resolution, replacement by return value - is a separate
 * feature and is not built, so any other decorator is refused rather than
 * evaluated as a TC39 decorator would be. Refusing is the honest state: a
 * declaration that is accepted and does nothing reads as support.
 */
export function reservedOnlyDecorators(decorators: readonly ParseNode.Decorator[] | null | undefined): ThrowCompletion | undefined {
  for (const d of decorators ?? []) {
    const control = reservedLayoutControl(d);
    if (!control || (!CLASS_CONTROLS.includes(control.name) && !FIELD_CONTROLS.includes(control.name))) {
      return Throw.TypeError('$1 is not supported yet', Value('a decorator other than a reserved layout control'));
    }
  }
  return undefined;
}

function operatorTableKey(e: ParseNode.OperatorDefinition): string {
  const name = e.OperatorName ?? '';
  if (name === '[]' && e.AccessorKind === 'set') {
    return '[]=';
  }
  return (e.FormalParameters?.length ?? 0) === 0 ? `unary ${name}` : name;
}

export function* ClassDefinitionEvaluation(ClassTail: ParseNode.ClassTail, classBinding: JSStringValue | UndefinedValue, className: PropertyKeyValue | PrivateName, sourceText: string, decorators: readonly DecoratorDefinitionRecord[]): ValueEvaluator<FunctionObject> {
  const { ClassHeritage, ClassBody } = ClassTail;
  // 1. Let env be the LexicalEnvironment of the running execution context.
  const env = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  // 2. Let classScope be NewDeclarativeEnvironment(env).
  const classScope = new DeclarativeEnvironmentRecord(env);
  // The class whose members are about to be evaluated, so their decorator
  // contexts can name it. Restored rather than cleared, since a class may be
  // declared inside another class's element.
  const outerClassName = SetCurrentClassName(classBinding instanceof UndefinedValue ? undefined : classBinding);
  // 3. If classBinding is not undefined, then
  if (!(classBinding instanceof UndefinedValue)) {
    // a. Perform classScopeEnv.CreateImmutableBinding(classBinding, true).
    classScope.CreateImmutableBinding(classBinding, Value.true);
  }
  // 4. Let outerPrivateEnvironment be the running execution context's PrivateEnvironment.
  const outerPrivateEnvironment = surroundingAgent.runningExecutionContext.PrivateEnvironment;
  // 5. Let classPrivateEnvironment be NewPrivateEnvironment(outerPrivateEnvironment).
  const classPrivateEnvironment = new PrivateEnvironmentRecord(outerPrivateEnvironment);
  // 6. If ClassBody is present, then
  if (ClassBody) {
    // a. For each String dn of the PrivateBoundIdentifiers of ClassBody, do
    for (const dn of PrivateBoundIdentifiers(ClassBody)) {
      // i. If classPrivateEnvironment.[[Names]] contains a Private Name whose [[Description]] is dn, then
      const existing = classPrivateEnvironment.Names.find((n) => n.Description.stringValue() === dn.stringValue());
      if (existing) {
        // 1. Assert: This is only possible for getter/setter pairs.
      } else { // ii. Else,
        // 1. Let name be a new Private Name whose [[Description]] value is dn.
        const name = new PrivateName(dn);
        // 2. Append name to classPrivateEnvironment.[[Names]].
        classPrivateEnvironment.Names.push(name);
      }
    }
  }
  let protoParent;
  let constructorParent: ObjectValue;
  // 7. If ClassHeritage is not present, then
  if (!ClassHeritage) {
    // a. Let protoParent be %Object.prototype%.
    protoParent = surroundingAgent.intrinsic('%Object.prototype%');
    // b. Let constructorParent be %Function.prototype%.
    constructorParent = surroundingAgent.intrinsic('%Function.prototype%');
  } else { // 8. Else,
    // a. Set the running execution context's LexicalEnvironment to classScope.
    surroundingAgent.runningExecutionContext.LexicalEnvironment = classScope;
    // b. Let superclassRef be the result of evaluating ClassHeritage.
    const superclassRef = Q(yield* Evaluate(ClassHeritage));
    // c. Set the running execution context's LexicalEnvironment to env.
    surroundingAgent.runningExecutionContext.LexicalEnvironment = env;
    // d. Let superclass be ? GetValue(superclassRef).
    const superclass = Q(yield* GetValue(superclassRef));
    // e. If superclass is null, then
    if (superclass instanceof NullValue) {
      // i. Let protoParent be null.
      protoParent = Value.null;
      // ii. Let constructorParent be %Function.prototype%.
      constructorParent = surroundingAgent.intrinsic('%Function.prototype%');
    } else if (!IsConstructor(superclass)) {
      // f. Else if IsConstructor(superclass) is false, throw a TypeError exception.
      return Throw.TypeError('Super class $1 is not a constructor', superclass);
    } else { // g. Else,
      // i. Let protoParent be ? Get(superclass, "prototype").
      protoParent = Q(yield* Get(superclass as ObjectValue, Value('prototype')));
      // ii. If Type(protoParent) is neither Object nor Null, throw a TypeError exception.
      if (!(protoParent instanceof ObjectValue) && !(protoParent instanceof NullValue)) {
        return Throw.TypeError('Super class\'s prototype must be an object or null');
      }
      // iii. Let constructorParent be superclass.
      constructorParent = superclass as ObjectValue;
    }
  }
  // 9. Let proto be OrdinaryObjectCreate(protoParent).
  const proto = OrdinaryObjectCreate(protoParent);
  let constructor;
  // 10. If ClassBody is not present, let constructor be empty.
  if (!ClassBody) {
    constructor = undefined;
  } else { // 11. Else, let constructor be ConstructorMethod of ClassBody.
    constructor = ConstructorMethod(ClassBody);
  }
  // 12. Set the running execution context's LexicalEnvironment to classScope.
  surroundingAgent.runningExecutionContext.LexicalEnvironment = classScope;
  // 13. Set the running execution context's PrivateEnvironment to classPrivateEnvironment.
  surroundingAgent.runningExecutionContext.PrivateEnvironment = classPrivateEnvironment;
  let F;
  // 14. If constructor is empty, then
  if (constructor === undefined) {
    // a. Let defaultConstructor be a new Abstract Closure with no parameters that captures nothing and performs the following steps when called:
    const defaultConstructor = function* defaultConstructor(args: Arguments, { NewTarget }: FunctionCallContext) {
      // i. Let args be the List of arguments that was passed to this function by [[Call]] or [[Construct]].
      // ii. If NewTarget is undefined, throw a TypeError exception.
      if (NewTarget instanceof UndefinedValue) {
        return Throw.TypeError('$1 cannot be invoked without new', surroundingAgent.activeFunctionObject);
      }
      // iii. Let F be the active function object.
      const F = surroundingAgent.activeFunctionObject as ECMAScriptFunctionObject; // eslint-disable-line no-shadow
      // proposal-runtime-types (spec sec-abstract-classes): an abstract class
      // with a default constructor also cannot be instantiated directly - throw
      // when NewTarget is this constructor itself, but allow a concrete subclass's
      // super() (a concrete NewTarget).
      if ((F as { IsAbstract?: boolean }).IsAbstract && (F as unknown) === NewTarget) {
        return Throw.TypeError('$1 is an abstract class and cannot be instantiated', F);
      }
      let result;
      // iv. If F.[[ConstructorKind]] is derived, then
      if (F.ConstructorKind === 'derived') {
        // 1. NOTE: This branch behaves similarly to `constructor(...args) { super(...args); }`. The most
        //    notable distinction is that while the aforementioned ECMAScript source text observably calls
        //    the @@iterator method on `%Array.prototype%`, a Default Constructor Function does not.
        // 2. Let func be ! F.[[GetPrototypeOf]]().
        const func = X(yield* F.GetPrototypeOf());
        // 3. If IsConstructor(func) is false, throw a TypeError exception.
        if (!IsConstructor(func)) {
          return Throw.TypeError('$1 is not a constructor', func);
        }
        // 4. Let result be ? Construct(func, args, NewTarget).
        result = Q(yield* Construct(func, args, NewTarget));
      } else { // v. Else,
        // 1. NOTE: This branch behaves similarly to `constructor() {}`.
        // 2. Let result be ? OrdinaryCreateFromConstructor(NewTarget, "%Object.prototype%").
        result = Q(yield* OrdinaryCreateFromConstructor(NewTarget, '%Object.prototype%'));
        // proposal-runtime-types: a placement binds between the instance being
        // created and its fields being initialized, and a class with NO
        // constructor is created here rather than in the ordinary [[Construct]]
        // - two creation paths, and a placement must be taken on both. Missing
        // this one left a default-constructor class placed in name only: its
        // fields became properties and its buffer was never written.
        if (surroundingAgent.feature('runtime-types')) {
          TakePendingPlacement(result);
        }
      }
      Q(yield* InitializeInstanceElements(result, F));
      // proposal-runtime-types (spec sec-typed-classes): a class with a typed
      // instance field seals its instances. The default (field-only) constructor
      // seals here at its outermost frame - when F is the class being new'd
      // (NewTarget) - after base and derived fields are initialized, mirroring the
      // FunctionConstructSlot path for classes with an explicit constructor.
      if (F === NewTarget && (F as { SealInstances?: boolean }).SealInstances) {
        Q(yield* result.PreventExtensions());
      }
      return result;
    };
    // b. ! CreateBuiltinFunction(defaultConstructor, 0, className, « [[ConstructorKind]], [[SourceText]], [[PrivateMethods]], [[Fields]] », the current Realm Record, constructorParent).
    F = X(CreateBuiltinFunction(markBuiltinFunctionAsConstructor(defaultConstructor), 0, className, ['ConstructorKind', 'SourceText', surroundingAgent.feature('decorators') ? 'Initializers' : 'PrivateMethods', surroundingAgent.feature('decorators') ? 'Elements' : 'Fields', 'HostLocation'], surroundingAgent.currentRealmRecord, constructorParent)) as Mutable<DefaultConstructorBuiltinFunction>;
    F.HostLocation = [getActiveScriptId(), ClassTail.location];
  } else { // 15. Else,
    // a. Let constructorInfo be ! DefineMethod of constructor with arguments proto and constructorParent.
    const constructorInfo = X(yield* DefineMethod(constructor, proto, constructorParent));
    // b. Let F be constructorInfo.[[Closure]].
    F = constructorInfo.Closure;
    // c. Perform SetFunctionName(F, className).
    SetFunctionName(F, className);
  }
  __ts_cast__<Mutable<DefaultConstructorBuiltinFunction>>(F);
  F.HostInitialName = className;
  F.SourceText = sourceText;
  // 16. Perform MakeConstructor(F, false, proto).
  MakeConstructor(F, Value.false, proto);
  // https://github.com/tc39/ecma262/pull/3212/
  // 17. Perform MakeClassConstructor(F).
  MakeClassConstructor(F);
  // 18. If ClassHeritage is present, set F.[[ConstructorKind]] to derived.
  if (ClassHeritage) {
    F.ConstructorKind = 'derived';
  }
  // 19. Perform CreateMethodProperty(proto, "constructor", F).
  X(CreateMethodProperty(proto, Value('constructor'), F));
  // 20. If ClassBody is not present, let elements be a new empty List.
  let elements: ParseNode.ClassElement[];
  if (!ClassBody) {
    elements = [];
  } else { // 20. Else, let elements be NonConstructorElements of ClassBody.
    elements = NonConstructorElements(ClassBody);
  }
  if (surroundingAgent.feature('decorators')) {
    const instanceElements: ClassElementDefinitionRecord[] = [];
    // 24. Let staticElements be a new empty List.
    const staticElements: (ClassElementDefinitionRecord | ClassStaticBlockDefinitionRecord)[] = [];
    // 25. For each ClassElement e of elements, do
    for (const e of elements) {
      if (e.type === 'OperatorDefinition' || e.type === 'AbstractMethodDefinition') {
        // proposal-runtime-types: named operators with bodies register in the
        // class operator table; abstract methods have no runtime behaviour.
        if (e.type === 'OperatorDefinition' && e.OperatorName && e.FunctionBody && e.FormalParameters) {
          const env = surroundingAgent.runningExecutionContext.LexicalEnvironment;
          const privEnv = surroundingAgent.runningExecutionContext.PrivateEnvironment;
          const opFn = OrdinaryFunctionCreate(surroundingAgent.intrinsic('%Function.prototype%'), 'operator', e.FormalParameters, e.FunctionBody, 'non-lexical-this', env, privEnv);
          RegisterClassOperator(e.static ? F : proto, operatorTableKey(e), opFn);
        }
        continue;
      }
      let result;
      // a. If IsStatic of e is false, then
      if (!IsStatic(e)) {
        result = yield* ClassElementEvaluation(e, proto);
      } else {
        result = yield* ClassElementEvaluation(e, F);
      }
      // c. If field is an abrupt completion, then
      if (result instanceof AbruptCompletion) {
        // i. Set the running execution context's LexicalEnvironment to env.
        surroundingAgent.runningExecutionContext.LexicalEnvironment = env;
        // ii. Set the running execution context's PrivateEnvironment to outerPrivateEnvironment.
        surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
        return result;
      }
      const element = X(result);
      if (element instanceof ClassElementDefinitionRecord) {
        if (!IsStatic(e)) {
          instanceElements.push(element);
        } else {
          staticElements.push(element);
        }
      } else {
        Assert(element instanceof ClassStaticBlockDefinitionRecord);
        staticElements.push(element);
      }
    }
    // 26. Set the running execution context's LexicalEnvironment to env.
    surroundingAgent.runningExecutionContext.LexicalEnvironment = env;
    const instanceMethodExtraInitializers: FunctionObject[] = [];
    const staticMethodExtraInitializers: FunctionObject[] = [];
    for (const e of staticElements) {
      if (e instanceof ClassElementDefinitionRecord && e.Kind !== 'field') {
        let extraInitializers: FunctionObject[];
        if (e.Kind === 'accessor') {
          extraInitializers = e.ExtraInitializers;
        } else {
          extraInitializers = staticMethodExtraInitializers;
        }
        const result = yield* ApplyDecoratorsAndDefineMethod(F, e, extraInitializers, true);
        if (result instanceof AbruptCompletion) {
          surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
          return result;
        }
      }
    }
    for (const e of instanceElements) {
      let extraInitializers: FunctionObject[];
      if (e.Kind !== 'field') {
        if (e.Kind === 'accessor') {
          extraInitializers = e.ExtraInitializers;
        } else {
          extraInitializers = instanceMethodExtraInitializers;
        }
        const result = yield* ApplyDecoratorsAndDefineMethod(proto, e, extraInitializers, false);
        if (result instanceof AbruptCompletion) {
          surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
          return result;
        }
      }
    }
    for (const e of staticElements) {
      if (e instanceof ClassElementDefinitionRecord && e.Kind === 'field') {
        const result = yield* ApplyDecoratorsToElementDefinition(F, e, e.ExtraInitializers, true);
        if (result instanceof AbruptCompletion) {
          surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
          return result;
        }
      }
    }
    for (const e of instanceElements) {
      if (e.Kind === 'field') {
        const result = yield* ApplyDecoratorsToElementDefinition(proto, e, e.ExtraInitializers, false);
        if (result instanceof AbruptCompletion) {
          surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
          return result;
        }
      }
    }
    F.Elements = instanceElements;
    F.Initializers = instanceMethodExtraInitializers;
    // TODO(decorator): spec bug?
    // Q(yield* InitializePrivateMethods(F, staticElements));
    Q(yield* InitializePrivateMethods(F, staticElements.filter((element): element is ClassElementDefinitionRecord => element instanceof ClassElementDefinitionRecord)));
    const classExtraInitializers: FunctionObject[] = [];
    const newF = yield* ApplyDecoratorsToClassDefinition(F, decorators, className, classExtraInitializers);
    if (newF instanceof AbruptCompletion) {
      surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
      return newF;
    }
    F = Q(newF);
    // 27. If classBinding is not undefined, then
    if (!(classBinding instanceof UndefinedValue)) {
      // a. Perform classScope.InitializeBinding(classBinding, F).
      yield* classScope.InitializeBinding(classBinding, F);
    }
    for (const initializer of staticMethodExtraInitializers) {
      const result = yield* Call(initializer, F);
      if (result instanceof AbruptCompletion) {
        surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
        return result;
      }
    }
    // 31. For each element elementRecord of staticElements, do
    for (const elementRecord of staticElements) {
      let result;
      // a. If elementRecord is a ClassFieldDefinition Record, then
      if (elementRecord instanceof ClassElementDefinitionRecord && (elementRecord.Kind === 'field' || elementRecord.Kind === 'accessor')) {
        // a. Let result be DefineField(F, elementRecord).
        result = yield* InitializeFieldOrAccessor(F, elementRecord);
      } else if (elementRecord instanceof ClassStaticBlockDefinitionRecord) {
        result = yield* Call(elementRecord.BodyFunction, F);
      }
      // c. If result is an abrupt completion, then
      if (result instanceof AbruptCompletion) {
        // i. Set the running execution context's PrivateEnvironment to outerPrivateEnvironment.
        surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
        // ii. Return result.
        return result;
      }
    }
    for (const initializer of classExtraInitializers) {
      const result = yield* Call(initializer, F);
      if (result instanceof AbruptCompletion) {
        surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
        return result;
      }
    }
    // proposal-runtime-types #sec-typed-storage: "...is automatically sealed, as
    // if PreventExtensions had been performed on each of its instances, AND ITS
    // PROTOTYPE IS FROZEN." The instance half was recorded above as
    // [[SealInstances]] and applied at field initialization; the prototype half
    // was described in the comment there and never performed, so a typed class's
    // prototype was an ordinary mutable object and a program could add to or
    // replace a method on it after the declaration.
    //
    // Frozen HERE, at the end of the evaluation, because the prototype is only
    // complete once the static elements above have run: freezing at the point
    // the decision is recorded would refuse the class's own methods.
    //
    // Sealing follows from ONE typed field, not from every field being typed:
    // #sec-typed-classes says "at least one of its public or private fields",
    // and the reason is that sealing is what makes a field's type a fact about
    // the layout at all, which one typed field already asks for.
    if ((F as { SealInstances?: boolean }).SealInstances === true) {
      Q(yield* SetIntegrityLevel(proto, 'frozen'));
    }
    // 32. Set the running execution context's PrivateEnvironment to outerPrivateEnvironment.
    surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
    // 33. Return F.
    SetCurrentClassName(outerClassName);
    return F;
  } else {
    // 21. Let instancePrivateMethods be a new empty List.
    const instancePrivateMethods: never[] = [];
    // 22. Let staticPrivateMethods be a new empty List.
    const staticPrivateMethods: never[] = [];
    // 23. Let instanceFields be a new empty List.
    const instanceFields: ClassFieldDefinitionRecord[] = [];
    // 24. Let staticElements be a new empty List.
    const staticElements: (ClassFieldDefinitionRecord | ClassStaticBlockDefinitionRecord)[] = [];
    // 25. For each ClassElement e of elements, do
    for (const e of elements) {
      if (e.type === 'OperatorDefinition' || e.type === 'AbstractMethodDefinition') {
        // proposal-runtime-types: named operators with bodies register in the
        // class operator table; abstract methods have no runtime behaviour.
        if (e.type === 'OperatorDefinition' && e.OperatorName && e.FunctionBody && e.FormalParameters) {
          const env = surroundingAgent.runningExecutionContext.LexicalEnvironment;
          const privEnv = surroundingAgent.runningExecutionContext.PrivateEnvironment;
          const opFn = OrdinaryFunctionCreate(surroundingAgent.intrinsic('%Function.prototype%'), 'operator', e.FormalParameters, e.FunctionBody, 'non-lexical-this', env, privEnv);
          RegisterClassOperator(e.static ? F : proto, operatorTableKey(e), opFn);
        }
        // proposal-runtime-types decorators.md "Order": a declaration's
        // sub-targets apply before the declaration itself. An OperatorDefinition
        // and an AbstractMethodDefinition are intercepted here and never reach
        // ClassElementEvaluation, which is where every other member's
        // sub-targets are applied - so without this the parameter and return
        // decorators of these two positions PARSE AND SILENTLY NEVER FIRE,
        // which reads as support and is worse than the SyntaxError the
        // operator's own decorator still gives.
        //
        // Only on this branch: the one above belongs to the TC39 `decorators`
        // feature, which is mutually exclusive with `runtime-types` and refused
        // at the Agent.
        if (surroundingAgent.feature('runtime-types')) {
          const isOperator = e.type === 'OperatorDefinition';
          Q(yield* ApplySubTargetDecorators(
            e,
            isOperator ? 'ClassOperator' : 'ClassMethod',
            isOperator ? Value(operatorTableKey(e)) : MemberKeyOf(e, undefined),
            (e.static ? F : proto) as Value,
          ));
        }
        continue;
      }
      let field;
      // a. If IsStatic of e is false, then
      if (IsStatic(e) === false) {
        // i. Let field be ClassElementEvaluation of e with arguments proto and false.
        field = (yield* ClassElementEvaluation(e, proto, Value.false))!;
      } else { // b. Else,
        // i. Let field be ClassElementEvaluation of e with arguments F and false.
        field = (yield* ClassElementEvaluation(e, F, Value.false))!;
      }
      // c. If field is an abrupt completion, then
      if (field instanceof AbruptCompletion) {
        // i. Set the running execution context's LexicalEnvironment to env.
        surroundingAgent.runningExecutionContext.LexicalEnvironment = env;
        // ii. Set the running execution context's PrivateEnvironment to outerPrivateEnvironment.
        surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
        // iii. Return Completion(field).
        return field;
      }
      // d. Set field to field.[[Value]].
      Q(field);
      // e. If field is a PrivateElement, then
      if (field instanceof PrivateElementRecord) {
        // i. Assert: field.[[Kind]] is either method or accessor.
        Assert(field.Kind === 'method' || field.Kind === 'accessor');
        // ii. If IsStatic of e is false, let container be instancePrivateMethods.
        let container: PrivateElementRecord[];
        if (IsStatic(e) === false) {
          container = instancePrivateMethods;
        } else { // iii. Else, let container be staticPrivateMethods.
          container = staticPrivateMethods;
        }
        // iv. If container contains a PrivateElement whose [[Key]] is field.[[Key]], then
        const index = container.findIndex((el) => el.Key === field.Key);
        if (index >= 0) {
          // 1. Let existing be that PrivateElement.
          const existing = container[index];
          // 2. Assert: field.[[Kind]] and existing.[[Kind]] are both accessor.
          Assert(field.Kind === 'accessor' && existing.Kind === 'accessor');
          // 3. If field.[[Get]] is undefined, then
          let combined;
          if (field.Getter === Value.undefined) {
            combined = PrivateElementRecord({
              Key: field.Key,
              Kind: 'accessor',
              Getter: existing.Getter,
              Setter: field.Setter,
            });
          } else { // 4. Else
            combined = PrivateElementRecord({
              Key: field.Key,
              Kind: 'accessor',
              Getter: field.Getter,
              Setter: existing.Setter,
            });
          }
          // 5. Replace existing in container with combined.
          container[index] = combined;
        } else { // v. Else,
          // 1. Append field to container.
          container.push(field);
        }
      } else if (field instanceof ClassFieldDefinitionRecord) { // f. Else if field is a ClassFieldDefinition Record, then
        // i. If IsStatic of e is false, append field to instanceFields.
        if (IsStatic(e) === false) {
          instanceFields.push(field);
        } else { // ii. Else, append field to staticElements.
          staticElements.push(field);
        }
      } else if (field instanceof ClassStaticBlockDefinitionRecord) { // g. Else if element is a ClassStaticBlockDefinition Record, then
        // i. Append element to staticElements.
        staticElements.push(field);
      }
    }
    // 26. Set the running execution context's LexicalEnvironment to env.
    surroundingAgent.runningExecutionContext.LexicalEnvironment = env;
    // 27. If classBinding is not undefined, then
    if (!(classBinding instanceof UndefinedValue)) {
      // a. Perform classScope.InitializeBinding(classBinding, F).
      yield* classScope.InitializeBinding(classBinding, F);
    }
    // 28. Set F.[[PrivateMethods]] to instancePrivateMethods.
    F.PrivateMethods = instancePrivateMethods;
    // 29. Set F.[[Fields]] to instanceFields.
    F.Fields = instanceFields;
    // proposal-runtime-types (spec sec-typed-classes): a class in which at least
    // one public or private instance field is typed is automatically sealed - its
    // instances have PreventExtensions performed and its prototype is frozen - so
    // that a field may be written but a property may not be added or removed. A
    // class whose fields are typed opts out with the `dynamic` modifier. We record
    // the decision on the constructor here (the class body and modifiers are in
    // scope) and enforce it when each instance's fields are initialized. Whether
    // instances additionally get value-type layout (contiguous memory, byteLength,
    // array views) is the memory-layout extension and is not decided here.
    {
      const modifiers = (ClassTail as { parent?: { ClassModifiers?: readonly string[] | null } }).parent?.ClassModifiers ?? [];
      const isDynamic = modifiers.includes('dynamic');
      const hasTypedInstanceField = (ClassBody ?? []).some((el) => (el as { type?: string, static?: boolean, TypeAnnotation?: unknown }).type === 'FieldDefinition'
        && !(el as { static?: boolean }).static
        && (el as { TypeAnnotation?: unknown }).TypeAnnotation !== undefined
        && (el as { TypeAnnotation?: unknown }).TypeAnnotation !== null);
      (F as { SealInstances?: boolean }).SealInstances = hasTypedInstanceField && !isDynamic;
      // proposal-runtime-types (spec sec-abstract-classes): an abstract class
      // cannot be instantiated - its constructor's [[Construct]] throws a
      // TypeError when NewTarget is that constructor itself, while super() from a
      // concrete subclass (a concrete NewTarget) runs it as a constructor body.
      (F as { IsAbstract?: boolean }).IsAbstract = modifiers.includes('abstract');
    }
    // 30. For each PrivateElement method of staticPrivateMethods, do
    for (const method of staticPrivateMethods) {
      // a. Perform ! PrivateMethodOrAccessorAdd(F, method).
      Q(yield* PrivateMethodOrAccessorAdd(F, method));
    }
    // 31. For each element elementRecord of staticElements, do
    for (const elementRecord of staticElements) {
      let result;
      // a. If elementRecord is a ClassFieldDefinition Record, then
      if (elementRecord instanceof ClassFieldDefinitionRecord) {
        // a. Let result be DefineField(F, elementRecord).
        result = yield* DefineField(F, elementRecord);
      } else { // b. Else,
        // i. Assert: elementRecord is a ClassStaticBlockDefinition Record.
        Assert(elementRecord instanceof ClassStaticBlockDefinitionRecord);
        // ii. Let result be Completion(Call(elementRecord.[[BodyFunction]], F)).
        result = yield* Call(elementRecord.BodyFunction, F);
      }
      // c. If result is an abrupt completion, then
      if (result instanceof AbruptCompletion) {
        // i. Set the running execution context's PrivateEnvironment to outerPrivateEnvironment.
        surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
        // ii. Return result.
        return result;
      }
    }
    // #sec-typed-storage's prototype freeze, on this branch too. The evaluation
    // has two exits and only one of them was taken by an ordinary declaration,
    // which is why the first placement of this appeared to do nothing.
    // #sec-memory-layout: the value type class row of the layout table. Computed
    // HERE, at declaration, because every field's type is already resolved into
    // its ClassFieldDefinition Record's [[TypeObject]] - resolving them again at
    // each read of `byteLength` would be a generator's work, and
    // #sec-layout-properties calls these compile-time constants.
    //
    // FINITENESS needs no cycle guard at this point, which is worth stating
    // because the plan expected one: a class whose field type names the class
    // itself is already refused by the ordinary temporal dead zone, before any
    // layout is computed - `class A { a: A; }` is a ReferenceError. The
    // condition of #sec-layout-finiteness therefore holds by construction here.
    // What does NOT hold is the other half of that clause: `class N { next: N |
    // null; }` is refused by the same TDZ, and the clause says a `T | null`
    // field closes a cycle because it is a reference, "which is why a linked
    // list is expressible". That over-refusal is recorded rather than fixed
    // here; it is a binding-resolution question, not a layout one.
    if ((F as { SealInstances?: boolean }).SealInstances === true) {
      const baseCtor = constructorParent as { InstanceLayout?: ClassLayout | null } | undefined;
      const baseLayout = (baseCtor && typeof baseCtor === 'object' && 'InstanceLayout' in baseCtor)
        ? baseCtor.InstanceLayout ?? null
        : null;
      const classControls = readClassControls((ClassTail as { parent?: { Decorators?: readonly ParseNode.Decorator[] | null } }).parent?.Decorators);
      const laidOut: { key: string, type: TypeRecord, controls?: FieldControls }[] = [];
      let complete = true;
      for (const field of instanceFields) {
        const typeObject = (field as { TypeObject?: { TypeRecord?: TypeRecord } }).TypeObject;
        const name = (field as { Name?: unknown }).Name;
        if (!typeObject?.TypeRecord || typeof (name as { stringValue?: unknown })?.stringValue !== 'function') {
          // An untyped field, or a private name: the table's "a class with an
          // untyped field" row gives the whole class no layout.
          complete = false;
          break;
        }
        laidOut.push({
          key: (name as { stringValue(): string }).stringValue(),
          type: typeObject.TypeRecord,
          controls: (field as { LayoutControls?: FieldControls }).LayoutControls,
        });
      }
      const computed = complete ? ComputeClassLayout(baseLayout, laidOut, classControls, (ClassTail as { parent?: unknown }).parent) : null;
      if (computed !== null && 'cycle' in computed) {
        // #sec-layout-finiteness, reported at the declaration that closes the
        // cycle rather than where a size is later asked for.
        return Throw.TypeError('$1 contains itself through field $2, so it has no finite layout', className as Value, Value(computed.cycle));
      }
      (F as { InstanceLayout?: ClassLayout | null }).InstanceLayout = computed;
    }
    if ((F as { SealInstances?: boolean }).SealInstances === true) {
      Q(yield* SetIntegrityLevel(proto, 'frozen'));
    }
    // 32. Set the running execution context's PrivateEnvironment to outerPrivateEnvironment.
    surroundingAgent.runningExecutionContext.PrivateEnvironment = outerPrivateEnvironment;
    // 33. Return F.
    SetCurrentClassName(outerClassName);
    return F;
  }
}

/**
 * proposal-runtime-types (README "Class Extension"): merge the members of a
 * `partial class` body into an existing class rather than creating a new one. The
 * existing constructor F and its prototype receive the new methods and operators:
 * an instance member is defined on the prototype, a static member on the
 * constructor, and a named operator registers in the class operator table on the
 * same object a fresh declaration would use. Fields, private members, and a
 * constructor are not re-opened here; a partial class adds behaviour, not state or
 * a second constructor. The class's own environment for member evaluation is the
 * running execution context's, since a partial declaration is evaluated where it
 * is written.
 */
export function* PartialClassMergeEvaluation(F: FunctionObject, ClassTail: ParseNode.ClassTail): PlainEvaluator<void> {
  const ClassBody = ClassTail.ClassBody;
  if (!ClassBody) {
    return undefined;
  }
  const proto = Q(yield* Get(F, Value('prototype')));
  // #sec-partial-classes: a `partial` declaration "adds behaviour and no cases:
  // it introduces no subclass and no instance state, so it does not enlarge the
  // closed set of a sealed hierarchy and DOES NOT CHANGE A CLASS'S LAYOUT". It
  // is therefore permitted over a typed class, whose prototype
  // #sec-typed-storage freezes - and the two are only in tension at the
  // implementation, where a frozen prototype refuses the DefineOwnProperty a
  // merge is made of.
  //
  // The freeze is against a PROGRAM mutating the prototype after the fact. A
  // partial declaration is not that: it is part of how the class is declared,
  // spread across modules, and refusing it would make the two specified
  // features contradict each other. So the merge lifts the freeze for its own
  // duration and restores it, which leaves nothing observable between the two:
  // a program cannot run in the gap, since the merge evaluates without calling
  // user code.
  const wasFrozen = proto instanceof ObjectValue && (F as { SealInstances?: boolean }).SealInstances === true
    && Q(yield* TestIntegrityLevel(proto, 'frozen'));
  if (wasFrozen) {
    (proto as unknown as { Extensible: unknown }).Extensible = Value.true;
    for (const key of Q(yield* (proto as ObjectValue).OwnPropertyKeys())) {
      const desc = Q(yield* (proto as ObjectValue).GetOwnProperty(key));
      if (desc instanceof Descriptor && desc.Configurable === Value.false) {
        Q(yield* (proto as ObjectValue).DefineOwnProperty(key, Descriptor({ Configurable: Value.true })));
      }
    }
  }
  if (!(proto instanceof ObjectValue)) {
    return Throw.TypeError('$1 cannot be extended by a partial class', F);
  }
  const elements = NonConstructorElements(ClassBody);
  for (const e of elements) {
    if (e.type === 'OperatorDefinition' || e.type === 'AbstractMethodDefinition') {
      if (e.type === 'OperatorDefinition' && e.OperatorName && e.FunctionBody && e.FormalParameters) {
        const env = surroundingAgent.runningExecutionContext.LexicalEnvironment;
        const privEnv = surroundingAgent.runningExecutionContext.PrivateEnvironment;
        const opFn = OrdinaryFunctionCreate(surroundingAgent.intrinsic('%Function.prototype%'), 'operator', e.FormalParameters, e.FunctionBody, 'non-lexical-this', env, privEnv);
        RegisterClassOperator(e.static ? F : proto, operatorTableKey(e), opFn);
      }
      continue;
    }
    if (e.type === 'FieldDefinition' || e.type === 'ClassStaticBlock') {
      // A partial class adds behaviour, not state. A field or static block in a
      // partial body is not merged; its members are methods and operators.
      continue;
    }
    const target = IsStatic(e) ? (F as ObjectValue) : proto;
    Q(yield* MethodDefinitionEvaluation(e, target, Value.false));
  }
  // Restored before the exit. The merge evaluates no user code between the lift
  // and here, so nothing can observe the prototype unfrozen.
  if (wasFrozen) {
    Q(yield* SetIntegrityLevel(proto as ObjectValue, 'frozen'));
  }
  return undefined;
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-decoratorevaluation */
export function* DecoratorEvaluation(decorator: ParseNode.Decorator): PlainEvaluator<DecoratorDefinitionRecord> {
  const expr = decorator.MemberExpression || decorator.CallExpression || decorator.ParenthesizedExpression;
  const ref = Q(yield* Evaluate(expr));
  const value = Q(yield* GetValue(ref));
  return { Decorator: value, Receiver: ref };
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-decoratorelistvaluation */
export function* DecoratorListEvaluation(decoratorList: readonly ParseNode.Decorator[]): PlainEvaluator<DecoratorDefinitionRecord[]> {
  const decorators: DecoratorDefinitionRecord[] = [];
  for (const decoratorNode of decoratorList) {
    const decoratorRecord = Q(yield* DecoratorEvaluation(decoratorNode));
    decorators.unshift(decoratorRecord);
  }
  return decorators;
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-createdecoratoraccessobject */
export function CreateDecoratorAccessObject(kind: ClassElementDefinitionRecord['Kind'], name: PropertyKeyValue | PrivateName): ObjectValue {
  const accessObj = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%'));
  if (kind === 'field' || kind === 'method' || kind === 'accessor' || kind === 'getter') {
    const getterClosure = function* getter([obj = Value.undefined]: Arguments) {
      if (!(obj instanceof ObjectValue)) {
        return Throw.TypeError('Invalid receiver');
      }
      if (IsPropertyKey(name)) {
        return Q(yield* Get(obj, name));
      } else {
        return Q(yield* PrivateGet(obj, name));
      }
    };
    const getter = CreateBuiltinFunction(getterClosure, 1, Value(''), []);
    X(CreateDataPropertyOrThrow(accessObj, Value('get'), getter));
  }
  if (kind === 'field' || kind === 'accessor' || kind === 'setter') {
    const setterClosure = function* setter([obj = Value.undefined, value = Value.undefined]: Arguments) {
      if (!(obj instanceof ObjectValue)) {
        return Throw.TypeError('Invalid receiver');
      }
      if (IsPropertyKey(name)) {
        return Q(yield* Set(obj, name, value, Value.true));
      } else {
        return Q(yield* PrivateSet(obj, name, value));
      }
    };
    const setter = CreateBuiltinFunction(setterClosure, 2, Value(''), []);
    X(CreateDataPropertyOrThrow(accessObj, Value('set'), setter));
  }
  const hasClosure = function* has(this: Value, [obj = Value.undefined]: Arguments) {
    if (!(obj instanceof ObjectValue)) {
      return Throw.TypeError('Invalid receiver');
    }
    if (IsPropertyKey(name)) {
      return Q(yield* HasProperty(obj, name));
    }
    if (PrivateElementFind(name, obj)) {
      return Value.true;
    }
    return Value.false;
  };
  const has = CreateBuiltinFunction(hasClosure, 1, Value('has'), []);
  X(CreateDataPropertyOrThrow(accessObj, Value('has'), has));
  return accessObj;
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-createaddinitializerfunction */
// TODO(decorator): spec bug, initializers should not require ECMAScriptFunctionObject
export function CreateAddInitializerFunction(initializers: FunctionObject[], decorationState: { Finished: boolean }): FunctionObject {
  const addInitializerClosure = function* addInitializer(this: Value, [initializer = Value.undefined]: Arguments) {
    if (decorationState.Finished) {
      return Throw.TypeError('Cannot call addInitializer after decoration is finished');
    }
    if (!IsCallable(initializer)) {
      return Throw.TypeError('addInitializer must be called with a function, but $1 was passed', initializer);
    }
    initializers.push(initializer);
    return Value.undefined;
  };
  return CreateBuiltinFunction(addInitializerClosure, 1, Value('addInitializer'), []);
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-createdecoratorcontextobject */
export function CreateDecoratorContextObject(kind: 'class' | ClassElementDefinitionRecord['Kind'], name: PropertyKeyValue | PrivateName, initializers: FunctionObject[], decorationState: { Finished: boolean }, isStatic?: boolean): ObjectValue {
  const contextObj = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%'));
  const kindStr = Value(kind);
  X(CreateDataPropertyOrThrow(contextObj, Value('kind'), kindStr));
  StampReflectionContext(contextObj, kindStr.stringValue());
  if (kind !== 'class') {
    X(CreateDataPropertyOrThrow(contextObj, Value('access'), CreateDecoratorAccessObject(kind, name)));
    if (isStatic !== undefined) {
      X(CreateDataPropertyOrThrow(contextObj, Value('static'), Value(isStatic)));
    }
    if (name instanceof PrivateName) {
      X(CreateDataPropertyOrThrow(contextObj, Value('private'), Value.true));
      X(CreateDataPropertyOrThrow(contextObj, Value('name'), name.Description));
    } else {
      X(CreateDataPropertyOrThrow(contextObj, Value('private'), Value.false));
      X(CreateDataPropertyOrThrow(contextObj, Value('name'), name));
    }
  } else {
    // TODO(decorator): spec bug, no assert to the name
    X(CreateDataPropertyOrThrow(contextObj, Value('name'), name as PropertyKeyValue));
  }
  const addInitializer = CreateAddInitializerFunction(initializers, decorationState);
  X(CreateDataPropertyOrThrow(contextObj, Value('addInitializer'), addInitializer));
  return contextObj;
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-applydecoratorstoelementdefinition */
// TODO(decorator): unused parameter in the spec
export function* ApplyDecoratorsToElementDefinition(_homeObject: ObjectValue, elementRecord: ClassElementDefinitionRecord, extraInitializers: FunctionObject[], isStatic: boolean): PlainEvaluator<void> {
  const decorators = elementRecord.Decorators;
  if (!decorators || decorators.length === 0) {
    return undefined;
  }
  const key = elementRecord.Key;
  const kind = elementRecord.Kind;
  for (const decoratorRecord of decorators) {
    const decorator = decoratorRecord.Decorator;
    const decoratorReceiver = decoratorRecord.Receiver;
    const decorationState = { Finished: false };
    const context = CreateDecoratorContextObject(kind, key, extraInitializers, decorationState, isStatic);
    let value: Value = Value.undefined;
    if (kind === 'method') {
      value = elementRecord.Value;
    } else if (kind === 'getter') {
      value = elementRecord.Get;
    } else if (kind === 'setter') {
      value = elementRecord.Set;
    } else if (kind === 'accessor') {
      value = OrdinaryObjectCreate(surroundingAgent.intrinsic('%Object.prototype%'));
      X(CreateDataPropertyOrThrow(value, Value('get'), elementRecord.Get));
      X(CreateDataPropertyOrThrow(value, Value('set'), elementRecord.Set));
    }
    // TODO(decorator): spec bug, missing GetValue call
    // const newValue = Q(yield* Call(decorator, decoratorReceiver), [value, context]));
    const newValue = Q(yield* Call(decorator, Q(yield* GetValue(decoratorReceiver)), [value, context]));
    decorationState.Finished = true;
    if (kind === 'field') {
      if (IsCallable(newValue)) {
        // TODO(decorator): spec bug. ApplyDecoratorsToElementDefinition unshift decorator initializers into this array, but read it in order, so the spec order is wrong (be like [decorator2, decorator1, syntaxInit], but the correct order should be [syntaxInit, decorator2, decorator1])
        elementRecord.Initializers.unshift(newValue);
      } else if (newValue !== Value.undefined) {
        return Throw.TypeError('Field decorator must return a function or undefined, but $1 was returned', newValue);
      }
    } else if (kind === 'accessor') {
      if (newValue instanceof ObjectValue) {
        const newGetter = Q(yield* Get(newValue, Value('get')));
        if (IsCallable(newGetter)) {
          elementRecord.Get = newGetter;
        } else if (newGetter !== Value.undefined) {
          return Throw.TypeError('The get property of the return value of an accessor decorator must be a function or undefined, but $1 was returned', newGetter);
        }
        const newSetter = Q(yield* Get(newValue, Value('set')));
        if (IsCallable(newSetter)) {
          elementRecord.Set = newSetter;
        } else if (newSetter !== Value.undefined) {
          return Throw.TypeError('The set property of the return value of an accessor decorator must be a function or undefined, but $1 was returned', newSetter);
        }
        const initializer = Q(yield* Get(newValue, Value('init')));
        if (IsCallable(initializer)) {
          // TODO(decorator): spec bug. ApplyDecoratorsToElementDefinition unshift decorator initializers into this array, but read it in order, so the spec order is wrong (be like [decorator2, decorator1, syntaxInit], but the correct order should be [syntaxInit, decorator2, decorator1])
          elementRecord.Initializers.unshift(initializer);
        } else if (initializer !== Value.undefined) {
          return Throw.TypeError('The init property of the return value of an accessor decorator must be a function or undefined, but $1 was returned', initializer);
        }
      } else if (newValue !== Value.undefined) {
        return Throw.TypeError('Accessor decorator must return an object or undefined, but $1 was returned', newValue);
      }
    } else {
      if (IsCallable(newValue)) {
        if (kind === 'getter') {
          elementRecord.Get = newValue;
        } else if (kind === 'setter') {
          elementRecord.Set = newValue;
        } else {
          elementRecord.Value = newValue;
        }
      } else if (newValue !== Value.undefined) {
        return Throw.TypeError('Method decorator must return a function or undefined, but $1 was returned', newValue);
      }
    }
  }
  elementRecord.Decorators = undefined;
  return undefined;
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-applydecoratorstoclassdefinition */
export function* ApplyDecoratorsToClassDefinition(classDef: FunctionObject, decorators: readonly DecoratorDefinitionRecord[], className: PropertyKeyValue | PrivateName, extraInitializers: FunctionObject[]): PlainEvaluator<FunctionObject> {
  for (const decoratorRecord of decorators) {
    const decorator = decoratorRecord.Decorator;
    const decoratorReceiver = decoratorRecord.Receiver;
    const decorationState = { Finished: false };
    const context = CreateDecoratorContextObject('class', className, extraInitializers, decorationState);
    // TODO(decorator): spec bug, missing GetValue call
    // const newDef = Q(yield* Call(decorator, decoratorReceiver, [classDef, context]));
    const newDef = Q(yield* Call(decorator, Q(yield* GetValue(decoratorReceiver)), [classDef, context]));
    decorationState.Finished = true;
    if (IsCallable(newDef)) {
      classDef = newDef;
    } else if (newDef !== Value.undefined) {
      return Throw.TypeError('Class decorator must return a function or undefined, but $1 was returned', newDef);
    }
  }
  return classDef;
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-applydecoratorsanddefinemethod */
export function* ApplyDecoratorsAndDefineMethod(homeObject: ObjectValue, methodDefinition: ClassElementDefinitionRecord, extraInitializers: FunctionObject[], isStatic: boolean): PlainEvaluator<void> {
  Q(yield* ApplyDecoratorsToElementDefinition(homeObject, methodDefinition, extraInitializers, isStatic));
  // TODO(decorator): spec bug, enumerable of class methods, whether decorated or not, should always be false
  // Q(yield* DefineMethodProperty(homeObject, methodDefinition, isStatic));
  Q(yield* DefineMethodProperty(homeObject, methodDefinition, false));
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-decoratordefinition-record-specification-type */
export interface DecoratorDefinitionRecord {
  readonly Decorator: Value;
  readonly Receiver: ReferenceRecord | Value;
}

/** https://arai-a.github.io/ecma262-compare/snapshot.html?pr=2417#sec-classfielddefinition-record-specification-type */
export type ClassElementDefinitionRecord = ClassElementDefinitionRecord_Method | ClassElementDefinitionRecord_Field | ClassElementDefinitionRecord_Accessor | ClassElementDefinitionRecord_Getter | ClassElementDefinitionRecord_Setter;
export interface ClassElementDefinitionRecord_Method {
  readonly Kind: 'method';
  readonly Key: PrivateName | JSStringValue | SymbolValue;
  // TODO(decorator): spec bug, spec is ECMAScriptFunctionObject
  Value: FunctionObject;
  Decorators: DecoratorDefinitionRecord[] | undefined;
}
export interface ClassElementDefinitionRecord_Field {
  readonly Kind: 'field';
  readonly Key: PrivateName | JSStringValue | SymbolValue;
  Decorators: DecoratorDefinitionRecord[] | undefined;
  readonly Initializers: FunctionObject[];
  readonly ExtraInitializers: FunctionObject[];
}
export interface ClassElementDefinitionRecord_Accessor {
  readonly Kind: 'accessor';
  readonly Key: PrivateName | JSStringValue | SymbolValue;
  // https://github.com/tc39/proposal-decorators/issues/572
  Get: FunctionObject;
  // https://github.com/tc39/proposal-decorators/issues/572
  Set: FunctionObject;
  readonly BackingStorageKey: PrivateName;
  Decorators: readonly DecoratorDefinitionRecord[] | undefined;
  readonly Initializers: FunctionObject[];
  readonly ExtraInitializers: FunctionObject[];
}
export interface ClassElementDefinitionRecord_Getter {
  readonly Kind: 'getter';
  readonly Key: PrivateName | JSStringValue | SymbolValue;
  // https://github.com/tc39/proposal-decorators/issues/572
  Get: FunctionObject;
  Decorators: readonly DecoratorDefinitionRecord[] | undefined;
}
export interface ClassElementDefinitionRecord_Setter {
  readonly Kind: 'setter';
  readonly Key: PrivateName | JSStringValue | SymbolValue;
  // https://github.com/tc39/proposal-decorators/issues/572
  Set: FunctionObject;
  Decorators: readonly DecoratorDefinitionRecord[] | undefined;
}

// This is a struct defined as a marco.
export const ClassElementDefinitionRecord = (function ClassElementDefinitionRecord(record: ClassElementDefinitionRecord) {
  Object.setPrototypeOf(record, ClassElementDefinitionRecord.prototype);
  return record;
}) as {
  (record: ClassElementDefinitionRecord): ClassElementDefinitionRecord;
  [Symbol.hasInstance](instance: unknown): instance is ClassElementDefinitionRecord;
};

/**
 * proposal-runtime-types #sec-applying-a-decorator: the context a `ClassField`
 * decoration supplies as its last argument.
 *
 * decorators.md's `ClassFieldReflection` is larger than this — `type`, `static`,
 * `private`, `protected`, `readonly`, `initial`, `offset`, `byteLength`, and
 * `metadata`. Stage A of PLAN-decorators.md builds the CALL, not the contexts,
 * so this carries the `kind` and the `name` that identify what was decorated
 * and leaves the rest to stage B, which widens `Reflect.ClassField` properly.
 * A partial context is stated here rather than implied, so that a stage B that
 * forgets a field fails a test rather than shipping a hole.
 */
export function* ClassFieldDecoratorContext(key: Value, node: ParseNode, className: Value, classCtor: Value): ValueEvaluator {
  const realm = surroundingAgent.currentRealmRecord;
  const context = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
  const decl = node as unknown as {
    static?: boolean, TypeAnnotation?: { Type?: ParseNode } | null,
    ClassElementName?: { PrivateIdentifier?: unknown }, Readonly?: boolean, Access?: string,
  };
  X(CreateDataProperty(context, Value('kind'), Value('ClassField')));
  StampReflectionContext(context, 'ClassField');
  X(CreateDataProperty(context, Value('name'), key));
  // decorators.md's ClassFieldReflection. `static` and `private` are read from
  // the declaration; `protected` and `readonly` follow the access modifiers the
  // class extension defines.
  X(CreateDataProperty(context, Value('static'), decl.static ? Value.true : Value.false));
  X(CreateDataProperty(context, Value('private'), key instanceof PrivateName ? Value.true : Value.false));
  X(CreateDataProperty(context, Value('protected'), decl.Access === 'protected' ? Value.true : Value.false));
  X(CreateDataProperty(context, Value('readonly'), decl.Readonly ? Value.true : Value.false));
  if (decl.TypeAnnotation?.Type) {
    const t = EnsureCompletion(yield* TypeNodeToTypeRecord(decl.TypeAnnotation.Type as never));
    if (t.Type === 'normal') {
      X(CreateDataProperty(context, Value('type'), GetTypeObject(t.Value as unknown as TypeRecord, realm) as Value));
    }
  }
  // "classContext: Reflect.Class.<TClass>" - a field's context carries its
  // class's, which is what lets one decorator reach the declaration it belongs
  // to without the class having to pass itself.
  X(CreateDataProperty(context, Value('classContext'), Q(yield* ClassDecoratorContext(className, classCtor))));
  return context;
}

/**
 * decorators.md's `ClassReflection`: `name`, `type` (the constructor),
 * `abstract`, and `metadata`.
 */
export function* ClassDecoratorContext(className: Value, classCtor: Value): ValueEvaluator {
  const realm = surroundingAgent.currentRealmRecord;
  const context = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
  X(CreateDataProperty(context, Value('kind'), Value('Class')));
  StampReflectionContext(context, 'Class');
  X(CreateDataProperty(context, Value('name'), className));
  X(CreateDataProperty(context, Value('type'), classCtor));
  X(CreateDataProperty(context, Value('abstract'), Value.false));
  return context;
}

/**
 * The contexts for a class's function-valued members. decorators.md gives each
 * its own reflection - `ClassMethodReflection` carries `signatures` and
 * `abstract`, a getter's carries neither - but all four share the shape a
 * decorator dispatches on, so they are built together and differ by `kind` and
 * by what only some of them have.
 */
export function* ClassMemberDecoratorContext(kind: string, key: Value, isStatic: boolean, className: Value, classCtor: Value): ValueEvaluator {
  const realm = surroundingAgent.currentRealmRecord;
  const context = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
  X(CreateDataProperty(context, Value('kind'), Value(kind)));
  StampReflectionContext(context, kind);
  X(CreateDataProperty(context, Value('name'), key));
  X(CreateDataProperty(context, Value('static'), isStatic ? Value.true : Value.false));
  X(CreateDataProperty(context, Value('private'), key instanceof PrivateName ? Value.true : Value.false));
  if (kind === 'ClassMethod' || kind === 'ClassOperator') {
    X(CreateDataProperty(context, Value('abstract'), Value.false));
  }
  X(CreateDataProperty(context, Value('classContext'), Q(yield* ClassDecoratorContext(className, classCtor))));
  return context;
}

/**
 * Which class-family context a member declaration takes. decorators.md gives
 * getters, setters, accessors, methods, and operators each their own, and the
 * declaration says which: an `AccessorKind` for the first three, an
 * `OperatorName` for an operator, and a method otherwise.
 */
function memberContextKind(node: ParseNode.MethodDefinition | ParseNode.GeneratorMethod | ParseNode.AsyncMethod | ParseNode.AsyncGeneratorMethod): string {
  const n = node as {
    UniqueFormalParameters?: unknown, PropertySetParameterList?: unknown,
  };
  // TWO BRANCHES USED TO STAND HERE AND NEITHER COULD EVER RUN, which an
  // `as unknown as { ... }` cast is what allowed: the cast INVENTED a shape, so
  // no field name in it was checked against any node that reaches this
  // function. The parameter type above is the fix - the four method forms are
  // the only callers, and a field this function reads must now exist on one of
  // them.
  //
  // `ClassOperator` was decided on an `OperatorName` that lives only on an
  // OperatorDefinition, and an OperatorDefinition never arrives here: the class
  // body walk intercepts it to register the operator and never calls
  // ClassElementEvaluation. Its contexts are named at that interception
  // instead.
  //
  // `ClassAccessor` was decided on an `Accessor` field NO PARSER SETS - the
  // spelling is `accessor`, lower case - and it could not have run even
  // spelled right, because `accessor` produces a FIELD DEFINITION and this
  // function is reached only from the method arm. When the grammar lands
  // (PLAN-accessor.md stage A) the decision belongs in the FieldDefinition arm
  // beside `ClassFieldDecoratorContext`, reading `node.accessor`.
  //
  // A MethodDefinition carries no accessor marker; the PARAMETER LIST is what
  // distinguishes the three, and it is what MethodDefinitionEvaluation itself
  // switches on. A setter has a PropertySetParameterList, a method has
  // UniqueFormalParameters, and a getter has neither.
  if (n.PropertySetParameterList) {
    return 'ClassSetter';
  }
  if (!n.UniqueFormalParameters) {
    return 'ClassGetter';
  }
  return 'ClassMethod';
}

/**
 * The name of a class member, for its decorator context.
 *
 * Taken from the RECORD the evaluation produced rather than by evaluating the
 * name node again: a ClassElementName is not an expression the evaluator
 * handles on its own, and a computed name must not be evaluated twice - once
 * for the member and once for its decorator - since the expression may have an
 * effect.
 */
function MemberKeyOf(node: ParseNode, evaluatedMember: unknown): Value {
  const record = evaluatedMember as { Key?: Value } | undefined;
  if (record?.Key !== undefined) {
    return record.Key;
  }
  const named = node as unknown as { ClassElementName?: { PropertyName?: { name?: string }, name?: string } };
  const literal = named.ClassElementName?.PropertyName?.name ?? named.ClassElementName?.name;
  return typeof literal === 'string' ? Value(literal) : Value.undefined;
}

/** The sub-target context a declaration's parameters and return take. */
function subTargetKinds(ownerKind: string): { parameter: string, ret: string } {
  switch (ownerKind) {
    case 'ClassGetter':
      // A getter takes no parameters, so only the return has a context.
      return { parameter: 'ClassSetterParameter', ret: 'ClassGetterReturn' };
    case 'ClassSetter':
      // And a setter has no return worth naming, which is why decorators.md
      // gives it a ClassSetterParameter and no ClassSetterReturn.
      return { parameter: 'ClassSetterParameter', ret: 'ClassMethodReturn' };
    case 'ClassOperator':
      return { parameter: 'ClassOperatorParameter', ret: 'ClassOperatorReturn' };
    case 'Function':
      // A plain function's parameters and return take the FUNCTION contexts,
      // not the class ones. Falling through to the default gave a standalone
      // function ClassMethodParameter, which would have been wrong in a way no
      // ordering test could catch - the sequence is identical either way.
      return { parameter: 'FunctionParameter', ret: 'FunctionReturn' };
    // The OBJECT family mirrors the class one member for member, so its
    // sub-targets mirror too. This table is the one place the families do not
    // generalize by themselves: every owner kind has to name its own, and an
    // owner that forgets to silently borrows the class contexts.
    case 'ObjectMethod':
      return { parameter: 'ObjectMethodParameter', ret: 'ObjectMethodReturn' };
    case 'ObjectGetter':
      return { parameter: 'ObjectSetterParameter', ret: 'ObjectGetterReturn' };
    case 'ObjectSetter':
      return { parameter: 'ObjectSetterParameter', ret: 'ObjectMethodReturn' };
    default:
      return { parameter: 'ClassMethodParameter', ret: 'ClassMethodReturn' };
  }
}

/**
 * Apply a declaration's PARAMETER and RETURN decorators, in that order.
 *
 * Source order within each: parameters left to right, then the return. The
 * reverse-source-order rule applies WITHIN one decorated position - `@a @b p` -
 * and not across positions, which run in the order they are written.
 */
/**
 * Whether a declaration carries any SUB-TARGET decoration - on a parameter or on
 * its return annotation. Mirrors the traversal below, and exists because a
 * declaration's sub-targets have to be applied whether or not the declaration
 * ITSELF is decorated: a function's were reached only through its own
 * decoration, so `function g(@f p: uint8)` fired nothing while
 * `@d function g(@f p: uint8)` fired both.
 */
export function HasSubTargetDecorators(node: ParseNode): boolean {
  const n = node as unknown as {
    UniqueFormalParameters?: readonly ParseNode[] | null,
    PropertySetParameterList?: readonly ParseNode[] | null,
    FormalParameters?: readonly ParseNode[] | null,
    TypeAnnotation?: { Decorators?: readonly ParseNode.Decorator[] | null } | null,
  };
  const parameters = n.UniqueFormalParameters ?? n.PropertySetParameterList ?? n.FormalParameters ?? [];
  for (const parameter of parameters) {
    const decorators = (parameter as { Decorators?: readonly ParseNode.Decorator[] | null }).Decorators;
    if (decorators && decorators.length > 0) {
      return true;
    }
  }
  return !!(n.TypeAnnotation?.Decorators && n.TypeAnnotation.Decorators.length > 0);
}

export function* ApplySubTargetDecorators(node: ParseNode, ownerKind: string, ownerName: Value, classCtor: Value): PlainEvaluator<void> {
  const kinds = subTargetKinds(ownerKind);
  const n = node as unknown as {
    UniqueFormalParameters?: readonly ParseNode[] | null,
    PropertySetParameterList?: readonly ParseNode[] | null,
    FormalParameters?: readonly ParseNode[] | null,
    TypeAnnotation?: { Decorators?: readonly ParseNode.Decorator[] | null } | null,
  };
  const parameters = n.UniqueFormalParameters ?? n.PropertySetParameterList ?? n.FormalParameters ?? [];
  for (let i = 0; i < parameters.length; i += 1) {
    const decorators = (parameters[i] as { Decorators?: readonly ParseNode.Decorator[] | null }).Decorators;
    if (!decorators || decorators.length === 0) {
      continue;
    }
    Q(yield* ApplyDecorators(decorators, Q(yield* SubTargetContext(kinds.parameter, i, ownerKind, ownerName, classCtor))));
  }
  if (n.TypeAnnotation?.Decorators && n.TypeAnnotation.Decorators.length > 0) {
    Q(yield* ApplyDecorators(n.TypeAnnotation.Decorators, Q(yield* SubTargetContext(kinds.ret, -1, ownerKind, ownerName, classCtor))));
  }
  return undefined;
}

/**
 * decorators.md's `ClassMethodParameterReflection` and its siblings. A parameter
 * carries its `index`; a return does not, which is what distinguishes the two
 * beyond the context type.
 */
export function* SubTargetContext(kind: string, index: number, ownerKind: string, ownerName: Value, classCtor: Value): ValueEvaluator {
  const realm = surroundingAgent.currentRealmRecord;
  const context = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
  X(CreateDataProperty(context, Value('kind'), Value(kind)));
  StampReflectionContext(context, kind);
  if (index >= 0) {
    X(CreateDataProperty(context, Value('index'), Value(index)));
  }
  // "methodContext: Reflect.ClassMethod.<TMethod, TClass>" - a sub-target
  // reaches the declaration it is part of, as a member reaches its class.
  X(CreateDataProperty(context, Value('methodContext'), Q(yield* ClassMemberDecoratorContext(
    ownerKind, ownerName, false, currentClassName ?? Value.undefined, classCtor,
  ))));
  return context;
}
