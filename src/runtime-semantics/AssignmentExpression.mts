import { copiesOnBinding } from './LexicalDeclaration.mts';
import { JSStringValue, ObjectValue, ReferenceRecord, Value } from '../value.mts';
import { Q, X } from '../completion.mts';
import {
  IsAnonymousFunctionDefinition,
  IsIdentifierRef,
  type DestructuringParseNode,
  type FunctionDeclaration,
} from '../static-semantics/all.mts';
import { Evaluate, type ValueEvaluator } from '../evaluator.mts';
import { OutOfRange } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';
import {
  NamedEvaluation,
  ApplyStringOrNumericBinaryOperator,
  DestructuringAssignmentEvaluation,
} from './all.mts';
import {
  Call,
  GetValue,
  LookupClassOperator,
  PutValue,
  CopyValueClassInstance,
  LocationOfAssignmentTarget,
  ToBoolean,
  surroundingAgent,
} from '#self';


/** https://tc39.es/ecma262/#sec-destructuring-assignment */
export function refineLeftHandSideExpression(node: ParseNode.ArrayLiteral | ParseNode.ObjectLiteral | ParseNode.PropertyDefinition | ParseNode.MemberExpression | ParseNode.CoverInitializedName | ParseNode.AssignmentExpression | ParseNode.Elision | ParseNode.IdentifierReference | ParseNode.ElementListElement | DestructuringParseNode | ParseNode.Expression, type?: 'array' | 'object'): ParseNode.AssignmentPattern {
  switch (node.type) {
    case 'ArrayLiteral': {
      const refinement: ParseNode.ArrayAssignmentPattern = {
        type: 'ArrayAssignmentPattern',
        AssignmentElementList: [],
        AssignmentRestElement: undefined,
      };
      node.ElementList.forEach((n) => {
        switch (n.type) {
          case 'SpreadElement':
            refinement.AssignmentRestElement = {
              ...n,
              type: 'AssignmentRestElement',
              AssignmentExpression: n.AssignmentExpression,
            };
            break;
          case 'ArrayLiteral':
          case 'ObjectLiteral':
            refinement.AssignmentElementList.push({
              type: 'AssignmentElement',
              DestructuringAssignmentTarget: n,
              Initializer: null,
            });
            break;
          default:
            refinement.AssignmentElementList.push(refineLeftHandSideExpression(n, 'array'));
            break;
        }
      });
      return refinement;
    }
    case 'ObjectLiteral': {
      const refined: ParseNode.ObjectAssignmentPattern = {
        type: 'ObjectAssignmentPattern',
        AssignmentPropertyList: [],
        AssignmentRestProperty: undefined,
      };
      node.PropertyDefinitionList.forEach((p) => {
        if ((p as ParseNode.PropertyDefinition).PropertyName === null && (p as ParseNode.PropertyDefinition).AssignmentExpression) {
          refined.AssignmentRestProperty = {
            type: 'AssignmentRestProperty',
            DestructuringAssignmentTarget: (p as ParseNode.PropertyDefinition).AssignmentExpression,
          };
        } else {
          refined.AssignmentPropertyList.push(refineLeftHandSideExpression(p as ParseNode.PropertyDefinition, 'object'));
        }
      });
      return refined;
    }
    case 'PropertyDefinition':
      // proposal-runtime-types: a `ref` member carries its target through to the
      // pattern, where the evaluation borrows the property's LOCATION rather
      // than reading its value.
      if ((node as unknown as { RefTarget?: unknown }).RefTarget) {
        return {
          type: 'AssignmentProperty',
          PropertyName: node.PropertyName,
          RefTarget: (node as unknown as { RefTarget?: unknown }).RefTarget,
          AssignmentElement: {
            type: 'AssignmentElement',
            DestructuringAssignmentTarget: (node as unknown as { RefTarget: ParseNode.AssignmentExpressionOrHigher }).RefTarget,
            Initializer: undefined,
          },
        } as never;
      }
      return {
        type: 'AssignmentProperty',
        PropertyName: node.PropertyName,
        AssignmentElement: node.AssignmentExpression.type === 'AssignmentExpression'
          ? {
            type: 'AssignmentElement',
            DestructuringAssignmentTarget: node.AssignmentExpression.LeftHandSideExpression,
            Initializer: node.AssignmentExpression.AssignmentExpression,
          }
          : {
            type: 'AssignmentElement',
            DestructuringAssignmentTarget: node.AssignmentExpression,
            Initializer: undefined,
          },
      };
    case 'IdentifierReference':
      if (type === 'array') {
        return {
          type: 'AssignmentElement',
          DestructuringAssignmentTarget: node,
          Initializer: undefined,
        };
      } else {
        return {
          type: 'AssignmentProperty',
          IdentifierReference: node,
          Initializer: undefined,
        };
      }
    case 'MemberExpression':
    case 'SuperProperty':
    // proposal-runtime-types #sec-location-consuming-contexts: a call that
    // returns a borrow is a valid target, so an array pattern refines one the
    // way it refines a member access - as an element whose target is the call.
    // Without this the pattern kept a raw CallExpression in its element list
    // and the evaluation had no case for it.
    case 'CallExpression':
      return {
        type: 'AssignmentElement',
        DestructuringAssignmentTarget: node,
        Initializer: undefined,
      };
    case 'CoverInitializedName':
      return {
        type: 'AssignmentProperty',
        IdentifierReference: node.IdentifierReference,
        Initializer: node.Initializer,
      };
    case 'AssignmentExpression':
      return {
        type: 'AssignmentElement',
        DestructuringAssignmentTarget: node.LeftHandSideExpression,
        Initializer: node.AssignmentExpression,
      };
    case 'Elision':
      return node;
    case 'ParenthesizedExpression':
      return refineLeftHandSideExpression(node.Expression, type);
    default:
      throw OutOfRange.nonExhaustive(node.type);
  }
}

