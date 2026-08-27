# Transfer benchmarking

Use a file whose content is known (for example, a 1 GiB archive with a SHA-256
checksum) and record the results at both ends. Do not use a browser download as
the source file: download throughput is unrelated to WebRTC throughput.

## Procedure

1. Deploy the same BeamDrop build to both devices, or run the production preview
   on the same LAN. Create a room and accept the file on the receiving device.
2. In development, call `beam.getDiagnostics()` from the component using
   `useBeam`. It returns only peer id, route, UDP/TCP, ICE candidate types, RTT,
   bitrate (when the browser exposes it), and bytes -- never candidate addresses.
3. Send the file, record the reported size, elapsed time, average and peak speed,
   plus the diagnostics route and RTT. Verify the received file's SHA-256 and
   byte size.
4. Repeat three times after the connection has settled. Report the median, not
   the best single run.

## Required scenarios

| Scenario | Setup | What it isolates |
| --- | --- | --- |
| Localhost | Two tabs/profiles on one computer | JavaScript, WebCrypto, and browser DataChannel overhead |
| Same LAN | Two devices on the same Wi-Fi/Ethernet network | DataChannel performance with negligible WAN latency |
| Remote direct | Two devices on unrelated networks; diagnostics must say `direct` | Real WAN capacity, RTT, packet loss, and ISP/NAT behavior |
| TURN relay | Force or select a network/path that reports `turn-relay` | TURN capacity and relay protocol overhead separately from direct P2P |

Never present localhost or LAN measurements as WAN results. A relay route, TCP
transport, high RTT, packet loss, or carrier NAT can all be the limiting factor
after the application sender has saturated its available DataChannel queue.
