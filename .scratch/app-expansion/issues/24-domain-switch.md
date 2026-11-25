# One on/off setting per domain

Status: needs-info
Type: task
Blocked by: D12 (owner; D2 accepted 25 Nov 2026)

## Why

`main` has one domain switch, `COMMERCE_ENABLED`. Packs reach the runtime through `additionalPacks`, which each host passes itself. A second domain would add another special case.

## What to build (shape, not names)

- One parser, outside every domain, that reads a closed list of enabled domains. Default: stays only. An unknown value stops startup and names the variable, never its value (as `commerce-switch.ts` does).
- Registration, routes, catalogues, rows and the chooser all follow it. A domain that is off has none of them.
- `COMMERCE_ENABLED` keeps working exactly as ADR 0104 says. No commerce change.

## Acceptance criteria

- AC1: For every subset of registered test packs, an off domain has no route, pack, catalogue, row, chooser entry or copy on any guest page.
- AC2: Unset means stays only. An unknown domain stops startup.
- AC3: This setting cannot turn Stays off unless the owner says so.
- AC4: Every ADR 0104 test passes unchanged.

## ADR compliance

0099, 0101, 0104, 0107 decision 10. The setting's name needs an ADR note.

## Comments
