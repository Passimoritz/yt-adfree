# Third-party notices

YT AdFree’s own code is under the [MIT License](LICENSE). It does **not** bundle third-party code or filter lists. At runtime, `background.js` downloads the following lists from their public sources and uses only the YouTube rules from them. They stay under their own licenses:

| What | Source | License |
|---|---|---|
| uBlock Origin filters (`filters.txt` and its sub-lists, `quick-fixes.txt`) | [uBlockOrigin/uAssets](https://github.com/uBlockOrigin/uAssets) | [GPL-3.0](https://github.com/uBlockOrigin/uAssets/blob/master/LICENSE) |
| EasyList | [easylist.to](https://easylist.to) | [GPL-3.0 / CC BY-SA 3.0](https://easylist.to/pages/licence.html) (dual-licensed) |

Built-in defaults in `content-main.js` (ad-related keys such as `adSlots`, the request tag `oAEBogYBLg`, a timer rule) are short facts about how YouTube’s player data looks, written independently; no code from those projects was copied.

Development only (not shipped with the extension): [Playwright](https://github.com/microsoft/playwright) (Apache-2.0) for the measurement scripts in `tools/test/`.

## Trademarks

YouTube and Google are trademarks of Google LLC. YT AdFree is an independent project and is not affiliated with, endorsed or sponsored by Google or YouTube. The logo deliberately avoids YouTube’s brand elements.
