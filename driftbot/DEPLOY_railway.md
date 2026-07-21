# Running driftbot 24/7 on Railway

This lets driftbot run continuously in the cloud, so your computer can be off.
It stays **paper-only** — nothing here places real trades.

## One-time setup

1. **Push the branch** (already done if you're reading this in the repo).

2. In [Railway](https://railway.app): **New Project → Deploy from GitHub repo**,
   and pick `kendallcoding202/kendallcoding202.github.io`.

3. **Set the root directory** so Railway builds the subfolder, not the whole
   site. In the service: **Settings → Source → Root Directory → `driftbot`**.
   (This repo is mostly a static website; driftbot lives in `driftbot/`.)

4. Railway auto-detects Python from `requirements.txt` and starts it with the
   `Procfile` (`python run.py dashboard`). No build config needed.

5. **Give it a public URL:** **Settings → Networking → Generate Domain.**
   Railway injects `PORT`; driftbot automatically binds `0.0.0.0:$PORT` and
   prints the public URL in the deploy logs.

6. Open that `https://<name>.up.railway.app` URL on your laptop **or phone** —
   the dashboard is the same responsive page.

That's it. It now runs 24/7. Trades still happen once per 15-minute bar, so
fees are unchanged from running locally.

## Persisting the paper portfolio across redeploys (optional)

Railway containers have an ephemeral filesystem, so a redeploy/restart resets
`state.json` (your paper balance + trade history). To keep it:

1. **Add a Volume:** service → **Variables/Volumes → New Volume**, mount path
   `/data`.
2. **Add a variable:** `DRIFTBOT_DATA_DIR=/data`.

driftbot then reads/writes `state.json` and `bot.log` under `/data`, which
survives redeploys.

## Changing settings

The deploy uses the committed defaults in `config.example.yaml` (SOL-USD,
15-minute bars, $1,000). To change them, edit `config.example.yaml`, commit,
and push — Railway redeploys automatically.

## A note on the public URL

The dashboard is **read-only and paper-only** — it can't trade and holds no
secrets — but the Railway URL is on the public internet with no password, so
anyone who has the link can view your (simulated) portfolio. Keep the link to
yourself. If you'd like a password on it, ask and I'll add simple auth.
