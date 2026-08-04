import {
  JSStringValue, ObjectValue, Value, ReferenceRecord,
} from '../value.mts';
import {
  Evaluate, type Evaluator, type PlainEvaluator, type StatementEvaluator,
} from '../evaluator.mts';
import {
  BoundNames,
  IsConstantDeclaration,
  IsDestructuring,
  StringValue,
  type DestructuringParseNode,
} from '../static-semantics/all.mts';
import { CreateForInIterator, type ForInIteratorInstance } from '../intrinsics/ForInIteratorPrototype.mts';
import {
  Completion,
  NormalCompletion,
  AbruptCompletion,
  UpdateEmpty,
  EnsureCompletion,
  Await,
  Q, X,
  type PlainCompletion,
  BreakCompletion,
} from '../completion.mts';
import { OutOfRange } from '../utils/language.mts';
import { JSStringSet } from '../utils/container.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { CreateRefBinding } from '../execution-context/Environment.mts';
import { SoAStorageOf, SoAElementReference } from '../intrinsics/SoA.mts';
import {
  Evaluate_SwitchStatement,
  Evaluate_VariableDeclarationList,
  BindingInitialization,
  DestructuringAssignmentEvaluation,
  refineLeftHandSideExpression,
} from './all.mts';
import { surroundingAgent, DeclarativeEnvironmentRecord, EnvironmentRecord } from '#self';
import {
  Assert,
  Call,
  GetIterator,
  GetValue,
  PutValue,
  LocationOfAssignmentTarget,
  GetV,
  ResolveBinding,
  InitializeReferencedBinding,
  IteratorComplete,
  IteratorValue,
  IteratorClose,
  AsyncIteratorClose,
  ToBoolean,
  ToObject,
  SameValue,
  Throw,
  IsArray,
  LengthOfArrayLike,
  type IteratorRecord,
  ValueOfNormalCompletion,
} from '#self';

/** https://tc39.es/ecma262/#sec-loopcontinues */
function LoopContinues(completion: Completion<Value | void>, labelSet: JSStringSet) {
  // 1. If completion.[[Type]] is normal, return true.
  if (completion.Type === 'normal') {
    return Value.true;
  }
  // 2. If completion.[[Type]] is not continue, return false.
  if (completion.Type !== 'continue') {
    return Value.false;
  }
  // 3. If completion.[[Target]] is empty, return true.
  if (completion.Target === undefined) {
    return Value.true;
  }
  // 4. If completion.[[Target]] is an element of labelSet, return true.
  if (labelSet.has(completion.Target)) {
    return Value.true;
  }
  // 5. Return false.
  return Value.false;
}

export function LabelledEvaluation(node: ParseNode.LabelledStatement | ParseNode.BreakableStatement, labelSet: JSStringSet): StatementEvaluator {
  switch (node.type) {
    case 'DoWhileStatement':
    case 'WhileStatement':
    case 'ForStatement':
    case 'ForInStatement':
    case 'ForOfStatement':
    case 'ForAwaitStatement':
    case 'SwitchStatement':
      return LabelledEvaluation_BreakableStatement(node, labelSet);
    case 'LabelledStatement':
      return LabelledEvaluation_LabelledStatement(node, labelSet);
    default:
      throw OutOfRange.exhaustive(node);
  }
}

/** https://tc39.es/ecma262/#sec-labelled-statements-runtime-semantics-labelledevaluation */
//   LabelledStatement : LabelIdentifier `:` LabelledItem
function* LabelledEvaluation_LabelledStatement({ LabelIdentifier, LabelledItem }: ParseNode.LabelledStatement, labelSet: JSStringSet) {
  // 1. Let label be the StringValue of LabelIdentifier.
  const label = StringValue(LabelIdentifier);
  // 2. Append label as an element of labelSet.
  labelSet.add(label);
  // 3. Let stmtResult be LabelledEvaluation of LabelledItem with argument labelSet.
  let stmtResult = EnsureCompletion(yield* LabelledEvaluation_LabelledItem(LabelledItem, labelSet)) as Completion<Value | void>;
  // 4. If stmtResult.[[Type]] is break and SameValue(stmtResult.[[Target]], label) is true, then
  if (stmtResult.Type === 'break' && SameValue(stmtResult.Target!, label)) {
    // a. Set stmtResult to NormalCompletion(stmtResult.[[Value]]).
    stmtResult = NormalCompletion(stmtResult.Value);
  }
  // 5. Return Completion(stmtResult).
  return Completion(stmtResult);
}

// LabelledItem :
//   Statement
//   FunctionDeclaration
function LabelledEvaluation_LabelledItem(LabelledItem: ParseNode.LabelledItem, labelSet: JSStringSet) {
  switch (LabelledItem.type) {
    case 'DoWhileStatement':
    case 'WhileStatement':
    case 'ForStatement':
    case 'ForInStatement':
    case 'ForOfStatement':
    case 'SwitchStatement':
    case 'LabelledStatement':
      return LabelledEvaluation(LabelledItem, labelSet);
    default:
      return Evaluate(LabelledItem);
  }
}

