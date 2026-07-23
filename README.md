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

| Var            | Default                      | Meaning                     |
| -------------- | ---------------------------- | --------------------------- |
| `VITE_INDEXER` | `http://162.43.7.61:18101`   | Indexer / Asset proxy base  |
| `VITE_NETWORK` | `Teratestnet`                | Network label shown in UI   |

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
