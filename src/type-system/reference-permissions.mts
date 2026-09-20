import type { ParseNode } from '../parser/ParseNode.mts';

/** A lexical slot, distinct from its current referent and value type. */
export interface ReferenceSlot { owner: ParseNode | null }
export interface ReadonlyOrigin { key: string; constructorOwner?: ParseNode }
export type ReferenceLocation = ReadonlyOrigin | ReferenceSlot;
export type ReferenceOperation =
  | { kind: 'bind' | 'rebind', slot: ReferenceSlot, locations: readonly ReferenceLocation[], source: ParseNode }
  | { kind: 'write', slot: ReferenceSlot };

type State = Map<ReferenceSlot, readonly ReferenceLocation[]>;

export function ReferenceFunction(node: ParseNode | undefined): ParseNode | null {
  for (let current = node; current; current = current.parent) {
    if (/FunctionDeclaration|FunctionExpression|ArrowFunction|Method|GeneratorDeclaration|GeneratorExpression|OperatorDefinition/.test(current.type)) return current;
  }
  return null;
}

/**
 * A small location-flow pass. Value typing supplies the immutable member facts;
 * this pass follows aliases, branches and back edges without rerunning type
 * evaluation. Alias-to-binding edges deliberately follow subsequent rebinding,
 * as EnvironmentRecord reference locations do at runtime.
 */
