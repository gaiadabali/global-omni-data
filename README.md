# Global Omni Data (GOD)

GOD is the holding company of YourTal, SnapApp and Free Tax Returns. This repository holds:

- `apps/site`: the public site at god.gaiada.com (Astro, static).
- `apps/dashboard`: the group dashboard at dashboard.god.gaiada.com (Next.js). Only allow-listed GOD staff can
  sign in, with Sign in with YourTal and a passkey.
- `packages/*`: shared code, including a seeded generator of synthetic data for development.

Brands only ever receive aggregates. Development and every screenshot use synthetic data; no real person's data
is ever committed here.

Working rules for contributors and coding agents are in [`CLAUDE.md`](CLAUDE.md).
