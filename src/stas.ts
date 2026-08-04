// STAS 3.0 token frame parser.
//
// Frame layout (STAS 3 spec v0.2.4 §4):
//
//   <owner> <var2> [FIXED ENGINE OPCODES] OP_RETURN <protoID> <flags> <svc…> <data…>
//
// Only the two leading pushes change across spends; everything after OP_RETURN is
// the data region the engine inspects through the sighash preimage. We reproduce
// the structural probe used by Dxs.Bsv's DstasLockingScriptParser and extend it
// with the v0.2.4 capability bits (NFT / AUGMENTABLE) and the var2 sub-formats.

import { hash160ToAddress, bytesToHex, hexToBytes } from "./api";

const OP_0 = 0x00;
const OP_PUSHDATA1 = 0x4c;
const OP_PUSHDATA2 = 0x4d;
const OP_PUSHDATA4 = 0x4e;
const OP_1NEGATE = 0x4f;
const OP_1 = 0x51;
const OP_16 = 0x60;
const OP_RETURN = 0x6a;

interface Token {
  op: number;
  /** Payload of a data push; empty for non-push opcodes. */
  bytes: Uint8Array;
  /** True for OP_0 and the direct/PUSHDATA push family (i.e. §5.1 "single push op"). */
  push: boolean;
  /** Byte offset of the opcode within the script. */
  at: number;
}

function tokenize(script: Uint8Array): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  while (i < script.length) {
    const at = i;
    const op = script[i++];
    if (op === OP_0) {
      out.push({ op, bytes: new Uint8Array(0), push: true, at });
      continue;
    }
    if (op < OP_PUSHDATA1) {
      if (i + op > script.length) return null;
      out.push({ op, bytes: script.slice(i, i + op), push: true, at });
      i += op;
      continue;
    }
    if (op === OP_PUSHDATA1 || op === OP_PUSHDATA2 || op === OP_PUSHDATA4) {
      const width = op === OP_PUSHDATA1 ? 1 : op === OP_PUSHDATA2 ? 2 : 4;
      if (i + width > script.length) return null;
      let len = 0;
      for (let k = 0; k < width; k++) len |= script[i + k] << (8 * k);
      i += width;
      if (len < 0 || i + len > script.length) return null;
      out.push({ op, bytes: script.slice(i, i + len), push: true, at });
      i += len;
      continue;
    }
    out.push({ op, bytes: new Uint8Array(0), push: false, at });
  }
  return out;
}

/** Values OP_1NEGATE / OP_1…OP_16 put on the stack, as var2 would carry them. */
function smallIntBytes(op: number): Uint8Array | null {
  if (op === OP_1NEGATE) return new Uint8Array([0x81]);
  if (op >= OP_1 && op <= OP_16) return new Uint8Array([op - OP_1 + 1]);
  return null;
}

export type Var2Action =
  | { kind: "passive"; note?: string }
  | { kind: "swap"; requestedScriptHash: string; receiveAddr: string | null; rateNumerator: number; rateDenominator: number }
  | { kind: "directive"; data: string }
  | { kind: "unknown"; action: number };

export interface StasFlags {
  raw: string;
  freezable: boolean;
  confiscatable: boolean;
  nft: boolean;
  augmentable: boolean;
}

export interface StasFrame {
  owner: string;
  ownerAddress: string | null;
  /** HASH160("") — the frame's signature check is disabled (§5.1). */
  ownerUnlocked: boolean;
  frozen: boolean;
  var2: Var2Action;
  flags: StasFlags;
  protoId: string;
  protoAddress: string | null;
  freezeAuth: string | null;
  confiscateAuth: string | null;
  /** Issuer payload pushes after the service fields (§5.2.4). */
  payloads: string[];
  payloadText: string | null;
  payloadJson: any | null;
  /** Size of the fixed engine region (§15.6 lists ~2.9-3.2 kB across revisions). */
  engineBytes: number;
}

/** HASH160 of the empty string — owner value that disables signature verification. */
const NULL_OWNER = "b472a266d0bd89c13706a4132ccfb16f7c3b9fcb";

function decodeUtf8(b: Uint8Array): string | null {
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(b);
    // reject control-character soup so binary payloads don't render as mojibake
    return /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s) ? null : s;
  } catch {
    return null;
  }
}

function parseVar2(raw: Uint8Array): { action: Var2Action; frozen: boolean } {
  // §6.2: the freeze operation prepends 0x02 to the pushed bytes. A bare OP_2
  // (handled by the caller via smallIntBytes) is the frozen form of an empty var2.
  let frozen = false;
  let body = raw;
  if (body.length > 1 && body[0] === 0x02) {
    frozen = true;
    body = body.slice(1);
  } else if (body.length === 1 && body[0] === 0x02) {
    return { action: { kind: "passive" }, frozen: true };
  }

  if (body.length === 0) return { action: { kind: "passive" }, frozen };

  const action = body[0];
  if (action === 0x00) {
    const note = body.length > 1 ? decodeUtf8(body.slice(1)) : null;
    return { action: { kind: "passive", note: note || undefined }, frozen };
  }
  if (action === 0x01 && body.length >= 61) {
    const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
    return {
      action: {
        kind: "swap",
        requestedScriptHash: bytesToHex(body.slice(1, 33)),
        receiveAddr: hash160ToAddress(bytesToHex(body.slice(33, 53))),
        rateNumerator: dv.getUint32(53, true),
        rateDenominator: dv.getUint32(57, true),
      },
      frozen,
    };
  }
  if (action === 0x03 && body.length >= 2) {
    // §6.4 / §15.2: the next spend must append this data to the token script.
    const data = body.slice(1);
    return { action: { kind: "directive", data: decodeUtf8(data) || bytesToHex(data) }, frozen };
  }
  return { action: { kind: "unknown", action }, frozen };
}

