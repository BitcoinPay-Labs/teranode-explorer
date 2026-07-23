// All calls go through the indexer, which proxies the Teranode Asset API
// (CORS-enabled) and adds the address index that Teranode itself lacks.
export const INDEXER: string =
  (import.meta as any).env?.VITE_INDEXER || "http://162.43.7.61:18101";
export const NETWORK_LABEL: string =
  (import.meta as any).env?.VITE_NETWORK || "Teratestnet";

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
  recentBlocks: (limit = 20): Promise<{ data: BlockRow[]; pagination: any }> =>
    j(`/asset/blocks?limit=${limit}`),
  blockHashByHeight: (h: number): Promise<{ height: number; hash: string }> =>
    j(`/blockhash/${h}`),
  blockByHash: (hash: string) => j(`/asset/block/${hash}/json`),
  tx: (txid: string) => j(`/asset/tx/${txid}/json`),
  balance: (addr: string) => j(`/address/${addr}/balance`),
  unspent: (addr: string) => j(`/address/${addr}/unspent`),
  history: (addr: string) => j(`/address/${addr}/history`),
};

export const BSV = (sats: number) =>
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
