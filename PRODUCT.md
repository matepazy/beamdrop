# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People sharing files, text, and links directly with another person or between their own devices, across browsers and device ecosystems.

## Product Purpose

Beam makes private, temporary peer-to-peer sharing possible in the browser without accounts or uploads. Success is a dependable, low-friction exchange between connected browsers.

## Positioning

An accountless, browser-native sharing space that transfers content directly between peers, with no proprietary ecosystem requirement or service-side storage.

## Operating Context

One person creates a private Beam and shares its short code, passphrase, or QR join link with another. Connected peers exchange files, notes, and links in a temporary session.

## Capabilities and Constraints

- Files, text, and links are shared over WebRTC DataChannels after peers rendezvous with the same hashed secret.
- No account, database, room directory, analytics, backend content storage, or persisted session history.
- Themes and a local display name may be stored locally.
- Incoming files are buffered in browser memory; practical file-size limits vary by browser and device.
- Public STUN is used by default; restrictive networks may need an externally configured TURN provider.

## Brand Commitments

Beam is an open, private alternative to ecosystem-bound sharing tools. Its communication should remain clear and trustworthy about direct transfer and the absence of storage.

## Evidence on Hand

- Product and privacy details: `README.md`.
- Existing app implementation and copy: `src/App.tsx`.
- Brand assets: `public/beam-logo.svg`, `public/beam-monogram.svg`, and `public/beam-drop-logo.svg`.
- No customer testimonials, benchmarks, pricing, or third-party proof assets are present; future work must not fabricate them.

## Product Principles

- Let anyone share without an account or proprietary device ecosystem.
- Keep the sharing path direct, temporary, and understandable.
- Be precise about privacy boundaries and network limitations.
- Prioritize reliable, low-friction exchange across browsers and devices.
