import { OutOfRange, isArray } from '../utils/language.mts';
import type { ParseNode } from '../parser/ParseNode.mts';

export function IsSimpleParameterList(node: ParseNode | readonly ParseNode[]) {
  if (isArray(node)) {
    for (const n of node) {
      if (!IsSimpleParameterList(n)) {
        return false;
      }
    }
    return true;
  }
  switch (node.type) {
    case 'SingleNameBinding':
      // proposal-runtime-types (references extension): a `ref` parameter makes
      // the list non-simple, as a default or a pattern does. The consequence
      // that matters is the arguments object: non-simple means unmapped, and
      // unmapped entries hold each argument's DECAYED value, so `arguments`
      // never aliases the caller's location and strict and sloppy code agree.
      return node.Initializer === null && node.Ref !== true;
    case 'BindingElement':
      return false;
    case 'BindingRestElement':
      return false;
    default:
      throw OutOfRange.nonExhaustive(node);
  }
}
