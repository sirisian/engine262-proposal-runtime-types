import { Evaluate } from '../evaluator.mts';
import {
  EnsureCompletion,
  UpdateEmpty,
  NormalCompletion,
} from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { surroundingAgent, TransferResultDependency, type Completion, type Value } from '#self';

/** https://tc39.es/ecma262/#sec-block-runtime-semantics-evaluation */
export function* Evaluate_StatementList(StatementList: ParseNode.StatementList) {
  if (StatementList.length === 0) {
    return NormalCompletion(undefined);
  }

  let blockCompletion: Completion<void | Value> = NormalCompletion(undefined);

  for (let index = 0; index < StatementList.length; index += 1) {
    const StatementListItem = StatementList[index];

    if (surroundingAgent.hostDefinedOptions.onDebugger) {
      const NextStatementListItem = StatementList[index + 1];
      surroundingAgent.runningExecutionContext.callSite.setNextLocation(NextStatementListItem);
    }

    if (blockCompletion.Type !== 'normal') return blockCompletion;
    const itemCompletion = EnsureCompletion(yield* Evaluate(StatementListItem));
    const next: Completion<void | Value> = UpdateEmpty(itemCompletion, blockCompletion.Value);
    if (itemCompletion.Value === undefined) TransferResultDependency(blockCompletion, next);
    blockCompletion = next;
  }

  return blockCompletion;
}
