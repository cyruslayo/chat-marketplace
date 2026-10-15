import assert from "node:assert/strict";
import test from "node:test";
import { resolveAction, type ActionServerEvent, type ActionSpec, type CommandPrincipal } from "../packages/platform-core/src/index.js";

// The platform gate is exercised with a small in-memory spec + artifact so each rejection
// path (ADR 0072/0074) is covered without standing up a domain.

interface FixtureContext {
  readonly artifactId: string;
  readonly entityId: string;
  readonly expectedStatus: string;
  readonly projectionVersion: number;
}
interface FixtureArtifact {
  readonly id: string;
  readonly kind: string;
  readonly schemaVersion: string;
  readonly projectionVersion: number;
  readonly facts: { readonly entityId: string; readonly status: string };
  readonly actions: readonly { readonly type: string }[];
}

const principal: CommandPrincipal = { id: "guest-1", role: "guest", tenantId: "tenant-1" };
const validContext: FixtureContext = { artifactId: "fixture:entity-1", entityId: "entity-1", expectedStatus: "ready", projectionVersion: 1 };

function fixtureArtifact(overrides: Partial<FixtureArtifact> = {}): FixtureArtifact {
  return {
    id: "fixture:entity-1",
    kind: "fixture.artifact",
    schemaVersion: "fixture.artifact/v1",
    projectionVersion: 1,
    facts: { entityId: "entity-1", status: "ready" },
    actions: [{ type: "run" }],
    ...overrides,
  };
}

function fixtureSpec(
  overrides: Partial<ActionSpec<FixtureContext, FixtureArtifact, { readonly entityId: string }>> = {},
): ActionSpec<FixtureContext, FixtureArtifact, { readonly entityId: string }> {
  return {
    name: "fixture.run",
    artifact: {
      kind: "fixture.artifact",
      schemaVersion: "fixture.artifact/v1",
      load: () => fixtureArtifact(),
    },
    context: {
      required: {
        artifactId: { type: "string", nonEmpty: true },
        entityId: { type: "string" },
        expectedStatus: { type: "string" },
        projectionVersion: { type: "integer" },
      },
    },
    crossMatch: (context, artifact) =>
      context.artifactId !== artifact.id
        ? { code: "ARTIFACT_MISMATCH", message: "The action does not match the artifact." }
        : context.entityId !== artifact.facts.entityId
          ? { code: "ENTITY_MISMATCH", message: "The action does not match the entity." }
          : true,
    expect: [
      { expected: (context) => context.expectedStatus, actual: (artifact) => artifact.facts.status },
      { expected: (context) => context.projectionVersion, actual: (artifact) => artifact.projectionVersion },
    ],
    isAuthorized: (_context, artifact) => artifact.actions.some((action) => action.type === "run"),
    command: (context) => ({ commandName: "fixture.run", payload: { entityId: context.entityId } }),
    run: ({ context }) => fixtureArtifact({ facts: { entityId: context.entityId, status: context.expectedStatus } }),
    rejectionMessages: { stale: "The action is stale.", runRejected: "The action was rejected." },
    ...overrides,
  };
}

function event(name: string, context: unknown): ActionServerEvent {
  return { message: { action: { name, context } } };
}

test("An unsupported action name is rejected with UNSUPPORTED_ACTION", () => {
  const outcome = resolveAction(event("fixture.other", validContext), [fixtureSpec()], principal);
  assert.equal(!outcome.ok && outcome.code, "UNSUPPORTED_ACTION");
});

test("A malformed context (missing required key) is rejected with INVALID_CONTEXT", () => {
  const { projectionVersion, ...malformed } = validContext;
  const outcome = resolveAction(event("fixture.run", malformed), [fixtureSpec()], principal);
  assert.equal(!outcome.ok && outcome.code, "INVALID_CONTEXT");
});

test("A malformed context (unknown key) is rejected with INVALID_CONTEXT", () => {
  const outcome = resolveAction(event("fixture.run", { ...validContext, injected: true }), [fixtureSpec()], principal);
  assert.equal(!outcome.ok && outcome.code, "INVALID_CONTEXT");
});

