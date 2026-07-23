import { useEffect, useState, useCallback } from "react";
import {
  api, BSV, classify, NETWORK_LABEL, BlockRow,
  scriptToAddress, coinbaseTag, isCoinbaseInput,
} from "./api";

type Route =
  | { v: "home" }
  | { v: "block"; hash: string }
  | { v: "tx"; txid: string }
  | { v: "address"; addr: string };

function parseHash(): Route {
  const h = location.hash.replace(/^#\/?/, "");
  const [kind, ...rest] = h.split("/");
  const arg = decodeURIComponent(rest.join("/"));
  if (kind === "block" && arg) return { v: "block", hash: arg };
  if (kind === "tx" && arg) return { v: "tx", txid: arg };
  if (kind === "address" && arg) return { v: "address", addr: arg };
  return { v: "home" };
}

export const go = (path: string) => { location.hash = path; };

export default function App() {
  const [q, setQ] = useState("");
  const [route, setRoute] = useState<Route>(parseHash);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    const onHash = () => { setErr(""); setRoute(parseHash()); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const search = useCallback(async (raw: string) => {
    const term = raw.trim();
    if (!term) return;
    setBusy(true);
    setErr("");
    try {
      const c = classify(term);
      if (c.kind === "address") { go(`/address/${c.value}`); return; }
      if (c.kind === "height") {
        const { hash } = await api.blockHashByHeight(c.value);
        go(`/block/${hash}`); return;
      }
      // 64-hex: try block, then tx
      try {
        const data = await api.blockByHash(c.value);
        if (data && (data.header || data.coinbase_tx)) { go(`/block/${c.value}`); return; }
        throw new Error("not block");
      } catch {
        await api.tx(c.value);
        go(`/tx/${c.value}`);
      }
    } catch {
      setErr(`見つかりません: ${term}`);
    } finally { setBusy(false); }
  }, []);

  return (
    <div className="app">
      <header>
        <div className="brand" onClick={() => go("/")}>
          <span className="logo">◆</span> Teranode Explorer
          <span className="net">{NETWORK_LABEL}</span>
        </div>
        <form className="searchbar" onSubmit={(e) => { e.preventDefault(); search(q); }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="アドレス / txid / ブロックハッシュ / 高さ を検索"
          />
          <button disabled={busy}>{busy ? "…" : "検索"}</button>
        </form>
      </header>
      <main>
        {err && <div className="card err">{err}</div>}
        {route.v === "home" && <Home />}
        {route.v === "block" && <BlockView hash={route.hash} />}
        {route.v === "tx" && <TxView txid={route.txid} />}
        {route.v === "address" && <AddressView addr={route.addr} />}
      </main>
    </div>
  );
}

function Home() {
  const [info, setInfo] = useState<any>(null);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  useEffect(() => {
    const load = () => {
      api.chainInfo().then(setInfo).catch(() => {});
      api.recentBlocks(20).then((r) => setBlocks(r.data || [])).catch(() => {});
    };
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);
  return (
    <>
      <div className="stats">
        <Stat label="ブロック高さ" value={info?.blocks ?? "…"} />
        <Stat label="チェーン" value={info?.chain ?? "…"} />
        <Stat label="ベストブロック" value={info ? shortHash(info.bestblockhash) : "…"} mono />
        <Stat label="difficulty" value={info ? Number(info.difficulty).toExponential(2) : "…"} />
      </div>
      <div className="card">
        <h2>最新ブロック</h2>
        <table>
          <thead><tr><th>高さ</th><th>ハッシュ</th><th>Tx</th><th>サイズ</th><th>マイナー</th><th>時刻</th></tr></thead>
          <tbody>
            {blocks.map((b) => (
              <tr key={b.hash}>
                <td><a onClick={() => go(`/block/${b.hash}`)}>{b.height}</a></td>
                <td className="mono"><a onClick={() => go(`/block/${b.hash}`)}>{shortHash(b.hash)}</a></td>
                <td>{b.transactionCount}</td>
                <td>{b.size} B</td>
                <td className="miner">{b.miner}</td>
                <td className="muted">{fmtTime(b.timestamp)}</td>
              </tr>
            ))}
            {blocks.length === 0 && <tr><td colSpan={6} className="muted">読み込み中…</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function BlockView({ hash }: { hash: string }) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setData(null); setErr("");
    api.blockByHash(hash).then(setData).catch((e) => setErr(e.message || "取得エラー"));
  }, [hash]);
  if (err) return <div className="card err">{err}</div>;
  if (!data) return <div className="card muted">読み込み中…</div>;
  const h = data.header || {};
  const cb = data.coinbase_tx || {};
  const reward = (cb.outputs || []).reduce((s: number, o: any) => s + (o.satoshis || 0), 0);
  const tag = cb.inputs?.[0]?.unlockingScript ? coinbaseTag(cb.inputs[0].unlockingScript) : "-";
  return (
    <div className="card">
      <h2>ブロック {data.height != null ? `#${data.height}` : ""}</h2>
      <Row k="ハッシュ" v={hash} mono />
      <Row k="前ブロック" v={h.hash_prev_block} mono link={() => go(`/block/${h.hash_prev_block}`)} />
      <Row k="Merkle root" v={h.hash_merkle_root} mono />
      <Row k="timestamp" v={h.timestamp ? new Date(h.timestamp * 1000).toLocaleString() : "-"} />
      <Row k="bits" v={h.bits} />
      <Row k="nonce" v={String(h.nonce)} />
      <Row k="Tx件数" v={String(data.transaction_count ?? "-")} />
      <Row k="サイズ" v={data.size_in_bytes != null ? `${data.size_in_bytes} B` : "-"} />
      <Row k="マイナー" v={tag} />
      <Row k="ブロック報酬" v={reward ? `${BSV(reward)} BSV` : "-"} />
      <Row k="coinbase txid" v={cb.txid} mono link={cb.txid ? () => go(`/tx/${cb.txid}`) : undefined} />
    </div>
  );
}

function TxView({ txid }: { txid: string }) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setData(null); setErr("");
    api.tx(txid).then(setData).catch((e) => setErr(e.message || "取得エラー"));
  }, [txid]);
  if (err) return <div className="card err">{err}</div>;
  if (!data) return <div className="card muted">読み込み中…</div>;
  const ins = data.inputs || data.vin || [];
  const outs = data.outputs || data.vout || [];
  const coinbase = ins.length > 0 && ins.every(isCoinbaseInput);
  const totalOut = outs.reduce((s: number, o: any) => s + (o.satoshis ?? o.value ?? 0), 0);
  return (
    <div className="card">
      <h2>トランザクション {coinbase && <span className="net">coinbase</span>}</h2>
      <Row k="txid" v={txid} mono />
      <Row k="出力合計" v={`${BSV(totalOut)} BSV`} />
      <div className="io">
        <div>
          <h3>入力 ({ins.length})</h3>
          {coinbase && <div className="small muted">新規発行（コインベース）</div>}
          {!coinbase && ins.map((i: any, n: number) => {
            const prev = i.txid || i.previous_transaction?.txid || "";
            return (
              <div key={n} className="mono small">
                {prev ? <a onClick={() => go(`/tx/${prev}`)}>{shortHash(prev)}</a> : "-"}
                {i.vout != null && <span className="muted">:{i.vout}</span>}
              </div>
            );
          })}
        </div>
        <div>
          <h3>出力 ({outs.length})</h3>
          {outs.map((o: any, n: number) => {
            const addr = scriptToAddress(o.lockingScript || "");
            return (
              <div key={n} className="small histrow">
                <span className="mono">
                  {addr
                    ? <a onClick={() => go(`/address/${addr}`)}>{addr}</a>
                    : shortHash(o.lockingScript || "")}
                </span>
                <b>{BSV(o.satoshis ?? o.value ?? 0)} BSV</b>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AddressView({ addr }: { addr: string }) {
  const [bal, setBal] = useState<any>(null);
  const [utxos, setUtxos] = useState<any[]>([]);
  const [hist, setHist] = useState<any[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => {
    setBal(null); setUtxos([]); setHist([]); setErr("");
    Promise.all([api.balance(addr), api.unspent(addr), api.history(addr)])
      .then(([b, u, h]) => { setBal(b); setUtxos(u); setHist(h.slice().reverse()); })
      .catch((e) => setErr(e.message));
  }, [addr]);
  if (err) return <div className="card err">{err}</div>;
  return (
    <div className="card">
      <h2>アドレス</h2>
      <Row k="アドレス" v={addr} mono />
      <Row k="hash160" v={bal?.hash160 || "…"} mono />
      <div className="stats">
        <Stat label="使用可能" value={bal ? `${BSV(bal.spendable ?? bal.confirmed)} BSV` : "…"} />
        <Stat label="未成熟(coinbase)" value={bal ? `${BSV(bal.immature || 0)} BSV` : "…"} />
        <Stat label="未確定" value={bal ? `${BSV(bal.unconfirmed || 0)} BSV` : "…"} />
        <Stat label="UTXO件数" value={String(utxos.length)} />
      </div>
      <h3>取引履歴 ({hist.length})</h3>
      {hist.map((t: any) => (
        <div key={`${t.tx_hash}-${t.height}`} className="mono small histrow">
          <a onClick={() => go(`/tx/${t.tx_hash}`)}>{shortHash(t.tx_hash)}</a>
          <span className="muted">{t.height ? `#${t.height}` : "未確定"}</span>
        </div>
      ))}
      {hist.length === 0 && <div className="muted">履歴なし</div>}
    </div>
  );
}

function Stat({ label, value, mono }: { label: string; value: any; mono?: boolean }) {
  return (
    <div className="stat">
      <div className="stat-l">{label}</div>
      <div className={"stat-v" + (mono ? " mono" : "")}>{value}</div>
    </div>
  );
}
function Row({ k, v, mono, link }: { k: string; v?: string; mono?: boolean; link?: () => void }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className={"v" + (mono ? " mono" : "")}>
        {link ? <a onClick={link}>{v || "-"}</a> : (v || "-")}
      </span>
    </div>
  );
}
const shortHash = (h: string) => (h && h.length > 20 ? `${h.slice(0, 12)}…${h.slice(-8)}` : h || "-");
const fmtTime = (t: string) => { try { return new Date(t).toLocaleString(); } catch { return t; } };
