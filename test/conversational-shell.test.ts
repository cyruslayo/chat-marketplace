import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canUseSurfaceActions,
  closeFocusedSurface,
  createConversationShellState,
  fallbackSummary,
  markActiveSurfaceStatus,
  replaceActiveSurface,
  reopenFocusedSurface,
  type SurfacePresentation,
} from "../apps/local-guest/src/conversational-shell.js";

function surface(overrides: Partial<SurfacePresentation> = {}): SurfacePresentation {
  return {
    surfaceId: "surface-a",
    mode: "inline-surface",
    status: "active",
    summary: "Discovery results",
    ...overrides,
  };
}

test("one primary rich surface can be active", () => {
  const first = replaceActiveSurface(createConversationShellState(), surface());
  const second = replaceActiveSurface(first, surface({ surfaceId: "surface-b", summary: "Unit details" }));

  assert.equal(second.activeSurface?.surfaceId, "surface-b");
  assert.equal(second.historicalSummaries.length, 1);
  assert.equal(second.historicalSummaries[0]?.surfaceId, "surface-a");
  assert.equal(second.historicalSummaries[0]?.summary, "Discovery results");
  assert.equal(second.historicalSummaries[0]?.status, "superseded");
  assert.equal(canUseSurfaceActions(second.historicalSummaries[0]!.status), false);
});

test("a same-identity surface revision replaces content without duplicating history", () => {
  const first = replaceActiveSurface(createConversationShellState(), surface());
  const revised = replaceActiveSurface(first, surface({ summary: "Updated discovery results" }));

  assert.equal(revised.historicalSummaries.length, 0);
  assert.equal(revised.activeSurface?.summary, "Updated discovery results");
});

test("stale and expired surfaces cannot keep consequential actions active", () => {
  assert.equal(canUseSurfaceActions("active"), true);
  assert.equal(canUseSurfaceActions("stale"), false);
  assert.equal(canUseSurfaceActions("expired"), false);
  assert.equal(canUseSurfaceActions("fallback"), false);
});

test("focused surfaces close and reopen within the same conversation context", () => {
  const focused = replaceActiveSurface(
    createConversationShellState(),
    surface({ surfaceId: "surface-focused", mode: "focused-surface" }),
  );
  const closed = closeFocusedSurface(focused);
  const reopened = reopenFocusedSurface(closed);

  assert.equal(closed.activeSurface?.surfaceId, "surface-focused");
  assert.equal(closed.focusedSurfaceOpen, false);
  assert.equal(reopened.focusedSurfaceOpen, true);
});

test("fallback preserves a safe textual meaning", () => {
  const fallback = surface({
    status: "fallback",
    summary: "Search results are available on the search page.",
    textFallback: "Search results are available on the search page.",
    conventionalRoute: "/stays/search",
  });

  assert.equal(fallbackSummary(fallback), "Search results are available on the search page.");
  assert.equal(canUseSurfaceActions(fallback.status), false);
});

test("a rejected stale action marks the visible workspace non-actionable", () => {
  const state = replaceActiveSurface(createConversationShellState(), surface());
  const stale = markActiveSurfaceStatus(state, "stale");

  assert.equal(stale.activeSurface?.status, "stale");
  assert.equal(stale.focusedSurfaceOpen, false);
  assert.equal(canUseSurfaceActions(stale.activeSurface!.status), false);
});
