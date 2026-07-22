# Coding Standards

These rules apply to all code written in this repository. They are enforced by agents as a hard gate before setting any issue to `resolved`. They are in addition to TypeScript compiler settings in `tsconfig.json`.

## Type safety

- **No `any` in domain-layer types.** Types in `domains/` and `packages/` must use explicit interfaces or `unknown` with a narrowing guard. Using `any` to silence a compiler error is a domain-modelling gap — surface it, don't hide it.
- **Read the target type before calling it.** Before writing code that constructs or calls a type defined elsewhere in the codebase, read its interface or class definition. Never guess the shape.

## Pattern reuse

- **Search before inventing.** Before introducing a new pattern (token format, ID scheme, audit record structure, error handling shape), search the codebase for an existing one. Consistency across the codebase matters more than local elegance.
- **Mirror existing module structure.** New domain modules should follow the same file layout, constructor shape, and method signatures as existing modules in the same bounded context (e.g. `BookingRequestManager`, `AvailabilityCalendar`).

## Security

- **Bearer credentials must never appear in audit logs, interaction state, or logs.** This is a hard rule derived from ADR 0075. Confirmation tokens, one-time passwords, access codes, and payment references are bearer credentials. Store only a hash or omit them entirely from audit records.
- **Never roll a custom security primitive.** If you need a tamper-evident token, use `node:crypto` `createHmac`. If you need a signed assertion, use an established pattern. Base64-encoding is not encryption and is not tamper-evidence.

## Domain fidelity

- **Policy strings, constants, and business rules must be sourced.** Every hardcoded string that represents a policy, rule, or domain constant (guest conduct rules, time windows, thresholds) must be traceable to an ADR or `CONTEXT.md`. If the source does not exist, do not invent it — surface the gap to the user.
- **No speculative constructor parameters.** Do not inject dependencies into a class unless you call them in that implementation. An unused injected dependency is scope creep and signals a missing implementation step.

## Audit records

- **Audit records are append-only and minimal.** Record only identifiers, timestamps, envelope IDs, and status transitions. Never record raw domain credentials, guest identity data, or financial references (cite ADR 0075).
