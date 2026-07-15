# GscNet

GscNet is a private, invite-only, local-first social network. It offers profiles, a home feed, stories, reels, Explore, follows, likes, comments, saves, encrypted direct messages, notifications, media uploads, offline caching, and installable PWA behavior.

Live app: <https://guugustucc.github.io/gscnet/>

## Privacy model

- No email, password, or central account database.
- A circle invite acts as its shared encryption secret.
- Relay traffic is encrypted in the browser with AES-GCM.
- Profile and feed state are cached on each member's device.
- The public repository contains only the app shell, never community content or invite codes.

GscNet uses public MQTT WebSocket relays for best-effort synchronization. The static web host is continuously available, but public free relays do not offer guaranteed retention, storage, uptime, moderation, or account recovery.

## Run locally

Serve this directory over HTTP, then open `index.html`. For example: `python -m http.server 4173`.
