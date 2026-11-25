/**
 * The founding partner application: its fields, its rules and its messages (landing issue 17). Shared by the server route and
 * the browser script, so the two can never disagree; the server's answer is the authority (ADR 0004). No Node or DOM import.
 */
import { normalizeContactEmail } from "../../../packages/platform-core/src/accounts/contact.js";

export const PARTNER_AREAS = [
  "Wuse",
  "Maitama",
  "Asokoro",
  "Garki",
  "Gwarinpa",
  "Jabi",
  "Other",
] as const;
export const PARTNER_UNIT_RANGES = ["1", "2 to 5", "6 to 20", "20+"] as const;
export const PARTNER_STAY_LENGTHS = ["short", "monthly"] as const;

export type PartnerArea = (typeof PARTNER_AREAS)[number];
export type PartnerUnitRange = (typeof PARTNER_UNIT_RANGES)[number];
export type PartnerStayLength = (typeof PARTNER_STAY_LENGTHS)[number];

/** The sentence the applicant ticks. It is stored with the application, word for word, as the consent record. */
export const PARTNER_CONSENT_TEXT =
  "I agree that Xenia can contact me about this application.";

/** Engineering bounds on free text, not policy values. `how` is the field's maxlength; the route's body limit bounds it on the server. */
export const PARTNER_TEXT_MAX = Object.freeze({
  fullName: 200,
  business: 200,
  phone: 32,
  email: 254,
  how: 2000,
});

const PARTNER_FIELDS = [
  "fullName",
  "business",
  "phone",
  "email",
  "area",
  "units",
  "stays",
  "consent",
] as const;
/** The fields that can be wrong, in page order, so the first wrong one is the first on the page. */
export type PartnerField = (typeof PARTNER_FIELDS)[number];

export interface PartnerApplication {
  readonly fullName: string;
  readonly business: string;
  readonly phone: string;
  readonly email: string;
  readonly area: PartnerArea;
  readonly units: PartnerUnitRange;
  readonly stays: readonly PartnerStayLength[];
  /** Empty when the applicant left the optional question blank. */
  readonly how: string;
}

/** What the applicant typed, kept so a refused form comes back filled in. */
export interface PartnerApplicationInput {
  readonly fullName: string;
  readonly business: string;
  readonly phone: string;
  readonly email: string;
  readonly area: string;
  readonly units: string;
  readonly stays: readonly string[];
  readonly how: string;
  readonly consent: boolean;
}

export const EMPTY_PARTNER_INPUT: PartnerApplicationInput = Object.freeze({
  fullName: "",
  business: "",
  phone: "",
  email: "",
  area: "",
  units: "",
  stays: Object.freeze([]) as readonly string[],
  how: "",
  consent: false,
});

export type PartnerApplicationErrors = Readonly<
  Partial<Record<PartnerField, string>>
>;

/** The design's messages: what is wrong, what it stops, and what to do. */
export const PARTNER_ERROR_TEXT: Readonly<Record<PartnerField, string>> =
  Object.freeze({
    fullName:
      "Your full name is missing, so we don’t know who to ask for. Enter the name we should use.",
    business:
      "Your business name is missing, so we can’t review the application. Enter the name of your business.",
    phone:
      "This phone number looks incomplete, so we can’t call you. Enter it with the country code, like +234 801 234 5678.",
    email:
      "This email address isn’t complete, so we can’t write to you. Enter it in the form name@example.com.",
    area: "No area is chosen, so we can’t plan the inspection. Choose the area where your apartments are.",
    units:
      "The number of apartments is missing, so we can’t plan the visit. Choose the range that fits.",
    stays:
      "No stay length is ticked, so we don’t know which guests to bring you. Tick at least one.",
    consent:
      "We need your permission to contact you, or we can’t reply to this application. Tick the box to agree.",
  });

export function partnerErrorLine(count: number): string {
  return count === 1
    ? "1 answer needs fixing, so your application wasn’t sent. Check the field marked below, then send again."
    : `${count} answers need fixing, so your application wasn’t sent. Check the fields marked below, then send again.`;
}

/** Reads the posted fields. Repeated single fields are treated as missing: an ambiguous form is refused, never guessed. */
export function partnerInputFromForm(
  form: Pick<URLSearchParams, "getAll">,
): PartnerApplicationInput {
  const one = (name: string): string => {
    const values = form.getAll(name);
    return values.length === 1 ? values[0]!.trim() : "";
  };
  return {
    fullName: one("fullName"),
    business: one("business"),
    phone: one("phone"),
    email: one("email"),
    area: one("area"),
    units: one("units"),
    stays: form.getAll("stays"),
    how: one("how"),
    consent: one("consent") === "yes",
  };
}

function member<T extends string>(
  list: readonly T[],
  value: string,
): T | undefined {
  return list.find((entry) => entry === value);
}

function filled(value: string, max: number): boolean {
  return value !== "" && value.length <= max;
}

function phoneIsComplete(value: string): boolean {
  if (!filled(value, PARTNER_TEXT_MAX.phone) || !/^[+\d\s().-]+$/.test(value))
    return false;
  const digits = value.replace(/\D/g, "").length;
  // The design's lower bound; the upper bound is the longest international number (E.164).
  return digits >= 10 && digits <= 15;
}

function emailOf(value: string): string | undefined {
  try {
    return normalizeContactEmail(value);
  } catch {
    return undefined;
  }
}

export type PartnerApplicationResult =
  | { readonly ok: true; readonly application: PartnerApplication }
  | { readonly ok: false; readonly errors: PartnerApplicationErrors };

/** Every field must be present and recognised; anything missing or unknown is an error (fail closed). */
export function validatePartnerApplication(
  input: PartnerApplicationInput,
): PartnerApplicationResult {
  const area = member(PARTNER_AREAS, input.area);
  const units = member(PARTNER_UNIT_RANGES, input.units);
  const stays = PARTNER_STAY_LENGTHS.filter((length) =>
    input.stays.includes(length),
  );
  const email = emailOf(input.email);
  const wrong: Record<PartnerField, boolean> = {
    fullName: !filled(input.fullName, PARTNER_TEXT_MAX.fullName),
    business: !filled(input.business, PARTNER_TEXT_MAX.business),
    phone: !phoneIsComplete(input.phone),
    email: email === undefined,
    area: area === undefined,
    units: units === undefined,
    stays:
      stays.length === 0 ||
      input.stays.some(
        (value) => member(PARTNER_STAY_LENGTHS, value) === undefined,
      ),
    consent: !input.consent,
  };
  const fields = PARTNER_FIELDS.filter((field) => wrong[field]);
  if (
    fields.length > 0 ||
    email === undefined ||
    area === undefined ||
    units === undefined
  ) {
    return {
      ok: false,
      errors: Object.fromEntries(
        fields.map((field) => [field, PARTNER_ERROR_TEXT[field]]),
      ),
    };
  }
  return {
    ok: true,
    application: {
      fullName: input.fullName,
      business: input.business,
      phone: input.phone,
      email,
      area,
      units,
      stays,
      how: input.how,
    },
  };
}

export function firstWrongField(
  errors: PartnerApplicationErrors,
): PartnerField | undefined {
  return PARTNER_FIELDS.find((field) => errors[field] !== undefined);
}
