# Establish explicit Operator representative grants

## Context

Issue 29 requires an authenticated actor to act for an Operator while ADR 0070 keeps actor and Operator identities distinct. Existing responsible-person verification, beneficial ownership, property Management Authority, and tenant identity do not define person-to-Operator command authority.

## Decision

At launch, an authenticated actor may act for an Operator only through an explicit server-side representative grant. Each grant has these minimum authoritative fields: opaque grant ID, actor ID, Operator ID, tenant ID, permission, `grantedAtIso`, `expiresAtIso`, authorized grantor ID, responsible-person verification timestamp, and optional opaque verification reference. A grant has one permission, `operator_actions`, for ordinary authenticated Operator-domain actions, including filing the Operator's Issue 29 enforcement appeal.

This permission does not authorize platform human-review decisions, enforcement final decisions, appeal decisions, administrative actions, settlement-account changes, or payout-destination changes. Those authorities remain governed separately.

Only an authorized platform human may create or revoke a grant, using the existing accepted human roles; no new role is introduced. A command principal cannot grant authority to itself, and AI, agent, and system principals cannot grant representative authority. Before creating a grant, that human must independently establish that the authenticated actor ID belongs to the person being authorized, that the person satisfied the applicable responsible-person verification requirement, and that the person is authorized to represent the specified Operator. The grant stores only the resulting minimum decision metadata and never raw identity evidence; an optional verification reference is opaque and is not a caller-provided `verified` boolean.

Grant lifecycle is derived from the durable historical record: `active` means not revoked and current server time is before `expiresAtIso`; `revoked` means `revokedAtIso` exists; `expired` means not revoked and current server time is at or after `expiresAtIso`. Every grant has `grantedAtIso` and an approved human-supplied `expiresAtIso`; this decision specifies no duration. Revocation preserves `revokedAtIso` and the revoking human. Missing, pending, unverified, revoked, or expired grants fail closed. Revoked and expired grants never reactivate; a new grant is required. One Operator may have multiple active representatives, and one actor may represent multiple Operators through separate grants. No relationship crosses Operator or tenant scope.

Authorization evaluates authenticated actor ID, Operator ID, tenant ID, required permission, current server time, and grant lifecycle server-side. A representative grant proves only that the authenticated actor may represent the Operator; it does not authorize every requested effect. Each consequential command must independently enforce authenticated principal role, tenant scope, Operator scope, resource ownership or applicability, command-specific policy, confirmation, concurrency, idempotency, and any higher-risk approval. A command must explicitly require representative authority where applicable; `operator_actions` never bypasses these checks. Caller-provided authorization booleans, matching tenant identity, responsible-person status alone, beneficial ownership, and Management Authority cannot substitute for a grant.

Grant creation and revocation record only minimal audit metadata using existing audit patterns: grant, actor, Operator, tenant, permission, status transition, authorized human, and timestamp. Passwords, tokens, identity-document images, verification bearer URLs, raw NIN/passport data, and raw verification evidence are excluded.

Management Authority remains the Operator's property-specific authority to provide accommodation; it does not authorize an authenticated person to act for the Operator. Responsible-person verification remains an onboarding prerequisite, not representative command authority.

This decision supplies the source-of-truth contract for a future `canActForOperator({ actorId, operatorId, tenantId })` adapter. It makes the Issue 29 architecture gap resolved, but does not itself implement production storage, commands, or composition.
