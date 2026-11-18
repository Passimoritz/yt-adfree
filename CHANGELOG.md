# Changelog

## 1.2.2 – 2026-11-18

- **Signed in, clicking to the next video:** no more short pause and no more “Experiencing interruptions?” hint. The request that runs on your account stays untouched; the ad-free video data is fetched in parallel without the account and swapped into YouTube’s answer before the player reads it, so nothing has to be reloaded.
- The “Experiencing interruptions?” snackbar is hidden if it still shows up.
- Repository in English (German README in `README.de.md`), new banner, charts, comparison image and screenshots, `tools/test/benchmark.js` as the single measurement script, MIT license.

## 1.2.1 – 2026-11-18

- Diagnostics: the log records which script paused the video and where YouTube’s hint appears.

## 1.2.0 – 2026-11-18

- **Signed in:** YouTube ignores the ad-free tag for accounts and then held videos back (black screen with spinner, start paused at 0:00). Now only the video request itself goes out without the account. Videos that need a sign-in are loaded normally.
- Network blocking rules removed: blocked ad pings are a detection signal, and merely fast-forwarding ads does not avoid YouTube’s waiting penalty (measured).

## 1.1.3 – 2026-11-18

- Local diagnostic log (last 400 events).
- The stall watchdog no longer restarts a video that is still loading at the very start.

## 1.1.2 – 2026-11-18

- Watchdog: resumes pauses you didn’t make (at most 3 per minute) and re-requests a video stuck mid-way.
- The safety-net skipper no longer jumps to the end of short videos when an ad is stitched into the stream.

## 1.1.1 – 2026-11-18

- The anti-adblock dialog is closed properly instead of only hidden (it blocked scrolling and paused the video).

## 1.1.0 – 2026-11-18

- First release: ad-free request tag, ad data filter, waiting-penalty timer fix, CSS hiding, safety-net skipper, rules from the uBlock Origin lists and EasyList every 6 hours, Chrome and Firefox builds.
