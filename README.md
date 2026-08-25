# Beam

Beam is a static, accountless browser app for temporary peer-to-peer sharing. Create a private Beam, share its short code or passphrase, and send files, text, or links directly between browsers.

## Architecture

```text
Pairing secret → SHA-256 room identifier → public signaling rendezvous → WebRTC DataChannel → peer-to-peer transfer
```

Beam uses Trystero's tracker adapter to help browsers that know the same secret establish a WebRTC connection. Shared content is sent over WebRTC DataChannels, not through Vercel or a Beam backend. The human-readable secret is hashed before it is used as a room identifier.

## Privacy model

- No account, database, room directory, analytics, or server-side room storage.
- Secrets, session history, files, links, and messages are not persisted.
- Only theme and local display name are stored in `localStorage`.
- Beam does not store transfers. WebRTC transport is browser-encrypted; some restrictive networks may relay encrypted traffic through a TURN provider when configured.

## Development

```bash
npm install
npm run dev
npm run test
npm run build
```

## Deploying to Vercel

The repository builds a normal Vite `dist/` folder and has no functions, API routes, or server runtime. Import the repository into Vercel with its defaults, or run `vercel` after linking the project. Hash routes make QR join links work without rewrite rules.

## TURN (optional)

Beam works with public STUN by default, but some NAT/firewall configurations cannot establish direct peer connections. Set `VITE_TURN_CREDENTIAL_ENDPOINT` to an external endpoint that returns short-lived `RTCConfiguration` credentials. Do not put permanent TURN credentials in `VITE_*` variables, and do not add that credential service to this repository.

## MVP limitations

Incoming files are buffered in browser memory before download, so practical file limits vary by browser and device. The initial experience is optimized for a reliable two-device transfer; the protocol keeps peer and recipient handling extensible for future multi-peer improvements.