test("A malformed context (wrong field type) is rejected with INVALID_CONTEXT", () => {
  const outcome = resolveAction(event("fixture.run", { ...validContext, projectionVersion: 1.5 }), [fixtureSpec()], principal);
  assert.equal(!outcome.ok && outcome.code, "INVALID_CONTEXT");
});

test("An unavailable authoritative artifact is rejected with INVALID_ARTIFACT", () => {
  const spec = fixtureSpec({ artifact: { kind: "fixture.artifact", schemaVersion: "fixture.artifact/v1", load: () => { throw new Error("missing"); } } });
  const outcome = resolveAction(event("fixture.run", validContext), [spec], principal);
  assert.equal(!outcome.ok && outcome.code, "INVALID_ARTIFACT");
});

test("A superseded artifact schema is rejected with INVALID_ARTIFACT", () => {
  const spec = fixtureSpec({ artifact: { kind: "fixture.artifact", schemaVersion: "fixture.artifact/v1", load: () => fixtureArtifact({ schemaVersion: "fixture.artifact/v2" }) } });
  const outcome = resolveAction(event("fixture.run", validContext), [spec], principal);
  assert.equal(!outcome.ok && outcome.code, "INVALID_ARTIFACT");
});

test("A context that names a different artifact is rejected with ARTIFACT_MISMATCH", () => {
  const outcome = resolveAction(event("fixture.run", { ...validContext, artifactId: "fixture:other" }), [fixtureSpec()], principal);
  assert.equal(!outcome.ok && outcome.code, "ARTIFACT_MISMATCH");
});

test("A context that names a different entity is rejected with ENTITY_MISMATCH", () => {
  const outcome = resolveAction(event("fixture.run", { ...validContext, entityId: "entity-2" }), [fixtureSpec()], principal);
  assert.equal(!outcome.ok && outcome.code, "ENTITY_MISMATCH");
});

test("A stale projection is rejected with STALE_ACTION", () => {
  const outcome = resolveAction(event("fixture.run", { ...validContext, projectionVersion: 2 }), [fixtureSpec()], principal);
  assert.equal(!outcome.ok && outcome.code, "STALE_ACTION");
  assert.equal(!outcome.ok && outcome.message, "The action is stale.");
});

test("An action the artifact does not advertise is rejected with ACTION_NOT_AUTHORIZED", () => {
  const spec = fixtureSpec({ artifact: { kind: "fixture.artifact", schemaVersion: "fixture.artifact/v1", load: () => fixtureArtifact({ actions: [] }) } });
  const outcome = resolveAction(event("fixture.run", validContext), [spec], principal);
  assert.equal(!outcome.ok && outcome.code, "ACTION_NOT_AUTHORIZED");
});

test("A domain run that throws is rejected with ACTION_NOT_AUTHORIZED and the pack message", () => {
  const spec = fixtureSpec({ run: () => { throw new Error("boom"); } });
  const outcome = resolveAction(event("fixture.run", validContext), [spec], principal);
  assert.equal(!outcome.ok && outcome.code, "ACTION_NOT_AUTHORIZED");
  assert.equal(!outcome.ok && outcome.message, "The action was rejected.");
});

test("A valid action runs with the gate-built platform command envelope and returns the refreshed artifact", () => {
  let seen: { commandName: string; entityId: string } | undefined;
  const spec = fixtureSpec({
    run: ({ context, envelope }) => {
      seen = { commandName: envelope!.commandName, entityId: (envelope!.payload as { entityId: string }).entityId };
      return fixtureArtifact({ facts: { entityId: context.entityId, status: context.expectedStatus } });
    },
  });
  const outcome = resolveAction(event("fixture.run", validContext), [spec], principal);
  assert.equal(outcome.ok, true);
  assert.deepEqual(seen, { commandName: "fixture.run", entityId: "entity-1" });
  assert.equal(outcome.ok && outcome.artifact.id, "fixture:entity-1");
});

test("The gate resolves the matching spec by name among several registered specs", () => {
  const other = fixtureSpec({ name: "fixture.other" });
  const outcome = resolveAction(event("fixture.other", validContext), [fixtureSpec(), other], principal);
  assert.equal(outcome.ok, true);
});