/**
 * Parse a locking script as a STAS 3.0 frame. Returns null for anything that is
 * not shaped like one (P2PKH, OP_RETURN data carriers, arbitrary scripts …).
 */
export function parseStas(lockingScript: string): StasFrame | null {
  if (!lockingScript || !/^[0-9a-fA-F]*$/.test(lockingScript) || lockingScript.length % 2) return null;
  // The engine alone is ~3 kB; anything much smaller cannot be a token frame.
  if (lockingScript.length < 2 * 1000) return null;

  const script = hexToBytes(lockingScript);
  const tokens = tokenize(script);
  if (!tokens || tokens.length < 18) return null;

  // 1. owner — a non-empty data push (§5.1).
  const t0 = tokens[0];
  if (!t0.push || t0.bytes.length !== 20) return null;
  const owner = bytesToHex(t0.bytes);

  // 2. var2 — a single push op; the small-int opcodes are pushes too.
  const t1 = tokens[1];
  let var2Raw: Uint8Array | null = t1.push ? t1.bytes : smallIntBytes(t1.op);
  if (var2Raw === null) return null;

  // 3. engine … OP_RETURN. The engine must actually be an opcode body, so the
  //    OP_RETURN cannot sit right behind var2.
  const opReturnIdx = tokens.findIndex((t, i) => i >= 2 && t.op === OP_RETURN && !t.push);
  if (opReturnIdx < 16) return null;
  const engineBytes = tokens[opReturnIdx].at - tokens[2].at;

  // 4. data region.
  const rest = tokens.slice(opReturnIdx + 1);
  if (rest.length < 1) return null;
  const protoTok = rest[0];
  if (!protoTok.push || protoTok.bytes.length !== 20) return null;
  const protoId = bytesToHex(protoTok.bytes);

  // flags: a push, an OP_0/absent field, or a small-int opcode (§5.2.2, §15.5).
  let flagsBytes = new Uint8Array(0);
  let cursor = 1;
  if (rest.length > 1) {
    const f = rest[1];
    const small = f.push ? null : smallIntBytes(f.op);
    if (f.push) { flagsBytes = f.bytes; cursor = 2; }
    else if (small) { flagsBytes = small; cursor = 2; }
    else return null;
  }
  // §15.5: a multi-byte flags field is read by its LAST byte at every site.
  const flagByte = flagsBytes.length > 0 ? flagsBytes[flagsBytes.length - 1] : 0;
  const flags: StasFlags = {
    raw: flagsBytes.length ? bytesToHex(flagsBytes) : "00",
    freezable: (flagByte & 0x01) !== 0,
    confiscatable: (flagByte & 0x02) !== 0,
    nft: (flagByte & 0x04) !== 0,
    // bit 3 is meaningful only together with the NFT bit (§15.2)
    augmentable: (flagByte & 0x08) !== 0 && (flagByte & 0x04) !== 0,
  };

  // service fields, in increasing flag-bit order (§5.2.3)
  const expectedSvc = (flags.freezable ? 1 : 0) + (flags.confiscatable ? 1 : 0);
  const svc: string[] = [];
  while (svc.length < expectedSvc) {
    const t = rest[cursor];
    if (!t || !t.push || t.bytes.length !== 20) return null;
    svc.push(bytesToHex(t.bytes));
    cursor++;
  }

  const payloadTokens = rest.slice(cursor).filter((t) => t.push && t.bytes.length > 0);
  const payloads = payloadTokens.map((t) => bytesToHex(t.bytes));
  const payloadText = payloadTokens.length ? decodeUtf8(payloadTokens[0].bytes) : null;
  let payloadJson: any = null;
  if (payloadText) {
    const trimmed = payloadText.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try { payloadJson = JSON.parse(trimmed); } catch { /* plain text payload */ }
    }
  }

  const { action, frozen } = parseVar2(var2Raw);

  return {
    owner,
    ownerAddress: hash160ToAddress(owner),
    ownerUnlocked: owner === NULL_OWNER,
    frozen,
    var2: action,
    flags,
    protoId,
    protoAddress: hash160ToAddress(protoId),
    freezeAuth: flags.freezable ? svc[0] ?? null : null,
    confiscateAuth: flags.confiscatable ? svc[flags.freezable ? 1 : 0] ?? null : null,
    payloads,
    payloadText,
    payloadJson,
    engineBytes,
  };
}

/** Short human label for the token class, e.g. "NFT" / "トークン". */
export const stasKind = (f: StasFrame): string => (f.flags.nft ? "NFT" : "トークン");

/** Name/symbol/image lifted from a JSON payload, when the issuer supplies one. */
export function stasMeta(f: StasFrame): { name?: string; symbol?: string; image?: string; description?: string } {
  const j = f.payloadJson;
  if (!j || typeof j !== "object") return {};
  const bag = (j.token ?? j.tokenSchema ?? j) as any;
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = bag?.[k] ?? j?.[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return undefined;
  };
  return {
    name: pick("name", "tokenName", "title"),
    symbol: pick("symbol", "ticker", "symbolId"),
    description: pick("description", "desc"),
    image: pick("image", "imageUrl", "icon", "media"),
  };
}
