# Deploying Hotelzz.in to the VPS (one-time setup)

Push to `main` → GitHub Actions SSHes into the VPS, pulls the latest code,
installs dependencies, and reloads the app with zero downtime. You do this
setup once; after that it's just `git push`.

## 1. On the VPS (148.230.66.88) — one time

SSH in first: `ssh root@148.230.66.88`

```bash
# Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs git

# pm2 — keeps the app running, restarts on crash, restarts on reboot
npm install -g pm2
pm2 startup   # run the one command it prints

# Deploy key so the VPS can pull from your private/public GitHub repo
ssh-keygen -t ed25519 -C "hotelzz-vps-deploy" -f ~/.ssh/hotelzz_deploy -N ""
cat ~/.ssh/hotelzz_deploy.pub
# → paste that into GitHub: repo → Settings → Deploy keys → Add deploy key
#   (read access is enough)

# Clone the app
mkdir -p /var/www && cd /var/www
GIT_SSH_COMMAND="ssh -i ~/.ssh/hotelzz_deploy" git clone git@github.com:Devpysber/Hotelzz-main.git hotelzz
cd hotelzz
npm ci --omit=dev
```

Create `/var/www/hotelzz/.env` with your real production secrets — **never
commit this file** (it's already in `.gitignore`). Same shape as your local
`.env`: `SMTP_*`, `GOOGLE_CLIENT_ID/SECRET`, `JWT_SECRET`, `PUBLIC_URL=https://hotelzz.in`,
`NODE_ENV=production`, etc.

Start it once by hand to confirm it boots clean, then hand it to pm2:

```bash
pm2 start server/index.js --name hotelzz
pm2 save
```

### Put it behind nginx + real HTTPS (do this before pointing the domain here)

```bash
apt-get install -y nginx certbot python3-certbot-nginx
```

Point `hotelzz.in` and `www.hotelzz.in`'s DNS A-records at `148.230.66.88`
first, then:

```nginx
# /etc/nginx/sites-available/hotelzz
server {
    listen 80;
    server_name hotelzz.in www.hotelzz.in;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/hotelzz /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d hotelzz.in -d www.hotelzz.in   # free real TLS cert, auto-renews
```

### Firewall

Hostinger's panel already shows 6 firewall rules configured — confirm only
22 (SSH), 80, 443 are open. The app itself should never be reachable
directly on 3000 from outside; only nginx talks to it (`127.0.0.1:3000`).

## 2. On GitHub — one time

Repo → **Settings → Secrets and variables → Actions → New repository secret**,
add these four:

| Secret | Value |
|---|---|
| `VPS_HOST` | `148.230.66.88` |
| `VPS_USER` | `root` |
| `VPS_SSH_KEY` | private key for a deploy-only key (see below — **not** your personal root key) |
| `VPS_APP_DIR` | `/var/www/hotelzz` |

For `VPS_SSH_KEY`, generate a **separate** key pair just for CI (don't reuse
the deploy key from step 1, and never paste your actual root password/key
anywhere in GitHub):

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ~/.ssh/gh_actions -N ""
cat ~/.ssh/gh_actions.pub >> ~/.ssh/authorized_keys   # on the VPS
cat ~/.ssh/gh_actions            # paste this whole private key as VPS_SSH_KEY
```

## 3. Push

```bash
git push origin main
```

Actions tab on GitHub shows the deploy running. Once green, the live site
is on the new code.

## What I already set up locally

- `.github/workflows/deploy.yml` — the pipeline above.
- Local git repo initialized **inside this project folder only** (not your
  home directory — see the note in chat about a stray repo I found rooted
  at `C:\Users\ASUS`, unrelated to this project, left untouched).
- `origin` remote already points at `https://github.com/Devpysber/Hotelzz-main.git`.
  That repo already has a `main` branch with a commit on it — before the
  first push, tell me whether to merge with what's already there or force
  it to your local copy, so nothing gets overwritten by accident.
