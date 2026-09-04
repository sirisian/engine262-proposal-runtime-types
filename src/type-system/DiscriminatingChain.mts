import type { ParseNode } from '../parser/ParseNode.mts';
import type { TypeRecord } from './records.mts';

/**
 * proposal-runtime-types `sec-discriminated-where-chains`, `DiscriminatingChainOf`:
 * does a `where` chain DISCRIMINATE, and if so on which member against which
 * constants?
 *
 * **The qualification is syntactic and this operation keeps it that way.** The
 * specification says why: "The qualification is syntactic so that no predicate
 * reasoning enters the checker; the alternative was a prover with a budget, and
 * no other rule here asks for one." Nothing below tests what a predicate MEANS -
 * it reads shapes, and a shape it does not recognise disqualifies the chain
 * rather than being reasoned about.
 *
 * It answers with the CONSTANTS each branch tests, not with a type. Building the
 * denoted union is `DenotedUnionOf`'s job, and keeping the two apart is what
 * lets every qualifying and disqualifying form be tested without constructing a
 * type.
 */

export interface DiscriminatingBranch {
  /** The constants this branch tests. Several where a clause is an `or`. */
  readonly constants: readonly string[];
  /** The branch's predicate, whose shape assertions `DenotedUnionOf` applies. */
  readonly predicate: ParseNode;
}

export interface DiscriminatingChain {
  /** The member of `this` every condition tests. */
  readonly discriminant: string;
  readonly branches: readonly DiscriminatingBranch[];
  /** ~conditional~ or ~match~, for diagnostics. */
  readonly form: 'conditional' | 'match';
}

/** The literal a node denotes, where it denotes one. */
function constantOf(node: ParseNode | null | undefined): string | undefined {
  const n = node as { type?: string, value?: unknown, name?: string, MemberExpression?: ParseNode, IdentifierName?: { name?: string } } | null | undefined;
  if (!n) {
    return undefined;
  }
  if (n.type === 'StringLiteral' || n.type === 'NumericLiteral') {
    return String(n.value);
  }
  if (n.type === 'BooleanLiteral') {
    return String(n.value);
  }
  // An enumerator, `E.A`, is a compile-time constant of an enum type.
  if (n.type === 'MemberExpression' && n.IdentifierName?.name) {
    const base = n.MemberExpression as { type?: string, name?: string } | undefined;
    return base?.type === 'IdentifierReference' ? `${base.name}.${n.IdentifierName.name}` : undefined;
  }
  return undefined;
}

/** The member name in a `this.x` access, where the node is one. */
function memberOfThis(node: ParseNode | null | undefined): string | undefined {
  const n = node as { type?: string, MemberExpression?: { type?: string }, IdentifierName?: { name?: string } } | null | undefined;
  if (n?.type !== 'MemberExpression' || !n.IdentifierName?.name) {
    return undefined;
  }
  return n.MemberExpression?.type === 'ThisExpression' ? n.IdentifierName.name : undefined;
}

/**
 * One condition, as `member == constant`.
 *
 * `==` and `===` only. **A nullish or ordering condition disqualifies** - the
 * specification names both - and so does anything else, because a shape this
 * does not recognise is not reasoned about.
 */
function equalityCondition(test: ParseNode): { member: string, constant: string } | undefined {
  // **(measured)** the node is an `EqualityExpression` whose operands are its
  // `EqualityExpression` and `RelationalExpression` fields - named for the
  // productions rather than for the sides. An earlier draft guessed `a`/`b` and
  // every form classified as non-discriminating, including the ones that should
  // qualify: the classifier read shapes that were never there and said so
  // uniformly, which reads exactly like a working rejecter.
  const t = test as {
    type?: string,
    operator?: string,
    EqualityExpression?: ParseNode,
    RelationalExpression?: ParseNode,
  };
  if (t.type !== 'EqualityExpression' || (t.operator !== '==' && t.operator !== '===')) {
    return undefined;
  }
  const left = t.EqualityExpression;
  const right = t.RelationalExpression;
  // Either order: `this.c == 'US'` and `'US' == this.c` are the same condition.
  const m1 = memberOfThis(left);
  const c1 = constantOf(right);
  if (m1 !== undefined && c1 !== undefined) {
    return { member: m1, constant: c1 };
  }
  const m2 = memberOfThis(right);
  const c2 = constantOf(left);
  if (m2 !== undefined && c2 !== undefined) {
    return { member: m2, constant: c2 };
  }
  return undefined;
}

