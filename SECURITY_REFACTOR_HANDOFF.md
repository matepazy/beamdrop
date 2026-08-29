# BeamDrop security refactor handoff

## What changed

- Beam creation now produces a human-readable `word-word-00` code from expanded vocabularies. It is carried in the URL fragment, so it is not sent in the initial HTTP request. This is a deliberate UX tradeoff: it is not a 128-bit cryptographic capability and must not be used for high-sensitivity sharing.
- `deriveRoomMaterial` uses HKDF-SHA-256 domain separation for the Trystero room ID, signaling key, and reserved application key.
- The capability-derived Trystero password gates the underlying room. A post-connect access channel exposes only lock/admission state; normal actions and file chunks are rejected until admission succeeds.
- Password checking on that access channel is nonce-based HMAC over a PBKDF2-SHA-256 derived key (310,000 iterations). No reusable password proof is sent or stored.

> Current product state: password protection is temporarily disabled end-to-end while the connection flow is stabilized. The settings and waiting-page lock controls are hidden, and all valid Beam-code holders are admitted.
- Payload encryption was removed deliberately: WebRTC DataChannels already provide authenticated DTLS transport encryption. The capability-derived Trystero password protects signaling/offer encryption and admission. `appKey` remains domain-separated but unused until a concrete end-to-end requirement exists.
- Control messages are versioned and size-limited (16 KiB), strings/IDs/numbers are checked at runtime, and links only permit HTTP(S).
- File chunks use a fixed binary header rather than delimiter parsing. Offers do not create a receiving buffer; chunks are accepted only after explicit acceptance, with strict ordering, size, and concurrency checks.

## Commands to run

```powershell
npm run build
npm test
```

The first type-check/build completed after the refactor. Subsequent Vite/Vitest runs were blocked by the desktop sandbox's esbuild error (`Cannot read directory "../../..": Access is denied` while resolving `vite.config.ts`/`vitest.config.ts`), not a reported source error. Re-run outside that restricted runner.

## Manual two-browser checks

1. Create a Beam and verify the shared link has a `word-word-00` fragment code.
2. Join from a second browser; send text, an HTTPS link, a location, and a small file.
3. Reject a file, then use DevTools to send a raw chunk action: no download/object URL must be created.
4. Set a password, join without it (expect password prompt/failure), then join with it.
5. Cancel a transfer mid-stream; both sides should move to `cancelled`.
6. Try malformed actions/chunks from DevTools: oversized controls, invalid IDs, incorrect chunk lengths, impossible sizes, and `javascript:` links must be ignored.
7. Test direct and TURN-relayed networks with the diagnostics dialog.

## Required follow-up for the next agent

Creator authority is the remaining security-critical item. The old post-connection approval protocol was removed because it let pending peers receive normal actions. The current handshake authorizes possession of the capability and optional password, but it does **not** yet preserve creator-only manual admission/kick/free-for-all across a multi-peer mesh.

Implement this next using a creator-generated ephemeral Ed25519 key pair:

1. Put only its public key in the invitation fragment beside the capability; retain the private key in creator session state (or a user-approved local secure store).
2. Include and verify signatures for creator-only state changes and direct kick notices, bound to protocol version, message type, target peer ID, room ID, and monotonic sequence.
3. Move manual admission into the Trystero handshake: creator holds a pending handshake promise after receiving a validated join identity; the UI's Allow/Reject resolves it. Issue signed admission grants for later mesh handshakes so non-creators can connect without receiving application actions before proof of creator approval.
4. Rotate the distribution/session key when membership changes only if custom content encryption is reintroduced for a documented benefit. Do not derive it from the human password.
5. Add integration tests with mocked Trystero rooms for join, reject, kick, disconnect, offer/accept/cancel/complete, and malicious peer cases.

This follow-up is intentionally called out rather than pretending the current capability/password authentication alone supplies creator identity.
