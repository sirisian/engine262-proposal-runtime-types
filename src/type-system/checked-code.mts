import type { ParseNode } from '../parser/ParseNode.mts';
import { IsProposalSyntax } from '../parser/ProposalSyntax.mts';
import { FunctionLikeUnits } from '../parser/TypedStrictness.mts';

/**
 * Checked code (#sec-checked-code). A unit is a Script, a Module, a
 * function-like unit or a class. A unit is checked when its own syntax,
 * excluding nested units, contains proposal syntax, or when it is nested in a
 * checked unit. The classification is syntactic and independent of source
 * order, like the strictness of annotated code, except that Modules and
 * classes are units here and a unit that is already strict is not skipped.
 *
 * Outside checked code the checker withholds the errors that read a type it
 * inferred from code, and the contracts this proposal attaches to built-ins,
 * operators and declarations that already exist, so a program written without
 * the proposal keeps its behaviour.
 */
export type CheckedRange = readonly [start: number, end: number];

const skippedKeys = new Set(['parent', 'location', 'sourceText', 'tokenLog']);
const bodyKeys = ['FunctionBody', 'GeneratorBody', 'AsyncBody', 'AsyncGeneratorBody', 'ConciseBody', 'AsyncConciseBody'];

const isClass = (node: ParseNode) => node.type === 'ClassDeclaration' || node.type === 'ClassExpression';
const isMethod = (node: ParseNode) => node.type.endsWith('Method') || node.type === 'MethodDefinition';

/** The source ranges of the checked units of a parse, merged and sorted. */
export function CheckedRanges(root: unknown, inherited = false): readonly CheckedRange[] {
  return scan(root, inherited).ranges;
}

function scan(root: unknown, inherited: boolean): { ranges: readonly CheckedRange[], rootOwn: boolean } {
  let rootOwn = false;
  if (inherited) {
    // Direct eval code in checked code is checked throughout.
    return { ranges: [[0, Number.MAX_SAFE_INTEGER]], rootOwn: true };
  }
  const ranges: [number, number][] = [];
  const seen = new WeakSet<object>();
  // Returns whether proposal syntax was found that belongs to the unit the
  // caller is classifying: a unit reports only its outward-facing parts.
  const visit = (value: unknown): boolean => {
    if (!value || typeof value !== 'object' || seen.has(value)) return false;
    seen.add(value);
    if (Array.isArray(value)) {
      let found = false;
      for (const item of value) found = visit(item) || found;
      return found;
    }
    const node = value as ParseNode;
    if (typeof node.type !== 'string') return false;
    const fields = value as Record<string, unknown>;
    const unit = node.type === 'Script' || node.type === 'Module' || FunctionLikeUnits.has(node.type) || isClass(node);
    let own = IsProposalSyntax(node);
    let outward = false;
    for (const key of Object.keys(fields)) {
      if (skippedKeys.has(key)) continue;
      // A member's computed name and the decorators on a unit are evaluated in
      // the enclosing unit, so they classify that unit, not this one.
      if (unit && (key === 'ClassElementName' || key === 'Decorators')) {
        outward = visit(fields[key]) || outward;
      } else {
        own = visit(fields[key]) || own;
      }
    }
    if (node === root) rootOwn = own;
    if (!unit) return own;
    if (own && node.location) {
      let start = node.location.startIndex;
      if (isMethod(node)) {
        const parts = [fields.UniqueFormalParameters, fields.PropertySetParameterList, fields.TypeAnnotation,
          ...bodyKeys.map((key) => fields[key])].flat();
        const starts = parts.filter((part): part is ParseNode => !!part && typeof part === 'object' && 'location' in part)
          .map((part) => part.location.startIndex);
        if (starts.length) start = Math.min(...starts);
      }
      ranges.push([start, node.location.endIndex]);
    }
    return outward;
  };
  visit(root);
  // A checked unit covers every unit nested in it.
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of ranges) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], end);
    else merged.push([start, end]);
  }
  return { ranges: merged, rootOwn };
}