/**
 * The conditional form.
 *
 * A chain is the `if`/`else` nest: an `else` whose predicate is itself a
 * `ConditionalRefinement` continues the chain. **That nesting IS the chain the
 * specification describes** - `else if` is absent sugar, and reading the nest
 * gives the same answer whatever the braces look like.
 */
function classifyConditional(predicate: ParseNode): DiscriminatingChain | undefined {
  const branches: DiscriminatingBranch[] = [];
  let discriminant: string | undefined;
  let node: ParseNode | null = predicate;
  for (;;) {
    const n = node as { type?: string, Test?: ParseNode, Consequent?: ParseNode, Alternate?: ParseNode | null } | null;
    if (n?.type !== 'ConditionalRefinement' || !n.Test || !n.Consequent) {
      break;
    }
    const cond = equalityCondition(n.Test);
    if (!cond) {
      return undefined;
    }
    if (discriminant === undefined) {
      discriminant = cond.member;
    } else if (discriminant !== cond.member) {
      // "conditions over two members" - disqualified.
      return undefined;
    }
    branches.push({ constants: [cond.constant], predicate: n.Consequent });
    if (n.Alternate === null || n.Alternate === undefined) {
      // No `else`. Totality is then a question about the discriminant's type,
      // which the caller answers - this operation reports the constants and
      // says the chain has no final branch.
      return discriminant === undefined ? undefined : { discriminant, branches, form: 'conditional' };
    }
    const alt = n.Alternate as { type?: string };
    if (alt.type === 'ConditionalRefinement') {
      node = n.Alternate;
      continue;
    }
    // A terminal `else`: its predicate is the last branch, testing whichever
    // constants the earlier conditions did not.
    branches.push({ constants: [], predicate: n.Alternate });
    return discriminant === undefined ? undefined : { discriminant, branches, form: 'conditional' };
  }
  return undefined;
}

/**
 * The `match` form. It parses as a MatchExpression, since a RefinementPredicate
 * may be an AssignmentExpression.
 *
 * Disqualified by a GUARDED clause, by two clauses naming one constant, and by a
 * pattern that is not a constant or an `or` of them.
 */
function classifyMatch(predicate: ParseNode): DiscriminatingChain | undefined {
  const m = predicate as { type?: string, Expression?: ParseNode, Clauses?: readonly ParseNode[] };
  if (m.type !== 'MatchExpression' || !m.Expression || !m.Clauses) {
    return undefined;
  }
  const discriminant = memberOfThis(m.Expression);
  if (discriminant === undefined) {
    return undefined;
  }
  const branches: DiscriminatingBranch[] = [];
  const seen = new Set<string>();
  for (const clause of m.Clauses) {
    const c = clause as { Pattern?: ParseNode | null, Guard?: ParseNode | null, Body?: ParseNode };
    if (c.Guard) {
      // "every clause is unguarded" - a guard is a refinement the checker would
      // have to reason about, which is the thing this rule avoids.
      return undefined;
    }
    if (!c.Pattern || !c.Body) {
      return undefined;
    }
    const constants = patternConstants(c.Pattern);
    if (constants === undefined) {
      return undefined;
    }
    for (const k of constants) {
      if (seen.has(k)) {
        // "no two clauses name one constant".
        return undefined;
      }
      seen.add(k);
    }
    branches.push({ constants, predicate: c.Body });
  }
  return branches.length > 0 ? { discriminant, branches, form: 'match' } : undefined;
}

