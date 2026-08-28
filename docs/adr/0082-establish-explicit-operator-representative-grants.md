# Establish explicit Operator representative grants

## Context

Issue 29 requires an authenticated actor to act for an Operator while ADR 0070 keeps actor and Operator identities distinct. Existing responsible-person verification, beneficial ownership, property Management Authority, and tenant identity do not define person-to-Operator command authority.

## Decision

At launch, an authenticated actor may act for an Operator only through an explicit server-side representative grant. Each grant has an opaque grant ID, actor ID, Operator ID, and tenant ID. A grant has one permission, `operator_actions`, for ordinary authenticated Operator-domain actions, including filing the Operator's Issue 29 enforcement appeal.

This permission does not authorize platform human-review decisions, enforcement final decisions, appeal decisions, administrative actions, settlement-account changes, or payout-destination changes. Those authorities remain governed separately.

Only an authorized platform human may create or revoke a grant. A command principal cannot grant authority to itself, and AI, agent, and system principals cannot grant representative authority. A grant becomes active only after the applicable responsible-person verification requirement is satisfied; the grant stores only the minimum authoritative verification status or reference and never raw identity evidence.

Grant lifecycle is `active`, `revoked`, or `expired`. Missing, pending, unverified, revoked, or expired grants fail closed. Revocation is immediate and never automatically restores authority; a new grant is required. One Operator may have multiple active representatives, and one actor may represent multiple Operators through separate grants. No relationship crosses Operator or tenant scope.

Authorization evaluates authenticated actor ID, Operator ID, tenant ID, and required permission server-side. Caller-provided authorization booleans, matching tenant identity, responsible-person status alone, beneficial ownership, and Management Authority cannot substitute for a grant.

Grant creation and revocation record only minimal audit metadata using existing audit patterns: grant, actor, Operator, tenant, status transition, authorized human, and timestamp. Passwords, tokens, identity-document images, verification bearer URLs, and raw NIN/passport data are excluded.

Management Authority remains the Operator's property-specific authority to provide accommodation; it does not authorize an authenticated person to act for the Operator. Responsible-person verification remains an onboarding prerequisite, not representative command authority.

This decision supplies the source-of-truth contract for a future `canActForOperator({ actorId, operatorId, tenantId })` adapter. It makes the Issue 29 architecture gap resolved, but does not itself implement production storage, commands, or composition.
