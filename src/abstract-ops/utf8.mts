/**
 * proposal-runtime-types: UTF-8, encoded and decoded exactly.
 *
 * A `string` has no layout, its size being a property of the value rather than
 * of the type, so a string reaching a fixed-width record or a wire format does
 * so as bytes. These are the two conversions, and they are specified here rather
 * than delegated to a host `TextEncoder` because the proposal fixes what they
 * refuse: neither truncates, and neither invents a replacement character.
 *
 * The encoding is UTF-8 and the count is in BYTES. A layout needs a byte count,
 * and UTF-8 is the encoding whose byte count survives a boundary.
 *
 * WELL-FORMED only. A JavaScript string may hold an unpaired surrogate, which
 * has no UTF-8 encoding; a program that wants one converted rather than refused
 * writes `String.prototype.toWellFormed` and says so.
 */

/** A lone surrogate, which no UTF-8 sequence encodes. */
export const UNPAIRED_SURROGATE = Symbol('unpaired-surrogate');

/**
 * The UTF-8 bytes of _text_, or ~UNPAIRED_SURROGATE~ where it holds one.
 *
 * Code points rather than code units: a surrogate PAIR is one four-byte
 * sequence, and reading the string a unit at a time would encode each half
 * separately, which is CESU-8 and not UTF-8.
 */
export function Utf8Encode(text: string): number[] | typeof UNPAIRED_SURROGATE {
  const out: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const unit = text.charCodeAt(i);
    let codePoint = unit;
    if (unit >= 0xD800 && unit <= 0xDBFF) {
      const low = i + 1 < text.length ? text.charCodeAt(i + 1) : NaN;
      if (!(low >= 0xDC00 && low <= 0xDFFF)) {
        return UNPAIRED_SURROGATE;
      }
      codePoint = (unit - 0xD800) * 0x400 + (low - 0xDC00) + 0x10000;
      i += 1;
    } else if (unit >= 0xDC00 && unit <= 0xDFFF) {
      // A trailing surrogate with no leading one before it.
      return UNPAIRED_SURROGATE;
    }
    if (codePoint < 0x80) {
      out.push(codePoint);
    } else if (codePoint < 0x800) {
      out.push(0xC0 | (codePoint >> 6), 0x80 | (codePoint & 0x3F));
    } else if (codePoint < 0x10000) {
      out.push(0xE0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3F), 0x80 | (codePoint & 0x3F));
    } else {
      out.push(
        0xF0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3F),
        0x80 | ((codePoint >> 6) & 0x3F),
        0x80 | (codePoint & 0x3F),
      );
    }
  }
  return out;
}

/** The byte count `Utf8Encode` would produce, without building the bytes. */
export function Utf8Length(text: string): number | typeof UNPAIRED_SURROGATE {
  const bytes = Utf8Encode(text);
  return bytes === UNPAIRED_SURROGATE ? UNPAIRED_SURROGATE : bytes.length;
}

/** Why a byte sequence is not well-formed UTF-8, for a diagnostic. */
export type Utf8FailureReason = 'truncated' | 'overlong' | 'surrogate' | 'out-of-range' | 'continuation' | 'lead';

/**
 * A refusal, WRAPPED so that it cannot be mistaken for a decoded string.
 *
 * The reasons were bare strings in a first cut, which made a failure and a
 * successful decode the same type: `typeof decoded === 'string'` was true for
 * both, so `String.fromUtf8([0xC0, 0x80])` returned the eight-character string
 * "overlong" instead of throwing. A refusal that a caller can spend is worse
 * than no check.
 */
export interface Utf8Failure { readonly failure: Utf8FailureReason; }

function fail(reason: Utf8FailureReason): Utf8Failure {
  return { failure: reason };
}

/**
 * The string _bytes_ encodes, or a reason it is not well-formed UTF-8.
 *
 * STRICT, and the four refusals are the four ways a decoder is usually lax:
 *
 *   - a TRUNCATED sequence, whose continuation bytes run past the end;
 *   - an OVERLONG encoding, `C0 80` for U+0000 being the classic, which lets one
 *     code point have several spellings and is a security bug wherever a filter
 *     runs before a decoder;
 *   - a SURROGATE encoded as three bytes, which is CESU-8 and which would
 *     otherwise let a lone surrogate survive a round trip this refuses to
 *     produce;
 *   - a code point above U+10FFFF, which is not a code point.
 *
 * A zero byte decodes to U+0000 like any other. Trimming padding is a property
 * of a FORMAT rather than of UTF-8, so it belongs to whatever overlays the
 * bytes and not here.
 */
export function Utf8Decode(bytes: readonly number[]): string | Utf8Failure {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const lead = bytes[i];
    let needed: number;
    let codePoint: number;
    if (lead < 0x80) {
      out += String.fromCharCode(lead);
      i += 1;
      continue;
    } else if (lead >= 0xC2 && lead <= 0xDF) {
      needed = 1;
      codePoint = lead & 0x1F;
    } else if (lead >= 0xE0 && lead <= 0xEF) {
      needed = 2;
      codePoint = lead & 0x0F;
    } else if (lead >= 0xF0 && lead <= 0xF4) {
      needed = 3;
      codePoint = lead & 0x07;
    } else if (lead >= 0xC0 && lead <= 0xC1) {
      // The two lead bytes that can only begin an overlong two-byte sequence.
      return fail('overlong');
    } else {
      // A continuation byte where a lead was due, or 0xF5..0xFF.
      return fail('lead');
    }
    // The continuation bytes are at i+1..i+needed, so the last one must be in
    // range. Checked before reading them so a run that stops short reports the
    // truncation rather than a missing continuation byte.
    if (i + needed >= bytes.length) {
      return fail('truncated');
    }
    for (let k = 1; k <= needed; k += 1) {
      const cont = bytes[i + k];
      if (cont === undefined || (cont & 0xC0) !== 0x80) {
        return fail('continuation');
      }
      codePoint = (codePoint << 6) | (cont & 0x3F);
    }
    if (needed === 2 && codePoint < 0x800) {
      return fail('overlong');
    }
    if (needed === 3 && codePoint < 0x10000) {
      return fail('overlong');
    }
    if (codePoint >= 0xD800 && codePoint <= 0xDFFF) {
      return fail('surrogate');
    }
    if (codePoint > 0x10FFFF) {
      return fail('out-of-range');
    }
    if (codePoint < 0x10000) {
      out += String.fromCharCode(codePoint);
    } else {
      const shifted = codePoint - 0x10000;
      out += String.fromCharCode(0xD800 + (shifted >> 10), 0xDC00 + (shifted & 0x3FF));
    }
    i += needed + 1;
  }
  return out;
}
