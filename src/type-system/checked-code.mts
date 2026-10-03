import type { ParseNode } from '../parser/ParseNode.mts';
import { IsProposalSyntax } from '../parser/ProposalSyntax.mts';
import { FunctionLikeUnits } from '../parser/TypedStrictness.mts';

/** #sec-checked-code: classification depends on syntax and ownership, never type evaluation. */
interface Unit {
  node: ParseNode;
  parent?: Unit;
  own: boolean;
  checked: boolean;
}
interface Classification {
  units: Unit[];
  nodes: ParseNode[];
}
const owners = new WeakMap<object, Unit>();
const classifications = new WeakMap<object, Classification>();
const inheritedRoots = new WeakSet<object>();
const skippedKeys = new Set(['parent', 'location', 'sourceText', 'tokenLog']);
const isUnit = (node: ParseNode): boolean => node.type === 'Script' || node.type === 'Module'
  || node.type === 'ClassDeclaration' || node.type === 'ClassExpression' || FunctionLikeUnits.has(node.type);

/** Two linear traversals: discover each unit's own syntax, then inherit downward. */
function classify(root: ParseNode, inherited = false): Classification {
  const units: Unit[] = [];
  const nodes: ParseNode[] = [];
  const seen = new WeakSet<object>();
  const visit = (value: unknown, enclosing?: Unit): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const element of value) visit(element, enclosing);
      return;
    }
    const node = value as ParseNode;
    if (typeof node.type !== 'string') return;
    const unit = isUnit(node);
    const owner = unit ? { node, parent: enclosing, own: false, checked: false } : enclosing;
    if (!owner) return;
    if (unit) units.push(owner);
    if (IsProposalSyntax(node)) owner.own = true;
    owners.set(node, owner);
    nodes.push(node);
    for (const [key, child] of Object.entries(node)) {
      if (skippedKeys.has(key)) continue;
      // A method key and a unit's decorators are evaluated by the enclosing unit.
      visit(child, unit && (key === 'ClassElementName' || key === 'Decorators') ? enclosing : owner);
    }
  };
  visit(root);
  for (const unit of units) unit.checked = inherited || unit.own || !!unit.parent?.checked;
  const result = { units, nodes };
  classifications.set(root, result);
  return result;
}

export function MarkInheritedChecked(root: ParseNode): void {
  inheritedRoots.add(root);
  const known = classifications.get(root);
  if (known) for (const unit of known.units) unit.checked = true;
}

/** Parameter and body fragments need no parent links to share their owning unit. */
export function ClassifyDynamicFunction(expression: ParseNode): void {
  classify(expression);
}

export function CheckedCodeOwner(node: ParseNode): ParseNode | undefined {
  let owner = owners.get(node);
  if (!owner) {
    let root = node;
    while (root.parent) root = root.parent as ParseNode;
    if (!isUnit(root)) return undefined;
    if (!classifications.has(root)) classify(root, inheritedRoots.has(root));
    owner = owners.get(node);
  }
  return owner?.node;
}

export function IsCheckedCode(node: ParseNode): boolean {
  CheckedCodeOwner(node);
  // Generated nodes must inherit an explicit source obligation; absent one, no check is suppressed.
  return owners.get(node)?.checked ?? true;
}

export type CheckedRange = readonly [number, number];
/** Host inspection only. Semantic ownership uses nodes, not overlapping source ranges. */
export function CheckedRanges(root: ParseNode, inherited = false): readonly CheckedRange[] {
  const result = classify(root, inherited || inheritedRoots.has(root));
  return result.nodes.filter((node) => owners.get(node)?.checked && node.location)
    .map((node) => [node.location.startIndex, node.location.endIndex] as const);
}
