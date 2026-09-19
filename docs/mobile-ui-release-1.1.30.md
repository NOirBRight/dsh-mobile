# Mobile UI follow-up — 1.1.30

The accepted scope in `mobile-ui-release-1.1.29.md` remains authoritative.

Physical installation of 1.1.29 succeeded, but the screenshot exposed a missed header regression: download still preceded Chat. The fixture contained a synthetic `data-open-in-app` attribute absent on this Host. Removing it reproduced the failure (`row-2 left inset: 50`).

The flattening exclusion now recognizes the public menu-button semantics instead of that optional attribute. The utility container retains its flex box and `order: 6`; Chat again leads the row. The corrected fixture passes. No official source or desktop layout was changed.

Android version: 1.1.30 / code 47. Mobile layout cache revision: 0.1.92. This is a new release, not a replacement of immutable 1.1.29 assets.

## Final verification

- Both review axes have no unresolved substantive code findings. Version-specific evidence is recorded here rather than rewriting historical 1.1.29 results.
- Strict `npm run verify:release` passes, including full repository tests, typechecking, architecture checks, immutable Pairing artifact verification and offline mobile startup on clean official alpha.4.
- Existing release certificate verified; installed successfully on `INVS85H6HY7D5HPR`. Android reports version 1.1.30/code 47 with no DEBUGGABLE flag.
- Physical screenshot confirms Chat on the left and download on the right. This session exposes only turns/steps; full three-group statistics geometry remains verified by automated layout tests, not claimed as full-data physical acceptance.
