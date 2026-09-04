import type { ParseNode } from '../parser/ParseNode.mts';
import { RegExpParser, type RegExpParserContext } from '../parser/RegExpParser.mts';
import {
  type TypeRecord, makePrimitive, libraryTypeRecord,
} from './records.mts';

/**
 * proposal-runtime-types (regexp.md extension): compile-time inference of a
 * regular expression literal's type. A literal `RegExp` has type
 * `RegExp.<Captures, Groups>`, where Captures is a tuple of the capture-group
 * types in source order and Groups is an object type of the named groups. A
 * capture that can fail to participate in a match, an optional group, a group
 * under a zero-minimum quantifier, or a group in an alternation branch that is
 * not taken, is typed `string | undefined`; a capture entered by every matching
 * path is `string`. The analysis is syntactic and reads only the pattern.
 *
 * The Flags argument of the design's `RegExp.<Captures, Groups, Flags>` and the
 * flag-dependent result shapes (the `d`-flag `indices`, the `g`-flag `match`
 * overload) are deferred with the rest of the typed match-result surface, so the
 * inferred type carries the two arguments the common annotation forms use.
 */

type CaptureInfo = { readonly name: string | undefined, readonly optional: boolean };

const stringType: TypeRecord = makePrimitive('string');

const undefinedType: TypeRecord = makePrimitive('undefined');

function stringOrUndefined(optional: boolean): TypeRecord {
  // `undefined`, NOT ~void~ - which is what this function was named for and did
  // not do.
  //
  // The clause said "the union of `string` with the ~void~ type", and ~void~ is
  // the type with NO VALUES, "written to say that a result must not be depended
  // on" (#sec-null-and-undefined-types). A capture no matching path entered
  // holds *undefined*: `/(a)?/.exec("")[1]` is *undefined*, not absent. So
  // `string | void` had no arm that value belongs to, and the declared type of
  // an optional capture could not hold what the capture takes -
  // `let x: string | void = undefined` is refused.
  //
  // The same slip this specification records elsewhere, where resolving
  // `undefined` to ~void~ "made `undefined` unassignable to `undefined`, which
  // took the whole `T | undefined` optional idiom with it". An optional capture
  // IS that idiom.
  return optional ? { Kind: 'union', Members: [stringType, undefinedType] } : stringType;
}

function quantifierAllowsZero(q: ParseNode.RegExp.Quantifier): boolean {
  const p = q.QuantifierPrefix;
  if (p.production === '*' || p.production === '?') {
    return true;
  }
  if (p.production === '{}') {
    return p.DecimalDigits_a === 0;
  }
  // '+' requires at least one repetition
  return false;
}

function walkDisjunction(d: ParseNode.RegExp.Disjunction, skippable: boolean, into: CaptureInfo[]): void {
  // A disjunction with more than one alternative can bypass any one of them, so a
  // group inside any branch may fail to participate.
  const branchSkippable = skippable || d.Disjunction !== undefined;
  walkAlternative(d.Alternative, branchSkippable, into);
  if (d.Disjunction !== undefined) {
    walkDisjunction(d.Disjunction, branchSkippable, into);
  }
}

function walkAlternative(a: ParseNode.RegExp.Alternative, skippable: boolean, into: CaptureInfo[]): void {
  for (const term of a.Term) {
    walkTerm(term, skippable, into);
  }
}