/** https://tc39.es/ecma262/#sec-statement-semantics-runtime-semantics-labelledevaluation */
//  BreakableStatement :
//    IterationStatement
//    SwitchStatement
//
//  IterationStatement :
//    (DoWhileStatement)
//    (WhileStatement)
function* LabelledEvaluation_BreakableStatement(BreakableStatement: ParseNode.BreakableStatement, labelSet: JSStringSet): StatementEvaluator {
  switch (BreakableStatement.type) {
    case 'DoWhileStatement':
    case 'WhileStatement':
    case 'ForStatement':
    case 'ForInStatement':
    case 'ForOfStatement':
    case 'ForAwaitStatement': {
      // 1. Let stmtResult be LabelledEvaluation of IterationStatement with argument labelSet.
      let stmtResult = EnsureCompletion(yield* LabelledEvaluation_IterationStatement(BreakableStatement, labelSet));
      // 2. If stmtResult.[[Type]] is break, then
      if (stmtResult.Type === 'break') {
        // a. If stmtResult.[[Target]] is empty, then
        if (stmtResult.Target === undefined) {
          // i. If stmtResult.[[Value]] is empty, set stmtResult to NormalCompletion(undefined).
          if (stmtResult.Value === undefined) {
            stmtResult = NormalCompletion(Value.undefined);
          } else { // ii. Else, set stmtResult to NormalCompletion(stmtResult.[[Value]]).
            stmtResult = NormalCompletion(stmtResult.Value);
          }
        }
      }
      // 3. Return Completion(stmtResult).
      return Completion(stmtResult);
    }
    case 'SwitchStatement': {
      // 1. Let stmtResult be LabelledEvaluation of SwitchStatement.
      let stmtResult = EnsureCompletion(yield* Evaluate_SwitchStatement(BreakableStatement));
      // 2. If stmtResult.[[Type]] is break, then
      if (stmtResult.Type === 'break') {
        // a. If stmtResult.[[Target]] is empty, then
        if (stmtResult.Target === undefined) {
          // i. If stmtResult.[[Value]] is empty, set stmtResult to NormalCompletion(undefined).
          if (stmtResult.Value === undefined) {
            stmtResult = NormalCompletion(Value.undefined);
          } else { // ii. Else, set stmtResult to NormalCompletion(stmtResult.[[Value]]).
            stmtResult = NormalCompletion(stmtResult.Value);
          }
        }
      }
      // 3. Return Completion(stmtResult).
      return Completion(stmtResult) as Completion<Value | void>;
    }
    default:
      throw OutOfRange.exhaustive(BreakableStatement);
  }
}

function LabelledEvaluation_IterationStatement(IterationStatement: ParseNode.IterationStatement, labelSet: JSStringSet): StatementEvaluator {
  switch (IterationStatement.type) {
    case 'DoWhileStatement':
      return LabelledEvaluation_IterationStatement_DoWhileStatement(IterationStatement, labelSet);
    case 'WhileStatement':
      return LabelledEvaluation_IterationStatement_WhileStatement(IterationStatement, labelSet);
    case 'ForStatement':
      return LabelledEvaluation_BreakableStatement_ForStatement(IterationStatement, labelSet);
    case 'ForInStatement':
      return LabelledEvaluation_IterationStatement_ForInStatement(IterationStatement, labelSet);
    case 'ForOfStatement':
      return LabelledEvaluation_IterationStatement_ForOfStatement(IterationStatement, labelSet);
    case 'ForAwaitStatement':
      return LabelledEvaluation_IterationStatement_ForAwaitStatement(IterationStatement, labelSet);
    default:
      throw OutOfRange.exhaustive(IterationStatement);
  }
}

/** https://tc39.es/ecma262/#sec-do-while-statement-runtime-semantics-labelledevaluation */
//   IterationStatement :
//     `do` Statement `while` `(` Expression `)` `;`
function* LabelledEvaluation_IterationStatement_DoWhileStatement({ Statement, Expression }: ParseNode.DoWhileStatement, labelSet: JSStringSet) {
  // 1. Let V be undefined.
  let iterationResult: Value = Value.undefined;
  // 2. Repeat,
  while (true) {
    // a. Let stmtResult be the result of evaluating Statement.
    const stmtResult = EnsureCompletion(yield* Evaluate(Statement)) as Completion<Value | void>;
    // b. If LoopContinues(stmtResult, labelSet) is false, return Completion(UpdateEmpty(stmtResult, V)).
    if (LoopContinues(stmtResult, labelSet) === Value.false) {
      return Completion(UpdateEmpty(stmtResult, iterationResult));
    }
    // c. If stmtResult.[[Value]] is not empty, set V to stmtResult.[[Value]].
    if (stmtResult.Value !== undefined) {
      iterationResult = stmtResult.Value;
    }
    // d. Let exprRef be the result of evaluating Expression.
    const exprRef = Q(yield* Evaluate(Expression));
    // e. Let exprValue be ? GetValue(exprRef).
    const exprValue = Q(yield* GetValue(exprRef));
    // f. If ! ToBoolean(exprValue) is false, return NormalCompletion(V).
    if (X(ToBoolean(exprValue)) === Value.false) {
      return NormalCompletion(iterationResult);
    }
  }
}


