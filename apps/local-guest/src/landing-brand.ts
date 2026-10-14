/**
 * The Shortlet logomark for the brand layer (landing direction, "Brand mark"): a speech bubble whose top is a roof peak,
 * with a keyhole. Inline SVG with no colour literals: the fill and the cut-out come from landing tokens in
 * shortlet-landing.css. It is decorative (aria-hidden); the link around it carries the accessible name "Shortlet".
 */
export function brandMarkSvg(): string {
  return '<svg class="landing-mark" width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" focusable="false"><path class="landing-mark__shape" d="M14 2.5 25.5 11v10a2.5 2.5 0 0 1-2.5 2.5h-9.5L8 27.5v-4H5A2.5 2.5 0 0 1 2.5 21V11Z"/><circle class="landing-mark__cut" cx="14" cy="14.3" r="2.6"/><rect class="landing-mark__cut" x="12.9" y="15.4" width="2.2" height="4.4" rx="1.1"/></svg>';
}
