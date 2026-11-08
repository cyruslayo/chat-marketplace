# Choose the production domain

Status: ready-for-human
Type: grilling
Blocked by: none
Requested: 8 Nov 2026

## Parent

[PRD](../PRD.md), decision D3.

## Why

`apps/cloudflare/cloudflare.config.ts:43` uses the placeholder `https://pilot.shortlet.example`. Issue 07, the Paystack webhook (issue 14), email links and the legal pages all need the real origin.

## What to decide (owner)

- A custom domain on Cloudflare, or a `workers.dev` name for a short closed pilot. Recommended: a custom domain, because guests see it in payment emails and Paystack's checkout.
- The production Cloudflare Access team domain and AUD for `/_ops/*`.

## Acceptance criteria

- [ ] AC1: The origin and the Access settings are recorded under `## Answer` (names only, no secrets).

## Comments
