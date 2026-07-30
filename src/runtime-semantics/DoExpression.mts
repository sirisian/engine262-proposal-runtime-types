import { Value, Descriptor } from '../value.mts';
import {
  EnsureCompletion, Q, X, type Completion, type ValueCompletion, type ValueEvaluator,
} from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { BlockDecoratorContext, Evaluate_Block } from './all.mts';
import { ApplyDecorators } from './ClassDefinitionEvaluation.mts';
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
  // #sec-do-expression-modifications: a DoBlock decorator may RETURN a
  // replacement, which is the capability the design gives these two contexts and
  // the reason the exclusion of blocks from replacement had no content once a
  // block had a value. It fires on ENTRY, as every block decorator does, so a
  // replacement means the block is not evaluated at all - which is what makes
  // `@memo do { expensive() }` a memoization rather than a wrapper.
  const decorators = (node.Block as { Decorators?: readonly ParseNode.Decorator[] | null } | undefined)?.Decorators;
  if (surroundingAgent.feature('runtime-types') && decorators?.length) {
    const context = Q(yield* BlockDecoratorContext('DoBlock', Value.undefined));
    const replacement = Q(yield* ApplyDecorators(decorators, context, true));
    if (replacement !== undefined && replacement !== Value.undefined) {
      return replacement;
    }
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
  // A `do *`'s body is a generator body rather than a Block, so Evaluate_Block
  // - which is what fires a block decorator - never sees it. The decorators are
  // applied here instead, with the DoGeneratorBlock context, and "every entry"
  // means every evaluation of the expression, which isevery time a generator is
  // produced rather than every `next`.
  const decorated = node.GeneratorBody as { Decorators?: readonly ParseNode.Decorator[] | null } | undefined;
  if (surroundingAgent.feature('runtime-types') && decorated?.Decorators?.length) {
    const context = Q(yield* BlockDecoratorContext('DoGeneratorBlock', Value.undefined));
    const replacement = Q(yield* ApplyDecorators(decorated.Decorators, context, true));
    if (replacement !== undefined && replacement !== Value.undefined) {
      // What a `do *` decorator replaces is an ITERATOR, and wrapping one -
      // filtering, limiting, buffering a sequence - is what a decorator over a
      // sequence is for.
      return replacement;
    }
  }
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
