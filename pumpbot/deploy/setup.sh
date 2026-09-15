#!/usr/bin/env bash
#
# Bootstrap pumpbot on a fresh Ubuntu/Debian VPS.
#
#   curl -fsSL https://raw.githubusercontent.com/kendallcoding202/kendallcoding202.github.io/claude/solana-meme-coin-tracker-gugfaj/pumpbot/deploy/setup.sh -o setup.sh
#   less setup.sh          # read it before running it — it runs as root
#   sudo bash setup.sh
#
# Installs Node 20, creates an unprivileged pumpbot user, clones the repo to
# /opt/pumpbot, installs deps, and registers the paper-mode systemd service.
#
# It deliberately does NOT: generate a wallet, enable live trading, or open any
# port. Those are decisions you make explicitly, afterwards.
#
# Options:
#   --firewall    also enable ufw, allowing only the SSH port currently in use
#   --branch X    clone a different branch (default: the tracker branch)

set -euo pipefail

REPO="https://github.com/kendallcoding202/kendallcoding202.github.io.git"
BRANCH="claude/solana-meme-coin-tracker-gugfaj"
APP_DIR="/opt/pumpbot"
APP_USER="pumpbot"
WITH_FIREWALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --firewall) WITH_FIREWALL=1; shift ;;
    --branch)   BRANCH="$2"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo: sudo bash setup.sh" >&2
  exit 1
fi

say() { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }

say "Installing prerequisites"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ca-certificates >/dev/null

# ---------------------------------------------------------------- Node 20+
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [[ "$MAJOR" -ge 20 ]] && NEED_NODE=0
fi

if [[ $NEED_NODE -eq 1 ]]; then
  say "Installing Node 20 (existing node is missing or older than 20)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
else
  say "Node $(node -v) already present"
fi

# ---------------------------------------------------------------- user + code
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  say "Creating unprivileged user '$APP_USER'"
  # No shell, no home login: this account exists only to run the bot.
  useradd -r -s /usr/sbin/nologin -d "$APP_DIR" "$APP_USER"
fi

if [[ -d "$APP_DIR/.git" ]]; then
  say "Updating existing checkout at $APP_DIR"
  git -C "$APP_DIR" remote set-url origin "$REPO"
  git -C "$APP_DIR" fetch --quiet origin "$BRANCH"
  git -C "$APP_DIR" checkout --quiet "$BRANCH"
  git -C "$APP_DIR" reset --hard --quiet "origin/$BRANCH"
else
  say "Cloning $BRANCH to $APP_DIR"
  mkdir -p "$APP_DIR"
  git clone --quiet --branch "$BRANCH" "$REPO" /tmp/pumpbot-clone
  # The bot lives in a subdirectory of the repo; move just that up to APP_DIR.
  cp -a /tmp/pumpbot-clone/pumpbot/. "$APP_DIR/"
  cp -a /tmp/pumpbot-clone/.git "$APP_DIR/.git"
  git -C "$APP_DIR" config core.sparseCheckout false
  rm -rf /tmp/pumpbot-clone
fi

say "Installing dependencies"
mkdir -p "$APP_DIR/.data"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
sudo -u "$APP_USER" env HOME="$APP_DIR" npm install --prefix "$APP_DIR" --omit=dev --silent

say "Running the test suite"
if sudo -u "$APP_USER" env HOME="$APP_DIR" node "$APP_DIR/test/run.js" | tail -1; then
  :
else
  echo "Tests failed — stopping before installing the service." >&2
  exit 1
fi

# ---------------------------------------------------------------- service
say "Installing the paper-mode service"
install -m 0644 "$APP_DIR/deploy/pumpbot-paper.service" /etc/systemd/system/pumpbot-paper.service
systemctl daemon-reload
systemctl enable --now pumpbot-paper

# ---------------------------------------------------------------- firewall
if [[ $WITH_FIREWALL -eq 1 ]]; then
  say "Configuring ufw"
  apt-get install -y -qq ufw >/dev/null
  # Allow whatever port sshd is actually listening on, so this cannot lock you out.
  SSH_PORT="$(ss -tlnp 2>/dev/null | awk '/sshd/ {split($4,a,":"); print a[length(a)]; exit}')"
  SSH_PORT="${SSH_PORT:-22}"
  ufw allow "$SSH_PORT/tcp" >/dev/null
  ufw --force enable >/dev/null
  echo "    ufw enabled; only $SSH_PORT/tcp is open."
  echo "    The dashboard is NOT exposed — reach it over an SSH tunnel."
fi

# ---------------------------------------------------------------- next steps
cat <<EOF

────────────────────────────────────────────────────────────────────────
 pumpbot is installed at $APP_DIR and running in PAPER mode.

 Watch it:
   journalctl -u pumpbot-paper -f

 View the dashboard from your laptop (run this on YOUR machine, not here):
   ssh -N -L 8081:localhost:8081 $(whoami)@$(hostname -I 2>/dev/null | awk '{print $1}')
   then open http://localhost:8081

 Nothing can spend money yet: there is no wallet and PAPER=1.

 When you want to go live, in this order:
   1. sudo -u $APP_USER $APP_DIR/node_modules/.bin/.. # see README
      cd $APP_DIR && sudo -u $APP_USER node src/index.js keygen
   2. Fund the address it prints with ONLY what you can lose.
   3. Verify the feed parses:
        sudo -u $APP_USER node src/index.js record 120
        sudo -u $APP_USER node src/index.js replay .data/feed-sample-*.jsonl
   4. Set PAPER=0 and RPC_URL in $APP_DIR/.env
   5. sudo cp $APP_DIR/deploy/pumpbot.service /etc/systemd/system/
      sudo systemctl daemon-reload && sudo systemctl enable --now pumpbot

 Leave pumpbot-paper running alongside live. It is your control group.
────────────────────────────────────────────────────────────────────────

EOF
