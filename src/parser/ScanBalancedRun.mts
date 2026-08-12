// proposal-runtime-types: finding the end of a region the engine does not lex.
//
// A moded region is scanned in a lexical mode that is not ECMAScript, so the
// engine cannot use its own tokenizer to find where the region ends. It needs a
// rule that is small enough to state and to agree on, because THREE things need
// it: entering a mode, the boundary detection replacement already relies on, and
// any editor tooling that has to find the same region (a tree-sitter injection
// needs the host grammar to know the extent without understanding the contents).
//
// The rule: delimiters `()`, `[]`, `{}` balance; string literals, template
// literals and comments are recognised and their contents skipped; nothing else
// is interpreted.
//
// Recognising strings and comments is not optional: a `}` inside either is not a
// delimiter, and a naive brace count ends the region at the wrong place.
//
// A regular expression is deliberately NOT recognised, and that is not an
// oversight. Inside a moded region the contents are not ECMAScript, so `/` is
// whatever the mode says it is - in JSX it opens a closing tag - and a `{` within
// it is a real delimiter. This is the mirror of the ECMAScript-side hazard that
// motivates modes at all: there, `a </{/` scans `/{/` as a regular expression and
// swallows the brace. A scanner cannot serve both readings, which is precisely
// why the region needs a declared mode rather than a cleverer guess.

export interface BalancedRun {
  /** The index just past the closing delimiter. */
  readonly end: number;
}

const OPENERS = '([{';
const CLOSERS = ')]}';

/**
 * Scans from _start_, which must index an opening delimiter, to the matching
 * close.
 *
 * Answers undefined where the delimiters do not balance before the source ends,
 * so the caller can report at the region rather than at the end of the file.
 */
export function ScanBalancedRun(source: string, start: number): BalancedRun | undefined {
  const first = source[start];
  if (first === undefined || !OPENERS.includes(first)) {
    return undefined;
  }
  const stack: string[] = [];
  let i = start;
  while (i < source.length) {
    const c = source[i];
    // A line comment runs to the next line terminator.
    if (c === '/' && source[i + 1] === '/') {
      i += 2;
      while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
        i += 1;
      }
      continue;
    }
    // A block comment runs to its close, and may span lines.
    if (c === '/' && source[i + 1] === '*') {
      const close = source.indexOf('*/', i + 2);
      if (close < 0) {
        return undefined;
      }
      i = close + 2;
      continue;
    }
    // A string literal: its contents are not delimiters.
    if (c === '"' || c === "'") {
      i += 1;
      while (i < source.length) {
        const s = source[i];
        if (s === '\\') {
          i += 2;
          continue;
        }
        i += 1;
        if (s === c) {
          break;
        }
      }
      continue;
    }
    // A template literal, whose `${ ... }` substitutions contain source that DOES
    // balance - `` `${ {a: 1} }` `` must not end at the inner brace. Scanned as a
    // unit rather than by pushing the substitution's brace onto the outer stack,
    // because after a substitution closes the scan is back INSIDE the template
    // and the next backtick is its close, not the start of a new literal.
    if (c === '`') {
      i += 1;
      let closed = false;
      while (i < source.length) {
        const s = source[i];
        if (s === '\\') {
          i += 2;
          continue;
        }
        if (s === '`') {
          i += 1;
          closed = true;
          break;
        }
        if (s === '$' && source[i + 1] === '{') {
          const substitution = ScanBalancedRun(source, i + 1);
          if (substitution === undefined) {
            return undefined;
          }
          i = substitution.end;
          continue;
        }
        i += 1;
      }
      if (!closed) {
        return undefined;
      }
      continue;
    }
    if (OPENERS.includes(c)) {
      stack.push(CLOSERS[OPENERS.indexOf(c)]);
      i += 1;
      continue;
    }
    if (CLOSERS.includes(c)) {
      if (stack.pop() !== c) {
        return undefined;
      }
      i += 1;
      if (stack.length === 0) {
        return { end: i };
      }
      continue;
    }
    i += 1;
  }
  return undefined;
}
