import {
  tokenizeText, SetJSXExpander, type SourceRefRecord, type TokenRecord,
} from './TokensOf.mts';
import { ScanBalancedRun } from './ScanBalancedRun.mts';

// proposal-runtime-types: producing a moded region's tokens.
//
// A region a macro decorates is normally tokenized as ECMAScript. That is
// exactly what a DSL cannot survive - `<div/>` reaches `<` where an expression
// is wanted and the scan stops - so a region whose decoration declared a mode is
// scanned by that mode instead.
//
// The tokens use the EXISTING kinds rather than new ones. A macro already walks
// `identifier`, `punctuator`, `string` and `group`, and a printer already knows
// how to separate them, so a mode that invents kinds would need both taught. A
// JSX tag is punctuation and identifiers; its text is a string; its `{ ... }`
// substitutions are groups whose contents are ORDINARY ECMAScript tokens, which
// is what lets a macro pass an interpolated expression through untouched.

/** Whether _c_ may appear in a JSX tag or attribute name. */
function isNamePart(c: string): boolean {
  return /[A-Za-z0-9_$\-.:]/.test(c);
}

function isSpace(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r';
}

/**
 * Tokenizes _text_ as JSX.
 *
 * Text between tags becomes a `string` token, so a macro sees a child's content
 * as one value rather than as a run of identifiers it would have to rejoin -
 * which is also what makes Deno's `precompile` splitting expressible, since the
 * static parts are already whole.
 */
function tokenizeJSX(text: string, source: SourceRefRecord, offset: number): TokenRecord[] {
  // Whitespace at the REGION's edges is formatting around the expression rather
  // than child content - the region's delimiters are not an element - so it is
  // dropped once, here. Everything after that is emitted RAW, because whitespace
  // BETWEEN children is content: `<p>Hi {name}!</p>` renders a space that no
  // macro could recover if the scanner discarded it.
  const lead = text.length - text.trimStart().length;
  const region = text.trim();
  const base = offset + lead;
  const out: TokenRecord[] = [];
  const span = (start: number, end: number) => ({ Source: source, Start: base + start, End: base + end });
  const push = (Kind: TokenRecord['Kind'], Value: string, start: number, end: number, Tokens?: readonly TokenRecord[]) => {
    out.push({
      Kind, Value, Span: span(start, end), Tokens, LineTerminatorBefore: false,
    });
  };
  let i = 0;
  let inTag = false;
  while (i < region.length) {
    const c = region[i];
    // A `{ ... }` substitution holds ECMAScript, wherever it appears - as an
    // attribute value or as a child - so its contents are tokenized as such and
    // handed over as a group, exactly like any other delimited run.
    if (c === '{') {
      const run = ScanBalancedRun(region, i);
      if (run === undefined) {
        push('punctuator', '{', i, i + 1);
        i += 1;
        continue;
      }
      const inner = region.slice(i + 1, run.end - 1);
      push('group', '{', i, run.end, tokenizeText(inner, source, base + i + 1));
      i = run.end;
      continue;
    }
    if (c === '<' || c === '>' || c === '/' || c === '=') {
      // Tag punctuation. `>` ends a tag, so text after it is a child again.
      push('punctuator', c, i, i + 1);
      if (c === '<') {
        inTag = true;
      } else if (c === '>') {
        inTag = false;
      }
      i += 1;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < region.length && region[j] !== c) {
        j += j + 1 < region.length && region[j] === '\\' ? 2 : 1;
      }
      j = Math.min(j + 1, region.length);
      push('string', region.slice(i, j), i, j);
      i = j;
      continue;
    }
    if (inTag && isSpace(c)) {
      // Insignificant only between a tag's parts. In child position it is
      // content, and falls through to the text branch below.
      i += 1;
      continue;
    }
    if (inTag) {
      // A tag or attribute name.
      let j = i;
      while (j < region.length && isNamePart(region[j])) {
        j += 1;
      }
      if (j === i) {
        push('punctuator', c, i, i + 1);
        i += 1;
        continue;
      }
      push('identifier', region.slice(i, j), i, j);
      i = j;
      continue;
    }
    // Child text, up to the next tag or substitution, emitted whole and
    // UNTRIMMED - including a run that is only whitespace.
    //
    // Trimming here was lossy in a way nothing downstream could repair:
    // `{a} {b}` and `{a}{b}` produced identical streams, and `<p>Hi {name}!</p>`
    // lost the space after `Hi`, so a macro rendered `Hiname!` and could not do
    // otherwise. Which whitespace is significant is JSX's rule rather than the
    // scanner's - a mode says what the tokens ARE, and a macro says what they
    // MEAN - so the rule is applied by whoever consumes them.
    let j = i;
    while (j < region.length && region[j] !== '<' && region[j] !== '{') {
      j += 1;
    }
    if (j > i) {
      push('string', JSON.stringify(region.slice(i, j)), i, j);
    }
    i = j;
  }
  return out;
}

/**
 * The tokens of _text_ in _mode_.
 *
 * An unknown mode is not reached: a mode is validated where its import declares
 * it, so by here it names a scanner.
 */
export function tokenizeModedText(text: string, mode: string, source: SourceRefRecord, offset = 0): readonly TokenRecord[] {
  if (mode !== 'jsx') {
    return tokenizeText(text, source, offset);
  }
  // The range handed over runs from just past the decoration to the region's
  // end, so it may carry a leading `do` before the region's own `{`. Everything
  // up to that brace is ordinary ECMAScript; the brace's CONTENTS are the mode's.
  //
  // Getting this wrong is subtle rather than loud: handing the region's braces
  // to the ECMAScript tokenizer succeeds for simple JSX, because `<div>hi</div>`
  // LEXES as punctuation and identifiers even though it does not parse - so the
  // mode appears to work while the macro receives child text as a run of
  // identifiers it cannot tell from tag names.
  const brace = text.indexOf('{');
  if (brace < 0) {
    return tokenizeText(text, source, offset);
  }
  const out: TokenRecord[] = [];
  const lead = text.slice(0, brace).trim();
  if (lead !== '') {
    out.push(...tokenizeText(lead, source, offset));
  }
  const run = ScanBalancedRun(text, brace);
  const end = run === undefined ? text.length : run.end;
  out.push({
    Kind: 'group',
    Value: '{',
    Span: { Source: source, Start: offset + brace, End: offset + end },
    Tokens: tokenizeJSX(text.slice(brace + 1, Math.max(brace + 1, end - 1)), source, offset + brace + 1),
    LineTerminatorBefore: false,
  });
  return out;
}

// The parse records a JSX element as one span, because its child text is not
// ECMAScript and cannot be tokenized as such. This is how that span becomes the
// element's structure for a macro.
SetJSXExpander((text, source, offset) => tokenizeJSX(text, source, offset));
