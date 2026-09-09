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
function* ArrayAccumulation(ElementList: ParseNode.ElementList, array: ObjectValue, nextIndex: number, elementContext: TypeRecord | null = null): PlainEvaluator<number> {
  let postIndex = nextIndex;
  for (const element of ElementList) {
    switch (element.type) {
      case 'Elision':
        postIndex += 1;
        Q(yield* Set(array, Value('length'), F(postIndex), Value.true));
        break;
      case 'SpreadElement':
        postIndex = Q(yield* ArrayAccumulation_SpreadElement(element, array, postIndex));
        break;
      default:
        // proposal-runtime-types #sec-contextual-types: "an element of an array
        // literal at a position of known array type" takes the element type.
        // Pushed FOR the element, so `[new Box(1)]` at `[].<Box.<uint8>>`
        // constructs `Box.<uint8>` and nothing nested under it inherits it.
        if (surroundingAgent.feature('runtime-types')) {
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

/** The element type an array literal's own position declares, or null. */
function elementContextOf(literal: object): TypeRecord | null {
  const t = contextualTypeFor(literal);
  if (!t) {
    return null;
  }
  if (t.Kind === 'array') {
    return (t as { Element?: TypeRecord }).Element ?? null;
  }
  return null;
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
    const next = Q(yield* IteratorStepValue(iteratorRecord));
    // b. If next is done, return nextIndex.
    if (next === 'done') {
      return nextIndex;
    }
    // d. Perform ! CreateDataPropertyOrThrow(array, ! ToString(𝔽(nextIndex)), next).
    X(CreateDataPropertyOrThrow(array, X(ToString(F(nextIndex))), next));
    // e. Set nextIndex to nextIndex + 1.
    nextIndex += 1;
  }
}


function* ArrayAccumulation_AssignmentExpression(AssignmentExpression: ParseNode.AssignmentExpressionOrHigher, array: ObjectValue, nextIndex: number): PlainEvaluator<number> {
  // 2. Let initResult be the result of evaluating AssignmentExpression.
  const initResult = Q(yield* Evaluate(AssignmentExpression));
  // 3. Let initValue be ? GetValue(initResult).
  const initValue = Q(yield* GetValue(initResult));
  // 4. Let created be ! CreateDataPropertyOrThrow(array, ! ToString(𝔽(nextIndex)), initValue).
  X(CreateDataPropertyOrThrow(array, X(ToString(F(nextIndex))), initValue));
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
  const len = yield* ArrayAccumulation(ElementList, array, 0, surroundingAgent.feature('runtime-types') ? elementContextOf(node) : null);
  Q(len);
  // 4. Return array.
  return array;
}
