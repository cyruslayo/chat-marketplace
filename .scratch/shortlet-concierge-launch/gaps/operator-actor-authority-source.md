# Operator actor authority source-of-truth gap

Status: blocked
Type: research

## Decision

B — PRODUCT AUTHORITY MODEL REQUIRED

## Problem

Issue 29 requires an authenticated Operator actor to file an enforcement appeal through `canActForOperator({ actorId, operatorId, tenantId })`. ADR 0070 requires interaction/actor identities and Operator domain identities to remain separate. The repository currently has no accepted source mapping an authenticated actor to an Operator.

The `OperatorAuthority` port in the enforcement module therefore correctly fails closed, but cannot be production-composed.

## Discovery

### `domains/shortlet/src/onboarding.ts`

`onboardOperator` stores an Operator domain identity and verification flags. `responsiblePersons` is copied as opaque input and the existing fixture contains `{ name, role }`. The record does not define a stable authenticated actor identity, allowed Operator command scope, authority grantor, revocation/removal state, or authoritative tenant binding. `responsiblePersonsVerified` is an aggregate verification flag, not an actor authorization decision.

This is insufficient for `canActForOperator`.

### Management Authority records

`grantManagementAuthority` stores a verified, property-specific authority record with an authority ID, property ID, status, validity dates, and operational permissions. ADR 0057 makes this authority about an Operator's authority over a property. It does not authorize a particular authenticated person to act for the Operator. It cannot answer `canActForOperator` without inventing a second relationship.

### Beneficial-owner records

The onboarding model stores only `beneficialOwnersVerified`; it has no beneficial-owner records with authenticated actor IDs or command authority. Beneficial ownership must not be silently treated as Operator staff or representative authority.

### Authentication and identity

`packages/platform-core/src/envelope.ts` defines `CommandPrincipal` with authenticated principal ID, role, and optional tenant ID. `packages/platform-core/src/thread.ts` defines `SecurityContext` with principal, tenant, session, and device/session metadata. These establish authenticated interaction scope but contain no Operator membership relationship and cannot answer `canActForOperator`.

### Existing command authorization patterns

Existing application/domain commands validate role, principal identity, tenant scope, and resource ownership where the relevant domain relationship is already defined. No reusable Operator membership repository, representative record, actor-to-Operator grant, or revocation authority was found. Matching tenant IDs alone are not sufficient authorization.

### Production composition

No production construction of `OperatorEnforcementManager` exists on `origin/main`. No existing composition root can safely provide `OperatorAuthority` without first selecting and defining the missing product semantics.

## Required product decision

The product and governance owners must define:

- which people may act for an Operator;
- how their stable authenticated actor IDs are recorded;
- who grants that authority;
- authoritative tenant scope;
- allowed Operator-scoped command/action scope;
- verification requirements and their source;
- revocation, suspension, expiry, and removal behavior;
- whether multiple actors may represent one Operator;
- whether one actor may represent multiple Operators;
- the required minimal audit record and retention behavior.

The decision must explicitly keep actor identity separate from Operator identity under ADR 0070 and must define how the server independently validates the relationship under ADR 0072.

## Candidate existing data

`responsiblePersons` remains a candidate source to evaluate after the product decision. It is not authoritative today. The current fields do not establish stable authenticated identity, authorization scope, tenant scope, verification lifecycle, or revocation/removal semantics.

Management Authority and beneficial-owner data are distinct concepts and must not be repurposed silently.

## Blocked behavior

Issue 29 Operator appeals must remain fail-closed until the product authority model and authoritative source are implemented. No caller-provided boolean, `actorId === operatorId` shortcut, tenant-only inference, responsible-person shortcut, beneficial-owner shortcut, or Unit Management Authority adapter is permitted.

This gap document does not modify Issue 29 or PR #42.

## Affected decisions

- ADR 0070: actor and Operator identities remain distinct.
- ADR 0072: consequential commands require independent server-side authorization.
- ADR 0075: future authority records must minimize identity/security data.
- Requested ADR 0001 was not present in `docs/adr/`.
