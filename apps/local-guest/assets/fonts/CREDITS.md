# Landing fonts: credits and licences

Self-hosted by the local guest server at `/landing/fonts/<file>` (issue 07). No font is requested from any other host.
Both families are licensed under the SIL Open Font License 1.1. The licence texts are in `OFL-Newsreader.txt` and `OFL-HankenGrotesk.txt`.

| File | Family | Source | Licence | Settings |
| --- | --- | --- | --- | --- |
| `newsreader-500.woff2` | Newsreader (roman) | https://github.com/google/fonts/tree/main/ofl/newsreader (`Newsreader[opsz,wght].ttf`) | OFL 1.1 | Static instance wght=500, opsz=72 |
| `newsreader-italic-400.woff2` | Newsreader (italic) | https://github.com/google/fonts/tree/main/ofl/newsreader (`Newsreader-Italic[opsz,wght].ttf`) | OFL 1.1 | Static instance wght=400, opsz=72 |
| `hanken-grotesk-400-700.woff2` | Hanken Grotesk | https://github.com/google/fonts/tree/main/ofl/hankengrotesk (`HankenGrotesk[wght].ttf`) | OFL 1.1 | Variable, wght axis limited to 400-700 |

Common settings for all three: subset to U+0000-00FF, U+0131, U+0152-0153, U+02C6, U+02DA, U+02DC, U+2000-206F, U+20A6 (naira sign), U+20AC, U+2122, U+2212; layout features kept; name table kept; WOFF2 flavour. Subsetting ran before instancing.

Glyph coverage: Newsreader has U+20A6. Hanken Grotesk does not, so prices use the display face (`--landing-font-money`).