/** https://tc39.es/ecma262/#sec-while-statement-runtime-semantics-labelledevaluation */
//   IterationStatement :
//     `while` `(` Expression `)` Statement
function* LabelledEvaluation_IterationStatement_WhileStatement({ Expression, Statement }: ParseNode.WhileStatement, labelSet: JSStringSet) {
  // 1. Let V be undefined.
  let iterationResult: Value = Value.undefined;
  // 2. Repeat,
  while (true) {
    // a. Let exprRef be the result of evaluating Expression.
    const exprRef = Q(yield* Evaluate(Expression));
    // b. Let exprValue be ? GetValue(exprRef).
    const exprValue = Q(yield* GetValue(exprRef));
    // c. If ! ToBoolean(exprValue) is false, return NormalCompletion(V).
    if (X(ToBoolean(exprValue)) === Value.false) {
      return NormalCompletion(iterationResult);
    }
    // d. Let stmtResult be the result of evaluating Statement.
    const stmtResult = EnsureCompletion(yield* Evaluate(Statement));
    // e. If LoopContinues(stmtResult, labelSet) is false, return Completion(UpdateEmpty(stmtResult, V)).
    if (LoopContinues(stmtResult, labelSet) === Value.false) {
      return Completion(UpdateEmpty(stmtResult, iterationResult));
    }
    // f. If stmtResult.[[Value]] is not empty, set V to stmtResult.[[Value]].
    if (stmtResult.Value !== undefined) {
      iterationResult = stmtResult.Value;
    }
  }
}

/** https://tc39.es/ecma262/#sec-for-statement-runtime-semantics-labelledevaluation */
//   IterationStatement :
//     `for` `(` Expression? `;` Expression? `;` Expresssion? `)` Statement
//     `for` `(` `var` VariableDeclarationList `;` Expression? `;` Expression? `)` Statement
//     `for` `(` LexicalDeclaration Expression? `;` Expression? `)` Statement
function* LabelledEvaluation_BreakableStatement_ForStatement(ForStatement: ParseNode.ForStatement, labelSet: JSStringSet) {
  const {
    VariableDeclarationList, LexicalDeclaration,
    Expression_a, Expression_b, Expression_c,
    Statement,
  } = ForStatement;
  switch (true) {
    case !!LexicalDeclaration: {
      // 1. Let oldEnv be the running execution context's LexicalEnvironment.
      const oldEnv = surroundingAgent.runningExecutionContext.LexicalEnvironment;
      // 2. Let loopEnv be NewDeclarativeEnvironment(oldEnv).
      const loopEnv = new DeclarativeEnvironmentRecord(oldEnv);
      // 3. Let isConst be IsConstantDeclaration of LexicalDeclaration.
      const isConst = IsConstantDeclaration(LexicalDeclaration);
      // 4. Let boundNames be the BoundNames of LexicalDeclaration.
      const boundNames = BoundNames(LexicalDeclaration);
      // 5. For each element dn of boundNames, do
      for (const dn of boundNames) {
        // a. If isConst is true, then
        if (isConst) {
          // i. Perform ! loopEnv.CreateImmutableBinding(dn, true).
          X(loopEnv.CreateImmutableBinding(dn, Value.true));
        } else { // b. Else,
          // i. Perform ! loopEnv.CreateMutableBinding(dn, false).
          X(loopEnv.CreateMutableBinding(dn, Value.false));
        }
      }
      // 6. Set the running execution context's LexicalEnvironment to loopEnv.
      surroundingAgent.runningExecutionContext.LexicalEnvironment = loopEnv;
      // 7. Let forDcl be the result of evaluating LexicalDeclaration.
      const forDcl = yield* Evaluate(LexicalDeclaration);
      // 8. If forDcl is an abrupt completion, then
      if (forDcl instanceof AbruptCompletion) {
        // a. Set the running execution context's LexicalEnvironment to oldEnv.
        surroundingAgent.runningExecutionContext.LexicalEnvironment = oldEnv;
        // b. Return Completion(forDcl).
        return Completion(forDcl);
      }
      // 9. If isConst is false, let perIterationLets be boundNames; otherwise let perIterationLets be « ».
      let perIterationLets: JSStringValue[];
      if (isConst === false) {
        perIterationLets = boundNames;
      } else {
        perIterationLets = [];
      }
      // 10. Let bodyResult be ForBodyEvaluation(the first Expression, the second Expression, Statement, perIterationLets, labelSet).
      const bodyResult = yield* ForBodyEvaluation(Expression_a, Expression_b, Statement, perIterationLets, labelSet);
      // 11. Set the running execution context's LexicalEnvironment to oldEnv.
      surroundingAgent.runningExecutionContext.LexicalEnvironment = oldEnv;
      // 12. Return Completion(bodyResult).
      return Completion(bodyResult);
    }
    case !!VariableDeclarationList: {
      // 1. Let varDcl be the result of evaluating VariableDeclarationList.
      const varDcl = yield* Evaluate_VariableDeclarationList(VariableDeclarationList);
      Q(varDcl);
      // 3. Return ? ForBodyEvaluation(the first Expression, the second Expression, Statement, « », labelSet).
      return Q(yield* ForBodyEvaluation(Expression_a, Expression_b, Statement, [], labelSet));
    }
    default: {
      // 1. If the first Expression is present, then
      if (Expression_a) {
        // a. Let exprRef be the result of evaluating the first Expression.
        const exprRef = Q(yield* Evaluate(Expression_a));
        // b. Perform ? GetValue(exprRef).
        Q(yield* GetValue(exprRef));
      }
      // 2. Return ? ForBodyEvaluation(the second Expression, the third Expression, Statement, « », labelSet).
      return Q(yield* ForBodyEvaluation(Expression_b, Expression_c, Statement, [], labelSet));
    }
  }
}

