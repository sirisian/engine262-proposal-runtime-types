import type { ParseNode } from '../parser/ParseNode.mts';
import { HasInitializer } from './all.mts';

/**
 * https://tc39.es/ecma262/#sec-static-semantics-expectedargumentcount
 *
 * The count stops at the first parameter that
 * is optional, defaulted, or a rest - and it read the LAST element to find the
 * rest, which is the base language's rule and not this proposal's. A rest may
 * now sit anywhere, so the scan looks for one at each position; a leading rest
 * gives a length of 0, which is already true of `(...args) => {}` today.
 */
export function ExpectedArgumentCount(FormalParameterList: ParseNode.FormalParameters) {
  let count = 0;
  for (const FormalParameter of FormalParameterList) {
    if (FormalParameter.type === 'BindingRestElement') {
      return count;
    }
    if (HasInitializer(FormalParameter)) {
      return count;
    }
    count += 1;
  }
  return count;
}
