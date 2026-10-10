# Shortlet UI foundations — contrast and viewport proof

Generated against `apps/web/src/shortlet-foundations.css` using the WCAG relative-luminance formula. The foundation test recomputes these values and checks text at 4.5:1, UI boundaries/focus at 3:1.

| Pair | Contrast | Minimum | Result |
| --- | ---: | ---: | --- |
| Primary text `#1D2923` / canvas `#F6F5F0` | 13.80:1 | 4.5:1 | Pass |
| Secondary text `#49574E` / canvas `#F6F5F0` | 6.98:1 | 4.5:1 | Pass |
| Muted text `#5D6A62` / canvas `#F6F5F0` | 5.19:1 | 4.5:1 | Pass |
| White primary-action text / action `#0B5C46` | 7.97:1 | 4.5:1 | Pass |
| Focus `#995300` / canvas `#F6F5F0` | 5.36:1 | 3:1 | Pass |
| Focus `#995300` / white `#FFFFFF` | 5.85:1 | 3:1 | Pass |
| Border `#747C75` / canvas `#F6F5F0` | 3.94:1 | 3:1 | Pass |
| Success `#176B49` / `#EAF4EE` | 5.77:1 | 4.5:1 | Pass |
| Warning `#7A4C00` / `#FFF2D6` | 6.61:1 | 4.5:1 | Pass |
| Danger `#A12B2B` / `#FCECEC` | 6.34:1 | 4.5:1 | Pass |
| Info `#185F83` / `#EAF3F8` | 6.22:1 | 4.5:1 | Pass |

Real Chromium proof used an explicit CSS viewport (`window.innerWidth`) at 320×900, 390×900, 768×900, and 1280×900 for both Guest and Operator inbox. All reported `scrollWidth <= clientWidth`. Focus was keyboard-triggered and computed to a 3px solid `#995300` outline. Weaver-mounted Guest output was exercised at 390px.

Screenshots are beside this report: `guest-home-{320,390,768,1280}.png`, `guest-weaver-390.png`, `focus-visible.png`, and `operator-inbox-{320,390,768,1280}.png`. Operator login is captured as `operator-login.png`.
