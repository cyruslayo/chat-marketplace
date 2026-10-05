# Seasonal "Home for the Holidays" offer with optional extras

Status: needs-info
Type: task
Blocked by: 05, 11

## Why

Diaspora visitors on long stays are a **seasonal marketing offer, not the core** (decided 3 Oct 2026). They fill December–February, and optionally July–August, using the same units and monthly prices, plus optional extras.

## What to build

- **A dated campaign.** A configured start and end date switches on a seasonal landing section and chat prompt that lead to Extended Stay search for the season's dates. Outside the dates nothing shows.
- **Optional extras.** These are a controlled catalogue of items such as airport pickup, a SIM, driver days and a cleaner or chef. Each shows its supplier and price, enters the quote only when selected, and is paid on-platform. No off-platform payment is allowed (ADR 0015; the controlled-catalogue principle from ADR 0062 carries over).
- Extras are included in the All-In Stay Total once selected, and refunded if undelivered.

## Needs info before it is ready for an agent

1. Which extras, which suppliers, and their prices. Are extras margin-bearing?
2. Whether extras are part of a period's payment or paid with the first period only.
3. The campaign dates for the first season, and the copy (the user confirms the wording).
4. Whether a Short Stay may also take extras during the season.

## Acceptance criteria (draft, finalised once the info above is given)

- AC1: The seasonal entry appears only between the configured dates, in chat and on the page.
- AC2: A selected extra appears in the quote and the All-In Stay Total with its supplier; an unselected extra never does.
- AC3: An undelivered extra is refunded in full and excluded from the Owner Payable.
- AC4: No extra can be paid or arranged off-platform through the concierge.

## ADR compliance

| ADR | Constraint |
|---|---|
| 0015 | Optional extras only when selected; all-in total |
| 0062 (principle) | Controlled extras catalogue with disclosed supplier; no off-platform payment |
| 0089 | Owner Payable excludes extras that are not owner amounts |
| 0078 | Accessible screens |

## Comments