export function CheckReferencePermissions(
  roots: readonly ParseNode[],
  operations: WeakMap<ParseNode, ReferenceOperation>,
  report: (origin: ReadonlyOrigin, write: ParseNode) => void,
): void {
  const functions: ParseNode[] = [];
  const visitedFunctions = new Set<ParseNode>();
  const initialLocations = new Map<ReferenceSlot, readonly ReferenceLocation[]>();
  const rebound = new Set<ReferenceSlot>();
  const capturedRebound = new Set<ReferenceSlot>();
  const children = (node: ParseNode): ParseNode[] => Object.entries(node).flatMap(([key, value]) => {
    if (['parent', 'location', 'sourceText', 'strict'].includes(key)) return [];
    return (Array.isArray(value) ? value : [value]).filter((child): child is ParseNode =>
      !!child && typeof child === 'object' && typeof child.type === 'string');
  });
  const scan = (node: ParseNode): void => {
    if (ReferenceFunction(node) === node) functions.push(node);
    const op = operations.get(node);
    if (op?.kind === 'bind') initialLocations.set(op.slot, op.locations);
    if (op?.kind === 'rebind') {
      rebound.add(op.slot);
      if (op.slot.owner !== ReferenceFunction(node)) capturedRebound.add(op.slot);
    }
    children(node).forEach(scan);
  };
  roots.forEach(scan);
  const merge = (...states: State[]): State => {
    const result: State = new Map();
    for (const state of states) {
      for (const [slot, locations] of state) {
        result.set(slot, [...new Set([...(result.get(slot) ?? []), ...locations])]);
      }
    }
    return result;
  };
  const equal = (a: State, b: State): boolean => [...new Set([...a.keys(), ...b.keys()])].every((slot) => {
    const left = a.get(slot) ?? [];
    const right = b.get(slot) ?? [];
    return left.length === right.length && left.every((item) => right.includes(item));
  });
  const checkWrite = (slot: ReferenceSlot, state: State, node: ParseNode, seen = new Set<ReferenceSlot>()): void => {
    if (seen.has(slot)) return;
    seen.add(slot);
    for (const location of state.get(slot) ?? []) {
      if ('key' in location) report(location, node);
      else checkWrite(location, state, node, seen);
    }
  };
  type Exit = { kind: 'break' | 'continue' | 'return' | 'throw', label?: string, state: State };
  type Flow = { normal?: State, exits: Exit[] };
  const normal = (state: State): Flow => ({ normal: state, exits: [] });
  const join = (...flows: Flow[]): Flow => {
    const states = flows.flatMap((flow) => flow.normal ? [flow.normal] : []);
    return { normal: states.length ? merge(...states) : undefined, exits: flows.flatMap((flow) => flow.exits) };
  };
  const sequence = (nodes: readonly ParseNode[], input: State): Flow => {
    let flow = normal(input);
    for (const node of nodes) {
      if (!flow.normal) break;
      const next = visit(node, flow.normal);
      flow = { normal: next.normal, exits: [...flow.exits, ...next.exits] };
    }
    return flow;
  };
  const visit = (node: ParseNode | null | undefined, input: State): Flow => {
    if (!node) return normal(input);
    const op = operations.get(node);
    if (op?.kind === 'write') {
      checkWrite(op.slot, input, node);
      return normal(input);
    }
    if (op) {
      const result = visit(op.source, input);
      result.normal?.set(op.slot, op.locations);
      return result;
    }
    if (ReferenceFunction(node) === node) {
      if (visitedFunctions.has(node)) return normal(input);
      visitedFunctions.add(node);
      const local = new Map(input);
      for (const [slot, locations] of initialLocations) {
        if (slot.owner !== node && !local.has(slot) && !rebound.has(slot)) local.set(slot, locations);
      }
      // A closure observes a slot at call time, not its definition-time target.
      // Without an effects contract a captured, rebindable origin is unknown.
      for (const slot of rebound) if (slot.owner !== node) local.delete(slot);
      sequence(children(node), local);
      return normal(input);
    }
    switch (node.type) {
      case 'BreakStatement':
      case 'ContinueStatement':
        return { exits: [{ kind: node.type === 'BreakStatement' ? 'break' : 'continue', label: node.LabelIdentifier?.name, state: input }] };
      case 'ReturnStatement':
      case 'ThrowStatement': {
        const value = sequence(children(node), input);
        return { exits: [...value.exits, ...(value.normal ? [{ kind: node.type === 'ReturnStatement' ? 'return' as const : 'throw' as const, state: value.normal }] : [])] };
      }
      case 'IfStatement': {
        const before = visit(node.Expression, input);
        if (!before.normal) return before;
        const branches = join(visit(node.Statement_a, new Map(before.normal)), visit(node.Statement_b, new Map(before.normal)));
        return { normal: branches.normal, exits: [...before.exits, ...branches.exits] };
      }
      case 'ConditionalExpression': {
        const before = visit(node.ShortCircuitExpression, input);
        if (!before.normal) return before;
        return join(visit(node.AssignmentExpression_a, new Map(before.normal)), visit(node.AssignmentExpression_b, new Map(before.normal)));
      }
      case 'LogicalANDExpression':
      case 'LogicalORExpression':
      case 'CoalesceExpression': {
        const parts = children(node);
        const before = visit(parts[0], input);
        return before.normal ? join(before, sequence(parts.slice(1), new Map(before.normal))) : before;
      }
      case 'ForStatement':
      case 'WhileStatement':
      case 'DoWhileStatement':
      case 'ForOfStatement':
      case 'ForInStatement': {
        const loop = node as unknown as Record<string, ParseNode | undefined>;
        let entry = input;
        if (node.type === 'ForStatement') {
          entry = visit(loop.LexicalDeclaration ?? loop.VariableDeclarationList ?? loop.Expression_a, entry).normal ?? new Map();
        } else if (node.type === 'ForOfStatement' || node.type === 'ForInStatement') {
          entry = visit(loop.AssignmentExpression ?? loop.Expression, entry).normal ?? new Map();
        }
        const labels: string[] = [];
        for (let parent = node.parent; parent?.type === 'LabelledStatement'; parent = parent.parent) labels.push(parent.LabelIdentifier.name);
        const targetsLoop = (exit: Exit): boolean => exit.label === undefined || labels.includes(exit.label);
        let head = new Map(entry);
        for (;;) {
          let before = new Map(head);
          if (node.type === 'ForStatement') before = visit(loop.Expression_b, before).normal ?? new Map();
          else if (node.type === 'WhileStatement') before = visit(loop.Expression, before).normal ?? new Map();
          if (node.type === 'ForOfStatement' || node.type === 'ForInStatement') {
            before = visit(loop.ForDeclaration ?? loop.LeftHandSideExpression, before).normal ?? new Map();
          }
          const body = visit(loop.Statement, new Map(before));
          const back = join(
            { normal: body.normal, exits: [] },
            ...body.exits.filter((exit) => exit.kind === 'continue' && targetsLoop(exit)).map((exit) => normal(exit.state)),
          );
          let next = back.normal;
          if (next && node.type === 'ForStatement') next = visit(loop.Expression_c, next).normal;
          else if (next && node.type === 'DoWhileStatement') next = visit(loop.Expression, next).normal;
          const joined = next ? merge(entry, next) : entry;
          if (equal(head, joined)) {
            const breaks = body.exits.filter((exit) => exit.kind === 'break' && targetsLoop(exit));
            const exits = body.exits.filter((exit) => !((exit.kind === 'break' || exit.kind === 'continue') && targetsLoop(exit)));
            const test = node.type === 'ForStatement' ? loop.Expression_b : loop.Expression;
            const endless = node.type === 'ForStatement' && !test
              || test?.type === 'BooleanLiteral' && test.value === true;
            const ordinaryExit = endless ? undefined : node.type === 'DoWhileStatement' ? next : before;
            const states = [...(ordinaryExit ? [ordinaryExit] : []), ...breaks.map((exit) => exit.state)];
            return { normal: states.length ? merge(...states) : undefined, exits };
          }
          head = joined;
        }
      }
      case 'LabelledStatement': {
        const body = visit(node.LabelledItem, input);
        const breaks = body.exits.filter((exit) => exit.kind === 'break' && exit.label === node.LabelIdentifier.name);
        const result = join(body, ...breaks.map((exit) => normal(exit.state)));
        result.exits = result.exits.filter((exit) => !breaks.includes(exit));
        return result;
      }
      case 'AssignmentExpression': {
        // The RHS may call a function which redirects a captured alias.
        const right = visit(node.AssignmentExpression, input);
        return right.normal ? visit(node.LeftHandSideExpression, right.normal) : right;
      }
      case 'CallExpression':
      case 'NewExpression':
      case 'TaggedTemplateExpression': {
        const result = sequence(children(node), input);
        for (const slot of capturedRebound) result.normal?.delete(slot);
        return result;
      }
      case 'SwitchStatement': {
        const before = visit(node.Expression, input);
        if (!before.normal) return before;
        const block = node.CaseBlock;
        const clauses = [...(block.CaseClauses_a ?? []), ...(block.DefaultClause ? [block.DefaultClause] : []), ...(block.CaseClauses_b ?? [])];
        // Case expressions run during selection, never on fallthrough. Their
        // calls may invalidate captured origins before any clause is entered.
        const selected = sequence(clauses.flatMap((clause) => 'Expression' in clause ? [clause.Expression] : []), new Map(before.normal));
        const entry = merge(before.normal, selected.normal ?? new Map());
        for (const slot of capturedRebound) if (!selected.normal?.has(slot)) entry.delete(slot);
        let fallthrough: State | undefined;
        const exits: Exit[] = [];
        const states = block.DefaultClause ? [] : [entry];
        for (const clause of clauses) {
          const flow = sequence(clause.StatementList ?? [], merge(entry, ...(fallthrough ? [fallthrough] : [])));
          fallthrough = flow.normal;
          for (const exit of flow.exits) {
            if (exit.kind === 'break' && exit.label === undefined) states.push(exit.state);
            else exits.push(exit);
          }
        }
        if (fallthrough) states.push(fallthrough);
        return { normal: states.length ? merge(...states) : undefined, exits };
      }
      case 'TryStatement': {
        const before = new Map(input);
        const tried = visit(node.Block, input);
        const handlers = node.CatchClauses ?? (node.Catch ? [node.Catch] : []);
        let result = tried;
        if (handlers.length) {
          // An implicit throw may occur between stores. Rebindable locations
          // without an explicit incoming edge are unknown at the catch entry.
          const implicit = new Map(before);
          for (const slot of rebound) implicit.delete(slot);
          const thrown = tried.exits.filter((exit) => exit.kind === 'throw').map((exit) => exit.state);
          const caught = handlers.map((handler) => visit(handler, merge(implicit, ...thrown)));
          result = join({ normal: tried.normal, exits: tried.exits.filter((exit) => exit.kind !== 'throw') }, ...caught);
        }
        if (!node.Finally) return result;
        const flows: Flow[] = result.normal ? [visit(node.Finally, result.normal)] : [];
        for (const exit of result.exits) {
          const finalized = visit(node.Finally, exit.state);
          flows.push({ exits: [...finalized.exits, ...(finalized.normal ? [{ ...exit, state: finalized.normal }] : [])] });
        }
        return join(...flows);
      }
      default:
        return sequence(children(node), input);
    }
  };
  for (const root of roots) visit(root, new Map());
  // Declarations beyond an abrupt statement still have statically checked bodies.
  for (const fn of functions) visit(fn, new Map());
}
