# Shortlet conversational shell

The local Guest web surface keeps the conversation as the interaction timeline. A server-produced `InteractionArtifact` is converted to A2UI and rendered by Weaver in one platform-owned workspace slot.

## Presentation modes

- `text`: explanations, acknowledgements, questions, status, clarifications, and errors stay in the transcript.
- `inline-surface`: bounded discovery and summary interactions stay compact in the current workspace.
- `focused-surface`: complex inspection or booking interactions use the available mobile space and provide a Back/Close control.

These are presentation concepts only; they do not own Shortlet Booking state.

## Workspace lifecycle

There is one primary active rich surface. A replacement updates the slot and records the prior surface as a compact superseded summary. A same-identity revision updates in place without duplicating history. Stale, expired, deleted, superseded, and fallback surfaces are non-actionable in the browser and must still be rejected by the server boundary.

The platform `GenerativeSurfaceManager` evaluates configured expiry lazily against its injected clock and retains superseded/deleted records for auditability while revoking their action authority.

Weaver processing or mounting failure preserves safe text and, when supplied by the authoritative adapter, a conventional route. The browser never guesses missing facts or executes generated code.

## State and accessibility

The server owns the interaction projection and restores the timeline and latest surface through `/api/state`; session storage holds only an opaque thread pointer. Draft input remains in the composer after recoverable failures. The shell uses a 320-pixel-safe layout, dynamic viewport units, safe-area insets, 44-pixel controls, 16-pixel input text, keyboard focus indicators, a skip link, live announcements for meaningful changes, and reduced-motion handling.

The first discovery presentation uses Weaver Basic Catalog. Multiple results remain one active discovery surface; the platform may refine its internal A2UI composition without adding a second rich workspace to the transcript.

Future domains register presentation through a platform-owned adapter and an approved Weaver catalogue entry. The adapter converts that domain's canonical artifact into allow-listed A2UI components; the shell consumes only the shared `GuestSurfacePayload` lifecycle metadata. A future domain does not add arbitrary renderers, HTML, CSS, JavaScript, URLs, or actions to the browser.

The local demo issues an HttpOnly same-origin browser-session cookie and binds browser-created threads to it, but it still supplies the Guest principal from the fixture rather than implementing production login. Production adoption must bind `/api/state`, turn, event, and telemetry requests to the authenticated principal, tenant, browser session, and interaction lease before exposure outside the local fixture.
