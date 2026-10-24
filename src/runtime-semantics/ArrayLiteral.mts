import { BeginConstructionSelections, EndConstructionSelections, CompleteConstructionSelections, NormalCompletion } from '#self';
import { ObjectValue, Value } from '../value.mts';
import {
  Evaluate, type PlainEvaluator,
  type ValueEvaluator,
} from '../evaluator.mts';
import {
  Q, X,
} from '../completion.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import { contextualTypeFor, pushContextualType, popContextualType } from '../type-system/runtime.mts';
import type { TypeRecord } from '../type-system/records.mts';
import { TupleStorageShapeOf, TupleStorageTypeAt, TupleConstructionTypeAt } from '../type-system/tuple-storage.mts';
import { EnsureCompletion, EvaluateResultValue, RetainPropertyResult } from '#self';
import {
  Set,
  ArrayCreate,
  GetValue,
  GetIterator,
  ToString,
  CreateDataPropertyOrThrow,
  F,
  IteratorStepValue,
  surroundingAgent,
} from '#self';

/** https://tc39.es/ecma262/#sec-runtime-semantics-arrayaccumulation */
//  Elision :
//    `,`
//    Elision `,`
//  ElementList :
//    Elision? AssignmentExpression
//    Elision? SpreadElement
//    ElementList `,` Elision? AssignmentExpression
//    ElementList : ElementList `,` Elision SpreadElement
//  SpreadElement :
//    `...` AssignmentExpression
function* ArrayAccumulation(ElementList: ParseNode.ElementList, array: ObjectValue, nextIndex: number, context: TypeRecord | null = null): PlainEvaluator<number> {
  const tuple = context?.Kind === 'tuple' ? TupleStorageShapeOf(context) : undefined;
  const lastSpread = tuple ? ElementList.findLastIndex((element) => element.type === 'SpreadElement') : -1;
  let remainingFixed = tuple ? ElementList.reduce((count, element) => count + (element.type === 'SpreadElement' ? 0 : 1), 0) : 0;
  let postIndex = nextIndex;
  for (let sourceIndex = 0; sourceIndex < ElementList.length; sourceIndex += 1) {
    const element = ElementList[sourceIndex];
    if (tuple && element.type !== 'SpreadElement') remainingFixed -= 1;
    switch (element.type) {
      case 'Elision':
        postIndex += 1;
        Q(yield* Set(array, Value('length'), F(postIndex), Value.true));
        break;
      case 'SpreadElement':
        postIndex = Q(yield* ArrayAccumulation_SpreadElement(element, array, postIndex));
        break;
      default:
        // A direct element consumes its own destination. After the last
        // spread, the actual prefix count plus the unevaluated fixed tail
        // determines the final supplied length without running later code.
        // Before that, use only a type shared by every remaining alignment.
        // Fixed following entries give a lower bound without running them.
        if (surroundingAgent.feature('runtime-types')) {
          let elementContext = context?.Kind === 'array' ? context.Element : null;
          if (tuple) {
            if (sourceIndex > lastSpread) {
              elementContext = TupleStorageTypeAt(tuple, postIndex, postIndex + ElementList.length - sourceIndex) ?? null;
            } else {
              elementContext = TupleConstructionTypeAt(tuple, postIndex, postIndex + 1 + remainingFixed) ?? null;
            }
          }
          pushContextualType(elementContext, element as object);
          try {
            postIndex = Q(yield* ArrayAccumulation_AssignmentExpression(element, array, postIndex));
          } finally {
            popContextualType();
          }
        } else {
          postIndex = Q(yield* ArrayAccumulation_AssignmentExpression(element, array, postIndex));
        }
        break;
    }
  }
  return postIndex;
}

// SpreadElement : `...` AssignmentExpression
function* ArrayAccumulation_SpreadElement({ AssignmentExpression }: ParseNode.SpreadElement, array: ObjectValue, nextIndex: number): PlainEvaluator<number> {
  // 1. Let spreadRef be the result of evaluating AssignmentExpression.
  const spreadRef = Q(yield* Evaluate(AssignmentExpression));
  // 2. Let spreadObj be ? GetValue(spreadRef).
  const spreadObj = Q(yield* GetValue(spreadRef));
  // 3. Let iteratorRecord be ? GetIterator(spreadObj).
  const iteratorRecord = Q(yield* GetIterator(spreadObj, 'sync'));
  // 4. Repeat,
  while (true) {
    // a. Let next be ? IteratorStep(iteratorRecord).
    const nextResult = EnsureCompletion(yield* IteratorStepValue(iteratorRecord));
    if (nextResult.Type !== 'normal') return nextResult;
    const next = nextResult.Value;
    // b. If next is done, return nextIndex.
    if (next === 'done') {
      return nextIndex;
    }
    // d. Perform ! CreateDataPropertyOrThrow(array, ! ToString(𝔽(nextIndex)), next).
    const key = X(ToString(F(nextIndex)));
    X(CreateDataPropertyOrThrow(array, key, next));
    RetainPropertyResult(array, key, nextResult);
    // e. Set nextIndex to nextIndex + 1.
    nextIndex += 1;
  }
}


function* ArrayAccumulation_AssignmentExpression(AssignmentExpression: ParseNode.AssignmentExpressionOrHigher, array: ObjectValue, nextIndex: number): PlainEvaluator<number> {
  // 2. Let initResult be the result of evaluating AssignmentExpression.
  const initResult = EnsureCompletion(yield* EvaluateResultValue(AssignmentExpression));
  if (initResult.Type !== 'normal') return initResult;
  // 4. Let created be ! CreateDataPropertyOrThrow(array, ! ToString(𝔽(nextIndex)), initValue).
  const key = X(ToString(F(nextIndex)));
  X(CreateDataPropertyOrThrow(array, key, initResult.Value));
  RetainPropertyResult(array, key, initResult);
  // 5. Return nextIndex + 1.
  return nextIndex + 1;
}

/** https://tc39.es/ecma262/#sec-array-initializer-runtime-semantics-evaluation */
//  ArrayLiteral :
//    `[` Elision `]`
//    `[` ElementList `]`
//    `[` ElementList `,` Elision `]`
export function* Evaluate_ArrayLiteral(node: ParseNode.ArrayLiteral): ValueEvaluator {
  const { ElementList } = node;
  // 1. Let array be ! ArrayCreate(0).
  const array = X(ArrayCreate(0));
  // 2. Let len be the result of performing ArrayAccumulation for ElementList with arguments array and 0.
  BeginConstructionSelections(array);
  try {
    Q(yield* ArrayAccumulation(ElementList, array, 0, surroundingAgent.feature('runtime-types') ? contextualTypeFor(node) ?? null : null));
    return CompleteConstructionSelections(array, NormalCompletion(array));
  } finally {
    EndConstructionSelections(array);
  }
}
