# Concierge Platform

The shared foundation for building transactional, domain-specific conversational services across web and messaging channels. It supplies extension points and infrastructure but does not define a universal transaction model.

## Language

**Concierge Platform**:
The shared runtime and internal SDK through which domain packs register conversational tools, workflows, policies, and trusted interfaces.
_Avoid_: Generic marketplace, chatbot framework

**Domain Pack**:
A cohesive implementation of one business domain's model, tools, workflows, policies, and UI catalogue against Concierge Platform extension points.
_Avoid_: Plugin, vertical, template

**Channel Adapter**:
A translation boundary that presents domain conversations and actions through a particular customer channel without owning authoritative transaction state.
_Avoid_: System of record, domain service

**Human Handoff**:
The transfer of a conversation and its relevant context from automation to an authorized human operator.
_Avoid_: Escalation message

**Payment Capability Certification**:
Production-equivalent evidence that a payment channel satisfies booking-specific reference, expiry, lifecycle, invalidation, verification, and late-payment requirements before exposure to guests.
_Avoid_: PSP channel enabled, documentation claim, sandbox success

**Human Risk Review**:
A scoped, auditable eligibility decision made by an authorized person when documented booking-risk policy cannot permit automatic progression.
_Avoid_: Automated risk score, operator approval, indefinite hold

**General Support**:
The staffed human help service for ordinary enquiries, booking administration, and non-urgent problems during published support hours.
_Avoid_: Emergency response, continuous live chat

**Active-Stay Emergency Support**:
The continuously reachable human response path for credible safety, access, habitability, or displacement incidents during an active stay.
_Avoid_: General Support, emergency services, automated acknowledgement

**Agent-Interaction Boundary**:
The protocol boundary between a supported interactive-client adapter and the agent-runtime gateway, excluding ordinary authentication, upload, webhook, media, administration, and deterministic application interfaces.
_Avoid_: Universal backend API, domain-service boundary

**Interaction Projection**:
Client-visible conversational and workflow state synchronized for an agent interaction but derived from, and subordinate to, authoritative application state.
_Avoid_: System of record, booking state, ledger state

**Generative Surface**:
A declarative, catalogue-validated arrangement of approved interface components that can present state and request application commands without containing executable business logic.
_Avoid_: Generated code, authoritative workflow, arbitrary HTML

**Web Agent Adapter**:
A replaceable integration that translates the platform interaction contract into a particular web agent framework and renderer.
_Avoid_: Agent runtime, application service, domain dependency

**Interaction Protocol Profile**:
A named, versioned compatibility contract that selects the allowed AG-UI events, A2UI messages, transports, custom extensions and failure behaviour independently of any package's latest release.
_Avoid_: Dependency version, framework configuration

**Interaction Thread**:
A durable conversational context belonging to one authorized principal and tenant that may reference, but never own, domain aggregates.
_Avoid_: Booking, browser session, agent run

**Agent Run**:
One bounded execution attempt within an Interaction Thread, with its own lifecycle and event stream.
_Avoid_: Conversation, booking workflow, background service

**Platform Command Envelope**:
The authenticated and auditable wrapper through which a consequential interaction requests an application state transition with identity, idempotency and concurrency context.
_Avoid_: UI event, tool call, direct database mutation

**Interaction Artifact**:
A canonical, versioned representation of domain facts, disclosures, amounts, deadlines and permitted actions from which channel-specific presentations are derived.
_Avoid_: A2UI surface, chat message, channel template

**Deterministic Parity**:
The property that an agent-enabled material action is also available through a conventional route and reaches the same application command, policy checks and audit behaviour.
_Avoid_: Visually identical UI, duplicated business logic

**Agent-Runtime Gateway**:
The platform-owned boundary that translates between agent interaction protocols and application capabilities without owning authoritative domain state.
_Avoid_: Domain service, system of record, CopilotKit backend

**Platform Action**:
A typed request originating from an interactive surface that must pass the same application-level controls as any other command before changing state.
_Avoid_: UI callback, tool permission, direct state mutation

**Interactive-Client Adapter**:
A replaceable translation layer between a client framework and the platform's supported agent-interaction protocol.
_Avoid_: Domain interface, application service, permanent framework dependency