function* LabelledEvaluation_IterationStatement_ForInStatement(ForInStatement: ParseNode.ForInStatement, labelSet: JSStringSet): StatementEvaluator {
  const {
    LeftHandSideExpression,
    ForBinding,
    ForDeclaration,
    Expression,
    Statement,
  } = ForInStatement;
  switch (true) {
    case !!LeftHandSideExpression && !!Expression: {
      // IterationStatement : `for` `(` LeftHandSideExpression `in` Expression `)` Statement
      // 1. Let keyResult be ? ForIn/OfHeadEvaluation(« », Expression, enumerate).
      const keyResult = Q(yield* ForInOfHeadEvaluation([], Expression, 'enumerate'));
      // 2. Return ? ForIn/OfBodyEvaluation(LeftHandSideExpression, Statement, keyResult, enumerate, assignment, labelSet).
      return Q(yield* ForInOfBodyEvaluation(LeftHandSideExpression, Statement, keyResult as IteratorRecord, 'enumerate', 'assignment', labelSet));
    }
    case !!ForBinding && !!Expression: {
      // IterationStatement :`for` `(` `var` ForBinding `in` Expression `)` Statement
      // 1. Let keyResult be ? ForIn/OfHeadEvaluation(« », Expression, enumerate).
      const keyResult = Q(yield* ForInOfHeadEvaluation([], Expression, 'enumerate'));
      // 2. Return ? ForIn/OfBodyEvaluation(ForBinding, Statement, keyResult, enumerate, varBinding, labelSet).
      return Q(yield* ForInOfBodyEvaluation(ForBinding, Statement, keyResult as IteratorRecord, 'enumerate', 'varBinding', labelSet));
    }
    case !!ForDeclaration && !!Expression: {
      // IterationStatement : `for` `(` ForDeclaration `in` Expression `)` Statement
      // 1. Let keyResult be ? ForIn/OfHeadEvaluation(BoundNames of ForDeclaration, Expression, enumerate).
      const keyResult = Q(yield* ForInOfHeadEvaluation(BoundNames(ForDeclaration), Expression, 'enumerate'));
      // 2. Return ? ForIn/OfBodyEvaluation(ForDeclaration, Statement, keyResult, enumerate, lexicalBinding, labelSet).
      return Q(yield* ForInOfBodyEvaluation(ForDeclaration, Statement, keyResult as IteratorRecord, 'enumerate', 'lexicalBinding', labelSet));
    }
    default:
      throw OutOfRange.nonExhaustive(ForInStatement);
  }
}

// IterationStatement :
//   `for` `await` `(` LeftHandSideExpression `of` AssignmentExpression `)` Statement
//   `for` `await` `(` `var` ForBinding `of` AssignmentExpression `)` Statement
//   `for` `await` `(` ForDeclaration`of` AssignmentExpression `)` Statement
function* LabelledEvaluation_IterationStatement_ForAwaitStatement(ForAwaitStatement: ParseNode.ForAwaitStatement, labelSet: JSStringSet): StatementEvaluator {
  const {
    LeftHandSideExpression,
    ForBinding,
    ForDeclaration,
    AssignmentExpression,
    Statement,
  } = ForAwaitStatement;
  switch (true) {
    case !!LeftHandSideExpression: {
      // 1. Let keyResult be ? ForIn/OfHeadEvaluation(« », AssignmentExpression, async-iterate).
      const keyResult = Q(yield* ForInOfHeadEvaluation([], AssignmentExpression, 'async-iterate'));
      // 2. Return ? ForIn/OfBodyEvaluation(LeftHandSideExpression, Statement, keyResult, iterate, assignment, labelSet, async).
      return Q(yield* ForInOfBodyEvaluation(LeftHandSideExpression, Statement, keyResult as IteratorRecord, 'iterate', 'assignment', labelSet, 'async'));
    }
    case !!ForBinding: {
      // 1. Let keyResult be ? ForIn/OfHeadEvaluation(« », AssignmentExpression, async-iterate).
      const keyResult = Q(yield* ForInOfHeadEvaluation([], AssignmentExpression, 'async-iterate'));
      // 2. Return ? ForIn/OfBodyEvaluation(ForBinding, Statement, keyResult, iterate, varBinding, labelSet, async).
      return Q(yield* ForInOfBodyEvaluation(ForBinding, Statement, keyResult as IteratorRecord, 'iterate', 'varBinding', labelSet, 'async'));
    }
    case !!ForDeclaration: {
      // 1. Let keyResult be ? ForIn/OfHeadEvaluation(BoundNames of ForDeclaration, AssignmentExpression, async-iterate).
      const keyResult = Q(yield* ForInOfHeadEvaluation(BoundNames(ForDeclaration), AssignmentExpression, 'async-iterate'));
      // 2. Return ? ForIn/OfBodyEvaluation(ForDeclaration, Statement, keyResult, iterate, lexicalBinding, labelSet, async).
      return Q(yield* ForInOfBodyEvaluation(ForDeclaration, Statement, keyResult as IteratorRecord, 'iterate', 'lexicalBinding', labelSet, 'async'));
    }
    default:
      throw OutOfRange.nonExhaustive(ForAwaitStatement);
  }
}

