import { Value, type JSStringValue } from '../value.mts';
import { StampReflectionContext } from '../type-system/reflection-contexts.mts';
import { collectOverloadGroups, MakeOverloadedFunction } from '../abstract-ops/runtime-types.mts';
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
import { CreateTokenStream } from '../intrinsics/TokenStream.mts';
import { TokensOf } from '../parser/TokensOf.mts';
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
  //
  // proposal-runtime-types: a name may be declared more than once here, as an
  // OVERLOAD, so the binding is created by the FIRST declaration of it and the
  // rest join the overload set below. ECMA-262 could not reach this - a second
  // lexical declaration of one name was an early error - which is why the
  // ordinary steps create a binding per declaration without checking.
  const lexicallyBound = new Set<string>();
  for (const d of declarations) {
    // a. For each element dn of the BoundNames of d, do
    for (const dn of BoundNames(d)) {
      if (lexicallyBound.has(dn.stringValue())) {
        continue;
      }
      lexicallyBound.add(dn.stringValue());
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
  // proposal-runtime-types: the overload SET, as GlobalDeclarationInstantiation
  // builds it for a script and InitializeEnvironment for a module. The loop
  // above bound the FIRST declaration of a repeated name; this replaces it with
  // the dispatcher built from all of them in source order.
  if (surroundingAgent.feature('runtime-types')) {
    const groups = collectOverloadGroups(
      declarations as unknown as { type: string }[],
      (d) => (BoundNames(d as ParseNode)[0] as JSStringValue).stringValue(),
    );
    for (const [, decls] of groups) {
      const name = BoundNames(decls[0] as ParseNode)[0] as JSStringValue;
      const functions = decls.map((d) => InstantiateFunctionObject(d as ParseNode.FunctionDeclaration, env, privateEnv));
      // `X`, not `Q`: this operation's only throw is the ambiguous-overload case,
      // which `check.mts` refuses EARLY - "$1 is declared twice with the same
      // parameter types and return type" - so it cannot reach here, and
      // `BlockDeclarationInstantiation`'s callers do not propagate a throw.
      const overloaded = X(yield* MakeOverloadedFunction(name, functions as Value[]));
      // SET, not initialize: the loop already initialized this binding with the
      // first declaration's function.
      X(yield* env.SetMutableBinding(name, overloaded, Value.false));
    }
  }
}

/** https://tc39.es/ecma262/#sec-block-runtime-semantics-evaluation */
//  Block :
//    `{` `}`
//    `{` StatementList `}`
export function* Evaluate_Block(node: ParseNode.Block & {
  BlockKind?: string,
  BlockParts?: ParseNode.BlockParts,
  BlockLabel?: string,
}) {
  const {
    StatementList, Decorators, BlockKind, BlockParts, BlockLabel,
  } = node;
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
    // The SUBKIND the parser recorded, if the block is a statement's body. All
    // eight reported the bare `Block` because the node carried no record of the
    // form that owns it - the design gives `IfBlock`, `ElseIfBlock`,
    // `ElseBlock`, `WhileBlock`, `DoWhileBlock`, `ForBlock`, `ForInBlock` and
    // `ForOfBlock` their own contexts, and a bare block keeps `Block`.
    const blockKind = BlockKind ?? 'Block';
    // proposal-runtime-types #sec-do-expression-modifications: a `do` block's
    // decorators are fired by the do EXPRESSION rather than here, because they
    // may REPLACE its value - the one thing a block decorator can do that no
    // other block has a use for - and the expression is what holds the value.
    if (blockKind !== 'DoBlock') {
      const label = BlockLabel === undefined ? Value.undefined : Value(BlockLabel);
      Q(yield* ApplyDecorators(Decorators, Q(yield* BlockDecoratorContext(blockKind, label, node, BlockParts))));
    }
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

/**
 * decorators.md's `BlockReflection` and its eleven siblings.
 *
 * `block` is the decorated block as a TokenStream; `condition`, `initializer`
 * and `update` are parts of the OWNING statement, which the parser recorded on
 * the block node because it is the one place both were in hand.
 *
 * These were `Expression` in the design and undefined in this engine until
 * decoratorreplacement.md gave `Expression` a meaning. A TokenStream is
 * deliberately below a syntax tree: the lexical grammar is already normative,
 * where a tree would have to be invented and versioned.
 */
export function* BlockDecoratorContext(
  kind: string,
  label: Value,
  node?: ParseNode,
  parts?: ParseNode.BlockParts,
): ValueEvaluator {
  const realm = surroundingAgent.currentRealmRecord;
  const context = OrdinaryObjectCreate(realm.Intrinsics['%Object.prototype%']);
  X(CreateDataProperty(context, Value('kind'), Value(kind)));
  StampReflectionContext(context, kind);
  X(CreateDataProperty(context, Value('label'), label));
  const stream = (n: ParseNode | undefined) => (n === undefined
    ? Value.undefined
    : CreateTokenStream(TokensOf(n), realm));
  X(CreateDataProperty(context, Value('block'), stream(node)));
  // Only the forms that HAVE these carry them, so a `Block` does not answer
  // *undefined* for a condition it could never have - an absent property and a
  // property that is always undefined say different things.
  if (parts?.condition !== undefined) {
    X(CreateDataProperty(context, Value('condition'), stream(parts.condition as ParseNode)));
  }
  if (parts?.initializer !== undefined) {
    X(CreateDataProperty(context, Value('initializer'), stream(parts.initializer as ParseNode)));
  }
  if (parts?.update !== undefined) {
    X(CreateDataProperty(context, Value('update'), stream(parts.update as ParseNode)));
  }
  if (parts?.binding !== undefined) {
    X(CreateDataProperty(context, Value('binding'), stream(parts.binding as ParseNode)));
  }
  // #sec-reflection-shape-block, MatchArmBlock. `pattern` is *undefined* for a
  // `default` clause and `guard` where the clause is unguarded, present either
  // way so a reader walks one shape.
  if (parts?.subject !== undefined) {
    X(CreateDataProperty(context, Value('subject'), stream(parts.subject as ParseNode)));
    X(CreateDataProperty(context, Value('pattern'), stream(parts.pattern as ParseNode | undefined)));
    X(CreateDataProperty(context, Value('guard'), stream(parts.guard as ParseNode | undefined)));
    X(CreateDataProperty(context, Value('index'), parts.index === undefined ? Value.undefined : Value(parts.index)));
  }
  return context;
}
