# Decide the future of the older Gemini concierge path

Status: ready-for-human
Type: grilling
Blocked by: none
Requested: 1 Nov 2026

## Parent

[PRD](../PRD.md)

## Why

`LocalGuestApp.#handleTurn` still has a third path, `handleGeminiTurn` (`apps/local-guest/src/gemini-concierge.ts`, `shortlet-app.ts:954`), used when a `geminiClient` is composed (`guest-server.ts:2444`). It runs only without the assistant runtime, has its own date handling, and has one test file (`test/gemini-concierge.test.ts`). Staging builds with `GEMINI_API_KEY` unset. Each parity change in this effort would otherwise need a third implementation.

## Decision for the owner

Retire it (remove the path, its client and test once nothing composes it), or keep it as a documented fallback and include it in the issue 16 parity suite. Recommended: retire.

## Acceptance criteria

- [ ] AC1: The decision is recorded in this issue's Comments, with which hosts compose `geminiClient` today.
- [ ] AC2: If retired, a follow-up issue lists the files and tests to remove.

## Comments
