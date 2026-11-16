/** ADR 0107 decision 8: ship suggestions only until labelled turns tune automatic-switch thresholds. */
export const MODE_SWITCH_TIERS_ENABLED = Object.freeze({ A: false, B: false, C: true });

export type ModeSwitchTier = "none" | "A" | "B" | "C";

/** Pure selection: a disabled automatic tier falls back to C; a missing or uncertain target cannot switch. */
export function modeSwitchTier(input: {
  readonly scope: "in_scope" | "mixed" | "out_of_scope" | "unclear";
  readonly targetPack: string | null;
  readonly packAtRisk: boolean;
  readonly freshTask?: boolean;
  readonly tiersEnabled: Readonly<{ A: boolean; B: boolean; C: boolean }>;
}): ModeSwitchTier {
  if (input.scope !== "out_of_scope" || input.targetPack === null) return "none";
  if (input.freshTask && input.tiersEnabled.A) return "A";
  if (!input.packAtRisk && input.tiersEnabled.B) return "B";
  return input.tiersEnabled.C ? "C" : "none";
}
