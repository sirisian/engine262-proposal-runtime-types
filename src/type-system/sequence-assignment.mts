// Distributing a sequence of items among a sequence of slots.
//
// proposal-runtime-types #sec-sequenceassignment. A parameter list, and a
// tuple's element list, is a REGULAR PATTERN over a sequence: a fixed slot is
// one item, an optional slot is one or none, and a rest is zero or more. The
// assignment is the leftmost-greedy match with backtracking, which is what the
// design means by taking arguments "greedily and given back to satisfy
// signatures" - a slot takes as many items as it can and yields one at a time
// until the slots after it can be satisfied.
//
// One operation serves both callers, which is the point of the clause defining
// it once: a tuple's membership and a call's binding cannot disagree about
// which run belongs to which rest if they ask the same question.

/**
 * One position in the pattern. A slot whose `Rest` is true takes zero or more
 * items, one whose `Optional` is true takes one or none, and any other takes
 * exactly one.
 */
export interface Slot {
  readonly Rest: boolean;
  readonly Optional: boolean;
}

/**
 * Reports whether the item at `itemIndex` may be taken by the slot at
 * `slotIndex`.
 *
 * The clause writes this as a closure over the slot RECORD. It takes the slot's
 * INDEX here, which agrees and is safer: a caller whose slots are equal records
 * - two rests of one type, which is precisely the design's worked example -
 * cannot tell them apart from the record alone, and would answer for the wrong
 * one.
 */
export type Admits = (itemIndex: number, slotIndex: number) => boolean;

/**
 * Distribute `n` items among `slots`, returning how many each takes, or
 * `'unmatched'` where no distribution admits every item.
 *
 * The result is DETERMINISTIC and is the specification's: because the search
 * takes the greatest count first at each slot in turn, the assignment returned
 * is the greatest in the lexicographic order on the count lists. The clause
 * permits any method that agrees with that, which is what lets this memoize.
 *
 * Memoization is not an optimization here but a bound: the naive recursion is
 * exponential in the number of rests, and a signature is a thing a program
 * writes, so nothing stops it having several. Keyed on (slot index, item
 * index), the search visits each state once, which is O(slots x items) states.
 */
export function SequenceAssignment(slots: readonly Slot[], n: number, admits: Admits): number[] | 'unmatched' {
  // A state is (k, i): the slots from k onward against the items from i to n.
  // The result depends on nothing else, since `slots`, `n`, and `admits` are
  // fixed for the call, which is what makes the memo sound.
  const memo = new Map<number, number[] | null>();
  const solve = (k: number, i: number): number[] | null => {
    if (k === slots.length) {
      // Every slot has taken its share; the match holds only if the items ran
      // out at the same moment.
      return i === n ? [] : null;
    }
    const key = k * (n + 1) + i;
    const seen = memo.get(key);
    if (seen !== undefined) {
      return seen;
    }
    const slot = slots[k];
    // The most this slot could take: items it admits, consecutively from i, and
    // never more than one unless it is a rest.
    let limit = 0;
    while (i + limit < n && admits(i + limit, k) && (slot.Rest || limit < 1)) {
      limit += 1;
    }
    const least = (slot.Rest || slot.Optional) ? 0 : 1;
    let result: number[] | null = null;
    for (let m = limit; m >= least; m -= 1) {
      const tail = solve(k + 1, i + m);
      if (tail !== null) {
        result = [m, ...tail];
        break;
      }
    }
    memo.set(key, result);
    return result;
  };
  return solve(0, 0) ?? 'unmatched';
}

/**
 * The index of the slot that receives the item at `index` under an assignment,
 * or -1 where no slot does.
 *
 * The callers ask two questions of one assignment - "how many did each take"
 * and "which one took this item" - and computing the second from the first here
 * keeps them from drifting.
 */
export function slotReceiving(counts: readonly number[], index: number): number {
  let seen = 0;
  for (let k = 0; k < counts.length; k += 1) {
    seen += counts[k];
    if (index < seen) {
      return k;
    }
  }
  return -1;
}
