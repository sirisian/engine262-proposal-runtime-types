import { tokenizeText, type SourceRefRecord, type TokenRecord } from './TokensOf.mts';
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
  const out: TokenRecord[] = [];
  const span = (start: number, end: number) => ({ Source: source, Start: offset + start, End: offset + end });
  const push = (Kind: TokenRecord['Kind'], Value: string, start: number, end: number, Tokens?: readonly TokenRecord[]) => {
    out.push({
      Kind, Value, Span: span(start, end), Tokens, LineTerminatorBefore: false,
    });
  };
  let i = 0;
  let inTag = false;
  while (i < text.length) {
    const c = text[i];
    // A `{ ... }` substitution holds ECMAScript, wherever it appears - as an
    // attribute value or as a child - so its contents are tokenized as such and
    // handed over as a group, exactly like any other delimited run.
    if (c === '{') {
      const run = ScanBalancedRun(text, i);
      if (run === undefined) {
        push('punctuator', '{', i, i + 1);
        i += 1;
        continue;
      }
      const inner = text.slice(i + 1, run.end - 1);
      push('group', '{', i, run.end, tokenizeText(inner, source, offset + i + 1));
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
      while (j < text.length && text[j] !== c) {
        j += j + 1 < text.length && text[j] === '\\' ? 2 : 1;
      }
      j = Math.min(j + 1, text.length);
      push('string', text.slice(i, j), i, j);
      i = j;
      continue;
    }
    if (isSpace(c)) {
      i += 1;
      continue;
    }
    if (inTag) {
      // A tag or attribute name.
      let j = i;
      while (j < text.length && isNamePart(text[j])) {
        j += 1;
      }
      if (j === i) {
        push('punctuator', c, i, i + 1);
        i += 1;
        continue;
      }
      push('identifier', text.slice(i, j), i, j);
      i = j;
      continue;
    }
    // Child text, up to the next tag or substitution. Kept whole, and trailing
    // whitespace trimmed the way a JSX transform does.
    let j = i;
    while (j < text.length && text[j] !== '<' && text[j] !== '{') {
      j += 1;
    }
    const raw = text.slice(i, j);
    if (raw.trim() !== '') {
      push('string', JSON.stringify(raw.trim()), i, j);
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
