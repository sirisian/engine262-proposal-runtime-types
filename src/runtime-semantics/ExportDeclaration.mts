import { Value } from '../value.mts';
import { Evaluate } from '../evaluator.mts';
import { BoundNames, IsAnonymousFunctionDefinition } from '../static-semantics/all.mts';
import { NormalCompletion, Q } from '../completion.mts';
import { OutOfRange } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  NamedEvaluation,
  InitializeBoundName,
  BindingClassDeclarationEvaluation,
  DecoratorListEvaluation,
} from './all.mts';
import { surroundingAgent } from '#self';
import { Evaluate_FunctionDeclaration } from './FunctionDeclaration.mts';
import {
  Assert, GetValue, type ECMAScriptFunctionObject, type FunctionDeclaration,
} from '#self';

/** https://tc39.es/ecma262/#sec-exports-runtime-semantics-evaluation */
//   ExportDeclaration :
//     `export` ExportFromClause FromClause `;`
//     `export` NamedExports `;`
//     `export` VariableDeclaration
//     `export` Declaration
//     `export` `default` HoistableDeclaration
//     `export` `default` ClassDeclaration
//     `export` `default` AssignmentExpression `;`
export function* Evaluate_ExportDeclaration(ExportDeclaration: ParseNode.ExportDeclaration) {
  const {
    FromClause, NamedExports,
    VariableStatement,
    Declaration,
    default: isDefault,
    HoistableDeclaration,
    ClassDeclaration,
    AssignmentExpression,
    Decorators,
  } = ExportDeclaration;

  if (FromClause || NamedExports) {
    // 1. Return NormalCompletion(empty).
    return NormalCompletion(undefined);
  }
  if (VariableStatement) {
    // 1. Return the result of evaluating VariableStatement.
    return yield* Evaluate(VariableStatement);
  }
  if (Declaration) {
    if (Decorators) {
      // A decorated exported FUNCTION declaration. The decorators sit on this
      // node rather than on the declaration, so they are handed to the function
      // evaluator, which owns the application - decorators.md's rule that a
      // decorated declaration does not hoist, the sub-target pass, and the
      // replacement written back through the binding are all its.
      //
      // This reached an assertion that a decorated export is always a class, so
      // `@dec export function f() {}` was refused outright. Every builder in the
      // standard kit is an exported function, so no kit builder could carry a
      // decorator at all - which is how this was found, trying to give the kit
      // its `exemplars`.
      if (Declaration.type === 'FunctionDeclaration') {
        Assert(!Declaration.Decorators);
        return yield* Evaluate_FunctionDeclaration(Declaration, Decorators);
      }
      Assert(Declaration.type === 'ClassDeclaration' && !Declaration.Decorators);
      const decorators = Q(yield* DecoratorListEvaluation(Decorators));
      Q(yield* BindingClassDeclarationEvaluation(Declaration, decorators));
      return undefined;
    } else {
      // 1. Return the result of evaluating Declaration.
      return yield* Evaluate(ExportDeclaration.Declaration!);
    }
  }
  if (!isDefault) {
    throw OutOfRange.exhaustive(ExportDeclaration);
  }
  if (HoistableDeclaration) {
    // 1. Return the result of evaluating HoistableDeclaration.
    return yield* Evaluate(HoistableDeclaration);
  }
  if (ClassDeclaration) {
    const decorators = Decorators ? Q(yield* DecoratorListEvaluation(Decorators)) : [];
    const value = Q(yield* BindingClassDeclarationEvaluation(ClassDeclaration, decorators)) as ECMAScriptFunctionObject;
    // 2. Let className be the sole element of BoundNames of ClassDeclaration.
    const className = BoundNames(ClassDeclaration)[0];
    // If className is "*default*", then
    if (className.stringValue() === '*default*') {
      // a. Let env be the running execution context's LexicalEnvironment.
      const env = surroundingAgent.runningExecutionContext.LexicalEnvironment;
      // b. Perform ? InitializeBoundName("*default*", value, env).
      Q(yield* InitializeBoundName(Value('*default*'), value, env));
    }
    // 3. Return NormalCompletion(empty).
    return NormalCompletion(undefined);
  }
  if (AssignmentExpression) {
    let value;
    // 1. If IsAnonymousFunctionDefinition(AssignmentExpression) is true, then
    if (IsAnonymousFunctionDefinition(AssignmentExpression)) {
      // a. Let value be NamedEvaluation of AssignmentExpression with argument "default".
      value = yield* NamedEvaluation(AssignmentExpression as FunctionDeclaration, Value('default'));
    } else { // 2. Else,
      // a. Let rhs be the result of evaluating AssignmentExpression.
      const rhs = Q(yield* Evaluate(AssignmentExpression));
      // a. Let value be ? GetValue(rhs).
      value = Q(yield* GetValue(rhs));
    }
    // 3. Let env be the running execution context's LexicalEnvironment.
    const env = surroundingAgent.runningExecutionContext.LexicalEnvironment;
    // 4. Perform ? InitializeBoundName("*default*", value, env).
    Q(yield* InitializeBoundName(Value('*default*'), value as ECMAScriptFunctionObject, env));
    // 5. Return NormalCompletion(empty).
    return NormalCompletion(undefined);
  }
  throw OutOfRange.exhaustive(ExportDeclaration);
}