/** https://tc39.es/ecma262/#sec-for-in-and-for-of-statements-runtime-semantics-labelledevaluation */
// IterationStatement :
//   `for` `(` LeftHandSideExpression `of` AssignmentExpression `)` Statement
//   `for` `(` `var` ForBinding `of` AssignmentExpression `)` Statement
//   `for` `(` ForDeclaration `of` AssignmentExpression `)` Statement
function* LabelledEvaluation_IterationStatement_ForOfStatement(ForOfStatement: ParseNode.ForOfStatement, labelSet: JSStringSet): StatementEvaluator {
  const {
    LeftHandSideExpression,
    ForBinding,
    ForDeclaration,
    AssignmentExpression,
    Statement,
  } = ForOfStatement;
  switch (true) {
    case !!LeftHandSideExpression: {
      // 1. Let keyResult be ? ForIn/OfHeadEvaluation(« », AssignmentExpression, iterate).
      const keyResult = Q(yield* ForInOfHeadEvaluation([], AssignmentExpression, 'iterate'));
      // 2. Return ? ForIn/OfBodyEvaluation(LeftHandSideExpression, Statement, keyResult, iterate, assignment, labelSet).
      return Q(yield* ForInOfBodyEvaluation(LeftHandSideExpression, Statement, keyResult as IteratorRecord, 'iterate', 'assignment', labelSet));
    }
    case !!ForBinding: {
      // 1. Let keyResult be ? ForIn/OfHeadEvaluation(« », AssignmentExpression, iterate).
      const keyResult = Q(yield* ForInOfHeadEvaluation([], AssignmentExpression, 'iterate'));
      // 2. Return ? ForIn/OfBodyEvaluation(ForBinding, Statement, keyResult, iterate, varBinding, labelSet).
      return Q(yield* ForInOfBodyEvaluation(ForBinding, Statement, keyResult as IteratorRecord, 'iterate', 'varBinding', labelSet));
    }
    case !!ForDeclaration: {
      // proposal-runtime-types (references extension): a `for (const ref p of a)`
      // loop binds each element by reference rather than a copy, so the body
      // writes into the array in place. It is index-based and does not go through
      // Symbol.iterator; the length is pinned for the loop's duration.
      if (ForDeclaration.ForBinding.Ref === true) {
        return Q(yield* RefForOfEvaluation(ForDeclaration, AssignmentExpression, Statement, labelSet));
      }
      // 1. Let keyResult be ? ForIn/OfHeadEvaluation(BoundNames of ForDeclaration, AssignmentExpression, iterate).
      const keyResult = Q(yield* ForInOfHeadEvaluation(BoundNames(ForDeclaration), AssignmentExpression, 'iterate'));
      // 2. Return ? ForIn/OfBodyEvaluation(ForDeclaration, Statement, keyResult, iterate, lexicalBinding, labelSet).
      return Q(yield* ForInOfBodyEvaluation(ForDeclaration, Statement, keyResult as IteratorRecord, 'iterate', 'lexicalBinding', labelSet));
    }
    default:
      throw OutOfRange.nonExhaustive(ForOfStatement);
  }
}

/** https://tc39.es/ecma262/#sec-forbodyevaluation */
function* ForBodyEvaluation(test: ParseNode.Expression | undefined, increment: ParseNode.Expression | undefined, stmt: ParseNode.Statement, perIterationBindings: readonly JSStringValue[], labelSet: JSStringSet) {
  // 1. Let V be undefined.
  let iterationResult: Value = Value.undefined;
  // 2. Perform ? CreatePerIterationEnvironment(perIterationBindings).
  Q(yield* CreatePerIterationEnvironment(perIterationBindings));
  // 3. Repeat,
  while (true) {
    // a. If test is not [empty], then
    if (test) {
      // i. Let testRef be the result of evaluating test.
      const testRef = Q(yield* Evaluate(test));
      // ii. Let testValue be ? GetValue(testRef).
      const testValue = Q(yield* GetValue(testRef));
      // iii. If ! ToBoolean(testValue) is false, return NormalCompletion(V).
      if (X(ToBoolean(testValue)) === Value.false) {
        return NormalCompletion(iterationResult);
      }
    }
    // b. Let result be the result of evaluating stmt.
    const result = EnsureCompletion(yield* Evaluate(stmt));
    // c. If LoopContinues(result, labelSet) is false, return Completion(UpdateEmpty(result, V)).
    if (LoopContinues(result, labelSet) === Value.false) {
      return Completion(UpdateEmpty(result, iterationResult));
    }
    // d. If result.[[Value]] is not empty, set V to result.[[Value]].
    if (result.Value !== undefined) {
      iterationResult = result.Value;
    }
    // e. Perform ? CreatePerIterationEnvironment(perIterationBindings).
    Q(yield* CreatePerIterationEnvironment(perIterationBindings));
    // f. If increment is not [empty], then
    if (increment) {
      // i. Let incRef be the result of evaluating increment.
      const incRef = Q(yield* Evaluate(increment));
      // ii. Perform ? GetValue(incRef).
      Q(yield* GetValue(incRef));
    }
  }
}

/** https://tc39.es/ecma262/#sec-createperiterationenvironment */
function* CreatePerIterationEnvironment(perIterationBindings: readonly JSStringValue[]): PlainEvaluator {
  // 1. If perIterationBindings has any elements, then
  if (perIterationBindings.length > 0) {
    // a. Let lastIterationEnv be the running execution context's LexicalEnvironment.
    const lastIterationEnv = surroundingAgent.runningExecutionContext.LexicalEnvironment;
    // b. Let outer be lastIterationEnv.[[OuterEnv]].
    const outer = lastIterationEnv.OuterEnv;
    // c. Assert: outer is not null.
    Assert(outer !== null);
    // d. Let thisIterationEnv be NewDeclarativeEnvironment(outer).
    const thisIterationEnv = new DeclarativeEnvironmentRecord(outer);
    // e. For each element bn of perIterationBindings, do
    for (const bn of perIterationBindings) {
      // i. Perform ! thisIterationEnv.CreateMutableBinding(bn, false).
      X(thisIterationEnv.CreateMutableBinding(bn, Value.false));
      // ii. Let lastValue be ? lastIterationEnv.GetBindingValue(bn, true).
      const lastValue = Q(yield* lastIterationEnv.GetBindingValue(bn, Value.true));
      // iii. Perform thisIterationEnv.InitializeBinding(bn, lastValue).
      yield* thisIterationEnv.InitializeBinding(bn, lastValue);
    }
    // f. Set the running execution context's LexicalEnvironment to thisIterationEnv.
    surroundingAgent.runningExecutionContext.LexicalEnvironment = thisIterationEnv;
  }
  // 2. Return undefined.
  return undefined;
}

