import { useEffect, useState, useCallback } from "react";
import { api, BSV, classify, NETWORK_LABEL, BlockRow } from "./api";

type View =
  | { v: "home" }
  | { v: "block"; data: any }
  | { v: "tx"; data: any; txid: string }
  | { v: "address"; addr: string }
  | { v: "error"; msg: string };

export default function App() {
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>({ v: "home" });
  const [busy, setBusy] = useState(false);

  const search = useCallback(async (raw: string) => {
    const term = raw.trim();
    if (!term) return;
    setBusy(true);
    try {
      const c = classify(term);
      if (c.kind === "address") { setView({ v: "address", addr: c.value }); return; }
      if (c.kind === "height") {
        const { hash } = await api.blockHashByHeight(c.value);
        const data = await api.blockByHash(hash);
        setView({ v: "block", data }); return;
      }
      // 64-hex: try block, then tx
      try {
        const data = await api.blockByHash(c.value);
        if (data && (data.header || data.coinbase_tx)) { setView({ v: "block", data }); return; }
        throw new Error("not block");
      } catch {
        const data = await api.tx(c.value);
        setView({ v: "tx", data, txid: c.value });
      }
    } catch (e: any) {
      setView({ v: "error", msg: `見つかりません: ${term}` });
    } finally { setBusy(false); }
  }, []);

  return (
    <div className="app">
      <header>
        <div className="brand" onClick={() => setView({ v: "home" })}>
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
        {view.v === "home" && <Home onOpen={search} />}
        {view.v === "block" && <BlockView data={view.data} onOpen={search} />}
        {view.v === "tx" && <TxView data={view.data} txid={view.txid} onOpen={search} />}
        {view.v === "address" && <AddressView addr={view.addr} onOpen={search} />}
        {view.v === "error" && <div className="card err">{view.msg}</div>}
      </main>
    </div>
  );
}

function Home({ onOpen }: { onOpen: (q: string) => void }) {
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
                <td><a onClick={() => onOpen(String(b.height))}>{b.height}</a></td>
                <td className="mono"><a onClick={() => onOpen(b.hash)}>{shortHash(b.hash)}</a></td>
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

function BlockView({ data, onOpen }: { data: any; onOpen: (q: string) => void }) {
  const h = data.header || {};
  const cb = data.coinbase_tx || {};
  return (
    <div className="card">
      <h2>ブロック</h2>
      <Row k="ハッシュ" v={data.hash || cb.blockHash} mono />
      <Row k="前ブロック" v={h.hash_prev_block} mono link={() => onOpen(h.hash_prev_block)} />
      <Row k="Merkle root" v={h.hash_merkle_root} mono />
      <Row k="timestamp" v={h.timestamp ? new Date(h.timestamp * 1000).toISOString() : "-"} />
      <Row k="bits" v={h.bits} />
      <Row k="nonce" v={String(h.nonce)} />
      <Row k="Tx件数" v={String(data.transaction_count ?? "-")} />
      <Row k="coinbase txid" v={cb.txid} mono link={cb.txid ? () => onOpen(cb.txid) : undefined} />
    </div>
  );
}

function TxView({ data, txid, onOpen }: { data: any; txid: string; onOpen: (q: string) => void }) {
  const ins = data.inputs || data.vin || [];
  const outs = data.outputs || data.vout || [];
  return (
    <div className="card">
      <h2>トランザクション</h2>
      <Row k="txid" v={txid} mono />
      <div className="io">
        <div>
          <h3>入力 ({ins.length})</h3>
          {ins.map((i: any, n: number) => (
            <div key={n} className="mono small">{shortHash(i.txid || i.previous_transaction?.txid || "coinbase")}</div>
          ))}
        </div>
        <div>
          <h3>出力 ({outs.length})</h3>
          {outs.map((o: any, n: number) => (
            <div key={n} className="small">
              <span className="mono">{shortHash(o.lockingScript || "")}</span>{" "}
              <b>{BSV(o.satoshis ?? o.value ?? 0)} BSV</b>
            </div>
          ))}
        </div>
      </div>
      <button className="secondary" onClick={() => onOpen(txid)}>再読込</button>
    </div>
  );
}

function AddressView({ addr, onOpen }: { addr: string; onOpen: (q: string) => void }) {
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
        <div key={t.tx_hash} className="mono small histrow">
          <a onClick={() => onOpen(t.tx_hash)}>{shortHash(t.tx_hash)}</a>
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
