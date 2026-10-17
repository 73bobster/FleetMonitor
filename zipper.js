// ZIP writer for the exit pack. Entries are stored (no compression): documents and spreadsheets are already compressed.
// With a passphrase every entry is encrypted with WinZip AES-256 (AE-2), which 7-Zip, WinZip, Keka and The Unarchiver open.
// (The built-in Windows Explorer cannot open AES zips; the README says to use 7-Zip.)
// Key derivation and the integrity code use the browser's WebCrypto; AES itself is below because WebCrypto's CTR mode
// counts big-endian and the zip format counts little-endian.
import { crc32 } from './exports.js';

const enc = new TextEncoder();

// ---- AES-256 block encryption (FIPS 197), table based ------------------------------------
const SBOX = new Uint8Array(256);
const T0 = new Uint32Array(256); const T1 = new Uint32Array(256); const T2 = new Uint32Array(256); const T3 = new Uint32Array(256);
(() => {
  let p = 1; let q = 1;
  do {                                                  // walk the multiplicative group of GF(2^8) to build the S-box
    p = p ^ ((p << 1) & 0xFF) ^ (p & 0x80 ? 0x1B : 0);
    q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xFF; if (q & 0x80) q ^= 0x09;
    const x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4));
    SBOX[p] = (x ^ 0x63) & 0xFF;
  } while (p !== 1);
  SBOX[0] = 0x63;
  const mul2 = (a) => ((a << 1) ^ (a & 0x80 ? 0x11B : 0)) & 0xFF;
  for (let i = 0; i < 256; i++) {
    const s = SBOX[i]; const s2 = mul2(s); const s3 = s2 ^ s;
    const w = ((s2 << 24) | (s << 16) | (s << 8) | s3) >>> 0;
    T0[i] = w; T1[i] = ((w >>> 8) | (w << 24)) >>> 0; T2[i] = ((w >>> 16) | (w << 16)) >>> 0; T3[i] = ((w >>> 24) | (w << 8)) >>> 0;
  }
})();

function expandKey(key) {                               // 32-byte key -> 60 round-key words
  const w = new Uint32Array(60);
  for (let i = 0; i < 8; i++) w[i] = ((key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3]) >>> 0;
  let rcon = 1;
  for (let i = 8; i < 60; i++) {
    let t = w[i - 1];
    if (i % 8 === 0) {
      t = ((SBOX[(t >>> 16) & 0xFF] << 24) | (SBOX[(t >>> 8) & 0xFF] << 16) | (SBOX[t & 0xFF] << 8) | SBOX[t >>> 24]) ^ (rcon << 24);
      rcon = ((rcon << 1) ^ (rcon & 0x80 ? 0x11B : 0)) & 0xFF;
    } else if (i % 8 === 4) {
      t = (SBOX[t >>> 24] << 24) | (SBOX[(t >>> 16) & 0xFF] << 16) | (SBOX[(t >>> 8) & 0xFF] << 8) | SBOX[t & 0xFF];
    }
    w[i] = (w[i - 8] ^ t) >>> 0;
  }
  return w;
}
// Encrypts the 16-byte block in `blk` (Uint8Array) in place.
function encryptBlock(rk, blk) {
  let s0 = (((blk[0] << 24) | (blk[1] << 16) | (blk[2] << 8) | blk[3]) ^ rk[0]) >>> 0;
  let s1 = (((blk[4] << 24) | (blk[5] << 16) | (blk[6] << 8) | blk[7]) ^ rk[1]) >>> 0;
  let s2 = (((blk[8] << 24) | (blk[9] << 16) | (blk[10] << 8) | blk[11]) ^ rk[2]) >>> 0;
  let s3 = (((blk[12] << 24) | (blk[13] << 16) | (blk[14] << 8) | blk[15]) ^ rk[3]) >>> 0;
  let k = 4;
  for (let r = 1; r < 14; r++, k += 4) {
    const t0 = T0[s0 >>> 24] ^ T1[(s1 >>> 16) & 0xFF] ^ T2[(s2 >>> 8) & 0xFF] ^ T3[s3 & 0xFF] ^ rk[k];
    const t1 = T0[s1 >>> 24] ^ T1[(s2 >>> 16) & 0xFF] ^ T2[(s3 >>> 8) & 0xFF] ^ T3[s0 & 0xFF] ^ rk[k + 1];
    const t2 = T0[s2 >>> 24] ^ T1[(s3 >>> 16) & 0xFF] ^ T2[(s0 >>> 8) & 0xFF] ^ T3[s1 & 0xFF] ^ rk[k + 2];
    const t3 = T0[s3 >>> 24] ^ T1[(s0 >>> 16) & 0xFF] ^ T2[(s1 >>> 8) & 0xFF] ^ T3[s2 & 0xFF] ^ rk[k + 3];
    s0 = t0 >>> 0; s1 = t1 >>> 0; s2 = t2 >>> 0; s3 = t3 >>> 0;
  }
  const o0 = ((SBOX[s0 >>> 24] << 24) | (SBOX[(s1 >>> 16) & 0xFF] << 16) | (SBOX[(s2 >>> 8) & 0xFF] << 8) | SBOX[s3 & 0xFF]) ^ rk[k];
  const o1 = ((SBOX[s1 >>> 24] << 24) | (SBOX[(s2 >>> 16) & 0xFF] << 16) | (SBOX[(s3 >>> 8) & 0xFF] << 8) | SBOX[s0 & 0xFF]) ^ rk[k + 1];
  const o2 = ((SBOX[s2 >>> 24] << 24) | (SBOX[(s3 >>> 16) & 0xFF] << 16) | (SBOX[(s0 >>> 8) & 0xFF] << 8) | SBOX[s1 & 0xFF]) ^ rk[k + 2];
  const o3 = ((SBOX[s3 >>> 24] << 24) | (SBOX[(s0 >>> 16) & 0xFF] << 16) | (SBOX[(s1 >>> 8) & 0xFF] << 8) | SBOX[s2 & 0xFF]) ^ rk[k + 3];
  blk[0] = o0 >>> 24; blk[1] = o0 >>> 16; blk[2] = o0 >>> 8; blk[3] = o0;
  blk[4] = o1 >>> 24; blk[5] = o1 >>> 16; blk[6] = o1 >>> 8; blk[7] = o1;
  blk[8] = o2 >>> 24; blk[9] = o2 >>> 16; blk[10] = o2 >>> 8; blk[11] = o2;
  blk[12] = o3 >>> 24; blk[13] = o3 >>> 16; blk[14] = o3 >>> 8; blk[15] = o3;
}
export const aesEncryptBlock = (key32, block16) => { const b = Uint8Array.from(block16); encryptBlock(expandKey(key32), b); return b; };   // for tests