/** https://tc39.es/ecma262/#sec-runtime-semantics-forinofheadevaluation */
function* ForInOfHeadEvaluation(uninitializedBoundNames: readonly JSStringValue[], expr: ParseNode.Expression | ParseNode.AssignmentExpression, iterationKind: 'enumerate' | 'iterate' | 'async-iterate'): Evaluator<PlainCompletion<Value | ForInOfHeadEvaluationResult | IteratorRecord> | BreakCompletion> {
  // 1. Let oldEnv be the running execution context's LexicalEnvironment.
  const oldEnv = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  // 2. If uninitializedBoundNames is not an empty List, then
  if (uninitializedBoundNames.length > 0) {
    // a. Assert: uninitializedBoundNames has no duplicate entries.
    // b. Let newEnv be NewDeclarativeEnvironment(oldEnv).
    const newEnv = new DeclarativeEnvironmentRecord(oldEnv);
    // c. For each string name in uninitializedBoundNames, do
    for (const name of uninitializedBoundNames) {
      // i. Perform ! newEnv.CreateMutableBinding(name, false).
      X(newEnv.CreateMutableBinding(name, Value.false));
    }
    // d. Set the running execution context's LexicalEnvironment to newEnv.
    surroundingAgent.runningExecutionContext.LexicalEnvironment = newEnv;
  }
  // 3. Let exprRef be the result of evaluating expr.
  const exprRef = Q(yield* Evaluate(expr));
  // 4. Set the running execution context's LexicalEnvironment to oldEnv.
  surroundingAgent.runningExecutionContext.LexicalEnvironment = oldEnv;
  // 5. Let exprValue be ? GetValue(exprRef).
  const exprValue = Q(yield* GetValue(exprRef));
  // 6. If iterationKind is enumerate, then
  if (iterationKind === 'enumerate') {
    // a. If exprValue is undefined or null, then
    if (exprValue === Value.undefined || exprValue === Value.null) {
      // i. Return Completion { [[Type]]: break, [[Value]]: empty, [[Target]]: empty }.
      return new Completion({ Type: 'break', Value: undefined, Target: undefined });
    }
    // b. Let obj be ! ToObject(exprValue).
    const obj = X(ToObject(exprValue));
    // c. Let iterator be ? EnumerateObjectProperties(obj).
    const iterator = Q(EnumerateObjectProperties(obj));
    // d. Let nextMethod be ! GetV(iterator, "next").
    const nextMethod = X(GetV(iterator, Value('next')));
    // e. Return the Record { [[Iterator]]: iterator, [[NextMethod]]: nextMethod, [[Done]]: false }.
    return { Iterator: iterator, NextMethod: nextMethod, Done: Value.false };
  } else { // 7. Else,
    // a. Assert: iterationKind is iterate or async-iterate.
    Assert(iterationKind === 'iterate' || iterationKind === 'async-iterate');
    // b. If iterationKind is async-iterate, let iteratorHint be async.
    // c. Else, let iteratorHint be sync.
    const iteratorHint = iterationKind === 'async-iterate' ? 'async' : 'sync';
    // d. Return ? GetIterator(exprValue, iteratorHint).
    return Q(yield* GetIterator(exprValue, iteratorHint));
  }
}
interface ForInOfHeadEvaluationResult {
  readonly Iterator: ForInIteratorInstance;
  readonly NextMethod: Value;
  readonly Done: Value;
}

/** https://tc39.es/ecma262/#sec-enumerate-object-properties */
function EnumerateObjectProperties(O: ObjectValue) {
  return CreateForInIterator(O);
}

