# Mobile UI repair scope — 1.1.29

Review baseline: `7837fa2651801a2b3cb9d05f239cb5fbff173024`, including this branch's uncommitted and new files. The originating specification is the user's September 19, 2026 repair conversation.

## Accepted requirements

- Change the Android/mobile narrow layout only. Do not modify official DSH sources, the desktop WebUI, production profiles, or restart the production Host.
- Align Chat, Trajectory, mode, Subs and Jobs with the mobile menu; reduce gaps and place download last.
- Preserve the current Host's interactive statistics pills, icons, accessible button names and original detail dialogs. Keep one readable line: 12–13px text, 14px statistics icons, vertically centered, with equal gaps between time/speed, usage/cache and context occupancy.
- Use concise labels, retaining `tok/s` and `Cache` when they fit. Only on constrained widths use further abbreviations/rounded compact counts; exact readings stay in the Host's accessible button name and detail dialog. Never introduce the rejected 6px text or replace buttons with a plain statistics line.
- A plugin that fails or leaves asynchronous boot pending must not hide device selection. Offer connection options during download and, after five seconds, outside the Host-owned root during plugin boot/disposal.
- Build and publish a signed release APK after review and verification, not a debug APK.

These explicit user requirements supersede ADR 0004's older two-line and summary-content recommendations for the current interactive mobile statistics pills. Unrelated older campaign goals are not additional requirements for this release. Older noninteractive Host statistics retain their official rendering.

## Explicitly approved fault-recovery exception

The user approved: “允许此故障恢复例外” in response to allowing a full reload only when plugin boot is stuck and the user chooses another device. Healthy profile switches remain resident.

`boot-recovery.ts` is the sole architecture-audit exception for `location.reload()`. Callers first persist the user's profile selection, then reload only while a graph is still painting or the user entered boot recovery. This discards a non-cancellable graph instead of letting its late completion replace a newly selected Host. No automatic timeout reload is performed. Tests cover the healthy no-reload case, recovery cases and the independent recovery control while boot is pending.

This exception does not recover a plugin's synchronous infinite loop on the WebView main thread; that requires an OS-level app restart. It covers asynchronous loading/activation/disposal stalls.

## Adapter boundaries

The Host supplies no compact-label API for StatsPills in this release. The mobile presenter observes the public composer dock, keeps React's nodes and handlers intact, and stamps only direct pill labels. Their previously unused `::after` renders the compact copy; official button `aria-label` values and dialog contents remain untouched. It does not use a tab's existing underline pseudo-element. Upstream seam requested: a compact-label/spacing option on the owner of the statistics pills. Unknown non-pill occupants are left alone.

Header corner compatibility uses the public rightbar control rather than introducing a generated-class selector. Existing baseline header adapters are outside this incremental repair.

## Review and verification

Historical results for 1.1.29 only. The subsequent physical header finding and final 1.1.30 verification are recorded in `mobile-ui-release-1.1.30.md`; the pending-device status below is superseded there.

- Parallel Standards/Spec reviews against the fixed baseline found no remaining hard standards violations or substantive implementation defects after repair. The successful-boot recovery flag reset has regression coverage.
- Full repository tests, TypeScript checks and architecture audit pass, including 298 mobile-web tests. Layout coverage checks narrow widths, large values, readable text/icon sizes, vertical centering and equal spacing.
- Strict `npm run verify:release` passes against clean official alpha.4, including immutable Pairing 0.1.14 artifact verification, offline profile installation and the mobile startup matrix.
- Android release artifact is version `1.1.29` / code `46`, signed with the existing DSH Mobile certificate; APK signature verification passes and the manifest has no debug flag.
- Final-device installation is pending an ADB connection; do not infer device acceptance from fixture coverage.
