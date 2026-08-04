// All calls go through the indexer, which proxies the Teranode Asset API
// (CORS-enabled) and adds the address index that Teranode itself lacks.
export const INDEXER: string =
  (import.meta as any).env?.VITE_INDEXER || "http://162.43.7.61:18101";
export const NETWORK_LABEL: string =
  (import.meta as any).env?.VITE_NETWORK || "Teratestnet";
export const APP_TITLE: string =
  (import.meta as any).env?.VITE_APP_TITLE || "Teranode Explorer";
// ヘッダーのロゴ文字。空文字列を明示指定すると非表示
export const LOGO: string =
  (import.meta as any).env?.VITE_LOGO ?? "◆";
export const SYMBOL: string =
  (import.meta as any).env?.VITE_SYMBOL || "BSV";
// satoshi→表示単位の除数。BSV=1e8、JPYS など satoshi 建て表示なら 1
export const SAT_PER_UNIT: number =
  Number((import.meta as any).env?.VITE_SAT_PER_UNIT || 1e8);

async function j<T = any>(path: string): Promise<T> {
  const r = await fetch(INDEXER + path);
  if (!r.ok) throw new Error((await r.text()) || r.statusText);
  return r.json();
}

export interface BlockRow {
  height: number; hash: string; previousblockhash: string;
  coinbaseValue: number; timestamp: string; transactionCount: number;
  size: number; miner: string;
}

export const api = {
  chainInfo: () => j("/chain/info"),
  recentBlocks: (limit = 20, offset = 0): Promise<{ data: BlockRow[]; pagination: any }> =>
    j(`/asset/blocks?limit=${limit}&offset=${offset}`),
  blockHashByHeight: (h: number): Promise<{ height: number; hash: string }> =>
    j(`/blockhash/${h}`),
  blockByHash: (hash: string) => j(`/asset/block/${hash}/json`),
  tx: (txid: string) => j(`/asset/tx/${txid}/json`),
  balance: (addr: string) => j(`/address/${addr}/balance`),
  unspent: (addr: string) => j(`/address/${addr}/unspent`),
  history: (addr: string) => j(`/address/${addr}/history`),
};

export const fmtAmount = (sats: number) =>
  (sats / SAT_PER_UNIT).toLocaleString(undefined, { maximumFractionDigits: 8 });

// ブロック報酬など、表示単位に関係なく常に BSV 建てで見せたい箇所用
export const fmtBsv = (sats: number) =>
  (sats / 1e8).toLocaleString(undefined, { maximumFractionDigits: 8 });

export type Query =
  | { kind: "height"; value: number }
  | { kind: "hash"; value: string }
  | { kind: "address"; value: string };

export function classify(qRaw: string): Query {
  const q = qRaw.trim();
  if (/^\d+$/.test(q)) return { kind: "height", value: parseInt(q, 10) };
  if (/^[0-9a-fA-F]{64}$/.test(q)) return { kind: "hash", value: q.toLowerCase() };
  return { kind: "address", value: q };
}

// ---- script / address helpers -------------------------------------------

// Teratestnet uses testnet address encoding (P2PKH version byte 0x6f).
const P2PKH_VERSION = 0x6f;
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function sha256(data: Uint8Array): Uint8Array {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const len = data.length;
  const padded = new Uint8Array(((len + 8) >> 6 << 6) + 64);
  padded.set(data);
  padded[len] = 0x80;
  const bitLen = len * 8;
  new DataView(padded.buffer).setUint32(padded.length - 4, bitLen >>> 0);
  new DataView(padded.buffer).setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  const w = new Uint32Array(64);
  const rr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    const dv = new DataView(padded.buffer, off, 64);
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) new DataView(out.buffer).setUint32(i * 4, H[i]);
  return out;
}

export const hexToBytes = (hex: string): Uint8Array => {
  const b = new Uint8Array(hex.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return b;
};

export const bytesToHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function base58check(payload: Uint8Array): string {
  const chk = sha256(sha256(payload)).slice(0, 4);
  const full = new Uint8Array(payload.length + 4);
  full.set(payload); full.set(chk, payload.length);
  let n = 0n;
  for (const byte of full) n = (n << 8n) | BigInt(byte);
  let s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const byte of full) { if (byte === 0) s = "1" + s; else break; }
  return s;
}

/** 20-byte HASH160 (hex) → testnet address. */
export function hash160ToAddress(h160: string): string | null {
  if (!/^[0-9a-fA-F]{40}$/.test(h160 || "")) return null;
  const payload = new Uint8Array(21);
  payload[0] = P2PKH_VERSION;
  payload.set(hexToBytes(h160), 1);
  return base58check(payload);
}

/** P2PKH lockingScript → testnet address; null for non-standard scripts. */
export function scriptToAddress(lockingScript: string): string | null {
  const m = /^76a914([0-9a-fA-F]{40})88ac$/.exec(lockingScript || "");
  return m ? hash160ToAddress(m[1]) : null;
}

/** Extract the human-readable miner tag from a coinbase unlockingScript. */
export function coinbaseTag(unlockingScript: string): string {
  try {
    const bytes = hexToBytes(unlockingScript);
    // skip BIP34 height push: first byte is the push length
    const skip = 1 + (bytes[0] ?? 0);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(skip));
    const cleaned = text.replace(/[\u0000-\u001f\u007f\ufffd]/g, "").trim();
    // the tag conventionally sits between the last pair of slashes
    const m = /\/.*\//.exec(cleaned);
    return (m ? m[0] : cleaned) || "-";
  } catch {
    return "-";
  }
}

export const isCoinbaseInput = (i: any): boolean =>
  /^0{64}$/.test(i?.txid || "") || i?.vout === 0xffffffff;