/** The constants a clause pattern names: one, or an `or` of them. */
function patternConstants(pattern: ParseNode): readonly string[] | undefined {
  // **(measured)** a constant clause is a `MatchLiteralPattern` carrying its
  // `Literal`, and an `or` is a pattern holding sub-patterns. Both were guessed
  // wrong in a first draft, and the classifier answered "not discriminating" for
  // every form - which is indistinguishable from a working rejecter and is why
  // the shape is measured here rather than inferred.
  const p = pattern as {
    type?: string,
    Literal?: ParseNode,
    Patterns?: readonly ParseNode[],
    MatchPatterns?: readonly ParseNode[],
    Pattern?: ParseNode,
    Left?: ParseNode,
    Right?: ParseNode,
  };
  if (p.type === 'MatchLiteralPattern' && p.Literal) {
    const k = constantOf(p.Literal);
    return k === undefined ? undefined : [k];
  }
  // **(measured)** an `or` is a BINARY `MatchOrPattern` with `Left` and `Right`,
  // not a list - so `'A' or 'B' or 'C'` nests, and the recursion below flattens
  // it. Three shapes were guessed before this one was measured.
  if (p.type === 'MatchOrPattern' && p.Left && p.Right) {
    const left = patternConstants(p.Left);
    const right = patternConstants(p.Right);
    return left === undefined || right === undefined ? undefined : [...left, ...right];
  }
  const alternatives = p.Patterns ?? p.MatchPatterns;
  if (Array.isArray(alternatives)) {
    const out: string[] = [];
    for (const sub of alternatives) {
      const inner = patternConstants(sub);
      if (inner === undefined) {
        return undefined;
      }
      out.push(...inner);
    }
    return out.length > 0 ? out : undefined;
  }
  if (p.Pattern) {
    return patternConstants(p.Pattern);
  }
  const direct = constantOf(pattern);
  return direct === undefined ? undefined : [direct];
}

/**
 * `sec-discriminated-where-chains`: the chain a `where` clause's predicate is,
 * or *undefined* where it discriminates nothing.
 *
 * TOTALITY is deliberately NOT decided here. A chain with no final `else` is
 * total only if its conditions exhaust the discriminant's declared type, and
 * that is a question about the TYPE rather than about the predicate's shape.
 * Reporting the constants and letting the caller compare them against the
 * member's type keeps this operation syntactic, which is the property the
 * specification asks for.
 */
export function DiscriminatingChainOf(clause: ParseNode): DiscriminatingChain | undefined {
  const predicate = (clause as { RefinementPredicate?: ParseNode }).RefinementPredicate;
  if (!predicate) {
    return undefined;
  }
  return classifyConditional(predicate) ?? classifyMatch(predicate);
}

/**
 * `sec-discriminated-where-chains`, `DenotedUnionOf`: the union a qualifying
 * chain DENOTES.
 *
 * "one member per branch, and where a branch tests several constants one member
 * per constant, each the type's base with the discriminant narrowed to the
 * constant tested and with each shape assertion of the branch, `this is T` or
 * `this.p is T`, applied at the asserted path."
 *
 * **The union is a CHECKING artifact and nothing else.** The specification is
 * explicit: "the dependent record type remains one ~parameterized~ Type Record,
 * `Reflect.typeOf` reports it, and assignability compares against it." So this
 * operation RETURNS a union and stores nothing - nothing it builds may reach the
 * type's identity, and a caller that memoized it onto the record would be the
 * way that rule gets broken quietly.
 */
