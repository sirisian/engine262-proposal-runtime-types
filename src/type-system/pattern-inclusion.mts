/**
 * proposal-runtime-types #sec-metadata, R18's decision procedure: "pattern pairs
 * free of backreferences and lookaround, within a fixed automaton size, get the
 * exact language-inclusion answer".
 *
 * Decides L(a) subset-of L(b) as emptiness of a x complement(b): b is
 * determinized, a stays an NFA, and the product is walked for a state that
 * accepts in a and not in b. A single such state is a string a admits and b does
 * not, so a is not a subtype of b.
 *
 * The alphabet is SYMBOLIC. Character classes stay as ranges and are cut into
 * disjoint intervals covering both patterns, plus one interval standing for every
 * code point neither mentions. Expanding a class to its members would not survive
 * `[\\s\\S]` under a Unicode flag, which is a range this design's own kit writes.
 *
 * Construction is a WHITELIST: a node type it does not model returns *undefined*
 * and the caller falls back to the syntactic answer. That is the difference
 * between a weak answer and a wrong one, and only the second is a defect - the
 * clause already provides for pairs that get "the syntactic one".
 */

interface Interval { readonly lo: number, readonly hi: number }

/** An NFA over interval indices, with epsilon edges held separately. */
interface Nfa {
  readonly start: number;
  readonly accept: number;
  /** `moves[state]` maps an interval index to the states it may reach. */
  readonly moves: Map<number, Set<number>>[];
  readonly epsilon: Set<number>[];
}

const MAX_CODE_POINT = 0x10FFFF;

class Builder {
  readonly moves: Map<number, Set<number>>[] = [];

  readonly epsilon: Set<number>[] = [];

  state(): number {
    this.moves.push(new Map());
    this.epsilon.push(new Set());
    return this.moves.length - 1;
  }

  edge(from: number, symbol: number, to: number): void {
    let set = this.moves[from]!.get(symbol);
    if (!set) {
      set = new Set();
      this.moves[from]!.set(symbol, set);
    }
    set.add(to);
  }

  empty(from: number, to: number): void {
    this.epsilon[from]!.add(to);
  }
}

/** Every interval boundary either pattern mentions, cut into disjoint pieces. */
function alphabetOf(ranges: readonly Interval[]): Interval[] {
  const cuts = new Set<number>([0, MAX_CODE_POINT + 1]);
  for (const range of ranges) {
    cuts.add(range.lo);
    cuts.add(range.hi + 1);
  }
  const sorted = [...cuts].filter((c) => c >= 0 && c <= MAX_CODE_POINT + 1).sort((x, y) => x - y);
  const out: Interval[] = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    out.push({ lo: sorted[i]!, hi: sorted[i + 1]! - 1 });
  }
  return out;
}

/** The ranges a node matches, or *undefined* where this construction cannot say. */
function rangesOfClassAtom(node: unknown): Interval[] | undefined {
  const record = node as { type?: string, value?: number, CharacterValue?: number };
  const value = record.CharacterValue ?? record.value;
  if (typeof value === 'number') {
    return [{ lo: value, hi: value }];
  }
  return undefined;
}

/**
 * The code point an Atom :: PatternCharacter stands for. The parser returns the
 * raw character rather than a node here, so this reads a string and not a
 * `CharacterValue` field - which a first attempt assumed, and which made every
 * pattern unmodelled and every answer "no answer".
 */
function patternCharacterValue(node: unknown): number | undefined {
  const raw = (node as { PatternCharacter?: unknown }).PatternCharacter;
  if (typeof raw !== 'string' || raw.length === 0) {
    return undefined;
  }
  return raw.codePointAt(0);
}

export interface InclusionInput {
  readonly source: string;
  readonly flags: string;
  readonly ast: unknown;
}

/**
 * Whether every string `a` admits is a string `b` admits.
 *
 * *undefined* where this construction does not model some part of either
 * pattern, which the caller reads as "no exact answer" and not as "false".
 */
export function DecidesInclusion(a: InclusionInput, b: InclusionInput): boolean | undefined {
  const ranges: Interval[] = [];
  const collect = (node: unknown): boolean => {
    if (!node || typeof node !== 'object') {
      return true;
    }
    if (Array.isArray(node)) {
      return node.every(collect);
    }
    const record = node as { type?: string, production?: string };
    if (record.type === 'ClassAtom') {
      const found = rangesOfClassAtom(record);
      if (!found) {
        return false;
      }
      ranges.push(...found);
    }
    if (record.type === 'Atom' && record.production === 'PatternCharacter') {
      const value = patternCharacterValue(record);
      if (value === undefined) {
        return false;
      }
      ranges.push({ lo: value, hi: value });
    }
    return Object.entries(record).every(([key, child]) => key === 'location' || key === 'parent' || collect(child));
  };
  if (!collect(a.ast) || !collect(b.ast)) {
    return undefined;
  }
  const alphabet = alphabetOf(ranges);
  const left = compile(a.ast, alphabet);
  const right = compile(b.ast, alphabet);
  if (!left || !right) {
    return undefined;
  }
  return !reachesCounterexample(left, right, alphabet.length);
}

