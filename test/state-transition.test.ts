import test from "node:test";
import assert from "node:assert/strict";
import { canTransition, type TransitionTable } from "../packages/platform-core/src/state-transition.js";

type Light = "red" | "green" | "amber";
const lights: TransitionTable<Light> = {
  red: ["green"],
  green: ["amber"],
  amber: [],
};

test("An allowed move returns true", () => {
  assert.equal(canTransition(lights, "red", "green"), true);
  assert.equal(canTransition(lights, "green", "amber"), true);
});

test("A move that is not listed returns false, including a move out of a terminal state (an empty list)", () => {
  assert.equal(canTransition(lights, "red", "amber"), false);
  assert.equal(canTransition(lights, "green", "red"), false);
  assert.equal(canTransition(lights, "amber", "red"), false);
  assert.equal(canTransition(lights, "amber", "green"), false);
});

test("A table that omits a state fails type checking", () => {
  // @ts-expect-error amber is missing from this table, so type checking must reject it
  const partial: TransitionTable<Light> = { red: ["green"], green: ["red"] };
  assert.equal(canTransition(partial, "red", "green"), true);
});
