import { NormalCompletion } from '../completion.mts';
import { StampReflectionContext } from '../type-system/reflection-contexts.mts';
import { Q } from '../completion.mts';
import type { PlainEvaluator, ValueEvaluator } from '../evaluator.mts';
import { Value } from '../value.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { ApplyDecorators, ApplySubTargetDecorators, HasSubTargetDecorators } from './ClassDefinitionEvaluation.mts';
import { MetadataObjectFor } from './ClassDefinitionEvaluation.mts';
import { PutValue } from '#self';
import { CreateDataProperty, OrdinaryObjectCreate, ResolveBinding, X, surroundingAgent } from '#self';
import { InstantiateFunctionObject } from './all.mts';

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
  // The guard admits a function whose SUB-TARGETS are decorated even when the
  // function itself is not: `function g(@f p: uint8): @f uint8` is two
  // decorations of positions that have contexts, and it fired neither, because
  // the sub-target application was reached only through the function's own.
  // A class method and an object method never had this - theirs run from
  // ClassElementEvaluation, which does not ask whether the member is decorated.
  if (surroundingAgent.feature('runtime-types')
      && (FunctionDeclaration.Decorators?.length || HasSubTargetDecorators(FunctionDeclaration as never))) {
    const name = (FunctionDeclaration.BindingIdentifier as { name?: string } | undefined)?.name;
    let fn: Value = Value.undefined;
    if (typeof name === 'string') {
      // A DECORATED declaration is not initialized by hoisting - decorators.md
      // makes it behave as `var f = @dec function () {};` - so the function is
      // instantiated HERE, at its written position, and assigned through the
      // binding hoisting left holding *undefined*.
      const running = surroundingAgent.runningExecutionContext;
      fn = InstantiateFunctionObject(
        FunctionDeclaration as never,
        running.LexicalEnvironment,
        running.PrivateEnvironment,
      ) as Value;
      Q(yield* PutValue(Q(yield* ResolveBinding(Value(name))), fn));
    }
    Q(yield* ApplySubTargetDecorators(FunctionDeclaration as never, 'Function', typeof name === 'string' ? Value(name) : Value.undefined, fn));
    if (FunctionDeclaration.Decorators?.length) {
      const replacement = Q(yield* ApplyDecorators(FunctionDeclaration.Decorators, Q(yield* FunctionDecoratorContext(
        typeof name === 'string' ? Value(name) : Value.undefined, fn,
      )), true));
      // decorators.md's table: a `Reflect.Function` decorator's return "replaces
      // the function". The binding is already initialized by the time the
      // decorators run - hoisting sees to that - so the replacement is WRITTEN
      // BACK through it, exactly as a class declaration's is: assigning the
      // local read of it would replace nothing, since every later reference
      // resolves the name again.
      if (replacement !== undefined && typeof name === 'string') {
        Q(yield* PutValue(Q(yield* ResolveBinding(Value(name))), replacement));
      }
    }
  }
  // 1. Return NormalCompletion(empty).
  return NormalCompletion(undefined);
}

/** decorators.md's `FunctionReflection`: `name`, `type`, `signatures`, `metadata`. */
export function* FunctionDecoratorContext(name: Value, fn: Value): ValueEvaluator {
  const realm = surroundingAgent.currentRealmRecord;
  const context = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
  X(CreateDataProperty(context, Value('kind'), Value('Function')));
  StampReflectionContext(context, 'Function');
  X(CreateDataProperty(context, Value('name'), name));
  X(CreateDataProperty(context, Value('type'), fn));
  // A function has no base declaration, so its metadata inherits nothing - the
  // prototype chain that carries a class member's is a CLASS structure, and
  // decorators.md's inheritance rule is written about one.
  X(CreateDataProperty(context, Value('metadata'), MetadataObjectFor(fn, undefined)));
  return context;
}
