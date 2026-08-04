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