/** https://tc39.es/ecma262/#sec-assignment-operators-runtime-semantics-evaluation */
//   AssignmentExpression :
//     LeftHandSideExpression `=` AssignmentExpression
//     LeftHandSideExpression AssignmentOperator AssignmentExpression
//     LeftHandSideExpression `&&=` AssignmentExpression
//     LeftHandSideExpression `||=` AssignmentExpression
//     LeftHandSideExpression `??=` AssignmentExpression
/**
 * Whether an assignment target names TYPED STORAGE, which holds a value type
 * class instance inline and therefore copies into it.
 *
 * #sec-value-type-copying: "storing into a field or an array element". A typed
 * class field carries its declared type in [[TypedProperties]] and a typed
 * array its element type in [[TypedElement]]; a plain object's property and a
 * plain array's element carry neither and hold a reference.
 *
 * A binding target - one whose base is an Environment Record rather than a
 * value - is not a store into an object at all. It is the assignment half of
 * "assigning to one" and always copies.
 */
function isTypedStorageTarget(reference: unknown): boolean {
  const ref = reference as {
    ReferencedName?: unknown,
    Base?: unknown,
  } | undefined;
  const base = ref?.Base;
  if (!(base instanceof ObjectValue)) {
    // A binding, not a property store.
    return true;
  }
  if ((base as { TypedElement?: unknown }).TypedElement !== undefined) {
    return true;
  }
  const name = ref?.ReferencedName;
  const key = name instanceof JSStringValue ? name.stringValue() : name;
  return (base as { TypedProperties?: Map<unknown, unknown> })
    .TypedProperties?.has(key) === true;
}

