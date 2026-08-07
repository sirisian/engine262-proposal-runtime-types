import { SetIntegrityLevel, TestIntegrityLevel } from '../abstract-ops/all.mts';
import { currentTypeParameterFrame } from '../type-system/runtime.mts';
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
import { DefinePropertyOrThrow } from '../abstract-ops/all.mts';
import { DefaultValueOf } from '../type-system/runtime.mts';
import { CreateArrayFromList } from '../abstract-ops/all.mts';
import { anyType } from '../type-system/records.mts';
import { CreateTokenStream } from '../intrinsics/TokenStream.mts';
import { TokensOf } from '../parser/TokensOf.mts';
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
import { ArgumentListEvaluation } from './ArgumentListEvaluation.mts';
import { Evaluate_PropertyName } from './PropertyName.mts';
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

function ClassElementEvaluation(node: ParseNode.MethodDefinition | ParseNode.GeneratorMethod | ParseNode.AsyncMethod | ParseNode.AsyncGeneratorMethod | ParseNode.FieldDefinition | ParseNode.ClassStaticBlock, object: ObjectValue, enumerable: BooleanValue, ctor?: ObjectValue): PlainEvaluator<PrivateElementRecord | ClassFieldDefinitionRecord | void>
// +decorator
function ClassElementEvaluation(node: ParseNode.MethodDefinition | ParseNode.GeneratorMethod | ParseNode.AsyncMethod | ParseNode.AsyncGeneratorMethod | ParseNode.FieldDefinition | ParseNode.ClassStaticBlock, object: ObjectValue, enumerable?: undefined, ctor?: ObjectValue): PlainEvaluator<ClassElementDefinitionRecord | ClassStaticBlockDefinitionRecord | void>
function* ClassElementEvaluation(node: ParseNode.MethodDefinition | ParseNode.GeneratorMethod | ParseNode.AsyncMethod | ParseNode.AsyncGeneratorMethod | ParseNode.FieldDefinition | ParseNode.ClassStaticBlock, object: ObjectValue, enumerable?: BooleanValue, ctor?: ObjectValue): PlainEvaluator<ClassElementDefinitionRecord | ClassFieldDefinitionRecord | ClassStaticBlockDefinitionRecord | PrivateElementRecord | void> {
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
          // Recorded for EVERY member, not only a decorated one: a reflection
          // describes what was DECLARED, and whether a decorator ran is no part
          // of that. The first attempt hooked a line inside the decorator
          // guard, so an undecorated method was unreflectable - the same
          // owner-gating shape the sub-target rule keeps meeting.
          Q(yield* RecordMemberDeclarationFor(node, memberContextKind(node), MemberKeyOf(node, method), object));
          Q(yield* ApplySubTargetDecorators(node, memberContextKind(node), MemberKeyOf(node, method), object as Value));
        }
        if (surroundingAgent.feature('runtime-types') && node.Decorators) {
          // decorators.md distinguishes a method from an accessor from an
          // operator by CONTEXT TYPE rather than by a `kind` string a decorator
          // has to test, so the position decides which context is built and
          // overload resolution does the rest.
          // A method, getter, or setter may be REPLACED by what its decorator
          // returns (decorators.md's replacement table). The replacement is
          // installed where the member was defined - MethodDefinitionEvaluation
          // has already put it on the home object, so this redefines it.
          const memberKind = memberContextKind(node);
          const replacement = Q(yield* ApplyDecorators(node.Decorators, Q(yield* ClassMemberDecoratorContext(
            memberKind,
            MemberKeyOf(node, method),
            (node as { static?: boolean }).static === true,
            currentClassName ?? Value.undefined,
            object as Value,
            node,
          )), true));
          if (replacement !== undefined) {
            const memberKey = MemberKeyOf(node, method);
            if (memberKey !== Value.undefined && !(memberKey instanceof PrivateName)) {
              const existing = Q(yield* object.GetOwnProperty(memberKey as PropertyKeyValue));
              const descriptor = memberKind === 'ClassGetter'
                ? Descriptor({ Getter: replacement as never, Enumerable: Value.false, Configurable: Value.true })
                : memberKind === 'ClassSetter'
                  ? Descriptor({ Setter: replacement as never, Enumerable: Value.false, Configurable: Value.true })
                  : Descriptor({ Value: replacement, Writable: Value.true, Enumerable: Value.false, Configurable: Value.true });
              // A getter and a setter of one name share a property, so the half
              // that was not replaced has to be carried across rather than
              // dropped.
              const priorPair = existing instanceof Descriptor ? existing as { Getter?: Value, Setter?: Value } : undefined;
              if (memberKind === 'ClassGetter' && priorPair?.Setter) {
                (descriptor as { Setter?: Value }).Setter = priorPair.Setter;
              }
              if (memberKind === 'ClassSetter' && priorPair?.Getter) {
                (descriptor as { Getter?: Value }).Getter = priorPair.Getter;
              }
              Q(yield* DefinePropertyOrThrow(object, memberKey as PropertyKeyValue, descriptor));
            }
          }
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
          // Recorded for EVERY field and accessor, decorated or not - the same
          // rule the method arm needed, and the reason an undecorated member
          // was unreflectable when the recording sat inside the decorator
          // block. The NAME comes from the node: an accessor's record carries
          // its backing Private Name, and a reflection names what was declared.
          const declaredKey = (node as ParseNode.FieldDefinition).ClassElementName
            ? (Q(yield* Evaluate_PropertyName((node as ParseNode.FieldDefinition).ClassElementName)) as Value)
            : Value.undefined;
          Q(yield* RecordMemberDeclarationFor(
            node,
            (node as { accessor?: boolean }).accessor === true ? 'ClassAccessor' : 'ClassField',
            declaredKey,
            object,
          ));
        }
        if (surroundingAgent.feature('runtime-types')) {
          // The decorators run AFTER the field definition is evaluated, because
          // "a decorator runs when the declaration it decorates is evaluated"
          // and a context that described a half-built field would be describing
          // something the program never has.
          // PLAN-accessor.md stage E. An `accessor` is a FieldDefinition
          // carrying the marker, so this arm is where the two part - stage 0
          // established that, after finding the decision written in
          // `memberContextKind`, which the method arm alone reaches.
          //
          // The KEY comes from the node rather than from the record: an
          // accessor's record carries its BACKING Private Name (stage B), and
          // the context must name what was declared, not the storage.
          const isAccessor = (node as { accessor?: boolean }).accessor === true;
          const accessorPair = (plain as { AccessorPair?: { Getter: Value, Setter: Value } }).AccessorPair;
          const key = isAccessor
            ? (Q(yield* Evaluate_PropertyName((node as ParseNode.FieldDefinition).ClassElementName)) as Value)
            : (plain as { Name?: Value }).Name;
          const memberReplacement = Q(yield* ApplyDecorators(node.Decorators, Q(yield* (isAccessor
            ? (k: Value, n: ParseNode, cn: Value, cc: Value) => ClassAccessorDecoratorContext(k, n, cn, cc, accessorPair)
            : ClassFieldDecoratorContext)(
            key ?? Value.undefined, node, currentClassName ?? Value.undefined, object as Value, ctor,
          )), true));
          if (memberReplacement !== undefined) {
            if (isAccessor) {
              // An accessor's replacement is a `{ get, set }` PAIR, installed
              // over the pair the desugaring put on the home object. The layout
              // slot stays either way (a layout may not depend on whether a
              // decorator ran), which is what `context.access` is for: a
              // replacement that wants the storage delegates to it.
              const replacementGet = Q(yield* Get(memberReplacement as ObjectValue, Value('get')));
              const replacementSet = Q(yield* Get(memberReplacement as ObjectValue, Value('set')));
              Q(yield* DefinePropertyOrThrow(object, key as PropertyKeyValue, Descriptor({
                Getter: replacementGet as never,
                Setter: replacementSet as never,
                Enumerable: Value.false,
                Configurable: Value.true,
              })));
            } else {
              // A FIELD's replacement is its initial VALUE, used by DefineField
              // for every instance rather than installed anywhere now.
              (plain as { ReplacedInitial?: Value }).ReplacedInitial = memberReplacement;
            }
          }
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
/**
 * decorators.md "Replacement": "Decorators can optionally return a replacement
 * for the decorated target. If a decorator returns `void` (or `undefined`), no
 * replacement occurs. If it returns a value, that value replaces the original
 * target."
 *
 * Returns the replacement, or *undefined* where none was offered - the CALLER
 * installs it, because what "replace" means differs per position: redefining a
 * property, rebinding a class, changing a field's initial value. A decorator
 * that offers one feeds the next, so with `@a @b m` the replacement `b` returns
 * is what `a` replaces in turn; the CONTEXT is unchanged throughout, which is
 * what decorators.md means by both decorators seeing the same thing.
 *
 * The table is closed: sub-target and structural contexts "do not support
 * return replacement", so their callers pass `replaceable` false and a returned
 * value is discarded rather than silently applied somewhere.
 */
export function* ApplyDecorators(decorators: readonly ParseNode.Decorator[] | null | undefined, context: Value, replaceable = false): PlainEvaluator<Value | undefined> {
  const list = decorators ?? [];
  const applicable: ParseNode.Decorator[] = [];
  const evaluated: Value[] = [];
  const args: Value[][] = [];
  let replacement: Value | undefined;
  // decorators.md's `addInitializer` table, which is a CLOSED list rather than
  // a property of the position: `Reflect.Function` has replacement and no
  // addInitializer, and `Reflect.ObjectField` has neither though
  // `Reflect.ClassField` has both. Read off the context's own `kind` so the
  // list lives in ONE place and cannot drift from the call sites - the failure
  // the sub-target table's default arm produced twice.
  const initializers: Value[] = [];
  const contextKind = context instanceof ObjectValue
    ? Q(yield* Get(context, Value('kind')))
    : Value.undefined;
  const initializable = contextKind instanceof JSStringValue && INITIALIZABLE_CONTEXTS.includes(contextKind.stringValue());
  if (initializable && context instanceof ObjectValue) {
    const addInitializer = CreateBuiltinFunction(function* addInitializerSteps([initializer = Value.undefined]: Arguments): ValueEvaluator {
      if (!IsCallable(initializer)) {
        return Throw.TypeError('$1 is not a function', initializer);
      }
      initializers.push(initializer);
      return Value.undefined;
    } as never, 1, Value('addInitializer'), []);
    X(CreateDataProperty(context, Value('addInitializer'), addInitializer));
  }
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
    const returned = Q(yield* CallDecorator(fn, args[i]!, context));
    if (replaceable && returned !== Value.undefined && !(returned instanceof UndefinedValue)) {
      replacement = returned;
    }
  }
  // decorators.md "Order", rule 4: "`addInitializer` callbacks run AFTER EVERY
  // DECORATOR of that declaration has been applied, in the order they were
  // added." So they run here rather than as each decorator returns - which is
  // what lets one decorator's initializer observe what a later-applied
  // decorator did, including its replacement - and in ADD order, not the
  // reverse order the decorators themselves ran in.
  for (const initializer of initializers) {
    Q(yield* Call(initializer, Value.undefined, []));
  }
  return replacement;
}

