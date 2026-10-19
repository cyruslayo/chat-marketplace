import type { HttpRequestLike, HttpResponseLike } from "../../../packages/platform-core/src/http-like.js";
import { GUEST_HTML_SECURITY_HEADERS } from "../../../packages/platform-core/src/security-headers.js";
import type { createCommercePack } from "../../../domains/commerce/src/index.js";
import { commerceDiscoveryPresentation, commerceOrderPresentation } from "../../web-agent/src/commerce-presentation.js";
import { COMMERCE_GUEST_COPY as COPY, commerceSoldBy } from "../../web-agent/src/guest-content.js";
import { appFrameHtml, commerceOfferHtml } from "./guest-kit.js";
import type { RouteModule } from "./guest-shell.js";
import { escapeHtml, formatWatDateTime, pageShell } from "../../web/src/ui-kit.js";

type Commerce = ReturnType<typeof createCommercePack>;

// Implementation limits, not traced to an ADR: they bound request size and form input, and are not policy.
/** The largest tracking form body that is read; a larger request is refused. */
const TRACKING_BODY_LIMIT_BYTES = 4096;
/** The maximum length of the public order code field. */
const PUBLIC_CODE_MAX_LENGTH = 100;
/** The maximum length of the phone field. */
const PHONE_MAX_LENGTH = 32;
/** The shared-cache lifetime of public store and offer pages, in seconds. */
const PUBLIC_PAGE_MAX_AGE_SECONDS = 60;

function sendHtml(res: HttpResponseLike, html: string, status = 200, privatePage = false): void {
  res.writeHead(status, {
    ...GUEST_HTML_SECURITY_HEADERS,
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": privatePage ? "no-store" : `public, max-age=${PUBLIC_PAGE_MAX_AGE_SECONDS}`,
    "Referrer-Policy": "no-referrer",
  });
  res.end(html);
}

function decodeSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

interface TrackedOrder {
  readonly publicCode: string;
  readonly status: string;
  readonly updatedAt: string;
}

function trackPage(result?: TrackedOrder, error?: string): string {
  const content = result === undefined
    ? `<section class="ui-panel ui-stack"><h1>${COPY.trackOrderTitle}</h1><p>${COPY.trackOrderIntro}</p><form method="post" action="/orders/track" class="ui-stack"><div class="ui-field"><label class="ui-field__label" for="public-code">${COPY.publicCodeLabel}</label><input id="public-code" name="publicCode" type="text" required maxlength="${PUBLIC_CODE_MAX_LENGTH}" autocomplete="off" autocapitalize="characters" spellcheck="false"></div><div class="ui-field"><label class="ui-field__label" for="order-phone">${COPY.phoneLabel}</label><input id="order-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required maxlength="${PHONE_MAX_LENGTH}" aria-describedby="order-phone-help"><p class="ui-field__hint" id="order-phone-help">${COPY.phoneHint}</p></div><button class="ui-button ui-button--primary ui-button--block" type="submit">${COPY.trackOrderSubmit}</button></form></section>`
    : `<section class="ui-panel ui-stack" aria-live="polite"><h1>${COPY.orderStatusTitle}</h1><p><strong>${COPY.publicCodeHeading}</strong><br>${escapeHtml(result.publicCode)}</p><p><strong>${COPY.statusHeading}</strong><br>${escapeHtml(result.status)}</p><p><strong>${COPY.lastUpdatedHeading}</strong><br><time datetime="${escapeHtml(result.updatedAt)}">${escapeHtml(formatWatDateTime(result.updatedAt))}</time></p><a class="ui-button ui-button--secondary ui-button--block" href="/orders/track">${COPY.trackAnotherOrder}</a></section>`;
  const alert = error === undefined ? "" : `<p class="ui-banner ui-banner--warning" role="alert">${escapeHtml(error)}</p>`;
  return pageShell({ title: `${COPY.trackOrderTitle} · ${COPY.pageTitleSuffix}`, width: "narrow", frame: appFrameHtml({ threadId: null }), body: `${content}${alert}` });
}

function readForm(req: HttpRequestLike): Promise<URLSearchParams> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > TRACKING_BODY_LIMIT_BYTES) {
        reject(new Error("request body too large"));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", reject);
    req.on("end", () => resolve(new URLSearchParams(Buffer.concat(chunks).toString("utf8"))));
  });
}

function notFoundPage(title: string, body: string, frame: string): string {
  return pageShell({ title: `${title} · ${COPY.pageTitleSuffix}`, width: "narrow", body: `<section class="ui-panel ui-empty"><h1>${title}</h1><p>${body}</p></section>`, frame });
}

