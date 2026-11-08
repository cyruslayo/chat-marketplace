# Backend patterns for multi-agent routing, handoff, per-agent state, context isolation and chat storage on Cloudflare Durable Objects

Researched 2026-11-08. Each claim cites the page it came from. Where a page was read only through a summarizing fetch tool or a search snippet, the notes say so. Search-snippet claims are weaker than full-page reads.

## 1. How multi-agent frameworks route, hand off and manage history across agents

### Takeaway
The major frameworks pass the **full shared transcript** to the receiving agent by default (OpenAI Agents SDK, Microsoft Agent Framework). Isolation is opt-in, through filters or per-agent settings: OpenAI `input_filter`/`handoff_history_mapper`, LangGraph supervisor `output_mode="last_message"`, ADK `include_contents='none'`. None of the sources gives numeric guidance on classifier thresholds or hysteresis. "Sticky" routing appears only structurally: in the handoff patterns the active agent persists across turns. A design with one lane per agent and only guest text crossing over is therefore stricter than any framework's default. It matches the opt-in isolation knobs, not the defaults.

### Cited Findings
**OpenAI Agents SDK (Python docs)**
- A handoff is exposed to the model as a tool named `transfer_to_<agent_name>`. By default the new agent sees the whole prior conversation, "as though the new agent takes over the conversation." — [OpenAI Agents SDK: Handoffs](https://openai.github.io/openai-agents-python/handoffs/)
- `input_filter` is set per handoff. It receives `HandoffInputData` (`input_history`, `new_items`, `input_items`) and returns what the next agent gets. — [OpenAI Agents SDK: Handoffs](https://openai.github.io/openai-agents-python/handoffs/)
- `handoff_filters.remove_all_tools` removes structured tool-call items. It does **not** redact tool arguments or results that were already copied into ordinary messages. — [OpenAI Agents SDK: Handoffs](https://openai.github.io/openai-agents-python/handoffs/)
- `nest_handoff_history` is an opt-in beta, off by default. It compacts earlier history into a `<CONVERSATION HISTORY>` summary block, and the docs warn it "does not redact sensitive data." `RunConfig.handoff_history_mapper` lets you replace the mapping with your own. — [OpenAI Agents SDK: Handoffs](https://openai.github.io/openai-agents-python/handoffs/)
- `input_type` is a validated schema for metadata the model sends on the handoff (for example `reason`). It does not change the destination. `is_enabled` is evaluated before arguments are parsed, so authorization that depends on parsed fields belongs in `on_handoff`, where raising an error stops the transfer. — [OpenAI Agents SDK: Handoffs](https://openai.github.io/openai-agents-python/handoffs/)
- Server-managed conversations (`conversation_id`, `previous_response_id`) do **not** support input filters. — [OpenAI Agents SDK: Handoffs](https://openai.github.io/openai-agents-python/handoffs/)
- The SDK provides `RECOMMENDED_PROMPT_PREFIX` / `prompt_with_handoff_instructions` for agents that can hand off. — [OpenAI Agents SDK: Handoffs](https://openai.github.io/openai-agents-python/handoffs/)

**LangChain / LangGraph**
- The current LangChain docs describe four patterns: subagents, handoffs, skills and router. They call context engineering, meaning what each agent sees, the central design concern. — [LangChain multi-agent docs](https://docs.langchain.com/oss/python/langchain/multi-agent)
- *Subagents*: a main agent calls stateless subagents as tools. The main agent keeps the conversation, and each subagent sees only its relevant context ("strong isolation"). — [LangChain multi-agent docs](https://docs.langchain.com/oss/python/langchain/multi-agent)
- *Handoffs*: a tool call updates a state variable that selects the active agent or changes its tools and prompt. The active agent **persists across turns**, so repeat requests skip re-routing. Execution is sequential. — [LangChain multi-agent docs](https://docs.langchain.com/oss/python/langchain/multi-agent)
- *Router*: a stateless classify step runs on every request, at the cost of one LLM call each. The docs suggest wrapping the router as a tool inside a stateful agent. — [LangChain multi-agent docs](https://docs.langchain.com/oss/python/langchain/multi-agent)
- *Skills*: loaded skill content stays in the history. In the docs' multi-domain example this pushed token use to about 15K. — [LangChain multi-agent docs](https://docs.langchain.com/oss/python/langchain/multi-agent)
- `create_supervisor` takes an `output_mode` of `last_message` (default: only a worker's final message joins the shared history) or `full_history`. — [LangGraph supervisor reference (JS OutputMode)](https://reference.langchain.com/javascript/langchain-langgraph-supervisor/supervisor/OutputMode); [Python reference](https://reference.langchain.com/python/langgraph-supervisor/supervisor/create_supervisor) (search snippet)
- LangGraph Swarm keeps a shared state field `active_agent` that handoff tools update. — search snippet citing [langgraph-supervisor reference](https://reference.langchain.com/python/langgraph-supervisor) (weak source)

**Google ADK and the A2A protocol**
- ADK creates one `transfer_to_agent` tool per configured sub-agent. `include_contents='none'` hides prior conversation history from an agent, but it does not hide session state placeholders. Agents in a SequentialAgent share `session.state`. — search snippets from community sources ([kodekloud notes](https://notes.kodekloud.com/docs/Google-ADK/ADK-Fundamentals/Using-State-to-Drive-Conversations/page), [hexdocs ADK port](https://hexdocs.pm/adk/context-compilation.html)). The official adk.dev multi-agent page redirected and could not be read, so these are **unverified against official docs**.
- Reported bug: when a root agent with `output_key` delegates to a sub-agent, the sub-agent's reply is not saved to `state[output_key]`. — [google/adk-python issue #3758](https://github.com/google/adk-python/issues/3758) (fix status unknown)
- A2A spec 1.0.0 is the latest released version, with compatibility by Major.Minor. Earlier versions were 0.3.0, 0.2.6 and 0.1.0. — [A2A specification](https://a2a-protocol.org/latest/specification/)
- A2A `taskId` names one stateful unit of work and is always server-generated. A client cannot create a task by supplying one. `contextId` "logically groups multiple related Task and Message objects," i.e. one conversational session. If a client sends both and they conflict, the agent must reject the message. A client can send a `contextId` without a `taskId` to start a new task in an existing context. — [A2A specification](https://a2a-protocol.org/latest/specification/)
- Agents may generate a `contextId`. If an agent cannot honour a client-supplied `contextId`, it must reject the request and must not mint a new one. Clients should treat server ids as opaque. — [A2A specification](https://a2a-protocol.org/latest/specification/)
- A2A task states: SUBMITTED and WORKING; the interrupted states INPUT_REQUIRED and AUTH_REQUIRED; the terminal states COMPLETED, FAILED, CANCELED and REJECTED. After INPUT_REQUIRED, the client continues by sending the same `taskId` and `contextId`. — [A2A specification](https://a2a-protocol.org/latest/specification/)
- An A2A Message has `messageId`, `role` (USER/AGENT), `parts` (text, file or structured data), optional `contextId`/`taskId`, and `referenceTaskIds`. — [A2A specification](https://a2a-protocol.org/latest/specification/)

**Microsoft Agent Framework / Semantic Kernel**
- In Agent Framework handoff orchestration the agents form a mesh with no central orchestrator. The conversation is handed off entirely, and the receiver has full context. `HandoffBuilder.add_handoff()` sets routing rules, and the framework detects circular routing. — [MS Agent Framework handoff docs](https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/handoff) (search snippet, page not opened)
- A Microsoft Learn module says each agent's response is broadcast to all participants. It warns that after 3–4 handoffs the accumulated context hurts performance and cost, and recommends limiting chain depth. — [MS Learn: handoff reliability](https://learn.microsoft.com/en-us/training/modules/aaai-apply-task-decomposition-multi-agent-azure/5-ensure-handoff-reliability-context-preservation) (training module, secondary)
- Semantic Kernel's agent orchestration features are marked experimental. — [SK handoff docs](https://learn.microsoft.com/en-us/semantic-kernel/frameworks/agent/agent-orchestration/handoff) (search snippet)

**Anthropic**
- In Anthropic's description, routing "classifies an input and directs it to a specialized followup task." It suits tasks with distinct categories, and the classification can be done by an LLM or by a traditional classifier. Their advice is to "find the simplest solution possible" and to add complexity only when it "demonstrably improves outcomes." — [Anthropic: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- Anthropic measured agents at about 4× the tokens of chat and multi-agent systems at about 15×. Multi-agent fits poorly when agents must share the same context or have many dependencies. Subagents can store their output externally and pass back lightweight references, which avoids losses from relaying through several stages. — [Anthropic: multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)

### Inferences
- A "lane per domain agent" model is closest to LangGraph's *handoffs* pattern (a persistent `active_agent`) combined with *subagent*-style isolation, where each lane has its own model history. A2A's `contextId` (the thread) grouping several `taskId`s (lanes or units of work) is a ready-made vocabulary for one thread holding several lanes.
- OpenAI's warning that `remove_all_tools` does not redact tool output copied into ordinary messages supports building the guest-text-only crossing as an **allow-list** (copy only guest-authored messages), not a deny-list filter.
- A2A's rule against minting a new id when the old one cannot be honoured matches a fail-closed approach to restoring ids.

### Gaps
- No framework doc I found gives numeric routing confidence thresholds, hysteresis or "stickiness" tuning, or auto/undo/suggest tiers. The tiered-switch design is not backed by published framework guidance.
- I could not read the official ADK multi-agent page; it redirected to adk.dev/workflows. Exactly what history a transferred ADK agent sees is unverified.
- I did not check whether the OpenAI Agents **JS** SDK fully matches the Python handoff features, including `nest_handoff_history`.

## 2. Context isolation and prompt-injection boundaries during handoff

### Takeaway
The published guidance is consistent. Treat any model-generated or external content as untrusted. Segregate and label it. Enforce least privilege in code, not in prompts. Require human approval for high-risk actions. Prefer architectural isolation (dual-LLM or CaMeL-style data-flow control) over detection. Letting only guest-authored text cross between agents fits these patterns. Agent outputs, tool results and summaries are the content that injection flows through.

### Cited Findings
- OWASP's LLM01:2025 mitigations are: constrain model behaviour; define output formats and validate them with deterministic code; filter input and output; enforce least privilege, with functions handled in code rather than exposed to the model; require human approval for high-risk actions; segregate and clearly label external content; and run adversarial testing that treats the model as an untrusted user. — [OWASP GenAI LLM01:2025](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- OWASP defines indirect injection as input from "external sources, such as websites or files" that changes model behaviour. — [OWASP GenAI LLM01:2025](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
- Dual LLM pattern: a privileged LLM has tools and never sees untrusted content. A quarantined LLM reads untrusted text but has no tools. Results pass between them as symbolic variables (for example `$email-summary-1`). DeepMind's critique: the privileged LLM still delegates extraction to the quarantined one, and an attacker can hijack that step. — [Simon Willison on CaMeL](https://simonwillison.net/2025/Apr/11/camel/)
- CaMeL (Google DeepMind, 2025) turns the request into restricted Python run by a custom interpreter. Each variable carries capability tags recording its source and allowed readers, data flow propagates the tags, and policies gate actions; for example an email may go only to a trusted recipient, otherwise the user is asked. The authors say it does not fully solve prompt injection. Its burdens are writing the policies and approval fatigue. — [Simon Willison on CaMeL](https://simonwillison.net/2025/Apr/11/camel/)
- Microsoft's spotlighting work (Hines et al., arXiv 2403.14720, CAMLIS'24) describes delimiting, datamarking and encoding of untrusted input. It reports attack success falling from >50% to <2% on GPT-family models with minimal task impact. — [arXiv 2403.14720](https://arxiv.org/abs/2403.14720v1) (abstract-level, via search snippet)
- OpenAI handoff filters do not redact data, and handoff summaries can carry tool arguments and outputs. — [OpenAI Agents SDK: Handoffs](https://openai.github.io/openai-agents-python/handoffs/)

### Inferences
- If the receiving lane gets only guest-authored text, the cross-agent channel cannot carry injection from tool output or from another agent's model output. Guest text can still contain direct injection, so each lane's own constraints and code-enforced guards (ADR 0106-style fail-closed ids) still apply.
- Structured facts that cross (dates, party size) should be passed as typed, code-validated fields, in the spirit of CaMeL's provenance tags, rather than as free text.

### Gaps
- I found no source naming an exact standard for what may cross between agents. The OWASP 2025 "Excessive Agency" entry (LLM06) was not fetched.
- I did not read Google's own spotlighting or defence-in-depth guidance for Gemini.

## 3. Intent classification for routing: LLM vs embeddings, calibration, abstain or clarify, metrics

### Takeaway
The evidence here is thin and mostly practitioner material. The main points are: an LLM's stated confidence is often poorly calibrated, and for routing, *selective* quality (does confidence rank right above wrong) matters more than calibration. Thresholds should be tuned per class against a risk target, conformal methods give finite-sample guarantees, and misrouting should be judged with per-class confusion matrices because errors cost different amounts.

### Cited Findings
- Anthropic: routing classification can be done by an LLM or by a traditional classifier. — [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- Calibration (ECE, reliability diagrams) and selective classification (AUROC, risk-coverage) are different things. A badly calibrated model can still select well, and selection is what matters for routing. — [tianpan.co: LLM classifier in production](https://tianpan.co/blog/2026-05-04-llm-classifier-production-beyond-accuracy) (practitioner blog)
- Reported figures: ECE above 0.10 is common in production, and about 66.7% of GPT-4o-mini misclassifications come at stated confidence above 80%. These are vendor glossary figures, **unverified**. — [futureagi glossary](https://futureagi.com/glossary/probabilistic-classification/)
- Abstain thresholds should differ by query class, with the operating point chosen from a curve of answer rate against accuracy on answered traffic. — [tianpan.co: calibrated abstention](https://tianpan.co/blog/2026-04-27-calibrated-abstention-i-dont-know) (practitioner blog)
- Conformal abstention calibrates the threshold with statistical guarantees from small calibration sets. — [arXiv 2405.01563](https://arxiv.org/pdf/2405.01563). A 2026 paper picks the largest threshold whose upper confidence bound on error stays below α, assuming calibration and deployment data are exchangeable. — [arXiv 2607.04430](https://www.alphaxiv.org/abs/2607.04430.md)
- Misrouting cost is asymmetric, so use per-class confusion matrices, not only overall accuracy. — [tianpan.co](https://tianpan.co/blog/2026-05-04-llm-classifier-production-beyond-accuracy)

### Inferences
- The tier design (auto, auto-with-undo, suggest) maps onto selective classification with two thresholds: auto above a high threshold, undo in the middle band, suggest or clarify below. Thresholds could differ per target lane, for example a higher bar for switching *out of* a lane with a pending booking. Set them from a labelled set of guest turns using risk-coverage curves, not from raw model confidence.
- Useful metrics: misroute rate per (from, to) lane pair, false-switch rate (an auto switch the guest undid), and clarify rate.

### Gaps
- I found no rigorous head-to-head of LLM versus embedding routing for chat intent in 2026, and no published guidance on hysteresis or debounce for conversational routing.
- I found no benchmark comparing a clarifying question against silently abstaining.

## 4. Cloudflare Durable Objects SQLite storage: limits, API, transactions, pricing, chat-history patterns, backup

### Takeaway
A SQLite-backed DO allows 10 GB per object, 8 MB per row or value in the DO limits table, a 100 KB SQL statement and 100 bound parameters. SQL calls are synchronous. `transactionSync` gives atomic multi-statement writes, and point-in-time recovery covers 30 days. Rows written cost $1.00 per million beyond 50M per month; rows read are nearly free. Cloudflare's own `AIChatAgent` stores chat in the DO's SQLite and caps rows at about 2 MB, compacting large tool outputs. Normalized rows (one per message or event) fit the billing model and the row limits better than one large JSON blob.

### Cited Findings
**Limits**
- Storage is 10 GB per Durable Object and unlimited per account on Workers Paid (5 GB on Free). The per-class total and the number of objects are unlimited. The Free-plan per-object figure is inconsistent: the FAQ says 1 GB. — [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- Max string, BLOB or row size is 8 MB, and key plus value together are limited to 8 MB. SQL statements are capped at 100 KB, with 100 bound parameters per query and 100 columns per table. — [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- **Conflict:** the Agents chat docs say "Workers SQLite rows have a hard maximum size of 2 MB," and AIChatAgent compacts messages at about 1.8 MB. — [Agents: chat agents](https://developers.cloudflare.com/agents/api-reference/chat-agents/). The DO limits page says 8 MB. Treat **2 MB** as the safe design ceiling.
- CPU is 30 s per request by default, configurable up to 5 min. The soft limit is 1,000 requests/s per object, and received WebSocket messages can be up to 32 MiB. — [DO limits](https://developers.cloudflare.com/durable-objects/platform/limits/)

**SQL API and transactions**
- `sql.exec(query, ...bindings)` returns a `SqlStorageCursor` with `toArray()`, `one()`, `raw()`, `rowsRead` and `rowsWritten`. The final row counts are what you are billed. Each index-row update counts as an extra row written. Consume a cursor synchronously, because one held across an `await` has no snapshot isolation. `exec` cannot run `BEGIN` or `SAVEPOINT`. — [DO SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- `transactionSync(cb)` runs a synchronous callback atomically and rolls back if it throws. The async `transaction()` `txn` object is described as obsolete for SQLite-backed objects. — [DO SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- Each storage call is implicitly transactional, and writes with no `await` between them are coalesced into one atomic write. Input gates block other events during awaited reads unless `allowConcurrency` is set. By default, outgoing network messages wait until writes are confirmed; `allowUnconfirmed` lifts this. Many un-awaited puts can exceed the 128 MB isolate limit. — [DO SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- `databaseSize` reports the database size in bytes. KV `get`/`put` accept 128 keys per call, and `list()` with no options loads everything into memory. — [DO SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)

**Point-in-time recovery**
- PITR covers the whole SQLite database, SQL and KV data, for any point in the last 30 days. The API is `getCurrentBookmark()`, `getBookmarkForTime(ts)` and `onNextSessionRestoreBookmark(bm)`, followed by `ctx.abort()`. The restore call returns a bookmark from just before the restore, so a restore can be undone. PITR does not work in local dev. The docs' example contains bugs. — [DO SQLite storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)

**Pricing (page last updated 18 Oct 2026)**
- Compute on Paid: 1M requests per month included, then $0.15 per million. Duration: 400,000 GB-s included, then $12.50 per million GB-s. Requests include WebSocket messages (billed 20:1) and alarms. Free: 100K requests and 13,000 GB-s per day. — [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- SQLite storage on Paid: 25B rows read per month included, then $0.001 per million. 50M rows written included, then $1.00 per million. 5 GB-month stored included, then $0.20 per GB-month. Free: 5M reads and 100K writes per day and 5 GB total; over-limit operations fail. Each `setAlarm()` counts as one row written. KV-style methods on SQLite objects are billed as rows. — [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- SQLite storage billing had a target start date of 7 Jan 2026, "not earlier." I did not confirm that billing has actually started. — [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)

**Agents SDK chat persistence**
- Each Agent instance has an embedded SQLite database, `this.sql`, used through tagged templates with typed rows. `setState`/`this.state` holds persisted state that syncs to clients. — [Agents API](https://developers.cloudflare.com/agents/api-reference/agents-api/)
- `AIChatAgent` persists messages in SQLite after each interaction and loads `this.messages` from SQLite. `persistMessages` stores messages and broadcasts them without starting a turn. `saveMessages` persists and then triggers `onChatMessage`, waiting for any active turn. — [Agents: chat agents](https://developers.cloudflare.com/agents/api-reference/chat-agents/)
- `maxPersistedMessages` deletes the oldest messages and "controls storage only." The docs recommend the AI SDK's `pruneMessages()` to control what the model sees. Large messages are compacted at about 1.8 MB, tool outputs first and then text, and marked with `metadata.compactedToolOutputs`. — [Agents: chat agents](https://developers.cloudflare.com/agents/api-reference/chat-agents/)
- Stream chunks are buffered in SQLite, so a client can reconnect and resume. After the Durable Object is evicted, a surviving "fiber" row lets the framework rebuild the partial reply and call `onChatRecovery`. — [Agents: chat agents](https://developers.cloudflare.com/agents/api-reference/chat-agents/)

### Inferences
- **Blob vs normalized rows.** Rewriting one JSON blob for the whole thread on every turn costs 1 row written, but the cost grows with the blob size, and the blob would hit the 2 MB row ceiling as the thread grows. Append-only rows (one per timeline event or message, keyed by lane id and sequence) keep each write small and make loading one lane a single indexed `SELECT`. Because reads are almost free ($0.001/M), reloading a lane's rows on every cold restore costs very little. Writes ($1/M plus index rows) are what to minimize. Keep secondary indexes few.
- The `maxPersistedMessages` vs `pruneMessages` split separates *what is stored* from *what the model sees*. That maps directly onto a lane holding a full timeline next to a bounded model history.
- PITR gives a 30-day safety net for a whole thread object. Export beyond 30 days needs an app-level dump to R2 or a similar store; I found no built-in export.

### Gaps
- The exact AIChatAgent table name and row layout (for example one row per message) are not on the docs pages I read. Reading the `agents` package source would settle it.
- I found no published benchmark of loading large JSON blobs versus normalized tables in a DO.
- I did not verify that SQLite storage billing went live in January 2026, or whether the 2 MB and 8 MB row figures have since been reconciled.
- I did not look at alarm limits beyond the billing note (one alarm per object is the commonly known constraint, not verified here).

## 5. Bounding chat history: summarization, windowing and their tradeoffs

### Takeaway
The main techniques are compaction (summarize, then restart the context), tool-result clearing (the safest form), structured external notes, and subagents that return condensed summaries. The main risk is losing subtle but critical context. Storage caps and model-context pruning should be separate controls.

### Cited Findings
- Compaction summarizes a conversation nearing the limit and starts a new window from the summary. The hard part is choosing what to keep. — [Anthropic: effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Tool-result clearing is "one of the safest lightest touch forms of compaction." — [Anthropic: effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Structured notes are persisted outside the context window and pulled back in later. Subagents return condensed summaries of about 1,000–2,000 tokens. — [Anthropic: effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Context rot: recall degrades as the context window fills. "Overly aggressive compaction can result in the loss of subtle but critical context." — [Anthropic: effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Anthropic's research system summarizes completed phases and stores essentials externally, because context beyond 200K tokens gets truncated. It resumes agents from checkpoints. — [Anthropic: multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- OpenAI's `nest_handoff_history` compacts history into a summary block on handoff, without redaction. — [OpenAI Agents SDK: Handoffs](https://openai.github.io/openai-agents-python/handoffs/)
- Microsoft: full-history handoffs grow costly after 3–4 hops. — [MS Learn module](https://learn.microsoft.com/en-us/training/modules/aaai-apply-task-decomposition-multi-agent-azure/5-ensure-handoff-reliability-context-preservation)
- Cloudflare: cap storage with `maxPersistedMessages` and prune model input with `pruneMessages()`. — [Agents: chat agents](https://developers.cloudflare.com/agents/api-reference/chat-agents/)

### Inferences
- For a booking lane, authoritative facts (dates, party size, unit id, offer state) should live in typed state or the domain projection, not in a summary. Model history can then be windowed safely, and a lossy summary can never become the source of truth for policy, in line with ADR-style fail-closed date authority.
- Clearing old tool results first, then windowing older turns, is the lowest-risk bounding order. A model-written summary is itself model output, so under the guest-text-only rule it must never cross lanes.

### Gaps
- I found no quantitative comparison of windowing vs summarization accuracy for task-oriented booking dialogs.