/**
 * The contexts decorators.md gives an `addInitializer`: "declaration sites where
 * initialization logic can be injected". A closed list, and not derivable from
 * the position - `Reflect.Function` has return replacement and no
 * addInitializer, while `Reflect.ObjectField` has neither though
 * `Reflect.ClassField` has both.
 */
const INITIALIZABLE_CONTEXTS: readonly string[] = [
  'Class', 'ClassField', 'ClassAccessor', 'ClassGetter', 'ClassSetter',
  'ClassMethod', 'ClassOperator', 'ObjectMethod', 'ObjectGetter', 'ObjectSetter',
];

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
  // proposal-runtime-types #sec-class-operators: an index accessor is keyed by
  // its INDEX COUNT as well as its name. A class may declare more than one -
  // the design's grid declares `[i]` and `[x, y]` together - and a table keyed
  // by name alone let the second overwrite the first, so only one of them was
  // ever reachable. The write direction takes the indices and then the value,
  // so its index count is one less than its parameter count.
  const params = e.FormalParameters?.length ?? 0;
  if (name === '[]' && e.AccessorKind === 'set') {
    return `[]=#${Math.max(0, params - 1)}`;
  }
  if (name === '[]') {
    return `[]#${params}`;
  }
  return params === 0 ? `unary ${name}` : name;
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
  // proposal-runtime-types #sec-generics: a generic class whose heritage READS
  // a type parameter, the design's `class G<W: uint32> extends [W * H].<uint8>`,
  // has no heritage to evaluate until an application binds the parameters. The
  // declaration still binds the name, so it is evaluated with no heritage and
  // the specialization built by an application evaluates it for real, over that
  // application's bindings. Only a heritage that actually reads a parameter is
  // deferred: one that does not evaluates at the declaration as it always has.
  //
  // "Unspecialized" is the declaration of a generic class evaluated with no
  // application's bindings in scope: the name is bound, and the parts that
  // depend on a parameter wait for an application to supply one.
  let unspecializedGeneric = false;
  if (surroundingAgent.feature('runtime-types')) {
    const owner = (ClassTail as unknown as { parent?: { TypeParameters?: { TypeParameterList?: readonly unknown[] } } }).parent;
    const params = owner?.TypeParameters?.TypeParameterList;
    if (params && params.length > 0 && currentTypeParameterFrame() === undefined) {
      unspecializedGeneric = true;
    }
  }
  const deferredHeritage = unspecializedGeneric && !!ClassHeritage;
  if (!ClassHeritage || deferredHeritage) {
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
      // proposal-runtime-types #sec-generics: a STATIC field of a generic class
      // is initialized when the class is defined, and an initializer reading a
      // type parameter has nothing to read until an application binds one. The
      // unspecialized declaration therefore leaves such a field undefined, as it
      // leaves a parameter-reading heritage unevaluated, and the specialization
      // built by an application initializes it over that application's
      // bindings. An instance field needs no such rule: it runs at
      // construction, and only a specialization is constructed.
      // A static BLOCK runs at definition too, so it waits for an application
      // the same way a static field does.
      if (unspecializedGeneric
          && ((elementRecord instanceof ClassElementDefinitionRecord
            && (elementRecord.Kind === 'field' || elementRecord.Kind === 'accessor'))
            || elementRecord instanceof ClassStaticBlockDefinitionRecord)) {
        continue;
      }
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
    const instancePrivateMethods: PrivateElementRecord[] = [];
    // 22. Let staticPrivateMethods be a new empty List.
    const staticPrivateMethods: PrivateElementRecord[] = [];
    // 23. Let instanceFields be a new empty List.
    const instanceFields: ClassFieldDefinitionRecord[] = [];
    // 24. Let staticElements be a new empty List.
    const staticElements: (ClassFieldDefinitionRecord | ClassStaticBlockDefinitionRecord)[] = [];
    // 25. For each ClassElement e of elements, do
    //
    // Walked over the WHOLE body rather than NonConstructorElements, so the
    // constructor keeps its DOCUMENT POSITION among the members. The
    // specification says "a constructor is a `ClassMethod` whose name is
    // *"constructor"*", and it was the one member a decorator could be written
    // on and never fire: excluded from NonConstructorElements, it never reached
    // ClassElementEvaluation at all. It is DECORATED here and not redefined -
    // the class IS the constructor, so there is nothing to install.
    // ClassBody IS the element list, so the whole body is walked directly and
    // `elements` (NonConstructorElements) is used only when there is no body.
    const bodyElements: readonly ParseNode.ClassElement[] = ClassBody ?? elements;
    for (const e of bodyElements) {
      // The CONSTRUCTOR is exactly what NonConstructorElements filtered out, so
      // it is identified by that list rather than by re-deriving the test.
      // Re-deriving it missed the forms `PropName` normalizes - a string-literal
      // or computed `"constructor"` - and a missed constructor fell through to
      // be DEFINED as an ordinary method, putting a `constructor` property on
      // the prototype and changing every instance's structural type.
      if (!elements.includes(e)) {
        if (e.type === 'MethodDefinition' && surroundingAgent.feature('runtime-types')) {
          // SUB-TARGETS UNCONDITIONALLY, the member's own only where written.
          // Gating the parameters on the constructor's own decorator list is
          // the defect A4 found for plain functions and C1 for operators: a
          // parameter's decorator belongs to the parameter.
          Q(yield* ApplySubTargetDecorators(e as never, 'ClassMethod', Value('constructor'), F as Value));
          if (e.Decorators?.length) {
            Q(yield* ApplyDecorators(e.Decorators, Q(yield* ClassMemberDecoratorContext(
              'ClassMethod', Value('constructor'), false, currentClassName ?? Value.undefined, F as Value,
            ))));
          }
        }
        continue;
      }
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
          const ownerKind = isOperator ? 'ClassOperator' : 'ClassMethod';
          const ownerName = isOperator ? Value(operatorTableKey(e)) : MemberKeyOf(e, undefined);
          const home = (e.static ? F : proto) as Value;
          Q(yield* ApplySubTargetDecorators(e, ownerKind, ownerName, home));
          // The operator's OWN decorator, which had no grammar until the
          // parser admitted it. Its replacement is the eleventh row of
          // decorators.md's table - "the operator function" - and it is
          // installed by RE-REGISTERING the operator, since an operator lives
          // in the class operator table rather than as a property.
          const ownDecorators = (e as { Decorators?: readonly ParseNode.Decorator[] | null }).Decorators;
          if (ownDecorators?.length) {
            // Passing the declaration is what gives the context its `type` and
            // `signatures`: both are derived from the node, and an operator's
            // context had neither because this call site alone withheld it.
            const replacement = Q(yield* ApplyDecorators(ownDecorators, Q(yield* ClassMemberDecoratorContext(
              ownerKind, ownerName, e.static === true, currentClassName ?? Value.undefined, home, e as ParseNode,
            )), true));
            if (replacement !== undefined && isOperator) {
              RegisterClassOperator(e.static ? F : proto, operatorTableKey(e), replacement as never);
            }
          }
        }
        continue;
      }
      let field;
      // a. If IsStatic of e is false, then
      if (IsStatic(e) === false) {
        // i. Let field be ClassElementEvaluation of e with arguments proto and false.
        field = (yield* ClassElementEvaluation(e, proto, Value.false, F))!;
      } else { // b. Else,
        // i. Let field be ClassElementEvaluation of e with arguments F and false.
        field = (yield* ClassElementEvaluation(e, F, Value.false, F))!;
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
        // PLAN-accessor.md Â§2.3: a PRIVATE accessor yields TWO things from one
        // declaration - the backing FIELD, which allocates the slot and is
        // handled below like any other, and a private GET/SET PAIR, which is a
        // PrivateElement and belongs in the same container a private getter or
        // setter written by hand would join. The pair rides on the field record
        // so the evaluation keeps one return value; installing it is the class's
        // job, here, beside every other private element.
        const privatePair = (field as { PrivateAccessor?: PrivateElementRecord }).PrivateAccessor;
        if (privatePair !== undefined) {
          const container = IsStatic(e) === false ? instancePrivateMethods : staticPrivateMethods;
          container.push(privatePair);
        }
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
      // proposal-runtime-types #sec-generics: see the note on the decorated
      // path above - an unspecialized generic class leaves a static field
      // uninitialized, and the specialization initializes it over its bindings.
      if (unspecializedGeneric
          && (elementRecord instanceof ClassFieldDefinitionRecord
            || elementRecord instanceof ClassStaticBlockDefinitionRecord)) {
        continue;
      }
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
      const laidOut: { key: string | PrivateName, type: TypeRecord, controls?: FieldControls }[] = [];
      let complete = true;
      for (const field of instanceFields) {
        const typeObject = (field as { TypeObject?: { TypeRecord?: TypeRecord } }).TypeObject;
        const name = (field as { Name?: unknown }).Name;
        if (!typeObject?.TypeRecord) {
          // #table-layout-qualification, the row "a class with an UNTYPED
          // field": that field has no size, so the class has no layout.
          complete = false;
          break;
        }
        // A PRIVATE field is laid out, and this used to be the same branch as an
        // untyped one - so a single `#x: uint8` gave its whole class no layout,
        // and every offset and byteLength on it threw. README: "Private fields
        // participate in the memory layout EXACTLY AS PUBLIC FIELDS DO, which is
        // why the value type rule counts both." Only the absence of a TYPE
        // disqualifies; the KIND of the key never did.
        //
        // The key stays the Private Name rather than becoming its description,
        // which is what keeps the other half of the design true: "a `#` field is
        // invisible to bracket access and REFLECTION". Every reflection lookup
        // compares the key against a string, so a Private Name occupies its slot
        // and answers no lookup - and two `#x` in a base and a derived class stay
        // distinct, which a description would have collided.
        // An accessor reports its DECLARED name rather than its backing Private
        // Name, so its slot is nameable in a layout walk exactly as a field's
        // is. A genuine `#x` keeps its Private Name and stays invisible - the
        // two are different cases and only one of them was ever written to be
        // reached by name.
        const layoutKey = (field as { LayoutName?: Value }).LayoutName ?? name;
        laidOut.push({
          key: typeof (layoutKey as { stringValue?: unknown })?.stringValue === 'function'
            ? (layoutKey as { stringValue(): string }).stringValue()
            : (layoutKey as PrivateName),
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
      if (surroundingAgent.feature('runtime-types') && e.type === 'OperatorDefinition') {
        Q(yield* ApplySubTargetDecorators(e as never, 'ClassOperator', Value(operatorTableKey(e)), (e.static ? F : proto) as Value));
      }
      continue;
    }
    // A PARTIAL BODY'S MEMBERS ARE DECORATED, which they were not: its methods
    // go through MethodDefinitionEvaluation directly and so never reached the
    // arm that applies a member's decorators. decorators.md gives no exception
    // for a partial body, and a `partial class` is where a program adds
    // behaviour to a class it does not own - which is where a decorator earns
    // its keep.
    const decorateMember = function* decorateMember(method: Value): PlainEvaluator<void> {
      if (!surroundingAgent.feature('runtime-types')) {
        return undefined;
      }
      const home = (e as { static?: boolean }).static === true ? F : proto;
      Q(yield* ApplySubTargetDecorators(e, memberContextKind(e as never), MemberKeyOf(e, method), home as Value));
      if ((e as { Decorators?: readonly ParseNode.Decorator[] | null }).Decorators?.length) {
        Q(yield* ApplyDecorators((e as { Decorators?: readonly ParseNode.Decorator[] | null }).Decorators, Q(yield* ClassMemberDecoratorContext(
          memberContextKind(e as never),
          MemberKeyOf(e, method),
          (e as { static?: boolean }).static === true,
          Q(yield* Get(F, Value('name'))),
          home as Value,
        ))));
      }
      return undefined;
    };
    if (e.type === 'FieldDefinition' || e.type === 'ClassStaticBlock') {
      // A partial class adds behaviour, not state. A field or static block in a
      // partial body is not merged; its members are methods and operators.
      continue;
    }
    const target = IsStatic(e) ? (F as ObjectValue) : proto;
    const merged = Q(yield* MethodDefinitionEvaluation(e, target, Value.false));
    Q(yield* decorateMember(merged as unknown as Value));
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
/**
 * decorators.md's `ClassAccessorReflection`: `type`, `name`, `static`,
 * `private`, `protected`, `initial`, `metadata`. Note what is NOT there - a
 * `readonly`, which `ClassFieldReflection` has and this does not.
 *
 * It fires ONCE, as `ClassAccessor`, and not as a ClassGetter and a ClassSetter
 * - decorators.md is explicit that the declaration form fixes the context:
 * "Accessor is required so that all decorators see the same context ... `signal`
 * runs before `validate` and both see an accessor." A desugaring-first
 * implementation would naturally have produced the pair, which is why the count
 * is asserted and not just the kind.
 */
/**
 * decorators.md's `initial`: "the DECLARED default - a typed field's zero value,
 * or a constant initializer."
 *
 * "A field's initializer runs per INSTANCE at construction while a field
 * decorator fires at CLASS DEFINITION, so there is no instance value to report
 * here; `addInitializer` is what reaches one." So a NON-CONSTANT initializer
 * reports *undefined* rather than being evaluated - evaluating it would run user
 * code at the wrong time and once per class rather than once per instance.
 *
 * ONE derivation, shared by the field and accessor contexts. decorators.md gives
 * `initial` on `ClassFieldReflection` AND `ClassAccessorReflection`, and the two
 * describe the same declaration - writing it twice is how the two paths in this
 * plan have repeatedly drifted.
 */
export function* DeclaredInitialOf(decl: ParseNode.FieldDefinition): ValueEvaluator {
  const initialiser = (decl as { Initializer?: ParseNode | null }).Initializer;
  if (initialiser) {
    const literal = initialiser as { type?: string, value?: unknown };
    if (literal.type === 'NumericLiteral') {
      return Value(Number(literal.value));
    }
    if (literal.type === 'StringLiteral') {
      return Value(String(literal.value));
    }
    if (literal.type === 'BooleanLiteral') {
      return literal.value ? Value.true : Value.false;
    }
    if (literal.type === 'NullLiteral') {
      return Value.null;
    }
    return Value.undefined;
  }
  if (decl.TypeAnnotation?.Type) {
    // A typed member with no initializer reports its type's ZERO VALUE, which
    // is what the class will actually give the instance.
    const t = EnsureCompletion(yield* TypeNodeToTypeRecord(decl.TypeAnnotation.Type as never));
    if (t.Type === 'normal') {
      return DefaultValueOf(t.Value as unknown as TypeRecord) ?? Value.undefined;
    }
  }
  return Value.undefined;
}

export function* ClassAccessorDecoratorContext(key: Value, node: ParseNode, className: Value, classCtor: Value, pair?: { Getter: Value, Setter: Value }): ValueEvaluator {
  const realm = surroundingAgent.currentRealmRecord;
  const context = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
  const decl = node as ParseNode.FieldDefinition;
  X(CreateDataProperty(context, Value('kind'), Value('ClassAccessor')));
  StampReflectionContext(context, 'ClassAccessor');
  X(CreateDataProperty(context, Value('name'), key));
  X(CreateDataProperty(context, Value('static'), decl.static === true ? Value.true : Value.false));
  X(CreateDataProperty(context, Value('private'), key instanceof PrivateName ? Value.true : Value.false));
  X(CreateDataProperty(context, Value('protected'), decl.protected === true ? Value.true : Value.false));
  // PLAN-accessor.md Â§2.5: `readonly accessor` is legal and means getter-only,
  // so the context reports it as a field's does. Without this the modifier was
  // invisible to a decorator as well as unenforced.
  X(CreateDataProperty(context, Value('readonly'), decl.readonly === true ? Value.true : Value.false));
  // proposal-runtime-types #sec-reflection-shape-class: a ClassAccessor
  // reflection carries the accessor's TYPE, as the field context beside it does
  // and by reading the same annotation. It had none, so an accessor's decorator
  // could see its name, its visibility, and its initial value, and not what it
  // holds - which is the one question the type system makes the facility for.
  if (decl.TypeAnnotation?.Type) {
    const accessorType = EnsureCompletion(yield* TypeNodeToTypeRecord(decl.TypeAnnotation.Type as never));
    if (accessorType.Type === 'normal') {
      X(CreateDataProperty(context, Value('type'), GetTypeObject(accessorType.Value as unknown as TypeRecord, realm) as Value));
    }
  }
  X(CreateDataProperty(context, Value('initial'), Q(yield* DeclaredInitialOf(decl))));
  X(CreateDataProperty(context, Value('initializer'), InitializerTokensOf(decl)));
  X(CreateDataProperty(context, Value('metadata'), Q(yield* MemberMetadataFor(classCtor, key))));
  // `access`: the pair this accessor generated, so a decorator that REPLACES
  // the accessor can delegate to the storage the layout already allotted rather
  // than closing over storage of its own and leaving the slot dead.
  if (pair) {
    const access = OrdinaryObjectCreate(surroundingAgent.currentRealmRecord.Intrinsics['%Object.prototype%']);
    X(CreateDataProperty(access, Value('get'), pair.Getter));
    X(CreateDataProperty(access, Value('set'), pair.Setter));
    X(CreateDataProperty(context, Value('access'), access));
  }
  X(CreateDataProperty(context, Value('classContext'), Q(yield* ClassDecoratorContext(className, classCtor))));
  return context;
}

export function* ClassFieldDecoratorContext(key: Value, node: ParseNode, className: Value, classCtor: Value, ctor?: ObjectValue): ValueEvaluator {
  const realm = surroundingAgent.currentRealmRecord;
  const context = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
  // Typed to the NODE this is given, not to an invented shape. The cast here
  // named `Readonly` and `Access`, which are the FIELD RECORD's spellings; a
  // FieldDefinition node carries `readonly` and `protected`. So both properties
  // reported FALSE for every field, however the member was declared - the same
  // failure as the `Accessor`/`accessor` branch stage 0 removed, and the same
  // cause: `as unknown as { ... }` invents a shape, so no name in it is checked
  // against the node that arrives.
  const decl = node as ParseNode.FieldDefinition;
  X(CreateDataProperty(context, Value('kind'), Value('ClassField')));
  StampReflectionContext(context, 'ClassField');
  X(CreateDataProperty(context, Value('name'), key));
  // decorators.md's ClassFieldReflection. `static` and `private` are read from
  // the declaration; `protected` and `readonly` follow the access modifiers the
  // class extension defines.
  X(CreateDataProperty(context, Value('static'), decl.static ? Value.true : Value.false));
  X(CreateDataProperty(context, Value('private'), key instanceof PrivateName ? Value.true : Value.false));
  X(CreateDataProperty(context, Value('protected'), decl.protected === true ? Value.true : Value.false));
  X(CreateDataProperty(context, Value('readonly'), decl.readonly === true ? Value.true : Value.false));
  if (decl.TypeAnnotation?.Type) {
    const t = EnsureCompletion(yield* TypeNodeToTypeRecord(decl.TypeAnnotation.Type as never));
    if (t.Type === 'normal') {
      X(CreateDataProperty(context, Value('type'), GetTypeObject(t.Value as unknown as TypeRecord, realm) as Value));
    }
  }
  X(CreateDataProperty(context, Value('initial'), Q(yield* DeclaredInitialOf(decl))));
  X(CreateDataProperty(context, Value('initializer'), InitializerTokensOf(decl)));
  // decorators.md also gives `offset` and `byteLength`, "present when the
  // declaring class has one". NOT ADDED YET, deliberately: the layout reflection
  // reaches a placement through the TYPE RECORD's `Constructor`, and the
  // constructor value this context is handed does not carry `InstanceLayout` -
  // measured, since a first attempt reported *undefined* for a field the read
  // path places at offset 4. Two always-undefined properties would look
  // implemented and be worse than their absence, which is how this suite reads
  // a deferral.
  // "classContext: Reflect.Class.<TClass>" - a field's context carries its
  // class's, which is what lets one decorator reach the declaration it belongs
  // to without the class having to pass itself.
  // decorators.md: "Layout, present when the declaring class has one. A STATIC
  // field is not part of an instance's layout, so both are undefined for it."
  //
  // ACCESSORS, not data properties, and the reason is an ORDERING fact: a field
  // decorator runs BEFORE the class's `InstanceLayout` is computed, AND SO DO
  // THE `addInitializer` CALLBACKS IT REGISTERS. A value read at either point
  // would always be *undefined*; a value read WHEN ASKED is present for every
  // reader that runs after the class finishes, which is what "present when the
  // declaring class has one" means.
  //
  // The constructor is THREADED IN from the call site. `Get(proto,
  // 'constructor')` must NOT be used: it walks the prototype chain, and while a
  // class is being defined that lookup can return `Object` - no layout, and no
  // error. There is deliberately no fallback to the home object either, so a
  // missing constructor reports *undefined* rather than silently substituting
  // something that answers wrongly.
  if (!decl.static && key instanceof JSStringValue && ctor) {
    const fieldName = key.stringValue();
    const owner = ctor as ObjectValue & { InstanceLayout?: { fields: readonly { key: string, offset: number, layout: { byteLength: number } }[] } | null };
    const reader = (which: 'offset' | 'byteLength') => CreateBuiltinFunction(function* read() {
      const placement = owner.InstanceLayout?.fields.find((f) => f.key === fieldName);
      if (!placement) {
        return Value.undefined;
      }
      return which === 'offset' ? Value(placement.offset) : Value(placement.layout.byteLength);
    } as never, 0, Value(which), [], realm);
    X(DefinePropertyOrThrow(context, Value('offset'), Descriptor({
      Getter: reader('offset'), Enumerable: Value.true, Configurable: Value.true,
    })));
    X(DefinePropertyOrThrow(context, Value('byteLength'), Descriptor({
      Getter: reader('byteLength'), Enumerable: Value.true, Configurable: Value.true,
    })));
  } else {
    X(CreateDataProperty(context, Value('offset'), Value.undefined));
    X(CreateDataProperty(context, Value('byteLength'), Value.undefined));
  }
  X(CreateDataProperty(context, Value('metadata'), Q(yield* MemberMetadataFor(classCtor, key))));
  X(CreateDataProperty(context, Value('classContext'), Q(yield* ClassDecoratorContext(className, classCtor))));
  return context;
}

/**
 * decorators.md's `ClassReflection`: `name`, `type` (the constructor),
 * `abstract`, and `metadata`.
 */
/**
 * decorators.md, Metadata Inheritance: "Each member's metadata is inherited
 * through the PROTOTYPE CHAIN ... If B redeclares the field and applies its own
 * decorators, B gets a new metadata object (PROTOTYPICALLY INHERITING FROM A'S)
 * where B's decorators write their values, SHADOWING A'S WITHOUT MUTATING
 * THEM."
 *
 * So a metadata object is an ORDINARY OBJECT whose [[Prototype]] is the
 * corresponding metadata of the base declaration - which is what makes "symbol
 * key lookups fall through the prototype" true by construction rather than by a
 * lookup rule written here. It is also why the metadata channel is a `partial
 * interface` and not a `partial class`: an instance of a class with a typed
 * field is not extensible and could not be prototypically linked at all.
 *
 * One object per declaration, kept so that a later read finds what a decorator
 * wrote - the object a decorator receives IS the one that persists, not a copy.
 */
const classMetadata = new WeakMap<Value, Map<string, ObjectValue>>();

/**
 * proposal-runtime-types: what a member was DECLARED as, per class and member.
 *
 * The reflections want `static`, `private`, `protected` and `abstract`, and
 * those are declaration facts - they live in the AST at class definition and
 * are recorded nowhere reachable from the type afterwards. A FIELD's reflection
 * escapes this by walking the instance LAYOUT, which is why it answers only for
 * a class that has one; a method has no slot and nothing equivalent to walk.
 *
 * Keyed the way the metadata store is, and recorded where the class body is
 * walked, so a read is a lookup rather than a second traversal.
 */
export interface MemberParameterDeclaration {
  readonly name: string;
  readonly index: number;
  readonly hasDefault: boolean;
}
export interface MemberDeclaration {
  readonly kind: string;
  readonly static: boolean;
  readonly private: boolean;
  readonly protected: boolean;
  readonly abstract: boolean;
  /**
   * The member's PARAMETERS, in declaration order. `getReflectionByIndex` is
   * declared only for the parameter contexts and returns this list indexed by
   * position - so a parameter's name and default have to be recorded where the
   * class body is walked, exactly as the member's own facts are.
   */
  readonly parameters: readonly MemberParameterDeclaration[];
  /**
   * The member's declared type, as the DECORATOR CONTEXT reports it - the
   * FUNCTION type for a method, getter or setter.
   *
   * Recorded here because the READ PATH answers from this record and had no
   * `type` at all, while the context did: two reflections of ONE declaration
   * disagreeing, which is the failure this plan has met most often. Derived by
   * the same operation the context uses, so they cannot drift.
   */
  readonly type?: TypeRecord | undefined;
}
const memberDeclarations = new WeakMap<Value, Map<string, MemberDeclaration>>();

export function RecordMemberDeclaration(owner: Value, member: string, declaration: MemberDeclaration): void {
  let byMember = memberDeclarations.get(owner);
  if (!byMember) {
    byMember = new Map();
    memberDeclarations.set(owner, byMember);
  }
  byMember.set(member, declaration);
}

/**
 * The declaration of `member` on `owner` or a class it extends. Reflection
 * "includes inherited members BY DEFAULT", so the base chain is walked - the
 * same chain the checker and the metadata store walk.
 */
/**
 * Every member of `kind` on `owner`, and on the classes it extends unless `own`.
 *
 * decorators.md: "Reflection includes inherited members BY DEFAULT ... To query
 * only the members a class declares itself, pass `{ own: true }`." The chain is
 * walked from the DERIVED class outward and a name already seen is not
 * replaced, so a redeclaration SHADOWS the base's rather than the base
 * overwriting it - the same direction the metadata prototype chain resolves in.
 */
export function AllMemberDeclarationsOf(owner: Value, kind: string, own: boolean): Map<string, MemberDeclaration> {
  const collected = new Map<string, MemberDeclaration>();
  let current: Value | undefined = owner;
  while (current !== undefined && current !== Value.null) {
    const byMember = memberDeclarations.get(current);
    if (byMember) {
      for (const [name, declaration] of byMember) {
        if (declaration.kind === kind && !collected.has(name)) {
          collected.set(name, declaration);
        }
      }
    }
    if (own) {
      break;
    }
    const next: unknown = current instanceof ObjectValue
      ? (current as unknown as { Prototype?: Value }).Prototype
      : undefined;
    current = next as Value | undefined;
  }
  return collected;
}

export function MemberDeclarationOf(owner: Value, member: string): MemberDeclaration | undefined {
  let current: Value | undefined = owner;
  while (current !== undefined && current !== Value.null) {
    const found = memberDeclarations.get(current)?.get(member);
    if (found) {
      return found;
    }
    const next: unknown = current instanceof ObjectValue
      ? (current as unknown as { properties?: unknown, Prototype?: Value }).Prototype
      : undefined;
    current = next as Value | undefined;
  }
  return undefined;
}

/**
 * The metadata object for one DECLARATION: a class, or a member of one. Keyed
 * by the owner and the member, so a class's own metadata and each member's are
 * separate objects with separate chains - decorators.md gives each context its
 * own intrinsic interface, and a field's metadata inherits the BASE'S FIELD's
 * rather than the base class's.
 *
 * `''` is the owner's own metadata; any other key is the member of that name.
 */
export function MetadataObjectFor(target: Value, inheritsFrom: Value | undefined, member = ''): ObjectValue {
  let byMember = classMetadata.get(target);
  if (!byMember) {
    byMember = new Map();
    classMetadata.set(target, byMember);
  }
  const existing = byMember.get(member);
  if (existing) {
    return existing;
  }
  const realm = surroundingAgent.currentRealmRecord;
  const inherited = inheritsFrom !== undefined ? classMetadata.get(inheritsFrom)?.get(member) : undefined;
  const created = OrdinaryObjectCreate(inherited ?? realm.Intrinsics['%Object.prototype%']);
  byMember.set(member, created);
  return created;
}

/**
 * decorators.md's `ClassMethodParameterMetadata` and its return sibling.
 *
 * A parameter is identified by its METHOD AND POSITION, so it is keyed on the
 * same store a member uses under a composite name - which is what
 * prototype-links a parameter's metadata to THE SAME PARAMETER of the same
 * method on the base class, exactly as a member's links to the same member. A
 * RETURN has no index and is keyed without one.
 */
function* SubTargetMetadataFor(classCtor: Value, ownerName: Value, index: number): PlainEvaluator<ObjectValue> {
  const method = ownerName instanceof JSStringValue ? ownerName.stringValue() : undefined;
  if (method === undefined) {
    // A symbol- or private-named method has no string key to inherit along.
    return OrdinaryObjectCreate(surroundingAgent.currentRealmRecord.Intrinsics['%Object.prototype%']);
  }
  // KEYED BY THE CONSTRUCTOR for the same reason a member's is: a context is
  // built with the home object, a PROTOTYPE for an instance member, while the
  // reflection reaches the class through its constructor.
  let owner = classCtor;
  if (classCtor instanceof ObjectValue) {
    const back = Q(yield* Get(classCtor, Value('constructor')));
    if (back instanceof ObjectValue) {
      owner = back;
    }
  }
  const base = owner instanceof ObjectValue ? Q(yield* owner.GetPrototypeOf()) : Value.undefined;
  return MetadataObjectFor(owner, base, index >= 0 ? `${method}#${index}` : `${method}#return`);
}

/**
 * The metadata a member's context carries, prototype-linked to the SAME
 * member's metadata on the base class. `classCtor` is the home object a member
 * was defined on - a prototype for an instance member - so the base is found by
 * walking one link from the constructor the class binds.
 */
function* MemberMetadataFor(classCtor: Value, key: Value): PlainEvaluator<ObjectValue> {
  const member = key instanceof JSStringValue ? key.stringValue() : undefined;
  if (member === undefined) {
    // A symbol- or private-named member has no string key to inherit along;
    // give it its own object rather than sharing one keyed by the empty name.
    const realm = surroundingAgent.currentRealmRecord;
    return OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
  }
  // KEYED BY THE CONSTRUCTOR, not by the home object. A member context is built
  // with the object the member was defined on - a PROTOTYPE for an instance
  // member - while `Reflect.getMetadata.<Reflect.ClassField, T>` reaches the
  // class through its constructor. Storing under the home object put the two on
  // different keys, so a field's metadata was written where nothing would read
  // it. A class prototype names its constructor, which is the link back.
  let owner = classCtor;
  if (classCtor instanceof ObjectValue) {
    const back = Q(yield* Get(classCtor, Value('constructor')));
    if (back instanceof ObjectValue) {
      owner = back;
    }
  }
  const base = owner instanceof ObjectValue ? Q(yield* owner.GetPrototypeOf()) : Value.undefined;
  return MetadataObjectFor(owner, base, member);
}

export function* ClassDecoratorContext(className: Value, classCtor: Value): ValueEvaluator {
  const realm = surroundingAgent.currentRealmRecord;
  const context = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
  X(CreateDataProperty(context, Value('kind'), Value('Class')));
  StampReflectionContext(context, 'Class');
  X(CreateDataProperty(context, Value('name'), className));
  X(CreateDataProperty(context, Value('type'), classCtor));
  X(CreateDataProperty(context, Value('abstract'), Value.false));
  // The class's own metadata, prototype-linked to its base class's so that a
  // key the base set is visible here and a key set here shadows it.
  const baseClass: Value = classCtor instanceof ObjectValue
    ? Q(yield* classCtor.GetPrototypeOf())
    : Value.undefined;
  X(CreateDataProperty(context, Value('metadata'), MetadataObjectFor(classCtor, baseClass)));
  return context;
}

/**
 * The contexts for a class's function-valued members. decorators.md gives each
 * its own reflection - `ClassMethodReflection` carries `signatures` and
 * `abstract`, a getter's carries neither - but all four share the shape a
 * decorator dispatches on, so they are built together and differ by `kind` and
 * by what only some of them have.
 */
/**
 * Record one member's declaration facts under the CONSTRUCTOR, which is what a
 * reflection reaches the class by - a member context is built with the home
 * object, and for an instance member that is the prototype.
 */
function* RecordMemberDeclarationFor(node: ParseNode, kind: string, key: Value, home: ObjectValue): PlainEvaluator<void> {
  if (!surroundingAgent.feature('runtime-types') || !(key instanceof JSStringValue)) {
    return undefined;
  }
  // A STATIC member's home object IS the constructor; an instance member's is
  // the prototype, which names its constructor. Walking `constructor` from the
  // constructor would reach `Function`, so the two cases are told apart by the
  // node rather than by probing the object.
  const n0 = node as { static?: boolean };
  let owner: Value = home;
  if (n0.static !== true) {
    const back = Q(yield* Get(home, Value('constructor')));
    if (back instanceof ObjectValue) {
      owner = back;
    }
  }
  const n = node as {
    static?: boolean, protected?: boolean, ClassElementName?: { type?: string },
    UniqueFormalParameters?: readonly ParseNode[] | null,
    PropertySetParameterList?: readonly ParseNode[] | null,
    FormalParameters?: readonly ParseNode[] | null,
  };
  const formals = n.UniqueFormalParameters ?? n.PropertySetParameterList ?? n.FormalParameters ?? [];
  const parameters: MemberParameterDeclaration[] = [];
  formals.forEach((parameter, index) => {
    const p = parameter as { BindingIdentifier?: { name?: string }, Initializer?: unknown };
    parameters.push({
      name: p.BindingIdentifier?.name ?? '',
      index,
      hasDefault: p.Initializer !== undefined && p.Initializer !== null,
    });
  });
  const declaredType = Q(yield* MemberFunctionTypeRecord(node));
  RecordMemberDeclaration(owner, key.stringValue(), {
    parameters,
    type: declaredType,
    kind,
    static: n.static === true,
    private: n.ClassElementName?.type === 'PrivateIdentifier',
    protected: n.protected === true,
    abstract: node.type === 'AbstractMethodDefinition',
  });
  return undefined;
}

/**
 * decorators.md's `FunctionSignatureReflection`: `{ parameters, return }`, where
 * a parameter carries `type`, `name`, `index` and `initial` - the same facts the
 * parameter CONTEXT reports, from the same node, so the two cannot disagree
 * about one declaration.
 */
export function* FunctionSignatureReflectionOf(node: ParseNode, realm: typeof surroundingAgent.currentRealmRecord): ValueEvaluator {
  const sig = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
  const n = node as {
    UniqueFormalParameters?: readonly ParseNode[] | null,
    PropertySetParameterList?: readonly ParseNode[] | null,
    FormalParameters?: readonly ParseNode[] | null,
    TypeAnnotation?: { Type?: ParseNode } | null,
  };
  const formals = n.UniqueFormalParameters ?? n.PropertySetParameterList ?? n.FormalParameters ?? [];
  const parameters: Value[] = [];
  for (let i = 0; i < formals.length; i += 1) {
    const entry = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
    const binding = formals[i] as {
      BindingIdentifier?: { name?: string } | null,
      TypeAnnotation?: { Type?: ParseNode } | null,
      Initializer?: { type?: string, value?: unknown } | null,
    };
    X(CreateDataProperty(entry, Value('index'), Value(i)));
    if (binding.BindingIdentifier?.name !== undefined) {
      X(CreateDataProperty(entry, Value('name'), Value(binding.BindingIdentifier.name)));
    }
    if (binding.TypeAnnotation?.Type) {
      const t = EnsureCompletion(yield* TypeNodeToTypeRecord(binding.TypeAnnotation.Type as never));
      if (t.Type === 'normal') {
        X(CreateDataProperty(entry, Value('type'), GetTypeObject(t.Value as unknown as TypeRecord, realm) as Value));
      }
    }
    X(CreateDataProperty(entry, Value('initial'), DeclaredConstantOf(binding.Initializer)));
    X(CreateDataProperty(entry, Value('initializer'), InitializerTokensOf(binding)));
    parameters.push(entry);
  }
  X(CreateDataProperty(sig, Value('parameters'), X(CreateArrayFromList(parameters))));
  const ret = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
  if (n.TypeAnnotation?.Type) {
    const t = EnsureCompletion(yield* TypeNodeToTypeRecord(n.TypeAnnotation.Type as never));
    if (t.Type === 'normal') {
      X(CreateDataProperty(ret, Value('type'), GetTypeObject(t.Value as unknown as TypeRecord, realm) as Value));
    }
  }
  X(CreateDataProperty(sig, Value('return'), ret));
  return sig;
}

/** A constant initializer's value, or *undefined* for anything else. */
function DeclaredConstantOf(init: { type?: string, value?: unknown } | null | undefined): Value {
  if (!init) {
    return Value.undefined;
  }
  if (init.type === 'NumericLiteral') {
    return Value(Number(init.value));
  }
  if (init.type === 'StringLiteral') {
    return Value(String(init.value));
  }
  if (init.type === 'BooleanLiteral') {
    return init.value ? Value.true : Value.false;
  }
  if (init.type === 'NullLiteral') {
    return Value.null;
  }
  return Value.undefined;
}

/**
 * The FUNCTION type of a method, getter or setter declaration - its parameters
 * and its return - which is what decorators.md's `type` field on those contexts
 * holds. *undefined* where the declaration annotates nothing.
 */
export function* MemberFunctionTypeRecord(node: ParseNode): PlainEvaluator<TypeRecord | undefined> {
  const n = node as {
    UniqueFormalParameters?: readonly ParseNode[] | null,
    PropertySetParameterList?: readonly ParseNode[] | null,
    FormalParameters?: readonly ParseNode[] | null,
    TypeAnnotation?: { Type?: ParseNode } | null,
  };
  const formals = n.UniqueFormalParameters ?? n.PropertySetParameterList ?? n.FormalParameters ?? [];
  const Parameters = [];
  let annotated = false;
  for (const formal of formals) {
    const binding = formal as {
      BindingIdentifier?: { name?: string } | null,
      TypeAnnotation?: { Type?: ParseNode } | null,
    };
    let paramType: TypeRecord = anyType;
    if (binding.TypeAnnotation?.Type) {
      const t = EnsureCompletion(yield* TypeNodeToTypeRecord(binding.TypeAnnotation.Type as never));
      if (t.Type === 'normal') {
        paramType = t.Value as unknown as TypeRecord;
        annotated = true;
      }
    }
    Parameters.push({
      Name: binding.BindingIdentifier?.name ?? '',
      Type: paramType,
      Optional: false,
      Rest: false,
    });
  }
  let Return: TypeRecord | null = null;
  if (n.TypeAnnotation?.Type) {
    const t = EnsureCompletion(yield* TypeNodeToTypeRecord(n.TypeAnnotation.Type as never));
    if (t.Type === 'normal') {
      Return = t.Value as unknown as TypeRecord;
      annotated = true;
    }
  }
  if (!annotated) {
    return undefined;
  }
  return { Kind: 'function', Signatures: [{ Parameters, Return }] } as TypeRecord;
}

export function* ClassMemberDecoratorContext(kind: string, key: Value, isStatic: boolean, className: Value, classCtor: Value, node?: ParseNode): ValueEvaluator {
  const realm = surroundingAgent.currentRealmRecord;
  const context = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
  X(CreateDataProperty(context, Value('kind'), Value(kind)));
  StampReflectionContext(context, kind);
  X(CreateDataProperty(context, Value('name'), key));
  X(CreateDataProperty(context, Value('static'), isStatic ? Value.true : Value.false));
  X(CreateDataProperty(context, Value('private'), key instanceof PrivateName ? Value.true : Value.false));
  // proposal-runtime-types #sec-reflection-shape-class: a method, getter, and
  // setter each report `protected` beside `static` and `private`. The field and
  // accessor contexts already did, so a decorator reading visibility got two of
  // three answers here and three there, for no reason a reader could see.
  X(CreateDataProperty(context, Value('protected'), (node as { protected?: boolean } | undefined)?.protected === true ? Value.true : Value.false));
  if (kind === 'ClassMethod' || kind === 'ClassOperator') {
    X(CreateDataProperty(context, Value('abstract'), Value.false));
  }
  // proposal-runtime-types #sec-reflection-shape-class: a ClassOperator
  // reflection reports the `operator` it overloads. Without it an operator's
  // reflection cannot say WHICH operator it is, which is the one thing
  // distinguishing it from a method's.
  if (kind === 'ClassOperator') {
    const operatorName = (node as { OperatorName?: string } | undefined)?.OperatorName;
    X(CreateDataProperty(context, Value('operator'), operatorName === undefined ? Value.undefined : Value(operatorName)));
  }
  // decorators.md: `ClassMethodReflection<T extends (...args) => any>` has
  // `type: T`, and `ClassGetterReflection` has `type: () => T`. **Both are the
  // member's FUNCTION type, not its return type** - easy to miss, and missed
  // here in cycle 197, which reported the RETURN type and so made a getter's
  // `type` indistinguishable from its RETURN sub-target's.
  //
  // A member that annotates nothing reports nothing, rather than a function
  // type of all-`any` - so "unannotated" stays distinguishable from "annotated
  // as any".
  if (node) {
    const fnType = Q(yield* MemberFunctionTypeRecord(node));
    if (fnType) {
      X(CreateDataProperty(context, Value('type'), GetTypeObject(fnType, realm) as Value));
    }
  }
  // decorators.md: "signatures: [].<FunctionSignatureReflection> - Length 1 when
  // not overloaded." A CLASS METHOD is never overloaded in this engine (a second
  // declaration of one name replaces the first, unlike a function declaration,
  // which does form an overload group), so this is always the one declaration
  // the context was handed.
  if (node) {
    const one = Q(yield* FunctionSignatureReflectionOf(node, realm));
    X(CreateDataProperty(context, Value('signatures'), X(CreateArrayFromList([one]))));
  }
  X(CreateDataProperty(context, Value('classContext'), Q(yield* ClassDecoratorContext(className, classCtor))));
  X(CreateDataProperty(context, Value('metadata'), Q(yield* MemberMetadataFor(classCtor, key))));
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
    case 'ClassAccessor':
      // An `accessor` has no parameter list and no return annotation - its
      // TypeAnnotation is a FIELD's, and cycle 132 made a decorator there a
      // SyntaxError. Named anyway rather than left to the default arm, which
      // would hand an accessor the METHOD contexts: relying on a position being
      // unreachable is how C1's operator bug survived.
      return { parameter: 'ClassAccessor', ret: 'ClassAccessor' };
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
    Q(yield* ApplyDecorators(decorators, Q(yield* SubTargetContext(kinds.parameter, i, ownerKind, ownerName, classCtor, parameters[i]))));
  }
  if (n.TypeAnnotation?.Decorators && n.TypeAnnotation.Decorators.length > 0) {
    // decorators.md's `ClassMethodReturnReflection` and its siblings give the
    // RETURN sub-target a `type` - the annotated type ITSELF, where the owning
    // member's `type` is the whole function type. Passing the annotation node
    // is what lets the two differ, which is the distinction the pair exists for.
    Q(yield* ApplyDecorators(n.TypeAnnotation.Decorators, Q(yield* SubTargetContext(kinds.ret, -1, ownerKind, ownerName, classCtor, n.TypeAnnotation as unknown as ParseNode))));
  }
  return undefined;
}

/**
 * decorators.md's `ClassMethodParameterReflection` and its siblings. A parameter
 * carries its `index`; a return does not, which is what distinguishes the two
 * beyond the context type.
 */
export function* SubTargetContext(kind: string, index: number, ownerKind: string, ownerName: Value, classCtor: Value, node?: ParseNode): ValueEvaluator {
  const realm = surroundingAgent.currentRealmRecord;
  const context = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
  X(CreateDataProperty(context, Value('kind'), Value(kind)));
  StampReflectionContext(context, kind);
  // proposal-runtime-types #sec-reflection-shape-class: a SETTER parameter
  // carries no `index` where the other parameter reflections do, because a
  // setter takes exactly one parameter and an index that is always 0 reports
  // nothing.
  if (index >= 0 && kind !== 'ClassSetterParameter' && kind !== 'ObjectSetterParameter') {
    X(CreateDataProperty(context, Value('index'), Value(index)));
  }
  // decorators.md's `ClassMethodParameterReflection` gives `type`, `name` and
  // `initial` beside `index`. The builder took no NODE, so it could report only
  // what its arguments carried - the same gap the method context had, and the
  // parameter node was sitting in the loop that calls this.
  if (node && index < 0) {
    // A RETURN sub-target: the node IS the annotation, and `type` is the
    // annotated type itself.
    const annotation = node as { Type?: ParseNode };
    if (annotation.Type) {
      const t = EnsureCompletion(yield* TypeNodeToTypeRecord(annotation.Type as never));
      if (t.Type === 'normal') {
        X(CreateDataProperty(context, Value('type'), GetTypeObject(t.Value as unknown as TypeRecord, realm) as Value));
      }
    }
  } else if (node) {
    const binding = node as {
      BindingIdentifier?: { name?: string } | null,
      TypeAnnotation?: { Type?: ParseNode } | null,
      Initializer?: ParseNode | null,
    };
    const paramName = binding.BindingIdentifier?.name;
    if (paramName !== undefined) {
      X(CreateDataProperty(context, Value('name'), Value(paramName)));
    }
    if (binding.TypeAnnotation?.Type) {
      const t = EnsureCompletion(yield* TypeNodeToTypeRecord(binding.TypeAnnotation.Type as never));
      if (t.Type === 'normal') {
        X(CreateDataProperty(context, Value('type'), GetTypeObject(t.Value as unknown as TypeRecord, realm) as Value));
      }
    }
    // `initial` is the DECLARED default, on the same terms a field's is: a
    // constant is reported, anything else is *undefined* rather than evaluated,
    // since evaluating a parameter default at class definition would run it at
    // the wrong time and once rather than per call.
    const init = binding.Initializer as { type?: string, value?: unknown } | null | undefined;
    let initial: Value = Value.undefined;
    if (init) {
      if (init.type === 'NumericLiteral') {
        initial = Value(Number(init.value));
      } else if (init.type === 'StringLiteral') {
        initial = Value(String(init.value));
      } else if (init.type === 'BooleanLiteral') {
        initial = init.value ? Value.true : Value.false;
      } else if (init.type === 'NullLiteral') {
        initial = Value.null;
      }
    }
    X(CreateDataProperty(context, Value('initial'), initial));
    // Same pair as a field's: the constant where there is one, the declaration
    // as tokens either way. A parameter default of `f()` has no `initial` and a
    // readable `initializer`.
    X(CreateDataProperty(context, Value('initializer'), InitializerTokensOf(node)));
  }
  // decorators.md gives a sub-target `metadata`, prototype-linked to the same
  // sub-target on the base class - the same rule a member's metadata follows,
  // under a key that names the METHOD AND POSITION rather than just a member.
  X(CreateDataProperty(context, Value('metadata'), Q(yield* SubTargetMetadataFor(classCtor, ownerName, index))));
  // "methodContext: Reflect.ClassMethod.<TMethod, TClass>" - a sub-target
  // reaches the declaration it is part of, as a member reaches its class.
  X(CreateDataProperty(context, Value('methodContext'), Q(yield* ClassMemberDecoratorContext(
    ownerKind, ownerName, false, currentClassName ?? Value.undefined, classCtor,
  ))));
  return context;
}

/**
 * The DECLARATION that produced `initial`, as a TokenStream.
 *
 * `initial` captures CONSTANT values only - a non-constant initializer reports
 * *undefined*, because evaluating it would run user code at class definition
 * rather than per call. decorators.md calls that "a limitation" and defers the
 * `Expression` that would fix it; decoratorreplacement.md gives `Expression` a
 * meaning, so the two now sit side by side: the VALUE where there is one, and
 * the EXPRESSION that produced it either way.
 *
 * They are not two spellings of one thing. `x: uint8 = f()` has no `initial`
 * and a perfectly good `initializer`.
 */
export function InitializerTokensOf(node: unknown): Value {
  // An absent initializer is NULL here, not undefined - the parser writes the
  // field either way. Guarding only for undefined let a null through and
  // `TokensOf` read `sourceText` off it.
  const init = (node as { Initializer?: ParseNode | null })?.Initializer;
  if (init === undefined || init === null) {
    return Value.undefined;
  }
  const realm = surroundingAgent.currentRealmRecord;
  return CreateTokenStream(TokensOf(init), realm);
}
