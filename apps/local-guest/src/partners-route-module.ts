import { createHash } from "node:crypto";
import type { AssetLoader } from "../../../packages/platform-core/src/asset-loader.js";
import type {
  HttpRequestLike,
  HttpResponseLike,
} from "../../../packages/platform-core/src/http-like.js";
import { GUEST_HTML_SECURITY_HEADERS } from "../../../packages/platform-core/src/security-headers.js";
import type { RouteModule } from "./guest-shell.js";
import { landingThemeFromCookie } from "./landing-theme.js";
import {
  partnerInputFromForm,
  validatePartnerApplication,
} from "./partner-application.js";
import type { PartnerApplicationStore } from "./partner-application-store.js";
import {
  renderPartnersHtml,
  type PartnerFormState,
} from "./partners-page-html.js";

/** Where applications go. Absent while no privacy notice is configured: the form is closed and nothing is collected. */
export interface PartnerApplicationIntake {
  /** Null when the form is open without a privacy notice (owner decision, 26 Nov 2026). */
  readonly privacyNoticeUrl: string | null;
  readonly store: PartnerApplicationStore;
  readonly newFormKey: () => string;
}

export interface PartnersRouteOptions {
  readonly assets: AssetLoader;
  readonly intake: PartnerApplicationIntake | null;
  /** The host's origin rule and its form reader, bounded for this form (ADR 0099: hosts compose, routes decide). */
  readonly originAccepted: (req: HttpRequestLike) => boolean;
  readonly readForm: (req: HttpRequestLike) => Promise<URLSearchParams>;
}

const FORM_KEY = /^[0-9a-f-]{36}$/;

function text(res: HttpResponseLike, status: number, message: string): void {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(message);
}

/** ADR 0099: a public marketing route, run before the shortlet session dispatch. It reads no session and sets no cookie. */
export function createPartnersRouteModule(
  options: PartnersRouteOptions,
): RouteModule {
  const { intake } = options;

  const page = (
    req: HttpRequestLike,
    res: HttpResponseLike,
    status: number,
    form: PartnerFormState,
  ): void => {
    res.writeHead(status, {
      ...GUEST_HTML_SECURITY_HEADERS,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      Vary: "Cookie",
    });
    res.end(renderPartnersHtml({ theme: landingThemeFromCookie(req), form }));
  };

  const emptyForm = (): PartnerFormState =>
    intake === null
      ? { kind: "closed" }
      : {
          kind: "open",
          privacyNoticeUrl: intake.privacyNoticeUrl,
          formKey: intake.newFormKey(),
        };

  const apply = async (
    req: HttpRequestLike,
    res: HttpResponseLike,
  ): Promise<void> => {
    if (!options.originAccepted(req)) {
      text(res, 403, "Origin rejected");
      return;
    }
    // Fail closed before reading a byte: with no privacy notice nothing is collected (ADR 0075, ADR 0095).
    if (intake === null) {
      req.resume();
      page(req, res, 503, { kind: "closed" });
      return;
    }
    let form: URLSearchParams;
    try {
      form = await options.readForm(req);
    } catch {
      text(res, 413, "Form is too large");
      return;
    }
    const input = partnerInputFromForm(form);
    const postedKey = form.getAll("formKey");
    const formKey =
      postedKey.length === 1 && FORM_KEY.test(postedKey[0]!)
        ? postedKey[0]!
        : intake.newFormKey();
    const open = {
      kind: "open",
      privacyNoticeUrl: intake.privacyNoticeUrl,
      formKey,
      input,
    } as const;
    const result = validatePartnerApplication(input);
    if (!result.ok) {
      page(req, res, 422, { ...open, errors: result.errors });
      return;
    }
    // The same form with the same answers is one application; changed answers are a new one and are never dropped.
    const submissionKey = createHash("sha256")
      .update(JSON.stringify([formKey, result.application]))
      .digest("hex");
    try {
      intake.store.save({
        application: result.application,
        submissionKey,
        privacyNoticeUrl: intake.privacyNoticeUrl,
      });
    } catch {
      // ADR 0075: the error may quote the row, so it is neither logged nor shown.
      page(req, res, 503, { ...open, unavailable: true });
      return;
    }
    res.writeHead(303, {
      Location: "/partners/applied#application",
      "Cache-Control": "no-store",
    });
    res.end();
  };

  return {
    name: "partners",
    async tryHandle(req, res, url) {
      if (req.method === "GET" && url.pathname === "/partners") {
        page(req, res, 200, emptyForm());
        return true;
      }
      if (req.method === "GET" && url.pathname === "/partners/applied") {
        page(
          req,
          res,
          200,
          intake === null ? { kind: "closed" } : { kind: "sent" },
        );
        return true;
      }
      if (req.method === "POST" && url.pathname === "/partners/apply") {
        await apply(req, res);
        return true;
      }
      if (
        req.method === "GET" &&
        (url.pathname === "/xenia-partners.css" ||
          url.pathname === "/partners.js")
      ) {
        const stylesheet = url.pathname === "/xenia-partners.css";
        try {
          const body = options.assets.text(
            stylesheet ? "xenia-partners.css" : "partners.js",
          );
          res.writeHead(200, {
            "Content-Type": stylesheet
              ? "text/css; charset=utf-8"
              : "text/javascript; charset=utf-8",
            ...(stylesheet ? { "Cache-Control": "public, max-age=3600" } : {}),
          });
          res.end(body);
        } catch {
          text(res, 404, "Not Found");
        }
        return true;
      }
      return false;
    },
  };
}