const classified = new WeakMap<object, readonly CheckedRange[]>();
const inheritedRoots = new WeakSet<object>();

/** Direct eval code whose caller is checked code is checked throughout. */
export function MarkInheritedChecked(root: ParseNode): void {
  inheritedRoots.add(root);
  classified.delete(root);
}

const roots = new Set(['Script', 'Module']);
const recorded = new WeakMap<object, boolean>();

/**
 * A dynamically constructed function classifies its own source as one unit
 * (#sec-checked-code). Its parameters and body are parsed apart from it and
 * carry no parent links, so its nodes reach no common root: record each node's
 * classification directly, entering every nested unit as the walk reaches it.
 */
export function ClassifyDynamicFunction(expression: ParseNode): void {
  const seen = new WeakSet<object>();
  const visit = (value: unknown, checked: boolean): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, checked);
      return;
    }
    const node = value as ParseNode;
    if (typeof node.type !== 'string') return;
    const unit = FunctionLikeUnits.has(node.type) || isClass(node);
    const here = checked || (unit && scan(node, false).rootOwn);
    recorded.set(node, here);
    for (const [key, child] of Object.entries(node)) {
      if (skippedKeys.has(key)) continue;
      // A member's computed name and decorators belong to the enclosing unit.
      visit(child, unit && (key === 'ClassElementName' || key === 'Decorators') ? checked : here);
    }
  };
  visit(expression, false);
}

/** Whether a node is in checked code. */
export function IsCheckedCode(node: ParseNode): boolean {
  const known = recorded.get(node);
  if (known !== undefined) return known;
  let root = node;
  while (root.parent) root = root.parent as ParseNode;
  // A node outside any parsed source, such as one the checker made for
  // itself, keeps every check: only real source can opt out.
  if (!roots.has(root.type) && !FunctionLikeUnits.has(root.type)) return true;
  const position = node.location?.startIndex;
  if (position === undefined) return true;
  let ranges = classified.get(root);
  if (!ranges) {
    ranges = CheckedRanges(root, inheritedRoots.has(root));
    classified.set(root, ranges);
  }
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (ranges[middle]![0] <= position) low = middle + 1;
    else high = middle;
  }
  return low > 0 && position < ranges[low - 1]![1];
}

/**
 * The inference family: each judgment reads a type the checker inferred from
 * code, so it applies only in checked code. Listed by message template; a new
 * judgment of this kind adds its template here.
 */
const inferenceTemplates = [
  'a value of $1 is always $2, so the branch it guards is dead code',
  'the $1 test can never succeed, so the branch it guards is dead code',
  'the $1 test can never fail, so the branch it guards is dead code',
  'the right operand of $1 can never be evaluated, so it is dead code',
  'the body of this loop can never run, since $1 has no element',
  'every case of $1 is covered, so the default can never be taken',
  '$1 and $2 are disjoint, so this comparison is always $3',
  'the catch clause for $1 can never run, since an earlier clause accepts every such value',
  'the $1 assertion can never succeed, so the code it dominates is dead',
];

/**
 * Contracts this proposal attaches to built-ins, operators and declarations
 * that already exist. A program without the proposal reaches them, and today
 * gets the run-time behaviour instead, so they too apply only in checked code.
 * The typed signatures of the existing Array methods are gated where they are
 * produced, since their message is the general one for assignability.
 */
const existingContractTemplates = [
  '$1 has no setter',
  'the right operand of $1 must be an object, not $2',
  'a value of $1 is not callable',
  'this value is not callable',
  'the call is ambiguous between two declared signatures',
];

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const gatedPatterns = [...inferenceTemplates, ...existingContractTemplates].map((template) => new RegExp(
  `^${template.split(/\$\d/).map(escape).join('[\\s\\S]*')}$`,
));

/** Whether a reported message belongs to a family that applies only in checked code. */
export function IsGatedMessage(message: string): boolean {
  return gatedPatterns.some((pattern) => pattern.test(message));
}