function walkTerm(t: ParseNode.RegExp.Term, skippable: boolean, into: CaptureInfo[]): void {
  if (t.production === 'Assertion') {
    const assertion = t.Assertion;
    // A lookahead or lookbehind wraps a disjunction; a capture inside it does not
    // participate on every matching path, so treat its groups as optional.
    if ('Disjunction' in assertion && assertion.Disjunction !== undefined) {
      walkDisjunction(assertion.Disjunction, true, into);
    }
    return;
  }
  const quantifier = t.Quantifier;
  const atomSkippable = skippable || (quantifier !== undefined && quantifierAllowsZero(quantifier));
  const atom = t.Atom;
  if (atom.production === 'Group') {
    // A capturing group. Its 1-based capture index is the count of capturing
    // parentheses opened before it, plus one.
    const index = atom.leftCapturingParenthesesBefore + 1;
    into[index - 1] = { name: atom.GroupSpecifier, optional: atomSkippable };
    walkDisjunction(atom.Disjunction, atomSkippable, into);
  } else if (atom.production === 'Modifier') {
    // A non-capturing group `(?:...)` or a modifier group `(?ims:...)`.
    walkDisjunction(atom.Disjunction, atomSkippable, into);
  }
  // Other atoms (characters, dots, classes, escapes, backreferences) hold no groups.
}

function contextFor(flags: string): RegExpParserContext {
  if (flags.includes('u')) {
    return { UnicodeMode: true, NamedCaptureGroups: true };
  }
  if (flags.includes('v')) {
    return { UnicodeMode: true, UnicodeSetsMode: true, NamedCaptureGroups: true };
  }
  return { NamedCaptureGroups: true };
}

/**
 * The inferred type of a regular expression literal, or null when the pattern
 * cannot be analyzed (in which case the literal keeps the `any` type). The
 * pattern has already been validated by the main parse, so a parse failure here
 * is not expected and degrades to null rather than throwing.
 */
export function inferRegExpLiteralType(body: string, flags: string): TypeRecord | null {
  let captures: CaptureInfo[];
  try {
    const parser = new RegExpParser(body);
    const pattern = parser.scope(contextFor(flags), () => parser.parsePattern());
    const total = pattern.capturingGroups.length;
    const collected: CaptureInfo[] = new Array(total);
    walkDisjunction(pattern.Disjunction, false, collected);
    // Any position the walk did not reach (it should reach all) defaults to a
    // required capture, which is the sound choice only when the pattern truly
    // enters it; the walk covers every capturing group, so this is a guard.
    captures = [];
    for (let i = 0; i < total; i += 1) {
      captures.push(collected[i] ?? { name: undefined, optional: false });
    }
  } catch {
    return null;
  }

  // The Captures argument: a tuple of the capture types in source order, and for
  // a no-capture pattern the tuple with NO elements.
  //
  // This emitted a dynamic array for the zero-capture case, on the stated ground that "a bare `[]` type denotes a
  // dynamic array here rather than an empty tuple".
  //
  // That was TRUE when written. `[]` was reassigned to the empty tuple a month
  // later - deliberately, on corpus evidence that `[]` in bound position was
  // never written while `[]` meaning the empty tuple appeared about thirty times
  // - and the reassignment swept nothing: one line of spec.emu, no engine
  // change, no mention of regular expressions.
  //
  // So this comment kept a rationale whose ground had moved, and the choice made
  // to let `RegExp.<[], {}>` name a no-capture literal became exactly what
  // refused it, while `RegExp.<[].<any>, {}>` - which no one would write - was
  // what worked.
  const capturesTuple: TypeRecord = {
    Kind: 'tuple',
    Elements: captures.map((c) => ({ Type: stringOrUndefined(c.optional), Rest: false, Initial: 'none' as const })),
  };

  // Group names merge across the captures. A name that appears more than once,
  // which the pattern grammar permits only in separate alternation branches,
  // contributes a single entry that is optional if any occurrence is.
  const byName = new Map<string, boolean>();
  for (const c of captures) {
    if (c.name !== undefined) {
      byName.set(c.name, (byName.get(c.name) ?? false) || c.optional);
    }
  }
  const properties = [...byName.entries()].map(([key, optional]) => ({
    key, type: stringOrUndefined(optional), optional: false, readonly: false,
  }));
  const groupsObject: TypeRecord = { Kind: 'object', Properties: properties, IndexSignatures: [] };

  return libraryTypeRecord('RegExp', [capturesTuple, groupsObject]);
}
