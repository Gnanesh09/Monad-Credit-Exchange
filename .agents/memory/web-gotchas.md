---
name: Web and proxy gotchas
description: Next 16 dev-server and hydration issues in the Replit preview, plus how the Replit proxy forwards client addresses.
---
- Next 16 blocks dev requests (HMR, RSC) from unknown origins; the Replit preview domain must be listed in allowedDevOrigins or the client never hydrates.
- Any value derived from Date.now() rendered during SSR causes a hydration mismatch. Start "now" as null on the server and set it in an effect.
  **How to apply:** for countdowns, ages and "x minutes ago", read time only on the client.
- Replit's edge proxy replaces client-supplied X-Forwarded-For (checked with a spoofed header), so with trust proxy enabled the leftmost entry is the real client.
