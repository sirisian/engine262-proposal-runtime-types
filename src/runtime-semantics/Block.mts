import { Value } from '../value.mts';
import { StampReflectionContext } from '../type-system/reflection-contexts.mts';
import { Q } from '../completion.mts';
import type { ValueEvaluator } from '../evaluator.mts';
import {
  LexicallyScopedDeclarations,
  IsConstantDeclaration,
  BoundNames,
} from '../static-semantics/all.mts';
import { X, NormalCompletion } from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { DisposeResources } from '../abstract-ops/disposal.mts';
import { ApplyDecorators } from './ClassDefinitionEvaluation.mts';
import { Evaluate_StatementList, InstantiateFunctionObject } from './all.mts';
import { CreateDataProperty, OrdinaryObjectCreate } from '#self';
import { surroundingAgent, Assert, DeclarativeEnvironmentRecord } from '#self';

/** https://tc39.es/ecma262/#sec-blockdeclarationinstantiation */
export function* BlockDeclarationInstantiation(code: ParseNode.StatementList | ParseNode.CaseBlock, env: DeclarativeEnvironmentRecord) {
  // 1. Assert: env is a declarative Environment Record.
  Assert(env instanceof DeclarativeEnvironmentRecord);
  // 2. Let declarations be the LexicallyScopedDeclarations of code.
  const declarations = LexicallyScopedDeclarations(code);
  // 3. Let privateEnv be the running execution context's PrivateEnvironment.
  const privateEnv = surroundingAgent.runningExecutionContext.PrivateEnvironment;
  // 4. For each element d in declarations, do
  for (const d of declarations) {
    // a. For each element dn of the BoundNames of d, do
    for (const dn of BoundNames(d)) {
      // i. If IsConstantDeclaration of d is true, then
      if (IsConstantDeclaration(d)) {
        // 1. Perform ! env.CreateImmutableBinding(dn, true).
        X(env.CreateImmutableBinding(dn, Value.true));
      } else { // ii. Else,
        // 1. Perform ! env.CreateMutableBinding(dn, false).
        X(env.CreateMutableBinding(dn, Value.false));
      }
      // b. If d is a FunctionDeclaration, a GeneratorDeclaration, an AsyncFunctionDeclaration, or an AsyncGeneratorDeclaration, then
      if (d.type === 'FunctionDeclaration'
          || d.type === 'GeneratorDeclaration'
          || d.type === 'AsyncFunctionDeclaration'
          || d.type === 'AsyncGeneratorDeclaration') {
        // i. Let fn be the sole element of the BoundNames of d.
        const fn = BoundNames(d)[0];
        // ii. Let fo be InstantiateFunctionObject of d with argument env.
        const fo = InstantiateFunctionObject(d, env, privateEnv);
        // iii. Perform env.InitializeBinding(fn, fo).
        yield* env.InitializeBinding(fn, fo);
      }
    }
  }
}

/** https://tc39.es/ecma262/#sec-block-runtime-semantics-evaluation */
//  Block :
//    `{` `}`
//    `{` StatementList `}`
export function* Evaluate_Block({ StatementList, Decorators }: ParseNode.Block) {
  // proposal-runtime-types decorators.md "Order": "Block, `let`, and `const`
  // decorators are on the other timeline: they fire when the STATEMENT EXECUTES
  // rather than when a declaration is evaluated. A block decorator on a loop
  // body therefore fires ONCE PER ITERATION, which makes block decorators the
  // only ones that can run more than once."
  //
  // So this fires on ENTRY, every entry, and that asymmetry is the feature: a
  // decorator observing a block is observing an execution rather than a
  // declaration.
  //
  // The reflection carries `label` only. Every other field the design gives a
  // block - `block`, `condition`, `initializer`, `update` - is an `Expression`,
  // and the design says in as many words: "That `Expression` is not defined
  // here. Macro AST is out of scope. The Expression is a placeholder." They are
  // absent rather than *undefined* so a reader meets the deferral.
  if (surroundingAgent.feature('runtime-types') && Decorators?.length) {
    Q(yield* ApplyDecorators(Decorators, Q(yield* BlockDecoratorContext('Block', Value.undefined))));
  }
  if (StatementList.length === 0) {
    // 1. Return NormalCompletion(empty).
    return NormalCompletion(undefined);
  }
  // 1. Let oldEnv be the running execution context's LexicalEnvironment.
  const oldEnv = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  // 2. Let blockEnv be NewDeclarativeEnvironment(oldEnv).
  const blockEnv = new DeclarativeEnvironmentRecord(oldEnv);
  // 3. Perform BlockDeclarationInstantiation(StatementList, blockEnv).
  yield* BlockDeclarationInstantiation(StatementList, blockEnv);
  // 4. Set the running execution context's LexicalEnvironment to blockEnv.
  surroundingAgent.runningExecutionContext.LexicalEnvironment = blockEnv;
  // 5. Let blockValue be the result of evaluating StatementList.
  let blockValue = yield* Evaluate_StatementList(StatementList);
  // proposal-runtime-types (explicit resource management): the resources a `using`
  // declaration registered in this block are disposed as the block is left, in
  // reverse order, whether the block completed normally or abruptly.
  blockValue = (yield* DisposeResources(blockEnv, blockValue)) as typeof blockValue;
  // 6. Set the running execution context's LexicalEnvironment to oldEnv.
  surroundingAgent.runningExecutionContext.LexicalEnvironment = oldEnv;
  // 7. Return blockValue.
  return blockValue;
}

/** decorators.md's `BlockReflection`: `label`, and an AST the design defers. */
export function* BlockDecoratorContext(kind: string, label: Value): ValueEvaluator {
  const realm = surroundingAgent.currentRealmRecord;
  const context = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
  X(CreateDataProperty(context, Value('kind'), Value(kind)));
  StampReflectionContext(context, kind);
  X(CreateDataProperty(context, Value('label'), label));
  return context;
}
