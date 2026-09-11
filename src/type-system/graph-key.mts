import type { GraphEntry } from './module-graph.mts';

/**
 * proposal-runtime-types #sec-expansion-artifact: an artifact is "keyed by a hash
 * of the module graph that produced it", and "a mismatch re-derives".
 *
 * The clause names how the hash is computed among the things it does not fix,
 * and is silent on the hash's INPUT - which is where interoperability lives. Two
 * producers running one digest over one inventory get different keys if they
 * serialize that inventory differently, and a consumer then reads every current
 * artifact as stale. It fails quietly: the symptom is "artifacts never help"
 * rather than "artifacts are broken".
 *
 * So both are fixed here. The encoding below is canonical, and the digest is
 * SHA-256. Leaving the digest open would buy nothing - the hash is a cache key,
 * not a security mechanism, and the clause says so: "the hash is what makes the
 * trust revocable" - while costing the guarantee that two conforming
 * implementations can read each other's artifacts at all.
 *
 * SHA-256 is IMPLEMENTED rather than imported. This engine imports no host
 * built-ins anywhere, which is what lets it run wherever its embedder does;
 * reaching for a platform's crypto would be the first such import, for a
 * convenience.
 */

const K = /* @__PURE__ */ Uint32Array.from([
  0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5, 0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
  0xD807AA98, 0x12835B01, 0x243185BE, 0x550C7DC3, 0x72BE5D74, 0x80DEB1FE, 0x9BDC06A7, 0xC19BF174,
  0xE49B69C1, 0xEFBE4786, 0x0FC19DC6, 0x240CA1CC, 0x2DE92C6F, 0x4A7484AA, 0x5CB0A9DC, 0x76F988DA,
  0x983E5152, 0xA831C66D, 0xB00327C8, 0xBF597FC7, 0xC6E00BF3, 0xD5A79147, 0x06CA6351, 0x14292967,
  0x27B70A85, 0x2E1B2138, 0x4D2C6DFC, 0x53380D13, 0x650A7354, 0x766A0ABB, 0x81C2C92E, 0x92722C85,
  0xA2BFE8A1, 0xA81A664B, 0xC24B8B70, 0xC76C51A3, 0xD192E819, 0xD6990624, 0xF40E3585, 0x106AA070,
  0x19A4C116, 0x1E376C08, 0x2748774C, 0x34B0BCB5, 0x391C0CB3, 0x4ED8AA4A, 0x5B9CCA4F, 0x682E6FF3,
  0x748F82EE, 0x78A5636F, 0x84C87814, 0x8CC70208, 0x90BEFFFA, 0xA4506CEB, 0xBEF9A3F7, 0xC67178F2,
]);

const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0;

/** SHA-256 of `bytes`, as lowercase hexadecimal. FIPS 180-4. */
export function Sha256(bytes: Uint8Array): string {
  const h = Uint32Array.from([
    0x6A09E667, 0xBB67AE85, 0x3C6EF372, 0xA54FF53A, 0x510E527F, 0x9B05688C, 0x1F83D9AB, 0x5BE0CD19,
  ]);
  // Padding: a one bit, zeroes, then the length in bits as a 64-bit big-endian.
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  // The length fits in 53 bits before it stops being exact, which is far past
  // any source text, so the high word is written from a division rather than
  // with BigInt.
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(padded.length - 4, bitLength >>> 0, false);

  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = [h[0]!, h[1]!, h[2]!, h[3]!, h[4]!, h[5]!, h[6]!, h[7]!];
    for (let i = 0; i < 64; i += 1) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e;
      e = (d + temp1) >>> 0;
      d = c; c = b; b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0; h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0; h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0; h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0; h[7] = (h[7]! + hh) >>> 0;
  }
  let out = '';
  for (const word of h) {
    out += word.toString(16).padStart(8, '0');
  }
  return out;
}

/** UTF-8 bytes of `text`, without reaching for a host encoder. */
function utf8(text: string): number[] {
  const out: number[] = [];
  for (const character of text) {
    const point = character.codePointAt(0)!;
    if (point < 0x80) {
      out.push(point);
    } else if (point < 0x800) {
      out.push(0xC0 | (point >> 6), 0x80 | (point & 0x3F));
    } else if (point < 0x10000) {
      out.push(0xE0 | (point >> 12), 0x80 | ((point >> 6) & 0x3F), 0x80 | (point & 0x3F));
    } else {
      out.push(
        0xF0 | (point >> 18), 0x80 | ((point >> 12) & 0x3F),
        0x80 | ((point >> 6) & 0x3F), 0x80 | (point & 0x3F),
      );
    }
  }
  return out;
}

/**
 * The bytes an inventory hashes to.
 *
 * LENGTH-PREFIXED, not delimited, so that no two inventories can encode alike:
 * `{ specifier: 'a', source: 'bc' }` and `{ specifier: 'ab', source: 'c' }` are
 * different graphs and would be one byte string under any separator a specifier
 * or a source could itself contain.
 *
 * Entries in the order the inventory gives, which is sorted by specifier, so a
 * graph reached in a different order hashes the same.
 */
export function EncodeGraphInventory(inventory: readonly GraphEntry[]): Uint8Array {
  const out: number[] = [];
  const writeLength = (n: number) => {
    out.push((n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF);
  };
  const writeString = (text: string) => {
    const bytes = utf8(text);
    writeLength(bytes.length);
    out.push(...bytes);
  };
  writeLength(inventory.length);
  for (const entry of inventory) {
    writeString(entry.specifier);
    writeString(entry.source);
  }
  return Uint8Array.from(out);
}

/** The key an artifact carries: SHA-256 over the canonical encoding. */
export function GraphKey(inventory: readonly GraphEntry[]): string {
  return `sha256:${Sha256(EncodeGraphInventory(inventory))}`;
}
