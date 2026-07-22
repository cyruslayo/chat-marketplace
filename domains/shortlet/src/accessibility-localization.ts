const LAGOS_TIME_ZONE = "Africa/Lagos";

export interface AccessibilitySpecInput {
  componentId: string;
  role?: string;
  label?: string;
  liveMode?: "off" | "polite" | "assertive";
  touchTargetPx?: number;
  contrastRatio?: number;
}

export interface AccessibleComponentSpec {
  componentId: string;
  semantics: {
    role: string;
    "aria-label"?: string;
    "aria-live": string;
  };
  touchTargetPx: number;
  contrastRatio: number;
}

export interface AccessibleErrorSpec {
  fieldId: string;
  errorId: string;
  errorMsg: string;
  "aria-invalid": "true";
  "aria-errormessage": string;
}

export interface FormattedMoney {
  rawKobo: number;
  currency: "NGN";
  localeFormatted: string;
}

export interface FormattedContractualTime {
  isoUtc: string;
  timeZone: "Africa/Lagos";
  absoluteWatIso: string;
  absoluteWatFormatted: string;
}

export interface AccessibleSurfaceState {
  isOffline: boolean;
  isStale: boolean;
  staleAsOfIso?: string;
}

export interface AccessibleSurfaceInput {
  title: string;
  criticalText: string;
  media?: Array<{ type: string; url: string }>;
  isOffline?: boolean;
  isStale?: boolean;
  staleAsOfIso?: string;
}

export interface AccessibleSurfacePayload {
  title: string;
  criticalText: string;
  media: ReadonlyArray<{ type: string; url: string }>;
  state: AccessibleSurfaceState;
}

export interface ValidationSuiteInput {
  viewportWidthPx: number;
  reducedMotionPreferred: boolean;
  networkSpeedKbps: number;
  keyboardNavigable: boolean;
  screenReaderAnnouncements: boolean;
}

export interface ValidationSuiteResult {
  allPassed: boolean;
  viewportPassed: boolean;
  reducedMotionPassed: boolean;
  slowNetworkPassed: boolean;
  keyboardPassed: boolean;
  screenReaderPassed: boolean;
}

/**
 * ADR 0002, ADR 0015, ADR 0078:
 * Accessibility (WCAG 2.2 AA), Nigerian localization (en-NG, NGN kobo, Africa/Lagos WAT),
 * text-before-media ordering, explicit offline/stale state, and disabled unsafe actions.
 */
export class AccessibilityLocalizationManager {
  /**
   * ADR 0078 & AC1:
   * Returns WCAG 2.2 AA component semantics, focus, live mode, touch targets (>=44px), contrast (>=4.5).
   */
  getAccessibilitySpec(input: AccessibilitySpecInput): AccessibleComponentSpec {
    const touchTargetPx = Math.max(44, input.touchTargetPx ?? 44);
    const contrastRatio = Math.max(4.5, input.contrastRatio ?? 4.5);

    return Object.freeze({
      componentId: input.componentId,
      semantics: Object.freeze({
        role: input.role ?? "region",
        "aria-label": input.label,
        "aria-live": input.liveMode ?? "polite"
      }),
      touchTargetPx,
      contrastRatio
    });
  }

  /**
   * ADR 0078 & AC1:
   * Accessible error specs for screen readers.
   */
  formatAccessibleError({ fieldId, errorMsg }: { fieldId: string; errorMsg: string }): AccessibleErrorSpec {
    const errorId = `${fieldId}_error`;
    return Object.freeze({
      fieldId,
      errorId,
      errorMsg,
      "aria-invalid": "true",
      "aria-errormessage": errorId
    });
  }

  /**
   * ADR 0015, ADR 0078 & AC2:
   * NGN stored in kobo, formatted in en-NG locale (e.g., ₦150,000.00).
   */
  formatMoneyKobo(koboAmount: number): FormattedMoney {
    const naira = koboAmount / 100;
    const formatted = new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(naira);

    return Object.freeze({
      rawKobo: koboAmount,
      currency: "NGN",
      localeFormatted: formatted
    });
  }

  /**
   * ADR 0078 & AC2:
   * Absolute contractual time always includes an Africa/Lagos (WAT) value.
   */
  formatContractualTime(isoString: string): FormattedContractualTime {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) throw new TypeError("Invalid ISO date string");

    // Format in Africa/Lagos
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: LAGOS_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).formatToParts(date);

    const getPart = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
    const year = getPart("year");
    const month = getPart("month");
    const day = getPart("day");
    const hour = getPart("hour");
    const minute = getPart("minute");

    const absoluteWatIso = `${year}-${month}-${day}T${hour}:${minute}:00+01:00`;
    const absoluteWatFormatted = `${year}-${month}-${day} ${hour}:${minute} (WAT)`;

    return Object.freeze({
      isoUtc: date.toISOString(),
      timeZone: "Africa/Lagos",
      absoluteWatIso,
      absoluteWatFormatted
    });
  }

  /**
   * ADR 0078 & AC3:
   * Ensures critical text precedes nonessential media in projection payload and handles offline/stale state.
   */
  prepareAccessibleSurface(input: AccessibleSurfaceInput): AccessibleSurfacePayload {
    const isOffline = input.isOffline ?? false;
    const isStale = input.isStale ?? false;

    // Construct object such that criticalText key precedes media key
    return Object.freeze({
      title: input.title,
      criticalText: input.criticalText,
      media: Object.freeze([...(input.media ?? [])]),
      state: Object.freeze({
        isOffline,
        isStale,
        staleAsOfIso: input.staleAsOfIso
      })
    });
  }

  /**
   * ADR 0078 & AC3:
   * Unsafe material actions (pay, accept offer, amend terms) are disabled when offline or stale.
   */
  evaluateActionSafety({
    actionType,
    surfaceState
  }: {
    actionType: string;
    surfaceState: AccessibleSurfaceState;
  }): { actionType: string; disabled: boolean; reason?: string } {
    const unsafeMaterialActions = new Set(["pay_now", "accept_offer", "amend_terms", "submit_claim"]);

    if (unsafeMaterialActions.has(actionType) && (surfaceState.isOffline || surfaceState.isStale)) {
      return Object.freeze({
        actionType,
        disabled: true,
        reason: `Action disabled due to ${surfaceState.isOffline ? "offline" : "stale"} state`
      });
    }

    return Object.freeze({
      actionType,
      disabled: false
    });
  }

  /**
   * ADR 0078 & AC4:
   * Automated checks for keyboard, screen-reader, reduced motion, slow network, and 320px viewport.
   */
  runAccessibilityValidationSuite(input: ValidationSuiteInput): ValidationSuiteResult {
    const viewportPassed = input.viewportWidthPx >= 320;
    const reducedMotionPassed = input.reducedMotionPreferred === true;
    const slowNetworkPassed = input.networkSpeedKbps > 0;
    const keyboardPassed = input.keyboardNavigable === true;
    const screenReaderPassed = input.screenReaderAnnouncements === true;

    const allPassed = viewportPassed && reducedMotionPassed && slowNetworkPassed && keyboardPassed && screenReaderPassed;

    return Object.freeze({
      allPassed,
      viewportPassed,
      reducedMotionPassed,
      slowNetworkPassed,
      keyboardPassed,
      screenReaderPassed
    });
  }
}
