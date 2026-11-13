# Put Velvet North online from GitHub

This project contains the website **and** the original Velvet North Network multiplayer server. They run together in one Docker deployment. GitHub stores the source, runs checks, and can trigger updates. GitHub Pages alone cannot run a permanent WebSocket server, so the live service needs an always-on Linux server (a VPS or a computer you own that stays powered on and reachable). This is hosting infrastructure, not a third-party multiplayer platform.

## 1. Upload the project to GitHub

1. Sign in to GitHub and create a new repository named `velvet-north-blackjack`.
2. For the simplest automatic deployment below, make the repository **Public**. (A private repository needs an additional GitHub deploy credential on the server.)
3. Upload the contents of this folder to the repository root. Make sure `server/`, `.github/`, `Dockerfile`, `compose.yaml`, and `Caddyfile` are at the top level—not inside another nested folder.
4. Open the repository's **Actions** tab. The `Verify Velvet North` workflow should run on the `main` branch.

## 2. Prepare your always-on server once

You need an Ubuntu 22.04/24.04 Linux VPS or an always-on Linux computer with a public IP. Point a domain's DNS `A` record to that server's public IP. Allow inbound TCP ports **80** and **443** in its firewall. Install Docker Engine and the Docker Compose plugin using Docker's official Ubuntu installation instructions.

SSH into that machine and run (replace `YOUR_GITHUB_USERNAME`):

```bash
sudo mkdir -p /opt/velvet-north
sudo chown "$USER":"$USER" /opt/velvet-north
git clone https://github.com/YOUR_GITHUB_USERNAME/velvet-north-blackjack.git /opt/velvet-north
cd /opt/velvet-north
DOMAIN=play.yourdomain.com docker compose up -d --build
```

Replace `play.yourdomain.com` with the exact domain whose DNS points to this server. Caddy obtains and renews the HTTPS certificate automatically. The website and secure multiplayer socket will share the same domain. Check `https://play.yourdomain.com/health` and then open `https://play.yourdomain.com/`.

## 3. Let GitHub deploy future changes automatically

In your GitHub repository, open **Settings → Secrets and variables → Actions → New repository secret**. Add:

- `DEPLOY_HOST` — your server's public IP or hostname
- `DEPLOY_USER` — your SSH username (must be allowed to run Docker)
- `DEPLOY_SSH_KEY` — the private SSH key GitHub Actions uses to log in (add its matching public key to that user's `~/.ssh/authorized_keys`)
- `DOMAIN` — your domain, e.g. `play.yourdomain.com`
- `DEPLOY_PORT` — optional; use `22` unless your SSH server uses another port

After the first manual setup above, push changes to `main`. The `Deploy Velvet North Network` workflow fetches the latest commit and rebuilds/restarts the app. You can also run it manually from **Actions → Deploy Velvet North Network → Run workflow**.

## 4. Important operating details

- The Docker restart policy brings the service back after a server reboot, provided Docker is enabled at boot.
- Your phone/computer can be off; the VPS keeps the site and server running.
- The current room/game state is in memory. A server restart closes active tables; it does not preserve accounts, chips, or history.
- The current game protocol uses the table host's browser as the blackjack game controller. The network server relays the game state between players. The host must stay connected to keep that particular table active, but does **not** need to stay connected for the whole website/network to remain online.
- Do not publish private SSH keys or passwords in the repository. Put deployment credentials only in GitHub Actions secrets.

## Troubleshooting

- If HTTPS does not activate, check that DNS points to the VPS and ports 80/443 are open.
- View server logs with `cd /opt/velvet-north && docker compose logs -f velvet-north`.
- View proxy logs with `cd /opt/velvet-north && docker compose logs -f caddy`.
- Check status with `docker compose ps`.