function storePage(commerce: Commerce, slug: string): string | null {
  const store = commerce.directory.consumerStores().find((candidate) => candidate.slug === slug);
  if (!store) return null;
  const merchant = commerce.directory.merchantById(store.merchantId);
  if (!merchant || merchant.status !== "verified") return null;
  const offers = commerce.catalogue.offersForStore(store.id).filter((offer) => offer.stock > 0);
  const presented = commerceDiscoveryPresentation(offers.map((offer) => ({
    offerId: offer.offerId,
    storeName: store.name,
    merchantName: merchant.name,
    productName: offer.productName,
    category: offer.category,
    description: offer.description,
    priceKobo: offer.priceKobo,
    stock: offer.stock,
  })));
  const cards = presented.offers.map((offer) => commerceOfferHtml(offer, `/s/${encodeURIComponent(slug)}/offers/${encodeURIComponent(offer.offerId)}`)).join("");
  const body = `<header class="ui-page__header"><p class="ui-eyebrow">${COPY.verifiedStore}</p><h1>${escapeHtml(store.name)}</h1><p>${escapeHtml(commerceSoldBy(merchant.name))}</p></header>${cards || `<section class="ui-panel ui-empty"><h2>${COPY.noOffersTitle}</h2><p>${COPY.noOffersBody}</p></section>`}<p><a class="ui-link" href="/orders/track">${COPY.trackOrderLink}</a></p>`;
  return pageShell({ title: `${store.name} · ${COPY.pageTitleSuffix}`, body, frame: appFrameHtml({ threadId: null, brand: store.name }) });
}

export function createCommerceRouteModule(commerce: Commerce): RouteModule {
  return {
    name: "commerce",
    async tryHandle(req, res, url) {
      if (req.method === "GET" && url.pathname === "/orders/track") {
        sendHtml(res, trackPage(), 200, true);
        return true;
      }
      if (req.method === "POST" && url.pathname === "/orders/track") {
        try {
          const form = await readForm(req);
          const code = form.get("publicCode");
          const phone = form.get("phone");
          // ADR 0075: one domain lookup for every input. An unknown code, a wrong phone and a blank phone share one response.
          const tracked = commerce.orders.trackOrder(typeof code === "string" ? code : "", typeof phone === "string" ? phone : "");
          if (tracked === null) {
            sendHtml(res, trackPage(undefined, COPY.orderNotFound), 200, true);
            return true;
          }
          sendHtml(res, trackPage(commerceOrderPresentation(tracked)), 200, true);
        } catch {
          sendHtml(res, trackPage(undefined, COPY.orderLookupFailed), 400, true);
        }
        return true;
      }
      const storeMatch = /^\/s\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(url.pathname);
      if (req.method === "GET" && storeMatch) {
        const body = storePage(commerce, storeMatch[1]!);
        if (body === null) {
          sendHtml(res, notFoundPage(COPY.storeUnavailableTitle, COPY.storeUnavailableBody, appFrameHtml({ threadId: null })), 404);
        } else sendHtml(res, body);
        return true;
      }
      const offerMatch = /^\/s\/([a-z0-9]+(?:-[a-z0-9]+)*)\/offers\/([^/]+)$/.exec(url.pathname);
      if (req.method === "GET" && offerMatch) {
        const store = commerce.directory.consumerStores().find((candidate) => candidate.slug === offerMatch[1]);
        const merchant = store ? commerce.directory.merchantById(store.merchantId) : null;
        const offerId = decodeSegment(offerMatch[2]!);
        const offer = store && offerId !== null && commerce.catalogue.offersForStore(store.id).find((candidate) => candidate.offerId === offerId);
        if (!store || !merchant || merchant.status !== "verified" || !offer || offer.stock <= 0) {
          sendHtml(res, notFoundPage(COPY.offerUnavailableTitle, COPY.offerUnavailableBody, appFrameHtml({ threadId: null })), 404);
        } else {
          const presentation = commerceDiscoveryPresentation([{ offerId: offer.offerId, storeName: store.name, merchantName: merchant.name, productName: offer.productName, category: offer.category, description: offer.description, priceKobo: offer.priceKobo, stock: offer.stock }]).offers[0]!;
          sendHtml(res, pageShell({ title: `${presentation.productName} · ${store.name}`, width: "narrow", frame: appFrameHtml({ threadId: null, brand: store.name }), body: `<header class="ui-page__header"><p class="ui-eyebrow">${escapeHtml(store.name)}</p><h1>${escapeHtml(presentation.productName)}</h1></header>${commerceOfferHtml(presentation, null, { omitHeading: true })}<p><a class="ui-link" href="/">${COPY.continueInChatLink}</a></p>` }));
        }
        return true;
      }
      if (req.method === "GET" && url.pathname === "/cart") {
        sendHtml(res, pageShell({ title: `${COPY.cartPageTitle} · ${COPY.pageTitleSuffix}`, width: "narrow", frame: appFrameHtml({ threadId: null }), body: `<section class="ui-panel ui-empty"><h1>${COPY.cartTitle}</h1><p>${COPY.cartBody}</p><a class="ui-button ui-button--primary ui-button--block" href="/">${COPY.continueInChatButton}</a></section>` }));
        return true;
      }
      return false;
    },
  };
}
