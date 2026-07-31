import { Value, type JSStringValue } from '../value.mts';
import {
  EnsureCompletion, Q, X, type ValueEvaluator,
} from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { Evaluate } from '../evaluator.mts';
import {
  GetValue, surroundingAgent, DeclarativeEnvironmentRecord, Throw,
} from '#self';

/**
 * The topic's binding name.
 *
 * `%` is not a valid IdentifierName, so no program can name this binding and
 * no user code can shadow it. The topic is reached only through a
 * TopicReference, which the parser admits only inside a pipeline body.
 */
let topicName: JSStringValue | undefined;
export function TOPIC(): JSStringValue {
  // Computed lazily rather than at module scope: the bundle initialises these
  // modules before `Value`, so a top-level `Value('%')` throws on import.
  topicName ??= Value('%');
  return topicName;
}

/**
 * proposal-runtime-types #sec-pipeline-operator: Runtime Semantics.
 *
 * An immutable binding in its own environment buys three things at once, which
 * is why the specification chose it over a substitution. The left operand is
 * evaluated ONCE however many times the topic appears, so `expensive() |> [%,
 * %]` calls it once. A nested pipeline shadows an outer one for free, since it
 * creates a second environment. And reading the topic is an ordinary lookup.
 */
export function* Evaluate_PipelineExpression(node: ParseNode.PipelineExpression): ValueEvaluator {
  const value = Q(yield* GetValue(Q(yield* Evaluate(node.PipelineExpression)) as never));
  const oldEnv = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  const topicEnv = new DeclarativeEnvironmentRecord(oldEnv);
  X(topicEnv.CreateImmutableBinding(TOPIC(), Value.true));
  X(topicEnv.InitializeBinding(TOPIC(), value));
  surroundingAgent.runningExecutionContext.LexicalEnvironment = topicEnv;
  const result = EnsureCompletion(yield* Evaluate(node.Body));
  // Restored BEFORE the completion is propagated: a throwing step would
  // otherwise leave the topic environment installed for the rest of the frame.
  surroundingAgent.runningExecutionContext.LexicalEnvironment = oldEnv;
  return Q(result) as Value;
}

/**
 * #sec-pipeline-operator: the topic resolves in the nearest enclosing topic
 * environment.
 *
 * The chain is walked rather than the immediate environment read, and that is
 * not a refinement: a closure written inside a step - `xs |> %.map(v => v +
 * %.length)` - runs with its own function environment installed, whose OUTER is
 * the topic environment. Reading the immediate one finds no binding and
 * asserts.
 */
export function* Evaluate_TopicReference(_node: ParseNode.TopicReference): ValueEvaluator {
  const name = TOPIC();
  let env: typeof surroundingAgent.runningExecutionContext.LexicalEnvironment | null = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  while (env) {
    if (X(yield* env.HasBinding(name)) === Value.true) {
      return Q(yield* env.GetBindingValue(name, Value.true)) as Value;
    }
    env = env.OuterEnv;
  }
  // Unreachable for a parsed program: the parser admits a topic only inside a
  // pipeline body, and evaluating one installs the binding.
  return Q(Throw.ReferenceError('the topic is not bound here')) as Value;
}
