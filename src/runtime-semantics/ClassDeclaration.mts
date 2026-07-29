import { Value, ObjectValue } from '../value.mts';
import { StringValue } from '../static-semantics/all.mts';
import { Q, NormalCompletion } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import { GetTypeObject } from '../type-system/intern.mts';
import { AssociateClassType } from '../abstract-ops/runtime-types.mts';
import {
  InitializeBoundName, ClassDefinitionEvaluation, PartialClassMergeEvaluation, type DecoratorDefinitionRecord, DecoratorListEvaluation,
  ApplyDecorators, ClassDecoratorContext,
} from './all.mts';
import {
  surroundingAgent, ResolveBinding, GetValue, PutValue, IsConstructor, Throw,
} from '#self';

/** https://tc39.es/ecma262/#sec-runtime-semantics-bindingclassdeclarationevaluation */
//   ClassDeclaration :
//     `class` BindingIdentifier ClassTail
//     `class` ClassTail
export function* BindingClassDeclarationEvaluation(ClassDeclaration: ParseNode.ClassDeclaration, decorators: readonly DecoratorDefinitionRecord[]): ValueEvaluator {
  const { BindingIdentifier, ClassTail } = ClassDeclaration;
  const sourceText = ClassDeclaration.sourceText;
  // proposal-runtime-types (README "Class Extension"): a `partial class` re-opens
  // the class its name already binds and merges the new members into it, rather
  // than creating a new class. The name must already be bound to a constructor;
  // the new methods and operators are added to that constructor and its prototype.
  if ((ClassDeclaration as { ClassModifiers?: readonly string[] | null }).ClassModifiers?.includes('partial')) {
    if (!BindingIdentifier) {
      return Throw.SyntaxError('A partial class requires a name');
    }
    const partialName = StringValue(BindingIdentifier);
    const ref = Q(yield* ResolveBinding(partialName, undefined));
    const existing = Q(yield* GetValue(ref));
    if (!(existing instanceof ObjectValue) || !IsConstructor(existing)) {
      return Throw.TypeError('$1 is not a class and cannot be extended by a partial class', partialName);
    }
    Q(yield* PartialClassMergeEvaluation(existing, ClassTail));
    return existing;
  }
  if (!BindingIdentifier) {
    const anon = Q(yield* ClassDefinitionEvaluation(ClassTail, Value.undefined, Value('default'), sourceText, decorators));
    if (surroundingAgent.feature('runtime-types')) {
      AssociateClassType(anon, GetTypeObject({ Kind: 'nominal', Declaration: ClassDeclaration, Arguments: [], Constructor: anon }));
    }
    return anon;
  }
  // 1. Let className be StringValue of BindingIdentifier.
  const className = StringValue(BindingIdentifier);
  // 2. Let value be ? ClassDefinitionEvaluation of ClassTail with arguments className, className, decorators.
  const value = Q(yield* ClassDefinitionEvaluation(ClassTail, className, className, sourceText, decorators));
  // proposal-runtime-types M21: associate the class type with its constructor.
  if (surroundingAgent.feature('runtime-types')) {
    const typeObject = GetTypeObject({ Kind: 'nominal', Declaration: ClassDeclaration, Arguments: [], Constructor: value });
    AssociateClassType(value, typeObject);
  }
  // 4. Let env be the running execution context's LexicalEnvironment.
  const env = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  // 5. Perform ? InitializeBoundName(className, value, env).
  Q(yield* InitializeBoundName(className, value, env));
  // 6. Return value.
  return value;
}

/** https://tc39.es/ecma262/#sec-class-definitions-runtime-semantics-evaluation */
//   ClassDeclaration : `class` BindingIdentifier ClassTAil
export function* Evaluate_ClassDeclaration(ClassDeclaration: ParseNode.ClassDeclaration): PlainEvaluator {
  // proposal-runtime-types: under this proposal the reserved layout controls
  // are read from the syntax and never evaluated, and no other decorator is
  // implemented yet. Under the TC39 feature - which is mutually exclusive with
  // this one - the list evaluates as that proposal specifies.
  let decorators: DecoratorDefinitionRecord[] = [];
  if (surroundingAgent.feature('runtime-types')) {
    // decorators.md "Order": "Members apply before their container, in document
    // order, and the container's own decorators apply last. A class decorator
    // sees a FINISHED CLASS, including whatever its fields' and methods'
    // decorators did." So the class's own decorators run after the class is
    // built, not before - which is why this sits below the evaluation rather
    // than above it, where the refusal it replaces sat.
    Q(yield* BindingClassDeclarationEvaluation(ClassDeclaration, decorators));
    const name = ClassDeclaration.BindingIdentifier
      ? Value((ClassDeclaration.BindingIdentifier as { name: string }).name)
      : Value.undefined;
    let ctor: Value = Value.undefined;
    let binding;
    if (ClassDeclaration.BindingIdentifier) {
      binding = Q(yield* ResolveBinding(name as never));
      ctor = Q(yield* GetValue(binding));
    }
    // decorators.md: a class decorator's return "replaces the class itself".
    // BindingClassDeclarationEvaluation has already initialized the binding, so
    // the replacement is WRITTEN BACK through it - assigning the local read
    // above would replace nothing, since every later reference resolves the
    // name again. An anonymous class expression has no binding to write to and
    // so cannot be replaced this way; pinned rather than guessed at.
    const replacement = Q(yield* ApplyDecorators(ClassDeclaration.Decorators, Q(yield* ClassDecoratorContext(name, ctor)), true));
    if (replacement !== undefined && binding !== undefined) {
      Q(yield* PutValue(binding, replacement));
    }
    return NormalCompletion(undefined);
  } else if (ClassDeclaration.Decorators) {
    decorators = Q(yield* DecoratorListEvaluation(ClassDeclaration.Decorators));
  }
  // 1. Perform ? BindingClassDeclarationEvaluation of this ClassDeclaration.
  Q(yield* BindingClassDeclarationEvaluation(ClassDeclaration, decorators));
  // 2. Return NormalCompletion(empty).
  return NormalCompletion(undefined);
}