export function DenotedUnionOf(
  chain: DiscriminatingChain,
  base: TypeRecord,
  /** Every constant of the discriminant's declared type, in declaration order. */
  allConstants: readonly string[],
  literalOf: (constant: string) => TypeRecord | undefined,
): TypeRecord | undefined {
  if (base.Kind !== 'object' || allConstants.length === 0) {
    return undefined;
  }
  const members: TypeRecord[] = [];
  const tested = new Set<string>();
  for (const branch of chain.branches) {
    for (const constant of branch.constants) {
      tested.add(constant);
    }
  }
  for (const branch of chain.branches) {
    // **A terminal `else` tests no constant of its own** - it covers whatever
    // the earlier branches did not, so its members are the discriminant's
    // remaining constants. That is why this operation needs the declared
    // constant set and not only the chain: the chain alone cannot say what
    // `else` means.
    const constants = branch.constants.length > 0
      ? branch.constants
      : allConstants.filter((k) => !tested.has(k));
    for (const constant of constants) {
      const narrowed = literalOf(constant);
      if (narrowed === undefined) {
        return undefined;
      }
      members.push(withDiscriminant(base, chain.discriminant, narrowed, branch));
    }
  }
  // TOTALITY, checked here because this is where both the constants tested and
  // the constants declared are in hand: a chain is total when its members cover
  // the declared set. A non-total chain denotes nothing.
  if (members.length !== allConstants.length || members.length < 2) {
    return undefined;
  }
  return { Kind: 'union', Members: members };
}

/** The base with one member's type replaced, plus the branch's assertions. */
function withDiscriminant(
  base: TypeRecord & { Kind: 'object' },
  discriminant: string,
  narrowed: TypeRecord,
  branch: DiscriminatingBranch,
): TypeRecord {
  const properties = base.Properties.map((prop) => (prop.key === discriminant
    ? { ...prop, type: narrowed }
    : prop));
  const asserted = shapeAssertionsOf(branch.predicate);
  for (const [path, type] of asserted) {
    const existing = properties.findIndex((prop) => prop.key === path);
    if (existing >= 0) {
      properties[existing] = { ...properties[existing], type };
    } else {
      properties.push({
        key: path, type, optional: false, readonly: false,
      });
    }
  }
  return { Kind: 'object', Properties: properties, IndexSignatures: base.IndexSignatures };
}

/**
 * The shape assertions a branch predicate makes, as path/type pairs.
 *
 * "a branch predicate that is not a shape assertion refines its member as a
 * `where` of its own and contributes no members" - so anything this does not
 * recognise contributes NOTHING rather than disqualifying the branch. That is
 * the difference between `DiscriminatingChainOf`'s job and this one: it refuses
 * a chain it cannot read, and this ignores a predicate it cannot read.
 */
function shapeAssertionsOf(predicate: ParseNode): readonly [string, TypeRecord][] {
  const out: [string, TypeRecord][] = [];
  const visit = (node: ParseNode | null | undefined): void => {
    const n = node as {
      type?: string,
      RelationalExpression?: ParseNode,
      Type?: ParseNode,
      LogicalANDExpression?: ParseNode,
      BitwiseORExpression?: ParseNode,
    } | null | undefined;
    if (!n) {
      return;
    }
    // A conjunction contributes both sides.
    if (n.type === 'LogicalANDExpression') {
      visit(n.LogicalANDExpression as ParseNode);
      visit(n.BitwiseORExpression as ParseNode);
      return;
    }
    if (n.type !== 'IsExpression' || !n.RelationalExpression || !n.Type) {
      return;
    }
    const target = n.RelationalExpression as { type?: string, IdentifierName?: { name?: string }, MemberExpression?: { type?: string } };
    // `this is T` asserts over the whole value and is applied by the caller's
    // base; `this.p is T` asserts at `p`.
    if (target.type === 'MemberExpression' && target.MemberExpression?.type === 'ThisExpression' && target.IdentifierName?.name) {
      const resolved = resolveAssertedType(n.Type as ParseNode);
      if (resolved) {
        out.push([target.IdentifierName.name, resolved]);
      }
    }
  };
  visit(predicate);
  return out;
}

/** A hook the caller supplies; set by `SetAssertedTypeResolver`. */
let resolveAssertedType: (node: ParseNode) => TypeRecord | undefined = () => undefined;

export function SetAssertedTypeResolver(f: (node: ParseNode) => TypeRecord | undefined): void {
  resolveAssertedType = f;
}