/** Thompson's construction over the symbolic alphabet, or *undefined*. */
function compile(ast: unknown, alphabet: readonly Interval[]): Nfa | undefined {
  const builder = new Builder();
  const indicesFor = (ranges: readonly Interval[]): number[] => {
    const out: number[] = [];
    alphabet.forEach((piece, index) => {
      if (ranges.some((range) => piece.lo >= range.lo && piece.hi <= range.hi)) {
        out.push(index);
      }
    });
    return out;
  };

  // Returns [start, accept], or undefined where a node is not modelled.
  const build = (node: unknown): [number, number] | undefined => {
    if (!node || typeof node !== 'object') {
      return undefined;
    }
    const record = node as { type?: string, production?: string, [k: string]: unknown };
    switch (record.type) {
      case 'Pattern':
        return build(record.Disjunction);
      case 'Disjunction': {
        const first = build(record.Alternative);
        if (!first) {
          return undefined;
        }
        if (!record.Disjunction) {
          return first;
        }
        const rest = build(record.Disjunction);
        if (!rest) {
          return undefined;
        }
        const start = builder.state();
        const accept = builder.state();
        builder.empty(start, first[0]);
        builder.empty(start, rest[0]);
        builder.empty(first[1], accept);
        builder.empty(rest[1], accept);
        return [start, accept];
      }
      case 'Alternative': {
        const terms = (record.Terms ?? record.Term ?? []) as unknown[];
        const list = Array.isArray(terms) ? terms : [terms];
        const start = builder.state();
        let cursor = start;
        for (const term of list) {
          const piece = build(term);
          if (!piece) {
            return undefined;
          }
          builder.empty(cursor, piece[0]);
          cursor = piece[1];
        }
        return [start, cursor];
      }
      case 'Term': {
        if (record.production === 'Assertion') {
          const assertion = record.Assertion as { production?: string } | undefined;
          // `^` and `$` are epsilon here: StringPattern's validation is anchored
          // to the whole string already, so they add nothing. Any other
          // assertion - a word boundary among them - is not modelled.
          if (assertion?.production === '^' || assertion?.production === '$') {
            const state = builder.state();
            return [state, state];
          }
          return undefined;
        }
        const atom = build(record.Atom);
        if (!atom) {
          return undefined;
        }
        const quantifier = record.Quantifier as { QuantifierPrefix?: { production?: string } } | undefined;
        if (!quantifier) {
          return atom;
        }
        const kind = quantifier.QuantifierPrefix?.production;
        const start = builder.state();
        const accept = builder.state();
        if (kind === '*') {
          builder.empty(start, atom[0]);
          builder.empty(start, accept);
          builder.empty(atom[1], atom[0]);
          builder.empty(atom[1], accept);
          return [start, accept];
        }
        if (kind === '+') {
          builder.empty(start, atom[0]);
          builder.empty(atom[1], atom[0]);
          builder.empty(atom[1], accept);
          return [start, accept];
        }
        if (kind === '?') {
          builder.empty(start, atom[0]);
          builder.empty(start, accept);
          builder.empty(atom[1], accept);
          return [start, accept];
        }
        // A counted quantifier would need the atom rebuilt per repetition, which
        // this does not do yet.
        return undefined;
      }
      case 'Atom': {
        if (record.production === 'PatternCharacter') {
          const value = patternCharacterValue(record);
          if (value === undefined) {
            return undefined;
          }
          const start = builder.state();
          const accept = builder.state();
          for (const index of indicesFor([{ lo: value, hi: value }])) {
            builder.edge(start, index, accept);
          }
          return [start, accept];
        }
        if (record.production === 'Group') {
          return build(record.Disjunction);
        }
        return undefined;
      }
      default:
        return undefined;
    }
  };

  const built = build(ast);
  if (!built) {
    return undefined;
  }
  return {
    start: built[0], accept: built[1], moves: builder.moves, epsilon: builder.epsilon,
  };
}

function closure(nfa: Nfa, states: Iterable<number>): Set<number> {
  const out = new Set<number>(states);
  const stack = [...out];
  while (stack.length > 0) {
    const state = stack.pop()!;
    for (const next of nfa.epsilon[state]!) {
      if (!out.has(next)) {
        out.add(next);
        stack.push(next);
      }
    }
  }
  return out;
}

function step(nfa: Nfa, states: Set<number>, symbol: number): Set<number> {
  const out = new Set<number>();
  for (const state of states) {
    for (const next of nfa.moves[state]!.get(symbol) ?? []) {
      out.add(next);
    }
  }
  return closure(nfa, out);
}

/** A string `a` accepts and `b` does not, found by walking the product. */
function reachesCounterexample(a: Nfa, b: Nfa, symbols: number): boolean {
  const start: [Set<number>, Set<number>] = [
    closure(a, [a.start]), closure(b, [b.start]),
  ];
  const key = (pair: [Set<number>, Set<number>]) => `${[...pair[0]].sort().join(',')}|${[...pair[1]].sort().join(',')}`;
  const seen = new Set<string>([key(start)]);
  const queue: [Set<number>, Set<number>][] = [start];
  while (queue.length > 0) {
    const [left, right] = queue.shift()!;
    if (left.has(a.accept) && !right.has(b.accept)) {
      return true;
    }
    for (let symbol = 0; symbol < symbols; symbol += 1) {
      const next: [Set<number>, Set<number>] = [step(a, left, symbol), step(b, right, symbol)];
      if (next[0].size === 0) {
        // Nothing `a` still admits down this path, so no counterexample lies
        // beyond it.
        continue;
      }
      const k = key(next);
      if (!seen.has(k)) {
        seen.add(k);
        queue.push(next);
      }
    }
  }
  return false;
}
