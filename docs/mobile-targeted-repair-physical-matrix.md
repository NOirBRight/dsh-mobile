# DSH Mobile Targeted Repair — 3082 Physical Acceptance Matrix

Artifact: [DSH Mobile 1.1.1 test.20260824.9](https://github.com/NOirBRight/dsh-mobile/releases/download/mobile-interactions-test-20260824/dsh-mobile-1.1.1-test.20260824.apk)

Android: versionCode 11 · versionName 1.1.1-test.20260824.9

SHA-256: 56682bee16d22dee180c1806a0462374decf2f7f55ffed70b8f85bc720162670
Target Host: the existing 3082 lab service (verified active and HTTP 200 on 2026-08-24).

Automated preflight now covers 320/360/390/412px, Chinese/English labels, visible feedback, equal action columns, command ownership, Back transitions, popup gutters, statistics visibility, and history restoration. The unchecked rows below intentionally require a physical Android device.

## Install and device preflight

1. Connect and unlock one physical Android device, enable USB debugging, and approve this workstation.
2. Run `npm run android:acceptance -w @dsh-mobile/mobile-web` from the repository root. If multiple devices are attached, set `DSH_ANDROID_SERIAL=<serial>`.
3. The command rejects emulators, verifies the APK SHA-256, installs it, confirms versionCode/versionName, launches DSH Mobile, and prints the device model, SDK, pixel width, density, and approximate CSS width.
4. Connect the launched app to the existing 3082 lab Host, then execute the visual/touch checks below.


## Device configurations

Record one row per available device/configuration. A physical device may cover multiple CSS widths through portrait/landscape.

| CSS width | Locale | Orientation | IME | Result | Notes |
|---:|---|---|---|---|---|
| 320 | zh-CN | portrait | closed/open | ☐ | |
| 360 | zh-CN | portrait | closed/open | ☐ | |
| 390 | en | portrait | closed/open | ☐ | |
| 412 | en | portrait | closed/open | ☐ | |
| available device | zh/en | landscape | closed/open | ☐ | |

## Required checks per configuration

1. **Popup geometry**
   - ☐ Open a left-side simple menu; its start edge follows the trigger and keeps at least 12px viewport gutter.
   - ☐ Open a right-side simple menu; its end edge follows the trigger and keeps at least 12px viewport gutter.
   - ☐ Open Model picker and a composer command listbox; rich/listbox content is readable, vertically scrollable when tall, and repositions after rotation.
2. **Slash command ownership**
   - ☐ Type /, tap one command once, and verify exactly that command is selected/inserted without a second tap.
3. **Statistics**
   - ☐ Composer shows one non-expandable line: TTFT, tok/s, cache-hit rate, input tokens, output tokens.
   - ☐ Every assistant turn footer retains clock, duration, turn TTFT, and turn throughput without ellipsis; adjacent actions remain reachable.
4. **Expanded History Boundary**
   - ☐ Load at least two older pages and note the first visible semantic row.
   - ☐ Switch sessions and return; all explicitly loaded pages are restored and the noted row does not jump.
   - ☐ Repeat across a reconnect/live repair; a never-expanded session performs no unsolicited older-page loading.
5. **One-layer Android Back**
   - ☐ With IME, profile/modal, question takeover, picker/menu, details, and drawer layered where possible, each Back closes/minimizes exactly one level in that order.
   - ☐ Model picker drilled pane returns to its root before closing.
   - ☐ Only an empty surface stack reaches browser history/native exit.
6. **Question footer**
   - ☐ Pager occupies its own row; visible feedback occupies an optional full-width row.
   - ☐ Skip and Next/Submit are equal-width, unclipped, and tappable with IME open and closed.
   - ☐ The option body remains the scrolling region; footer actions stay reachable.

## Sign-off

- Device / Android version:
- Tester:
- Date:
- Result: ☐ pass ☐ fail
- Failure evidence / reproduction:
