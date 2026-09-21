import type { ParseNode } from '../parser/ParseNode.mts';
import type { StatementEvaluator } from '../evaluator.mts';
import { DisposeResources } from '../abstract-ops/disposal.mts';
import { Evaluate_StatementList } from './all.mts';
import { surroundingAgent } from '#self';

/** https://tc39.es/ecma262/#sec-function-definitions-runtime-semantics-evaluation */
//   FunctionStatementList : [empty]
//
// (implicit)
//   FunctionStatementList : StatementList
export function* Evaluate_FunctionStatementList(FunctionStatementList: ParseNode.FunctionStatementList): StatementEvaluator {
  // The body owns the resources registered directly in its lexical environment,
  // just as an explicit Block does. Suspension keeps them alive until exit.
  const env = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  const result = yield* Evaluate_StatementList(FunctionStatementList);
  return (yield* DisposeResources(env, result)) as typeof result;
}