/** https://tc39.es/ecma262/#sec-runtime-semantics-forin-div-ofbodyevaluation-lhs-stmt-iterator-lhskind-labelset */
function* ForInOfBodyEvaluation(lhs: ParseNode, stmt: ParseNode.Statement, iteratorRecord: IteratorRecord, iterationKind: 'enumerate' | 'iterate', lhsKind: 'assignment' | 'lexicalBinding' | 'varBinding', labelSet: JSStringSet, iteratorKind?: 'sync' | 'async'): StatementEvaluator {
  if (iteratorKind === undefined) iteratorKind = 'sync';
  const oldEnv = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  let iterationResult: Value = Value.undefined;
  const destructuring = IsDestructuring(lhs);
  let assignmentPattern;
  if (destructuring && lhsKind === 'assignment') {
    // a. Assert: lhs is a LeftHandSideExpression.
    assignmentPattern = refineLeftHandSideExpression(lhs as DestructuringParseNode);
  }
  while (true) {
    let nextResult = Q(yield* Call(iteratorRecord.NextMethod, iteratorRecord.Iterator));
    if (iteratorKind === 'async') nextResult = Q(yield* Await(nextResult));
    if (!(nextResult instanceof ObjectValue)) {
      return Throw.TypeError('The return value ($1) of the next() on an iterator ($2) must be an object', nextResult, iteratorRecord.Iterator);
    }
    const done = Q(yield* IteratorComplete(nextResult));
    if (done === Value.true) return iterationResult;
    const nextValue = Q(yield* IteratorValue(nextResult));
    let lhsRef;
    let iterationEnv;
    let status: NormalCompletion<Value | void> | AbruptCompletion;
    if (lhsKind === 'assignment' || lhsKind === 'varBinding') {
      if (destructuring) {
        if (lhsKind === 'assignment') {
          status = EnsureCompletion(yield* DestructuringAssignmentEvaluation(assignmentPattern as ParseNode.ObjectAssignmentPattern | ParseNode.ArrayAssignmentPattern, nextValue));
        } else {
          Assert(lhsKind === 'varBinding');
          Assert(lhs.type === 'ForBinding');
          status = EnsureCompletion(yield* BindingInitialization(lhs, nextValue, Value.undefined));
        }
      } else {
        lhsRef = yield* Evaluate(lhs);
        // 2. If lhsKind is assignment and the AssignmentTargetType of lhs is web-compat, throw a ReferenceError exception.
        if (lhsRef instanceof AbruptCompletion) {
          status = lhsRef;
        } else {
          lhsRef = LocationOfAssignmentTarget(ValueOfNormalCompletion(lhsRef) as Value);
          if (lhsRef === undefined) lhsRef = Value.undefined;
          status = EnsureCompletion(yield* PutValue(lhsRef, nextValue));
        }
      }
    } else {
      Assert(lhsKind === 'lexicalBinding');
      Assert(lhs.type === 'ForDeclaration');
      iterationEnv = new DeclarativeEnvironmentRecord(oldEnv);
      ForDeclarationBindingInstantiation(lhs, iterationEnv);
      surroundingAgent.runningExecutionContext.LexicalEnvironment = iterationEnv;
      if (destructuring) {
        status = EnsureCompletion(yield* BindingInitialization(lhs, nextValue, iterationEnv));
      } else {
        // 1. Assert: lhs binds a single name.
        const boundNames = BoundNames(lhs);
        Assert(boundNames.length === 1);

        const lhsName = boundNames[0];
        lhsRef = X(ResolveBinding(lhsName));
        status = EnsureCompletion(yield* InitializeReferencedBinding(lhsRef, nextValue));
      }
    }
    Assert(typeof status! !== 'undefined');
    if (status instanceof AbruptCompletion) {
      surroundingAgent.runningExecutionContext.LexicalEnvironment = oldEnv;
      if (iterationKind === 'enumerate') return status;
      Assert(iterationKind === 'iterate');
      if (iteratorKind === 'async') {
        return Q(yield* AsyncIteratorClose(iteratorRecord, status));
      }
      return Q(yield* IteratorClose(iteratorRecord, status));
    }
    const result = EnsureCompletion(yield* Evaluate(stmt));
    surroundingAgent.runningExecutionContext.LexicalEnvironment = oldEnv;
    if (LoopContinues(result, labelSet) === Value.false) {
      status = UpdateEmpty(result, iterationResult);
      if (iterationKind === 'enumerate') return status;
      Assert(iterationKind === 'iterate');
      if (iteratorKind === 'async') {
        return Q(yield* AsyncIteratorClose(iteratorRecord, status));
      }
      return Q(yield* IteratorClose(iteratorRecord, status));
    }
    if (result.Value !== undefined) {
      iterationResult = result.Value;
    }
  }
}

/**
 * proposal-runtime-types (references extension): the index-based evaluation of a
 * `for (LetOrConst ref p of a)` loop. Each iteration binds _p_ as a reference to
 * the array element at the current index, so a write through _p_ writes into the
 * array. The loop reads the length once and pins it: any resize of the array
 * while an element reference is live is a TypeError, which a ref loop makes easy
 * to hit since it holds a reference across the whole iteration. A `let ref` may
 * be written through and rebound; a `const ref` may not. The loop does not go
 * through Symbol.iterator and allocates no result object.
 */
function* RefForOfEvaluation(ForDeclaration: ParseNode.ForDeclaration, expr: ParseNode.AssignmentExpressionOrHigher, stmt: ParseNode.Statement, labelSet: JSStringSet): StatementEvaluator {
  const { LetOrConst, ForBinding } = ForDeclaration;
  const oldEnv = surroundingAgent.runningExecutionContext.LexicalEnvironment;
  const exprRef = Q(yield* Evaluate(expr));
  const value = Q(yield* GetValue(exprRef));
  // The referent of a ref loop is an array; a ref denotes an array slot. Other
  // iterables have no index-addressable storage a borrow could alias.
  // proposal-runtime-types soa.md: "for (const ref p of particles) { ... }" -
  // "Reference iteration, as on any typed array". An SoA's elements are index
  // addressable exactly as an array's are; what differs is that the borrow is a
  // column set and an index rather than an array slot, so the loop takes its
  // own path rather than making a ReferenceRecord that would gather a copy.
  if (value instanceof ObjectValue && SoAStorageOf(value as unknown as object) !== undefined) {
    return yield* SoARefForOfEvaluation(value, LetOrConst, ForBinding, stmt, labelSet, oldEnv);
  }
  if (!(value instanceof ObjectValue) || X(IsArray(value)) !== Value.true) {
    return Throw.TypeError('a ref for-of loop requires an array or an SoA whose elements can be referenced');
  }
  const array = value;
  // Pin the length once; a change to it while a reference is live is a TypeError.
  const pinned = Q(yield* LengthOfArrayLike(array));
  const [name] = BoundNames(ForBinding);
  const mutable = !IsConstantDeclaration(LetOrConst);
  let iterationResult: Value = Value.undefined;
  for (let i = 0; i < pinned; i += 1) {
    // Liveness: the array must not have been resized while a prior iteration's
    // element reference was live.
    const current = Q(yield* LengthOfArrayLike(array));
    if (current !== pinned) {
      surroundingAgent.runningExecutionContext.LexicalEnvironment = oldEnv;
      return Throw.TypeError('an array may not be resized while a reference into it is live');
    }
    const iterationEnv = new DeclarativeEnvironmentRecord(oldEnv);
    const location = new ReferenceRecord({
      Base: array,
      ReferencedName: Value(`${i}`),
      Strict: Value.true,
      ThisValue: undefined,
    });
    CreateRefBinding(iterationEnv, Value(name.stringValue()), location, mutable);
    surroundingAgent.runningExecutionContext.LexicalEnvironment = iterationEnv;
    const result = EnsureCompletion(yield* Evaluate(stmt));
    surroundingAgent.runningExecutionContext.LexicalEnvironment = oldEnv;
    // A resize during this iteration's body, while the element reference was
    // live, is equally a TypeError.
    const after = Q(yield* LengthOfArrayLike(array));
    if (after !== pinned) {
      return Throw.TypeError('an array may not be resized while a reference into it is live');
    }
    if (LoopContinues(result, labelSet) === Value.false) {
      return UpdateEmpty(result, iterationResult);
    }
    if (result.Value !== undefined) {
      iterationResult = result.Value;
    }
  }
  return NormalCompletion(iterationResult);
}


