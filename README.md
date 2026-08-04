# Teranode Explorer

A lightweight block explorer for BSV Teranode networks (Teratestnet), built to add
the **address search** that the built-in Teranode dashboard does not provide.

Teranode itself keeps no address index, so this app talks to a companion **indexer
service** which:

- proxies the Teranode Asset API (CORS-enabled) for blocks and transactions, and
- maintains an address → UTXO / balance / history index.

## Features

- Home: chain stats + latest blocks
- Search by **address**, **txid**, **block hash**, or **block height**
- Address view: spendable / immature / unconfirmed balance, UTXO count, tx history
- Block and transaction detail views

## STAS 3.0 tokens (NFTs included)

`src/stas.ts` recognises [STAS 3.0](https://medium.com/@Stas33496115) token frames
straight from the locking script — no indexer support required — and the tx and
address views render them as tokens instead of raw script blobs:

- capability flags (§5.2.2): FREEZABLE, CONFISCATABLE, **NFT** (bit 2) and
  **AUGMENTABLE** (bit 3, honoured only alongside the NFT bit), including the
  multi-byte "read the last byte" rule of §15.5
- var2 sub-formats (§6): passive notes, swap descriptors (requested script hash,
  receive address, rate), the frozen marker, and append-only augmentation directives
- issuer data region: protocol ID / redemption address, freeze and confiscation
  authorities, and the payload — pretty-printed when it holds JSON, with `name` /
  `symbol` / `image` surfaced for NFT metadata
- amounts: a frame carries its token amount in the satoshi field, so token outputs
  are excluded from the BSV totals on both the tx and the address view

The structural probe follows `Dxs.Bsv`'s `DstasLockingScriptParser`; the parser is
checked against the conformance vectors from `dxs-consigliere`.

The presentation follows the shape Etherscan uses for tokens and NFTs:

- **tx view** — a "トークン移転" list above the raw inputs/outputs, one
  `From … → To … For <amount> <token>` line per token output, with an issuer
  avatar; the sender side is resolved by reading the spent outputs, and an output
  with no matching input frame is labelled 発行 (mint)
- **address view** — a token holdings table (avatar, name, amount, UTXO count) and
  an NFT gallery of item cards, one card per NFT UTXO (collapsed only when the
  issuer labels several with the same token id)
- **item detail** — issuer, holder, compliance authorities, and OpenSea-style trait
  tiles built from `attributes` / `traits` / `properties`, with the raw metadata
  JSON tucked behind a disclosure

**Indexer caveat**: the address index keys on the P2PKH pattern
(`76a914…88ac`), which a STAS frame does not match — its owner is a bare 20-byte
push. Token UTXOs therefore only show up on an address page if the indexer learns
to index the STAS owner field; token rendering inside a transaction works today.

## Stack

React 18 + TypeScript + Vite. No backend in this repo; all data comes from the
indexer endpoint configured at build time.

## Configuration

Build-time environment variables:

| Var            | Default                      | CI value      | Meaning                    |
| -------------- | ---------------------------- | ------------- | -------------------------- |
| `VITE_INDEXER` | `http://162.43.7.61:18101`   | `/api`        | Indexer / Asset proxy base |
| `VITE_NETWORK` | `Teratestnet`                | `Teratestnet` | Network label shown in UI  |

The production site is HTTPS, so `VITE_INDEXER` must stay a same-origin path there —
a raw `http://…:18101` endpoint gets blocked as mixed content. Caddy proxies
`e.btcp.io/api/*` to the indexer on `127.0.0.1:18101`.

## Sibling deployment

The JPYS-branded build (JPYS units, <https://e.jpys.btcp.io>) lives in its own
repository, [`BitcoinPay-Labs/jpys-explorer`](https://github.com/BitcoinPay-Labs/jpys-explorer).
Changes to shared UI code are not propagated automatically — port them by hand.

## Local development

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build to dist/
```

## Deployment (CI/CD)

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds the site and
deploys `dist/` to the production VPS over SSH, then restarts the
`teranode-explorer` systemd service.

Required repository secrets:

- `DEPLOY_SSH_KEY` — private key authorized on the VPS
- `DEPLOY_HOST` — VPS IP / host
- `DEPLOY_USER` — SSH user

The VPS serves `dist/` on port `18300`.
