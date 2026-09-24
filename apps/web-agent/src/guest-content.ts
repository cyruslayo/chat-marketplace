const AMENITY_LABELS: Readonly<Record<string, string>> = {
  "24_7_power_generator": "24/7 backup power",
  air_conditioning: "Air conditioning",
  generator: "Backup power",
  parking: "Secure parking",
  security_guard: "On-site security",
  swimming_pool: "Swimming pool",
  wifi: "Wi-Fi",
  workspace: "Dedicated workspace",
};

export function guestAmenityLabel(identifier: string): string {
  const acceptedLabel = AMENITY_LABELS[identifier];
  if (acceptedLabel) return acceptedLabel;
  return identifier
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function guestOccupancyLabel(identifier: string): string | undefined {
  if (identifier === "entire-place" || identifier === "entire_place") return "Entire Place";
  return undefined;
}

export function guestInspectionDisclosure(inspection: {
  readonly status: string;
  readonly inspectedAt: string;
  readonly expiresAt: string;
  readonly scope: readonly string[];
}): string | undefined {
  if (inspection.status !== "current" && inspection.status !== "passed") return undefined;
  const inspectedAt = formatGuestDate(inspection.inspectedAt);
  const expiresAt = formatGuestDate(inspection.expiresAt);
  const scope = inspection.scope.map((item) => item
    .replaceAll("-", " ")
    .replaceAll("_", " "));
  return `Physical inspection completed${inspectedAt ? ` on ${inspectedAt}` : ""}${scope.length > 0 ? `. Scope: ${scope.join(", ")}` : ""}${expiresAt ? `. Inspection expiry: ${expiresAt}` : ""}.`;
}

export function formatGuestDate(value: string): string | undefined {
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}/.test(value) || Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}