// WinZip CTR: a 16-byte little-endian counter starting at 1, keystream XORed over the data.
function ctrXor(key, data) {
  const rk = expandKey(key); const out = new Uint8Array(data.length);
  const ctr = new Uint8Array(16); const ks = new Uint8Array(16);
  for (let off = 0, n = 1; off < data.length; off += 16, n++) {
    ctr[0] = n & 0xFF; ctr[1] = (n >>> 8) & 0xFF; ctr[2] = (n >>> 16) & 0xFF; ctr[3] = (n >>> 24) & 0xFF;
    ks.set(ctr); encryptBlock(rk, ks);
    const m = Math.min(16, data.length - off);
    for (let i = 0; i < m; i++) out[off + i] = data[off + i] ^ ks[i];
  }
  return out;
}

async function aesEntry(data, password) {
  const subtle = globalThis.crypto.subtle;
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const base = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 1000, hash: 'SHA-1' }, base, 8 * 66));
  const encKey = bits.slice(0, 32); const macKey = bits.slice(32, 64); const verifier = bits.slice(64, 66);
  const cipher = ctrXor(encKey, data);
  const hk = await subtle.importKey('raw', macKey, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const auth = new Uint8Array(await subtle.sign('HMAC', hk, cipher)).slice(0, 10);
  const out = new Uint8Array(16 + 2 + cipher.length + 10);
  out.set(salt, 0); out.set(verifier, 16); out.set(cipher, 18); out.set(auth, 18 + cipher.length);
  return out;
}

const u16 = (v) => [v & 0xFF, (v >>> 8) & 0xFF];
const u32 = (v) => [v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF];

// files: [{ name, data: Uint8Array }]. Returns a Uint8Array. Passphrase optional.
export async function buildZip(files, { password = '', date = new Date(), onProgress } = {}) {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const parts = []; const central = []; let offset = 0; let done = 0;
  const total = files.reduce((s, f) => s + f.data.length, 0);
  if (total > 3.5 * 1024 ** 3 || files.length > 65000) throw new Error('This pack is too large for a single zip file. Download it again without the uploaded documents.');
  const extra = Uint8Array.from([...u16(0x9901), ...u16(7), ...u16(2), 0x41, 0x45, 3, ...u16(0)]);   // AES extra field: AE-2, "AE", 256-bit, method stored
  for (const f of files) {
    const name = enc.encode(f.name);
    let body = f.data; let crc = crc32(f.data); let method = 0; let flags = 0x0800; let ext = new Uint8Array(0); let version = 20;
    if (password) { body = await aesEntry(f.data, password); crc = 0; method = 99; flags |= 1; ext = extra; version = 51; }
    const local = Uint8Array.from([...u32(0x04034b50), ...u16(version), ...u16(flags), ...u16(method), ...u16(dosTime), ...u16(dosDate), ...u32(crc), ...u32(body.length), ...u32(f.data.length), ...u16(name.length), ...u16(ext.length)]);
    parts.push(local, name, ext, body);
    central.push(Uint8Array.from([...u32(0x02014b50), ...u16(version), ...u16(version), ...u16(flags), ...u16(method), ...u16(dosTime), ...u16(dosDate), ...u32(crc), ...u32(body.length), ...u32(f.data.length), ...u16(name.length), ...u16(ext.length), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), name, ext);
    offset += local.length + name.length + ext.length + body.length;
    done += f.data.length; onProgress?.(done, total);
    if (password) await new Promise((r) => setTimeout(r, 0));   // let the page breathe between files
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = Uint8Array.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}