/**
 * proposal-runtime-types soa.md: reference iteration over an SoA.
 *
 * Each iteration binds the element VIEW - the column set and the index - rather
 * than a location, because a location over an SoA index would gather a copy and
 * every write through the binding would be lost. That is the same distinction
 * the `ref` binding form draws, and the same reason it exists.
 *
 * The length is pinned as it is for an array, and for a sharper reason: growth
 * reallocates every column, so a reference taken in an earlier iteration is
 * invalidated by a `push` in a later one.
 */
function* SoARefForOfEvaluation(soa: ObjectValue, LetOrConst: ParseNode.LetOrConst, ForBinding: ParseNode.ForBinding, stmt: ParseNode.Statement, labelSet: JSStringSet, oldEnv: EnvironmentRecord): StatementEvaluator {
  const storage = SoAStorageOf(soa as unknown as object)!;
  const pinned = storage.Length;
  const [name] = BoundNames(ForBinding);
  const mutable = !IsConstantDeclaration(LetOrConst);
  let iterationResult: Value = Value.undefined;
  for (let i = 0; i < pinned; i += 1) {
    if (storage.Length !== pinned) {
      surroundingAgent.runningExecutionContext.LexicalEnvironment = oldEnv;
      return Throw.TypeError('an SoA may not be resized while a reference into it is live');
    }
    const view = Q(yield* SoAElementReference(storage, i));
    const iterationEnv = new DeclarativeEnvironmentRecord(oldEnv);
    // A `let ref` may be rebound and a `const ref` may not; either way the view
    // it holds writes through, since the write goes to the columns rather than
    // to the binding.
    if (mutable) {
      X(iterationEnv.CreateMutableBinding(Value(name.stringValue()), Value.false));
    } else {
      X(iterationEnv.CreateImmutableBinding(Value(name.stringValue()), Value.false));
    }
    X(iterationEnv.InitializeBinding(Value(name.stringValue()), view));
    surroundingAgent.runningExecutionContext.LexicalEnvironment = iterationEnv;
    const result = EnsureCompletion(yield* Evaluate(stmt));
    surroundingAgent.runningExecutionContext.LexicalEnvironment = oldEnv;
    if (storage.Length !== pinned) {
      return Throw.TypeError('an SoA may not be resized while a reference into it is live');
    }
    if (LoopContinues(result, labelSet) === Value.false) {
      return UpdateEmpty(result, iterationResult);
    }
    if (result.Value !== undefined) {
      iterationResult = result.Value;
    }
  }
  return NormalCompletion(iterationResult);
}

/** https://tc39.es/ecma262/#sec-runtime-semantics-bindinginstantiation */
//   ForDeclaration : LetOrConst ForBinding
function ForDeclarationBindingInstantiation({ LetOrConst, ForBinding }: ParseNode.ForDeclaration, environment: DeclarativeEnvironmentRecord) {
  // 1. Assert: environment is a declarative Environment Record.
  Assert(environment instanceof DeclarativeEnvironmentRecord);
  // 2. For each element name of the BoundNames of ForBinding, do
  for (const name of BoundNames(ForBinding)) {
    // a. If IsConstantDeclaration of LetOrConst is true, then
    if (IsConstantDeclaration(LetOrConst)) {
      // i. Perform ! environment.CreateImmutableBinding(name, true).
      X(environment.CreateImmutableBinding(name, Value.true));
    } else { // b. Else,
      // i. Perform ! environment.CreateMutableBinding(name, false).
      X(environment.CreateMutableBinding(name, Value.false));
    }
  }
}

/** https://tc39.es/ecma262/#sec-for-in-and-for-of-statements-runtime-semantics-evaluation */
//   ForBinding : BindingIdentifier
export function Evaluate_ForBinding({ BindingIdentifier, strict }: ParseNode.ForBinding) {
  // 1. Let bindingId be StringValue of BindingIdentifier.
  const bindingId = StringValue(BindingIdentifier!);
  // 2. Return ? ResolveBinding(bindingId).
  return ResolveBinding(bindingId, undefined, strict);
}
