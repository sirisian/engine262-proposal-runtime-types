import { Value, Descriptor } from '../value.mts';
import {
  EnsureCompletion, Q, X, type Completion, type ValueCompletion, type ValueEvaluator,
} from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { Evaluate_Block } from './all.mts';
import {
  Call, DefinePropertyOrThrow, OrdinaryFunctionCreate, OrdinaryObjectCreate,
  sourceTextMatchedBy, surroundingAgent,
} from '#self';

/**
 * proposal-runtime-types #sec-do-expressions: Runtime Semantics: Evaluation.
 *
 * The plain form is a handful of lines because the machinery was already here:
 * Evaluate_StatementList threads UpdateEmpty exactly as the base specification
 * does, so a block's completion already CARRIES its completion value. All this
 * does is read it, and turn an empty completion into `undefined` - which is
 * `do {}` being `void 0`.
 *
 * An abrupt completion propagates untouched, and that is the feature rather
 * than an omission: `return`, `break`, and `continue` inside a `do` mean what
 * they mean in the surrounding code, which is what makes a `do` unlike an
 * immediately-invoked arrow.
 */
export function* Evaluate_DoExpression(node: ParseNode.DoExpression): ValueEvaluator {
  if (node.star) {
    return yield* EvaluateDoGenerator(node);
  }
  const completion = EnsureCompletion(yield* Evaluate_Block(node.Block!)) as Completion<Value | void>;
  if (completion.Type !== 'normal') {
    // `return`, `break`, and `continue` leave the expression untouched, which
    // is what makes a `do` unlike an immediately-invoked arrow.
    return completion as ValueCompletion;
  }
  // An EMPTY completion is `do {}` being `void 0`.
  return completion.Value === undefined ? Value.undefined : completion.Value;
}

/**
 * proposal-runtime-types #sec-do-generator-expressions.
 *
 * A `do *` evaluates to a generator object, and the construction is a generator
 * function's with ONE difference that is the entire point of the form: the
 * closure is created with ~lexical-this~, as an arrow's is. The syntax exists to
 * delete a `function* () { ... }.call(this)`, and building it from the generator
 * expression path instead would give back a generator whose `this` is undefined
 * in strict code - a failure that shows up only where the body reads `this`.
 *
 * It has no parameters and no name, so the binding-identifier scope a generator
 * expression builds and the SetFunctionName it performs are both absent. The
 * closure is called immediately with no arguments, and the generator object it
 * returns is the expression's value.
 */
function* EvaluateDoGenerator(node: ParseNode.DoExpression): ValueEvaluator {
  const scope = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  const privateScope = surroundingAgent.runningExecutionContext.PrivateEnvironment;
  const sourceText = sourceTextMatchedBy(node);
  const intrinsic = node.async ? '%AsyncGeneratorFunction.prototype%' : '%GeneratorFunction.prototype%';
  const protoIntrinsic = node.async
    ? '%AsyncGeneratorFunction.prototype.prototype%'
    : '%GeneratorFunction.prototype.prototype%';
  const closure = OrdinaryFunctionCreate(
    surroundingAgent.intrinsic(intrinsic),
    sourceText,
    [] as unknown as ParseNode.FormalParameters,
    node.GeneratorBody!,
    'lexical-this',
    scope,
    privateScope,
  );
  const prototype = X(OrdinaryObjectCreate(surroundingAgent.intrinsic(protoIntrinsic)));
  X(DefinePropertyOrThrow(closure, Value('prototype'), Descriptor({
    Value: prototype,
    Writable: Value.true,
    Enumerable: Value.false,
    Configurable: Value.false,
  })));
  // Calling it is what produces the generator object; `undefined` is the
  // receiver, which a lexical-this closure ignores.
  return Q(yield* Call(closure, Value.undefined, []));
}