export function* Evaluate_AssignmentExpression({
  LeftHandSideExpression, AssignmentOperator, AssignmentExpression,
}: ParseNode.AssignmentExpression): ValueEvaluator {
  if (AssignmentOperator === '=') {
    // 1. If LeftHandSideExpression is neither an ObjectLiteral nor an ArrayLiteral, then
    if (LeftHandSideExpression.type !== 'ObjectLiteral' && LeftHandSideExpression.type !== 'ArrayLiteral') {
      // a. Let lref be the result of evaluating LeftHandSideExpression.
      const lref = Q(LocationOfAssignmentTarget(LeftHandSideExpression, Q(yield* Evaluate(LeftHandSideExpression))));
      Q(lref);
      // c. If IsAnonymousFunctionDefinition(AssignmentExpression) and IsIdentifierRef of LeftHandSideExpression are both true, then
      let rval;
      if (IsAnonymousFunctionDefinition(AssignmentExpression) && IsIdentifierRef(LeftHandSideExpression)) {
        // i. Let rval be NamedEvaluation of AssignmentExpression with argument GetReferencedName(lref).
        rval = Q(yield* NamedEvaluation(AssignmentExpression as FunctionDeclaration, (lref as ReferenceRecord).ReferencedName as JSStringValue));
      } else { // d. Else,
        // i. Let rref be the result of evaluating AssignmentExpression.
        const rref = Q(yield* Evaluate(AssignmentExpression));
        // ii. Let rval be ? GetValue(rref).
        rval = Q(yield* GetValue(rref));
      }
      // #sec-value-type-copying: "assigning to one" is a COPY site, by the same
      // rule as at a binding - a NAME or a READ on the right denotes an existing
      // value and copies; a construction or a call produces one and does not.
      //
      // Measured before this: `_b_ = _a_` copied where `_b_` was ANNOTATED and
      // aliased where it was not, the annotation's boundary having been doing
      // the work. That is the elision hazard this turns on: a
      // boundary may be skipped, so a copy resting on one is a copy that
      // sometimes does not happen.
      //
      // Placed at the SIMPLE-assignment `PutValue`. A first attempt put it at
      // the one below, which serves DESTRUCTURING - the two look alike and only
      // one of them runs for `_b_ = _a_`.
      // Copy only into TYPED STORAGE. #sec-value-type-copying's position
      // list names "storing into a FIELD or an array element", and a plain
      // object's property is neither - it holds a reference, as it does for
      // every other object.
      //
      // This narrows an earlier version that copied on any assignment whose
      // right-hand side named a value type class instance. That read the
      // clause's opening sentence, "ASSIGNING a value of a value type ... copies
      // it", which conditions on the VALUE; the position list conditions on the
      // DESTINATION, and the two disagree. The measured consequence was that
      // `_o_.p = _a_` copied while `const _o_ = { p: _a_ }`, `_m_.set(_k_, _a_)`
      // and `_arr_.push(_a_)` all aliased - one spelling of "put this value in
      // that object" behaving differently from the rest, which is where the
      // rule had been implemented rather than what it says.
      if (copiesOnBinding(AssignmentExpression) && isTypedStorageTarget(lref)) {
        rval = CopyValueClassInstance(rval);
      }
      // e. Perform ? PutValue(lref, rval).
      Q(yield* PutValue(lref, rval));
      // f. Return rval.
      return rval;
    }
    // 2. Let assignmentPattern be the AssignmentPattern that is covered by LeftHandSideExpression.
    const assignmentPattern = refineLeftHandSideExpression(LeftHandSideExpression);
    // 3. Let rref be the result of evaluating AssignmentExpression.
    const rref = Q(yield* Evaluate(AssignmentExpression));
    // 3. Let rval be ? GetValue(rref).
    const rval = Q(yield* GetValue(rref));
    // 4. Perform ? DestructuringAssignmentEvaluation of assignmentPattern using rval as the argument.
    Q(yield* DestructuringAssignmentEvaluation(assignmentPattern as ParseNode.ObjectAssignmentPattern | ParseNode.ArrayAssignmentPattern, rval));
    // 5. Return rval.
    return rval;
  } else if (AssignmentOperator === '&&=') {
    // 1. Let lref be the result of evaluating LeftHandSideExpression.
    const lref = Q(LocationOfAssignmentTarget(LeftHandSideExpression, Q(yield* Evaluate(LeftHandSideExpression))));
    // 2. Let lval be ? GetValue(lref).
    const lval = Q(yield* GetValue(lref));
    // 3. Let lbool be ! ToBoolean(lval).
    const lbool = X(ToBoolean(lval));
    // 4. If lbool is false, return lval.
    if (lbool === Value.false) {
      return lval;
    }
    let rval;
    // 5. If IsAnonymousFunctionDefinition(AssignmentExpression) is true and IsIdentifierRef of LeftHandSideExpression is true, then
    if (IsAnonymousFunctionDefinition(AssignmentExpression) && IsIdentifierRef(LeftHandSideExpression)) {
      // a. Let rval be NamedEvaluation of AssignmentExpression with argument GetReferencedName(lref).
      rval = Q(yield* NamedEvaluation(AssignmentExpression as FunctionDeclaration, (lref as ReferenceRecord).ReferencedName as JSStringValue));
    } else { // 6. Else,
      // a. Let rref be the result of evaluating AssignmentExpression.
      const rref = Q(yield* Evaluate(AssignmentExpression));
      // b. Let rval be ? GetValue(rref).
      rval = Q(yield* GetValue(rref));
    }
    // 7. Perform ? PutValue(lref, rval).
    Q(yield* PutValue(lref, rval));
    // 8. Return rval.
    return rval;
  } else if (AssignmentOperator === '||=') {
    // 1. Let lref be the result of evaluating LeftHandSideExpression.
    const lref = Q(LocationOfAssignmentTarget(LeftHandSideExpression, Q(yield* Evaluate(LeftHandSideExpression))));
    // 2. Let lval be ? GetValue(lref).
    const lval = Q(yield* GetValue(lref));
    // 3. Let lbool be ! ToBoolean(lval).
    const lbool = X(ToBoolean(lval));
    // 4. If lbool is true, return lval.
    if (lbool === Value.true) {
      return lval;
    }
    let rval;
    // 5. If IsAnonymousFunctionDefinition(AssignmentExpression) is true and IsIdentifierRef of LeftHandSideExpression is true, then
    if (IsAnonymousFunctionDefinition(AssignmentExpression) && IsIdentifierRef(LeftHandSideExpression)) {
      // a. Let rval be NamedEvaluation of AssignmentExpression with argument GetReferencedName(lref).
      rval = Q(yield* NamedEvaluation(AssignmentExpression as FunctionDeclaration, (lref as ReferenceRecord).ReferencedName as JSStringValue));
    } else { // 6. Else,
      // a. Let rref be the result of evaluating AssignmentExpression.
      const rref = Q(yield* Evaluate(AssignmentExpression));
      // b. Let rval be ? GetValue(rref).
      rval = Q(yield* GetValue(rref));
    }
    // 7. Perform ? PutValue(lref, rval).
    Q(yield* PutValue(lref, rval));
    // 8. Return rval.
    return rval;
  } else if (AssignmentOperator === '??=') {
    // 1.Let lref be the result of evaluating LeftHandSideExpression.
    const lref = Q(LocationOfAssignmentTarget(LeftHandSideExpression, Q(yield* Evaluate(LeftHandSideExpression))));
    // 2. Let lval be ? GetValue(lref).
    const lval = Q(yield* GetValue(lref));
    // 3. If lval is not undefined nor null, return lval.
    if (lval !== Value.undefined && lval !== Value.null) {
      return lval;
    }
    let rval;
    // 4. If IsAnonymousFunctionDefinition(AssignmentExpression) is true and IsIdentifierRef of LeftHandSideExpression is true, then
    if (IsAnonymousFunctionDefinition(AssignmentExpression) && IsIdentifierRef(LeftHandSideExpression)) {
      // a. Let rval be NamedEvaluation of AssignmentExpression with argument GetReferencedName(lref).
      rval = Q(yield* NamedEvaluation(AssignmentExpression as FunctionDeclaration, (lref as ReferenceRecord).ReferencedName as JSStringValue));
    } else { // 5. Else,
      // a. Let rref be the result of evaluating AssignmentExpression.
      const rref = Q(yield* Evaluate(AssignmentExpression));
      // b. Let rval be ? GetValue(rref).
      rval = Q(yield* GetValue(rref));
    }
    // 6. Perform ? PutValue(lref, rval).
    Q(yield* PutValue(lref, rval));
    // 7. Return rval.
    return rval;
  } else {
    // 1. Let lref be the result of evaluating LeftHandSideExpression.
    const lref = Q(LocationOfAssignmentTarget(LeftHandSideExpression, Q(yield* Evaluate(LeftHandSideExpression))));
    // 2. Let lval be ? GetValue(lref).
    const lval = Q(yield* GetValue(lref));
    // 3. Let rref be the result of evaluating AssignmentExpression.
    const rref = Q(yield* Evaluate(AssignmentExpression));
    // 4. Let rval be ? GetValue(rref).
    const rval = Q(yield* GetValue(rref));
    // 5. Let assignmentOpText be the source text matched by AssignmentOperator.
    const assignmentOpText = AssignmentOperator;
    // proposal-runtime-types (operatoroverloading.md): an explicit compound
    // assignment operator declared on the left operand's class updates the
    // receiver and returns the result, taking precedence over the desugaring to
    // the binary operator below. A value type uses this to update in place.
    if (surroundingAgent.feature('runtime-types') && lval instanceof ObjectValue) {
      const compoundOp = LookupClassOperator(lval, assignmentOpText);
      if (compoundOp) {
        // THE BINDING IS NOT REASSIGNED. operatoroverloading.md: compound
        // assignments "are invoked as method calls on the left-hand side. The
        // binding itself is never reassigned, so THEY WORK ON `const` BINDINGS,
        // and the value of the expression `a += b` is whatever the operator
        // returns, allowing operators to return `this` for chaining."
        //
        // Writing the result back made `a += b` a reassignment, so a `const`
        // binding threw "Assignment to constant variable" - the one thing the
        // design calls out as working. A value type uses this form precisely to
        // update in place, and the bindings holding such a value are usually
        // `const`, so the form was unavailable exactly where it was meant to be
        // used.
        //
        // Only the EXPLICIT operator takes this path. The desugaring below,
        // where a class declares `operator+` and not `operator+=`, is a genuine
        // reassignment - `a = a + b` - and keeps its PutValue, because
        // `operator+` returns a new value rather than updating the receiver.
        // That is why one form works on a `const` binding and the other does
        // not, and it is a difference the author of the class chooses.
        return Q(yield* Call(compoundOp, lval, [rval]));
      }
    }
    // 6. Let opText be the sequence of Unicode code points associated with assignmentOpText in the following table:
    const opText = ({
      '**=': '**',
      '*=': '*',
      '/=': '/',
      '%=': '%',
      '+=': '+',
      '-=': '-',
      '<<=': '<<',
      '>>=': '>>',
      '>>>=': '>>>',
      '&=': '&',
      '^=': '^',
      '|=': '|',
    } as const)[assignmentOpText];
    // 7. Let r be ApplyStringOrNumericBinaryOperator(lval, opText, rval).
    const r = Q(yield* ApplyStringOrNumericBinaryOperator(lval, opText, rval));
    // 8. Perform ? PutValue(lref, r).
    Q(yield* PutValue(lref, r));
    // 9. Return r.
    return r;
  }
}
