import { NormalCompletion } from '../completion.mts';
import { Q } from '../completion.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import { Value } from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { ApplyDecorators, ApplySubTargetDecorators } from './ClassDefinitionEvaluation.mts';
import { CreateDataProperty, GetValue, OrdinaryObjectCreate, ResolveBinding, X, surroundingAgent } from '#self';

/** https://tc39.es/ecma262/#sec-function-definitions-runtime-semantics-evaluation */
// FunctionDeclaration :
//   function BindingIdentifier ( FormalParameters ) { FunctionBody }
//   function ( FormalParameters ) { FunctionBody }
export function* Evaluate_FunctionDeclaration(FunctionDeclaration: ParseNode.FunctionDeclaration): PlainEvaluator {
  // proposal-runtime-types decorators.md "Order": "A DECORATED FUNCTION
  // DECLARATION DOES NOT HOIST. `@dec function f() {}` behaves as
  // `var f = @dec function () {};`"
  //
  // An undecorated function declaration is instantiated during hoisting and
  // this evaluation does nothing, which is why the body below was empty. A
  // decorated one has work to do here, at its written position, because its
  // decorator expressions must evaluate in document order and cannot run before
  // the bindings they reference exist.
  if (surroundingAgent.feature('runtime-types') && FunctionDeclaration.Decorators?.length) {
    const name = (FunctionDeclaration.BindingIdentifier as { name?: string } | undefined)?.name;
    let fn: Value = Value.undefined;
    if (typeof name === 'string') {
      fn = Q(yield* GetValue(Q(yield* ResolveBinding(Value(name)))));
    }
    Q(yield* ApplySubTargetDecorators(FunctionDeclaration as never, 'Function', typeof name === 'string' ? Value(name) : Value.undefined, fn));
    Q(yield* ApplyDecorators(FunctionDeclaration.Decorators, Q(yield* FunctionDecoratorContext(
      typeof name === 'string' ? Value(name) : Value.undefined, fn,
    ))));
  }
  // 1. Return NormalCompletion(empty).
  return NormalCompletion(undefined);
}

/** decorators.md's `FunctionReflection`: `name`, `type`, `signatures`, `metadata`. */
export function* FunctionDecoratorContext(name: Value, fn: Value): ValueEvaluator {
  const realm = surroundingAgent.currentRealmRecord;
  const context = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
  X(CreateDataProperty(context, Value('kind'), Value('Function')));
  X(CreateDataProperty(context, Value('name'), name));
  X(CreateDataProperty(context, Value('type'), fn));
  return context;
}
