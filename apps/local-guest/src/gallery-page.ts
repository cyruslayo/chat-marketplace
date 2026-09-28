// The full apartment page's only script (guest-gallery issue 01): it enhances the server-rendered gallery. The page
// works without it (ADR 0080); the chat bundle (client.ts) enhances the chat's gallery itself.
import { enhanceListingGallery } from "./listing-gallery.js";

const run = (): void => {
  for (const gallery of document.querySelectorAll<HTMLElement>(".listing-gallery")) enhanceListingGallery(gallery);
};

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
else run();
