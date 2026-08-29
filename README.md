<p align="center">
  <img src="public/beam-monogram.svg" alt="Beam monogram" width="96" height="96" />
</p>

# BeamDrop.

Private, temporary, peer-to-peer sharing between browsers.

Beam lets you send files, text, links, clipboard contents, and map locations directly from one browser to another. No account is required, and shared content is not uploaded to a Beam server.

## Highlights

- Create a private Beam with a short code or memorable passphrase, optionally protected by a password.
- Join an active Beam with its code, passphrase, or QR link; inactive codes are rejected instead of becoming new sessions.
- The first guest joins automatically; later guests need approval from someone already in the Beam and can be removed by any participant.
- Transfer files with progress, accept/decline, and cancel controls.
- Share text, links, clipboard contents, and map locations.
- Use a local display name for the current device.
- Works across modern browsers and device ecosystems.
- Supports an optional TURN provider for restrictive networks.

## How it works

```text
Code or passphrase
        │
        ▼
SHA-256 room identifier
        │
        ▼
Public signaling rendezvous
        │
        ▼
WebRTC DataChannel
        │
        ▼
Direct browser-to-browser transfer
```

The human-readable Beam secret is normalized and hashed before it becomes a room identifier. Trystero's Nostr relay adapter helps browsers that know the same secret discover one another, after which content travels over WebRTC DataChannels.

## Privacy model

Beam is designed for temporary exchanges:

- No accounts, database, room directory, analytics, or Beam backend.
- Files, messages, links, secrets, and session history are not persisted by Beam.
- Beam does not store identity, session, authentication, or display-name data in browser storage.
- Incoming files are held in browser memory until the recipient saves them.
- WebRTC transport is browser-encrypted. The Beam code derives separate rendezvous and peer-authentication keys; no session data is persisted. On restrictive networks, an external TURN provider may relay encrypted traffic.

Beam still depends on internet connectivity for signaling and peer connection setup. Do not share sensitive information unless the participants and network environment are trusted.

## Getting started

### Requirements

- Node.js 18 or newer
- A modern browser with WebRTC support

### Run locally

```bash
npm install
npm run dev
```

Open the local URL shown by Vite, then open it in a second browser or on another device to test a transfer.

### Available scripts

```bash
npm run dev       # Start the Vite development server
npm run test      # Run the Vitest suite once
npm run test:watch
npm run build     # Type-check and create the production build
```

## Optional TURN configuration

Beam uses public STUN by default:

```text
stun:stun.l.google.com:19302
```

For networks where direct WebRTC connections fail, set `VITE_TURN_CREDENTIAL_ENDPOINT` to an external endpoint that returns short-lived `RTCConfiguration` credentials. The endpoint should return JSON compatible with the browser's `RTCConfiguration` type.

```bash
VITE_TURN_CREDENTIAL_ENDPOINT=https://example.com/turn-credentials npm run dev
```

Do not put permanent TURN credentials in `VITE_*` variables or commit a credential service to this repository.

## Deployment

Beam is a client-side Vite application. The production output is `dist/`, and there are no API routes, server functions, or Beam storage services.

```bash
npm run build
```

The repository includes a `vercel.json` configuration for deploying to Vercel with the Vite framework defaults. Any static host that serves the generated `dist/` directory can also host the app.

## Peer authentication and release metadata

Before Trystero activates a connection, both browsers complete BeamDrop peer protocol v1 authentication. Each side creates a fresh 256-bit nonce and verifies an HMAC-SHA-256 proof using a dedicated HKDF-derived peer-authentication key. This is separate from the reserved AES-GCM application key and the Trystero signaling key. The proof is domain-separated and binds the Beam room, protocol version, challenge role, and fresh nonce, so a captured proof cannot be replayed for another challenge or room.

Authentication proves only that the peer knows the Beam/session cryptographic material. It does not make a peer safe: all received controls, offers, chunks, text, links, and metadata are still runtime-validated and bounded, and invalid peers are ignored after a small per-session failure threshold. Incomplete transfer state and authentication-related state are memory-only and removed on disconnect.

The app also supports signed official-release metadata using ECDSA P-256. A valid signature means the manifest was produced by an authorized BeamDrop release process; it **does not** prove that a remote browser is executing an unmodified official client. By default (`REQUIRE_OFFICIAL_RELEASE = false`), an unsigned or invalid release manifest is simply unofficial and the peer may still join if its session authentication succeeds.

To enable release verification, release automation must replace the public JWK, manifest, and signature in `src/lib/releaseMetadata.ts` at build time. Keep the ECDSA private key exclusively in the release system (for example, a protected GitHub Actions secret); never put it in source, Vite environment variables, or public assets. Sign the exact canonical representation implemented by `canonicalReleaseManifest`. Set `REQUIRE_OFFICIAL_RELEASE` to `true` only if the product intentionally blocks forks and unsigned builds.

## Project structure

```text
src/
├── App.tsx          # Landing page, room UI, QR flow, and sharing controls
├── hooks/useBeam.ts  # WebRTC room lifecycle and transfer state
└── lib/
    ├── codes.ts     # Secret generation, normalization, and room hashing
    ├── protocol.ts  # Control messages and file chunking
    ├── rtc.ts       # STUN/TURN configuration
    └── format.ts    # Display formatting helpers
public/              # Beam logo and monogram assets
```

## Current limitations

- Incoming files are buffered in browser memory before download, so practical file-size limits depend on the browser and device.
- The initial experience is optimized for a reliable two-device exchange.
- Peer discovery and connection setup require internet access.
- Some restrictive NAT and firewall configurations require a TURN provider.
- Map locations use OpenStreetMap tiles when the location composer is opened.

## License

Beam is licensed under the [GNU Affero General Public License v3.0](LICENSE).
