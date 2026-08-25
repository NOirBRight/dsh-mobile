# Archived: session hydration boot pipeline

Removed from the live boot graph. The mobile shell always boots Core (official Runtime + official or narrow layout). Source is kept here for history, not packaged into the APK.

- `packages/session-hydration-mobile` — optional hydration provider
- `patches/` — Runtime seam patch and revision allowlist
- `apps/` — `session-hydration.ts`, enhancement preference, and their tests
