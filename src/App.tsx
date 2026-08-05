import { useEffect, useState, useCallback, useMemo } from "react";
import {
  api, fmtAmount, fmtBsv, classify, NETWORK_LABEL, APP_TITLE, SYMBOL, LOGO, BlockRow,
  scriptToAddress, coinbaseTag, isCoinbaseInput, hash160ToAddress, TokenRow, TokenHolder,
} from "./api";
import { parseStas, stasKind, stasMeta, StasFrame, StasMeta } from "./stas";

type Route =
  | { v: "home" }
  | { v: "block"; hash: string }
  | { v: "tx"; txid: string }
  | { v: "address"; addr: string }
  | { v: "tokens" }
  | { v: "token"; id: string };

function parsePath(raw: string): Route {
  const [kind, ...rest] = raw.replace(/^\/+/, "").split("/");
  const arg = decodeURIComponent(rest.join("/"));
  if (kind === "block" && arg) return { v: "block", hash: arg };
  if (kind === "tx" && arg) return { v: "tx", txid: arg };
  if (kind === "address" && arg) return { v: "address", addr: arg };
  if (kind === "token" && arg) return { v: "token", id: arg.toLowerCase() };
  if (kind === "tokens") return { v: "tokens" };
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
        <nav className="nav small">
          <a onClick={() => go("/tokens")}>トークン</a>
        </nav>
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
        {route.v === "tokens" && <TokensView />}
        {route.v === "token" && <TokenView id={route.id} />}
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
  const [inFrames, setInFrames] = useState<StasFrame[]>([]);
  const [err, setErr] = useState("");
  useEffect(() => {
    setData(null); setInFrames([]); setErr("");
    api.tx(txid).then(setData).catch((e) => setErr(e.message || "取得エラー"));
  }, [txid]);

  // Resolve the sender side by reading the spent outputs. Only worth doing when
  // this transaction actually carries tokens.
  useEffect(() => {
    if (!data) return;
    const outs = data.outputs || data.vout || [];
    if (!outs.some((o: any) => parseStas(o.lockingScript || ""))) return;
    const ins = (data.inputs || data.vin || []).filter((i: any) => !isCoinbaseInput(i));
    let cancelled = false;
    Promise.all(
      ins.map(async (i: any) => {
        const prevTxid = i.txid || i.previous_transaction?.txid;
        if (!prevTxid || i.vout == null) return null;
        try {
          const prev = await api.tx(prevTxid);
          const po = (prev.outputs || prev.vout || [])[i.vout];
          return parseStas(po?.lockingScript || "");
        } catch {
          return null;
        }
      }),
    ).then((frames) => {
      if (!cancelled) setInFrames(frames.filter(Boolean) as StasFrame[]);
    });
    return () => { cancelled = true; };
  }, [data]);
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
  const transfers = buildTransfers(frames, outs, inFrames);
  return (
    <div className="card">
      <h2>トランザクション {coinbase && <span className="net">coinbase</span>}</h2>
      <Row k="txid" v={txid} mono />
      <Row
        k={tokenCount ? "出力合計 (トークン以外)" : "出力合計"}
        v={`${fmtAmount(totalOut)} ${SYMBOL}`}
      />
      {tokenCount > 0 && <Row k="トークン出力" v={`${tokenCount} 件 (STAS 3.0)`} />}
      {transfers.length > 0 && (
        <>
          <h3>トークン移転 ({transfers.length})</h3>
          {transfers.map((t, n) => <TransferRow key={n} t={t} />)}
        </>
      )}
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
            const sats = o.satoshis ?? o.value ?? 0;
            return (
              <div key={n} className="small histrow">
                <span className="mono">
                  {token
                    ? <span className="muted">STAS フレーム（上の移転を参照）</span>
                    : addr
                      ? <a onClick={() => go(`/address/${addr}`)}>{addr}</a>
                      : shortHash(script)}
                </span>
                <b>{token ? `${fmtUnits(sats)} 単位` : `${fmtAmount(sats)} ${SYMBOL}`}</b>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** One row of the "Tokens Transferred" list: who sent what to whom. */
interface Transfer {
  frame: StasFrame;
  units: number;
  from: string | null;
  /** No matching input frame — the issuance mints here. */
  minted: boolean;
  to: string | null;
}

/**
 * Match input frames to output frames per issuance, so a spend reads as
 * "from → to" rather than as two unrelated UTXOs. Inputs of an issuance are
 * consumed in order; an output with no input left over is a mint.
 */
function buildTransfers(outFrames: Array<StasFrame | null>, outs: any[], inFrames: StasFrame[]): Transfer[] {
  const pool = new Map<string, StasFrame[]>();
  for (const f of inFrames) {
    const list = pool.get(f.protoId) || [];
    list.push(f);
    pool.set(f.protoId, list);
  }
  const rows: Transfer[] = [];
  outFrames.forEach((f, i) => {
    if (!f) return;
    const src = pool.get(f.protoId);
    const prev = src && src.length ? src.shift()! : null;
    rows.push({
      frame: f,
      units: outs[i]?.satoshis ?? outs[i]?.value ?? 0,
      from: prev ? (prev.ownerUnlocked ? null : prev.ownerAddress) : null,
      minted: !prev,
      to: f.ownerUnlocked ? null : f.ownerAddress,
    });
  });
  return rows;
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
  const fungible = holdings.filter((h) => !h.frame.flags.nft);
  const nfts = holdings.filter((h) => h.frame.flags.nft);
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
      {fungible.length > 0 && (
        <>
          <h3>トークン保有 ({fungible.length})</h3>
          <table className="tok-table">
            <thead>
              <tr><th>トークン</th><th>数量</th><th className="num">UTXO</th></tr>
            </thead>
            <tbody>
              {fungible.map((h) => (
                <tr key={h.frame.protoId}>
                  <td>
                    <div className="tok-cell">
                      <TokenIcon frame={h.frame} size={26} />
                      <a onClick={() => go(`/token/${h.frame.protoId}`)}>{tokenLabel(h.frame)}</a>
                      <StasBadges f={h.frame} />
                    </div>
                  </td>
                  <td><b>{fmtUnits(h.units)}</b></td>
                  <td className="num muted">{h.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {nfts.length > 0 && (
        <>
          <h3>NFT ({nfts.reduce((s, h) => s + h.count, 0)})</h3>
          <div className="nft-grid">
            {nfts.map((h, i) => (
              <NftCard key={`${h.frame.protoId}-${i}`} frame={h.frame} count={h.count} />
            ))}
          </div>
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

// ---- token tracker pages --------------------------------------------------

/** Frame parsed from an issuance's sample script, for name/symbol/flags. */
const rowFrame = (r: { script: string | null }): StasFrame | null => parseStas(r.script || "");

function TokensView() {
  const [rows, setRows] = useState<TokenRow[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api.tokens().then(setRows).catch((e) => setErr(e.message || "取得エラー"));
  }, []);
  if (err) return <div className="card err">{err}</div>;
  if (!rows) return <div className="card muted">読み込み中…</div>;
  return (
    <div className="card">
      <h2>トークン ({rows.length})</h2>
      {rows.length === 0 && <div className="muted">STAS トークンはまだ索引されていません</div>}
      {rows.length > 0 && (
        <table className="tok-table">
          <thead>
            <tr>
              <th>トークン</th><th className="num">供給量</th>
              <th className="num">保有者</th><th className="num">UTXO</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const f = rowFrame(r);
              return (
                <tr key={r.token}>
                  <td>
                    <div className="tok-cell">
                      {f ? <TokenIcon frame={f} size={26} /> : <span className="tok-icon tok-initial" style={{ width: 26, height: 26, fontSize: 11 }}>?</span>}
                      <a onClick={() => go(`/token/${r.token}`)}>
                        {f ? tokenLabel(f) : `STAS ${shortHash(r.token)}`}
                      </a>
                      {f && <StasBadges f={f} />}
                    </div>
                  </td>
                  <td className="num"><b>{fmtUnits(r.supply)}</b></td>
                  <td className="num muted">{r.holders}</td>
                  <td className="num muted">{r.utxos}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function TokenView({ id }: { id: string }) {
  const [info, setInfo] = useState<any>(null);
  const [holders, setHolders] = useState<TokenHolder[]>([]);
  const [hist, setHist] = useState<Array<{ tx_hash: string; height: number }>>([]);
  const [err, setErr] = useState("");
  useEffect(() => {
    setInfo(null); setHolders([]); setHist([]); setErr("");
    api.token(id).then(setInfo).catch((e) => setErr(e.message || "取得エラー"));
    api.tokenHolders(id).then(setHolders).catch(() => {});
    api.tokenHistory(id).then((h) => setHist(h.slice().reverse())).catch(() => {});
  }, [id]);
  if (err) return <div className="card err">{err}</div>;
  if (!info) return <div className="card muted">読み込み中…</div>;
  const frame = rowFrame(info);
  const meta: StasMeta = frame ? stasMeta(frame) : { traits: [] };
  return (
    <div className="card">
      <div className="tok-head">
        {frame
          ? <TokenIcon frame={frame} size={52} />
          : <span className="tok-icon tok-initial" style={{ width: 52, height: 52, fontSize: 22 }}>?</span>}
        <div>
          <h2 className="tok-title">
            {frame ? tokenLabel(frame) : `STAS ${shortHash(id)}`}
            {frame && <StasBadges f={frame} />}
          </h2>
          <div className="small muted mono">{id}</div>
        </div>
      </div>
      {meta.description && <div className="small tok-desc">{meta.description}</div>}
      <div className="stats">
        <Stat label={info.nft ? "発行点数" : "供給量"} value={fmtUnits(info.supply || 0)} />
        <Stat label="保有者" value={String(info.holders ?? 0)} />
        <Stat label="UTXO" value={String(info.utxos ?? 0)} />
        <Stat label="初出ブロック" value={info.first_height != null ? `#${info.first_height}` : "-"} />
      </div>
      {frame && (
        <>
          <Row
            k="発行体 (protoID)"
            v={frame.protoAddress || id}
            mono
            link={frame.protoAddress ? () => go(`/address/${frame.protoAddress}`) : undefined}
          />
          <Row k="flags" v={frame.flags.raw} mono />
          {frame.freezeAuth && <Row k="凍結権限" v={hash160ToAddress(frame.freezeAuth) || frame.freezeAuth} mono />}
          {frame.confiscateAuth && <Row k="没収権限" v={hash160ToAddress(frame.confiscateAuth) || frame.confiscateAuth} mono />}
          <Row k="エンジン" v={`${frame.engineBytes.toLocaleString()} B`} />
          <TraitGrid traits={meta.traits} />
        </>
      )}
      <h3>保有者 ({holders.length})</h3>
      {holders.length === 0 && <div className="muted small">保有者なし</div>}
      {holders.length > 0 && (
        <table className="tok-table">
          <thead>
            <tr><th>アドレス</th><th className="num">数量</th><th className="num">割合</th><th className="num">UTXO</th></tr>
          </thead>
          <tbody>
            {holders.map((h) => (
              <tr key={h.hash160}>
                <td className="mono"><a onClick={() => go(`/address/${h.address}`)}>{h.address}</a></td>
                <td className="num"><b>{fmtUnits(h.units)}</b></td>
                <td className="num muted">
                  {info.supply ? `${((h.units / info.supply) * 100).toFixed(2)}%` : "-"}
                </td>
                <td className="num muted">{h.utxos}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3>移転履歴 ({hist.length})</h3>
      {hist.map((t) => (
        <div key={`${t.tx_hash}-${t.height}`} className="mono small histrow">
          <a onClick={() => go(`/tx/${t.tx_hash}`)}>{shortHash(t.tx_hash)}</a>
          <span className="muted">{t.height ? `#${t.height}` : "未確定"}</span>
        </div>
      ))}
      {hist.length === 0 && <div className="muted small">履歴なし</div>}
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
      <TraitGrid traits={meta.traits} />
      {f.payloadText && !f.payloadJson && <Row k="データ" v={f.payloadText} />}
      {f.payloadJson && (
        <details className="stas-raw">
          <summary className="small muted">メタデータ JSON</summary>
          <pre className="stas-json mono small">{JSON.stringify(f.payloadJson, null, 2)}</pre>
        </details>
      )}
      {!f.payloadText && f.payloads.length > 0 && (
        <Row k="データ" v={`${f.payloads.length} 件 (バイナリ ${f.payloads.join("").length / 2} B)`} mono />
      )}
    </div>
  );
}

/** Token avatar: the issuer image when there is one, else an initial disc. */
function TokenIcon({ frame, size = 34 }: { frame: StasFrame; size?: number }) {
  const meta = stasMeta(frame);
  const img = meta.image && /^https:\/\//.test(meta.image) ? meta.image : null;
  // Unnamed issuances still deserve a stable mark: fall back to the protocol id.
  const named = (meta.symbol || meta.name || "").trim();
  const initial = named ? named.charAt(0).toUpperCase() : frame.protoId.slice(0, 2).toUpperCase();
  const style = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  if (img) {
    return <img className="tok-icon" style={style} src={img} alt={meta.name || "token"} loading="lazy" />;
  }
  return (
    <span className={"tok-icon tok-initial" + (frame.flags.nft ? " nft" : "")} style={style}>
      {initial}
    </span>
  );
}

const tokenLabel = (frame: StasFrame): string => {
  const meta = stasMeta(frame);
  if (meta.name && meta.symbol) return `${meta.name} (${meta.symbol})`;
  return meta.name || meta.symbol || `STAS ${shortHash(frame.protoId)}`;
};

/** Etherscan-style "From … To … For …" line, expandable into the frame detail. */
function TransferRow({ t }: { t: Transfer }) {
  const [open, setOpen] = useState(false);
  const meta = stasMeta(t.frame);
  const tokenId = meta.tokenId ? `#${meta.tokenId}` : null;
  return (
    <div className="xfer">
      <div className="xfer-main">
        <TokenIcon frame={t.frame} />
        <div className="xfer-body">
          <div className="xfer-line small">
            <span className="muted">From</span>
            {t.minted
              ? <span className="pill mint">発行</span>
              : t.from
                ? <a className="mono" onClick={() => go(`/address/${t.from}`)}>{shortHash(t.from)}</a>
                : <span className="muted">署名検証なし</span>}
            <span className="arrow">→</span>
            <span className="muted">To</span>
            {t.to
              ? <a className="mono" onClick={() => go(`/address/${t.to}`)}>{shortHash(t.to)}</a>
              : <span className="muted">署名検証なし</span>}
          </div>
          <div className="xfer-line small">
            <span className="muted">For</span>
            {t.frame.flags.nft
              ? <b>{tokenId || "1 点"}</b>
              : <b>{fmtUnits(t.units)}</b>}
            <a className="tok-name" onClick={() => go(`/token/${t.frame.protoId}`)}>{tokenLabel(t.frame)}</a>
            <StasBadges f={t.frame} />
            <a className="stas-toggle muted" onClick={() => setOpen(!open)}>{open ? "詳細を閉じる" : "詳細"}</a>
          </div>
        </div>
      </div>
      {open && <StasDetail f={t.frame} />}
    </div>
  );
}

/** Trait tiles, the way an NFT marketplace / Etherscan item page shows them. */
function TraitGrid({ traits }: { traits: Array<{ name: string; value: string }> }) {
  if (!traits.length) return null;
  return (
    <div className="traits">
      {traits.map((t, i) => (
        <div key={i} className="trait">
          <div className="trait-k">{t.name || "属性"}</div>
          <div className="trait-v">{t.value}</div>
        </div>
      ))}
    </div>
  );
}

/** NFT gallery card used on the address page. */
function NftCard({ frame, count }: { frame: StasFrame; count: number }) {
  const [open, setOpen] = useState(false);
  const meta = stasMeta(frame);
  const img = meta.image && /^https:\/\//.test(meta.image) ? meta.image : null;
  return (
    <div className="nft-card">
      <div className="nft-art" onClick={() => setOpen(!open)}>
        {img
          ? <img src={img} alt={meta.name || "NFT"} loading="lazy" />
          : <span className="nft-ph">{(meta.symbol || meta.name || "NFT").slice(0, 4).toUpperCase()}</span>}
        {count > 1 && <span className="nft-count">×{count}</span>}
      </div>
      <div className="nft-meta">
        <div className="nft-name">
          <a onClick={() => go(`/token/${frame.protoId}`)}>{meta.name || `STAS ${shortHash(frame.protoId)}`}</a>
        </div>
        <div className="small muted">
          {meta.tokenId ? `#${meta.tokenId}` : "NFT"}
          {frame.frozen && " · 凍結中"}
        </div>
      </div>
      {open && <StasDetail f={frame} />}
    </div>
  );
}

/**
 * Group an address's STAS UTXOs for the holdings views. Fungible frames collapse
 * per issuance; an NFT is one item per UTXO, so it only collapses when the issuer
 * labels several UTXOs with the same token id.
 */
function stasHoldings(utxos: any[]): Array<{ frame: StasFrame; count: number; units: number }> {
  const groups = new Map<string, { frame: StasFrame; count: number; units: number }>();
  utxos.forEach((u, i) => {
    const f = parseStas(u.script || "");
    if (!f) return;
    const id = stasMeta(f).tokenId;
    const key = f.flags.nft
      ? `${f.protoId}:nft:${id ?? `${u.tx_hash}:${u.tx_pos ?? i}`}`
      : `${f.protoId}:ft`;
    const cur = groups.get(key);
    if (cur) { cur.count++; cur.units += u.value ?? u.satoshis ?? 0; }
    else groups.set(key, { frame: f, count: 1, units: u.value ?? u.satoshis ?? 0 });
  });
  return [...groups.values()].sort((a, b) => b.units - a.units);
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
