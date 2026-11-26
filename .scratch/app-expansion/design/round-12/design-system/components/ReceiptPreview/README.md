Receipt preview shows the Guest's uploaded receipt inline on the transfer check, at a readable size and labelled by its file type, so the Operator can compare it with the expected credit without leaving the page.

**Maps to:** `.ui-receipt` with `__meta`, `__frame`, `__label`, `__file`, `__name`, `__gone`. New: the shipped back office has only the "View receipt" button (`.bo-receipt`), which opens the upload in a new tab. That link stays, as "Open the receipt full size".

## Anatomy
1. Heading (from the parent): "The Guest's receipt".
2. Meta line: "Uploaded Thu 26 Nov 2026, 10:51 AM WAT · evidence only, not proof of payment".
3. Body, one of:
   - Image: a 3:4 frame (up to 520px tall), `object-fit: contain`, so the whole receipt shows. A type label sits top left: "Image · JPEG" (in design boards, "Illustration").
   - PDF: a file card with a document icon, the file name, "PDF · 182 KB", and "Open the receipt". Android Chrome can't show a PDF inline, so it is never embedded.
   - Deleted: "Deleted after 90 days", with the date it was removed and no link.
4. Link: "Open the receipt full size" (image) or "Open the receipt" (PDF). It opens the upload itself in a new tab, and says so to screen readers.

## Variants and states
| State | What shows |
| --- | --- |
| Image (idle) | Frame, type label, link. |
| PDF (idle) | File card, link. |
| Deleted after 90 days | `__gone` panel: "Deleted after 90 days", "Removed Sun 23 Nov 2026 under the retention rule. The decision on this transfer is unchanged." No link, no retry. |
| Loading | A receipt-shaped skeleton and "Loading the receipt…". The facts beside it are already shown, because text loads before media. |
| Failed to load | Warning banner: "The receipt didn't load", "Nothing was changed. The facts beside it still apply." and "Try again". The full-size link stays, as a fallback. |
| Hover, focus | On the links and "Try again" only. |
| Busy | "Try again" shows "Loading…" while the image refetches. |
| Success, invalid, disabled | Not applicable: the preview decides nothing. |
| Stale | Not applicable. The backend serves the upload with its own content type and no caching, so each view fetches the current file. |

## Backend contract it relies on
- `GET /operator/transfers/:id/receipt` returns the upload with its own `Content-Type` and `Cache-Control: no-store`. The preview chooses the image or PDF body from that content type, never from the file name.
- Retention: receipts are deleted after 90 days. The record keeps `receiptDeletedAt`, which drives the Deleted state.

## Tokens
`surface`, `surface-subtle`, `border`, `ink`, `ink-secondary`, `warning`, `warning-surface`, `indigo` (links), `radius-md`, `space-4`. Type: small 14/20 (meta), body 16/24.

## Accessibility
- Image: `alt="The Guest's receipt, uploaded 10:51 AM WAT"`. The alt can't promise what the image says; the Operator reads the expected facts beside it.
- PDF card: the link's name includes the file name and "(opens in a new tab)".
- Failed: `role="status"` on the banner; "Try again" is a real `<button>`.
- Keyboard: Tab to the link, then to "Try again" when shown.
- Targets: the links and the button are 44px.

## Rules
- The receipt is evidence, never proof. The confirm helper text says so, and the label never says "Verified".
- Never show the Guest's name. Receipts may carry one, so the preview never crops or reads text out of the upload.
