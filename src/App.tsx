import { useEffect, useState, useCallback, useMemo } from "react";
import {
  api, fmtAmount, fmtBsv, classify, NETWORK_LABEL, APP_TITLE, SYMBOL, LOGO, BlockRow,
  scriptToAddress, coinbaseTag, isCoinbaseInput, hash160ToAddress,
} from "./api";
import { parseStas, stasKind, stasMeta, StasFrame } from "./stas";

type Route =
  | { v: "home" }
  | { v: "block"; hash: string }
  | { v: "tx"; txid: string }
  | { v: "address"; addr: string };

function parsePath(raw: string): Route {
  const [kind, ...rest] = raw.replace(/^\/+/, "").split("/");
  const arg = decodeURIComponent(rest.join("/"));
  if (kind === "block" && arg) return { v: "block", hash: arg };
  if (kind === "tx" && arg) return { v: "tx", txid: arg };
  if (kind === "address" && arg) return { v: "address", addr: arg };
  return { v: "home" };
}

// 正規の形は /address/{addr} などのパス。ウォレットや過去に共有された
// #/tx/{txid} 形式のリンクも読めるよう、hash が付いていればそちらを優先する。
function currentRoute(): Route {
  const h = location.hash.replace(/^#\/?/, "");
  return h ? parsePath(h) : parsePath(location.pathname);
}

export const go = (path: string) => {
  if (location.pathname + location.hash === path) return;
  history.pushState(null, "", path);
  dispatchEvent(new PopStateEvent("popstate"));
};

export default function App() {
  const [q, setQ] = useState("");
  const [route, setRoute] = useState<Route>(currentRoute);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    document.title = APP_TITLE;
    // hash 形式で開かれた場合はパス形式に書き直す（表示中の画面はそのまま）
    if (location.hash) {
      const h = location.hash.replace(/^#\/?/, "");
      history.replaceState(null, "", h ? `/${h}` : "/");
    }
    const onNav = () => { setErr(""); setRoute(currentRoute()); };
    window.addEventListener("popstate", onNav);
    window.addEventListener("hashchange", onNav);
    return () => {
      window.removeEventListener("popstate", onNav);
      window.removeEventListener("hashchange", onNav);
    };
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
          {LOGO && <span className="logo">{LOGO}</span>} {APP_TITLE}
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
      <Row k="ブロック報酬" v={reward ? `${fmtBsv(reward)} BSV` : "-"} />
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
  // A STAS frame carries its token amount in the satoshi field, so folding those
  // outputs into the satoshi total would state a value the transaction never moved.
  const frames: Array<StasFrame | null> = outs.map((o: any) => parseStas(o.lockingScript || ""));
  const tokenCount = frames.filter(Boolean).length;
  const totalOut = outs.reduce(
    (s: number, o: any, i: number) => (frames[i] ? s : s + (o.satoshis ?? o.value ?? 0)),
    0,
  );
  return (
    <div className="card">
      <h2>トランザクション {coinbase && <span className="net">coinbase</span>}</h2>
      <Row k="txid" v={txid} mono />
      <Row
        k={tokenCount ? "出力合計 (トークン以外)" : "出力合計"}
        v={`${fmtAmount(totalOut)} ${SYMBOL}`}
      />
      {tokenCount > 0 && <Row k="トークン出力" v={`${tokenCount} 件 (STAS 3.0)`} />}
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
            const script = o.lockingScript || "";
            const addr = scriptToAddress(script);
            const token = frames[n];
            if (token) return <StasOutput key={n} frame={token} satoshis={o.satoshis ?? o.value ?? 0} />;
            return (
              <div key={n} className="small histrow">
                <span className="mono">
                  {addr
                    ? <a onClick={() => go(`/address/${addr}`)}>{addr}</a>
                    : shortHash(script)}
                </span>
                <b>{fmtAmount(o.satoshis ?? o.value ?? 0)} {SYMBOL}</b>
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
  const holdings = useMemo(() => stasHoldings(utxos), [utxos]);
  // The indexer counts every UTXO in satoshis, but a token frame's satoshi value
  // is its token amount — subtract it so the BSV balance is not overstated.
  const tokenSats = holdings.reduce((s, h) => s + h.units, 0);
  const spendable = bal ? (bal.spendable ?? bal.confirmed ?? 0) - tokenSats : 0;
  if (err) return <div className="card err">{err}</div>;
  return (
    <div className="card">
      <h2>アドレス</h2>
      <Row k="アドレス" v={addr} mono />
      <Row k="hash160" v={bal?.hash160 || "…"} mono />
      <div className="stats">
        <Stat
          label={tokenSats ? "使用可能 (トークン除く)" : "使用可能"}
          value={bal ? `${fmtAmount(spendable)} ${SYMBOL}` : "…"}
        />
        <Stat label="未成熟(coinbase)" value={bal ? `${fmtAmount(bal.immature || 0)} ${SYMBOL}` : "…"} />
        <Stat label="未確定" value={bal ? `${fmtAmount(bal.unconfirmed || 0)} ${SYMBOL}` : "…"} />
        <Stat label="UTXO件数" value={String(utxos.length)} />
      </div>
      {holdings.length > 0 && (
        <>
          <h3>保有トークン ({holdings.length})</h3>
          {holdings.map((h) => (
            <div key={`${h.frame.protoId}-${h.frame.flags.nft}`} className="stas-out">
              <div className="small histrow">
                <span className="mono">
                  {shortHash(stasMeta(h.frame).name || h.frame.protoAddress || h.frame.protoId)}
                  <StasBadges f={h.frame} />
                </span>
                <b>
                  {h.frame.flags.nft
                    ? `${h.count} 点`
                    : `${fmtUnits(h.units)} 単位 / ${h.count} UTXO`}
                </b>
              </div>
            </div>
          ))}
        </>
      )}
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

// ---- STAS 3.0 tokens ------------------------------------------------------

function StasBadges({ f }: { f: StasFrame }) {
  return (
    <span className="badges">
      <span className={"badge" + (f.flags.nft ? " nft" : "")}>{stasKind(f)}</span>
      {f.flags.augmentable && <span className="badge">追記可</span>}
      {f.flags.freezable && <span className="badge">凍結可</span>}
      {f.flags.confiscatable && <span className="badge">没収可</span>}
      {f.frozen && <span className="badge warn">凍結中</span>}
      {f.var2.kind === "swap" && <span className="badge warn">スワップ待ち</span>}
      {f.var2.kind === "directive" && <span className="badge warn">追記指示</span>}
    </span>
  );
}

/** Token amount. STAS carries the amount in the satoshi value of the frame. */
const fmtUnits = (n: number) => n.toLocaleString();

function StasDetail({ f }: { f: StasFrame }) {
  const meta = stasMeta(f);
  const img = meta.image && /^https:\/\//.test(meta.image) ? meta.image : null;
  return (
    <div className="stas-detail">
      {(meta.name || meta.symbol) && (
        <Row k="名称" v={[meta.name, meta.symbol && `(${meta.symbol})`].filter(Boolean).join(" ")} />
      )}
      {meta.description && <Row k="説明" v={meta.description} />}
      <Row
        k="発行体 (protoID)"
        v={f.protoAddress || f.protoId}
        mono
        link={f.protoAddress ? () => go(`/address/${f.protoAddress}`) : undefined}
      />
      <Row
        k="保有者"
        v={f.ownerUnlocked ? "署名検証なし (HASH160(\"\"))" : f.ownerAddress || f.owner}
        mono
        link={!f.ownerUnlocked && f.ownerAddress ? () => go(`/address/${f.ownerAddress}`) : undefined}
      />
      <Row k="flags" v={f.flags.raw} mono />
      {f.freezeAuth && (
        <Row k="凍結権限" v={hash160ToAddress(f.freezeAuth) || f.freezeAuth} mono />
      )}
      {f.confiscateAuth && (
        <Row k="没収権限" v={hash160ToAddress(f.confiscateAuth) || f.confiscateAuth} mono />
      )}
      {f.var2.kind === "swap" && (
        <>
          <Row k="希望スクリプト" v={f.var2.requestedScriptHash} mono />
          <Row k="受取先" v={f.var2.receiveAddr || "-"} mono />
          <Row
            k="レート"
            v={f.var2.rateNumerator === 0
              ? "指定なし"
              : `${f.var2.rateNumerator} / ${f.var2.rateDenominator}`}
          />
        </>
      )}
      {f.var2.kind === "directive" && <Row k="次の spend で追記" v={f.var2.data} mono />}
      {f.var2.kind === "passive" && f.var2.note && <Row k="メモ (var2)" v={f.var2.note} />}
      {f.var2.kind === "unknown" && (
        <Row k="var2" v={`未知のアクション 0x${f.var2.action.toString(16).padStart(2, "0")}`} />
      )}
      <Row k="エンジン" v={`${f.engineBytes.toLocaleString()} B`} />
      {img && <img className="stas-img" src={img} alt={meta.name || "token image"} loading="lazy" />}
      {f.payloadText && !f.payloadJson && <Row k="データ" v={f.payloadText} />}
      {f.payloadJson && (
        <pre className="stas-json mono small">{JSON.stringify(f.payloadJson, null, 2)}</pre>
      )}
      {!f.payloadText && f.payloads.length > 0 && (
        <Row k="データ" v={`${f.payloads.length} 件 (バイナリ ${f.payloads.join("").length / 2} B)`} mono />
      )}
    </div>
  );
}

function StasOutput({ frame, satoshis }: { frame: StasFrame; satoshis: number }) {
  const [open, setOpen] = useState(false);
  const meta = stasMeta(frame);
  const label = meta.name || meta.symbol || frame.protoAddress || frame.protoId;
  return (
    <div className="stas-out">
      <div className="small histrow">
        <span className="mono">
          <a className="stas-toggle" onClick={() => setOpen(!open)}>
            {open ? "▾" : "▸"} {shortHash(label)}
          </a>
          <StasBadges f={frame} />
        </span>
        <b>{frame.flags.nft ? "1 点" : `${fmtUnits(satoshis)} 単位`}</b>
      </div>
      {open && <StasDetail f={frame} />}
    </div>
  );
}

/** Group STAS UTXOs of an address by issuance, for the holdings table. */
function stasHoldings(utxos: any[]): Array<{ frame: StasFrame; count: number; units: number }> {
  const byProto = new Map<string, { frame: StasFrame; count: number; units: number }>();
  for (const u of utxos) {
    const f = parseStas(u.script || "");
    if (!f) continue;
    const key = `${f.protoId}:${f.flags.nft}`;
    const cur = byProto.get(key);
    if (cur) { cur.count++; cur.units += u.value ?? u.satoshis ?? 0; }
    else byProto.set(key, { frame: f, count: 1, units: u.value ?? u.satoshis ?? 0 });
  }
  return [...byProto.values()].sort((a, b) => b.units - a.units);
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
