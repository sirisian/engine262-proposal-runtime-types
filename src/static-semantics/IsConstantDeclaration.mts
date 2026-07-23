import type { ParseNode } from '../parser/ParseNode.mts';

export function IsConstantDeclaration(node: ParseNode | ParseNode.LetOrConst) {
  // proposal-runtime-types (explicit resource management): a `using` binding is
  // immutable like a `const` one, since the resource it names is disposed when the
  // block is left and rebinding it would lose the thing to dispose.
  const isConst = (v: unknown) => v === 'const' || v === 'using';
  return isConst(node) || (typeof node === 'object' && 'LetOrConst' in node && isConst(node.LetOrConst));
}
