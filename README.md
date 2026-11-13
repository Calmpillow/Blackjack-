# Velvet North Blackjack

A browser blackjack game with gallery profile pictures and the original Velvet North Network multiplayer backend. The website and WebSocket service are served by the same Node.js process.

## Local test

- Install Node.js 20 or newer.
- On Windows, double-click `START_MULTIPLAYER_WINDOWS.bat`. On macOS/Linux, run `./START_MULTIPLAYER_MAC_LINUX.sh`.
- Open `http://localhost:8787/`.

## GitHub + always-on deployment

See [DEPLOYMENT.md](DEPLOYMENT.md). GitHub stores the code and runs automated checks/deploys. An always-on server that you control runs the actual website and multiplayer process. GitHub Pages is static hosting and cannot run this WebSocket backend.

## Network features

- 30 active rooms maximum; 12 players per room including the host
- Public room directory at `/api/rooms`
- Health check at `/health`
- WebSocket endpoint at `/ws`
- Private-room passwords salted and hashed in memory
- Heartbeats, rate limiting, message-size limits, and disconnect cleanup

Room/session data is in memory. Restarting the service closes active rooms. Persistent accounts, saved chips, and durable history are not included.
