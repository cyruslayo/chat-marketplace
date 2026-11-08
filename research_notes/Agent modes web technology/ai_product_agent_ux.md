# How AI chat products present multiple agents/personas, switching, auto-routing and per-agent history (as of 2026-11-08)

Context for the reader: these notes support a guest app where a guest switches between domain agents (stays, restaurants, events), each with its own visual identity, starters and chat history, and where the system may auto-switch when the topic changes. Research budget was about 15 tool calls; several official help pages returned 403 or carried no detail, so gaps are listed explicitly.

## Q1. Agent identity, switching, and per-agent vs shared history in leading products

### Takeaway
The major "custom agent" containers of 2023-2025 (custom GPTs, Gemini Gems) are being retired in late 2026 in favour of skills/plugins that attach capabilities to one main assistant, rather than separate named personas. Where per-agent identity survives (Microsoft 365 Copilot agents, Poe bots, project workspaces), the common pattern is: a home page with name, description and conversation starters; an @-mention picker to bring an agent into the current thread; a persistent "who is active" tag; and history that is either scoped per agent/workspace (deliberate one-on-one chats) or shared in one thread (@-mention), with no consistent rule on context carryover.

### Cited Findings

**Microsoft 365 Copilot agents (the most explicit published design guidance)**
- Two entry points: the navigation panel's "Agents section" (installed, user-pinned or admin-pinned agents, user-reorderable) opens an agent's home page; users there are in a "deliberate, task-focused mindset", so the home page should show "a clear name, description, and conversation starter prompts" — [Microsoft Learn, Agent entry points (updated 2026-09-30)](https://learn.microsoft.com/en-us/agents/design-guidelines/agent-entry-points)
- Typing `@` in the input opens an agent picker showing the agent name and a short description; Microsoft advises "clear, action-oriented names and concise descriptions" — [Microsoft Learn](https://learn.microsoft.com/en-us/agents/design-guidelines/agent-entry-points)
- @-mention lets users "add or remove it from an ongoing conversation, allowing multiple agents to collaborate in a single thread"; selecting from the navigation panel instead gives "a direct one-on-one conversation with that agent" — i.e. two history models side by side — [Microsoft Learn](https://learn.microsoft.com/en-us/agents/design-guidelines/agent-entry-points)
- An **agent tag** appears in the input box when an agent is invoked; Microsoft calls it "a key trust signal" and says the name and icon must work at that small scale ("brevity and a recognizable icon matter") — [Microsoft Learn](https://learn.microsoft.com/en-us/agents/design-guidelines/agent-entry-points)
- A system-generated **control message** appears in the chat "when an agent joins or stops responding", signalling handoff back to Copilot; "The UI always shows which agent is active"; designers should avoid interactions that leave users "uncertain about whether they're talking to Copilot or an agent" — [Microsoft Learn](https://learn.microsoft.com/en-us/agents/design-guidelines/agent-entry-points)
- Selecting a chat-history item switches the current agent to the one used in that chat (history is keyed to the agent) — [Microsoft Learn training: Interact with agents](https://learn.microsoft.com/en-us/training/modules/use-no-code-agents-sharepoint/4-interact-with-agents)
- Unverified user report (Copilot Pro, not M365): after an @-switch "each agent operates in its own context" and the new agent cannot see the previous agent's output — [Reddit snapshot](https://reddit.sentinel-team.org/posts/1tbtqft/snapshots/2026-05-16T02%3A14%3A45.014634Z)

**ChatGPT custom GPTs and GPT @-mentions**
- GPT mentions launched in late January 2024: type `@` in a chat to bring a custom GPT into the conversation — [Voicebot.ai, 2024-01-29](https://voicebot.ai/2024/01/29/openai-is-rolling-out-gpt-mentions-in-chatgpt-to-invoke-custom-gpts/); [OpenAI community](https://community.openai.com/t/bring-gpts-into-any-conversation-in-chatgpt/608707)
- OpenAI help: on web, @ brings a GPT in "without starting a new chat", the next message goes to that GPT and the conversation keeps its context; not available on iOS/Android (open the GPT from the menu instead); GPTs do not use saved memory, custom instructions or previous conversations — "Each conversation starts fresh" — [OpenAI Help, GPTs in ChatGPT](https://help.openai.com/articles/8554407) (as summarised by search; page not fetched directly)
- User reports that the @-mention feature stopped working for them — [OpenAI community](https://community.openai.com/t/why-does-the-custom-gpt-mention-feature-no-longer-work/1370980)
- **Discontinued:** custom GPTs are scheduled to stop running on **2026-12-11** (Enterprise deferrals to 2027-02-11); creation ends earlier (FAQ: 2026-09-25 planned; Virtualization Review reports 2026-10-26 for Enterprise — sources disagree). Instructions migrate to a plugin "skill", knowledge files to reference files; previous conversations, custom actions and sharing do not migrate automatically — [OpenAI Help, Custom GPT retirement FAQ](https://help.openai.com/en/articles/20001519-custom-gpt-retirement-and-migration-faq); [Virtualization Review, 2026-09-28](https://virtualizationreview.com/articles/2026/09/28/openai-to-retire-custom-gpts-replace-them-with-plugins.aspx); [Campus Technology, 2026-10-05](https://campustechnology.com/articles/2026/10/05/openai-discontinuing-custom-gpts-and-moving-to-plugin-architecture.aspx)
- Some builders object that plugins do not reproduce a GPT's "dedicated and predictable environment" — [EdTech Innovation Hub](https://www.edtechinnovationhub.com/news/openai-to-retire-custom-gpts-in-december-as-creators-move-to-plugins)

**Google Gemini Gems**
- Gems are created on the web (sidebar > Gems), with a name and instructions; chats start by selecting the Gem under "My Gems"; premade Gems exist (e.g. "Learning coach"); Gems sync to the mobile app and the Workspace side panel; Gems can't be used with Gemini Live — [Google Gemini Help, Use Gems](https://support.google.com/gemini/answer/15146780?hl=en)
- **Discontinued:** "Gems will be removed on personal Google Accounts starting in November 2026" and "will soon transition to skills" — [Google Gemini Help](https://support.google.com/gemini/answer/15146780?hl=en)
- Gems were opened to free users in March 2025 — [Techzim, 2025-03](https://techzim.co.zw/2025/03/now-free-geminis-gems-can-help-with-the-repetitive-stuff-you-keep-asking-ai)
- Third-party report that Gem icon/colour could not be customised (defaults used) — [Tom's Guide](https://tomsguide.com/ai/googles-latest-gemini-feature-lets-you-create-your-own-chatbot-heres-how-it-works)

**Claude Projects**
- Claude keeps "separate memory summaries for each individual project, as well as a summary including the rest of your non-project chats" — [Claude Support](https://support.claude.com/en/articles/9519177)
- Each project has its own scoped chat list; chats in a project are separate threads that share files and instructions but not each other's back-and-forth (third-party) — [LLMnesia](https://www.llmnesia.com/blog/claude-projects-vs-conversation-history); [Product Talk glossary](https://producttalk.org/glossary-ai-claude-project)

**Perplexity Spaces**
- Spaces group threads, files and custom instructions that apply to all threads in the space — [Perplexity Help, What are Spaces](https://intercom.help/perplexity-ai/en/articles/10352961-what-are-spaces)
- Space threads appear both in the global Library and in the Space's own view (dual listing); Spaces do not carry memory of past threads (third-party) — [LLMnesia](https://www.llmnesia.com/blog/perplexity-spaces-vs-conversation-history)

**Poe multi-bot chat**
- Since April 2024, users can @-mention any bot into a chat, and Poe suggests other bots to compare answers; later bots use "the context from all of the previous bots" in the thread (shared context) — [Analytics Vidhya, 2024-04](https://www.analyticsvidhya.com/blog/2024/04/poes-multi-bot-chat-a-game-changer-in-ai-interactivity/); [CDOTrends](https://www.cdotrends.com/story/3941/poe-unveils-multi-bot-chat-feature)

### Inferences
- Two history models dominate: (a) **scoped history** — one thread list per agent/workspace (M365 one-on-one agent chats, Claude Projects, Gem chats, Perplexity Spaces with dual listing); (b) **shared thread** — one conversation where agents are @-mentioned in and out (Poe, ChatGPT GPT mentions, M365 @-mention). For a guest app, (a) with a dual listing (per-agent and "all chats") mirrors Perplexity/M365 best.
- Context carryover on switch is inconsistent and poorly documented everywhere; products that keep context (Poe, ChatGPT @) do so within one thread. A deliberate, documented carry-over (e.g. passing dates/party size from stays to restaurants) would be a differentiator, but should be visible to the user.
- The industry direction in late 2026 (GPTs to plugins/skills, Gems to skills) is away from many named personas toward one assistant with domain capabilities. A per-domain persona design should be justified by distinct workflows, not branding alone.

### Gaps
- Meta AI Studio characters, Character.AI, Slack/Teams AI agents, and Siri/Apple Intelligence persona/history behaviour were not researched within budget (Character.AI search returned nothing relevant).
- Whether Gem chats are listed per Gem or in shared Recent chats is not stated in Google's help page.
- Claude "styles" UX was not covered.
- OpenAI help pages returned 403 on direct fetch; GPT-mention details rely on search summaries of the help article.

## Q2. Automatic routing/handoff UX: disclosure, confirmation vs silent, override, criticism

### Takeaway
Automatic routing is the area with the strongest documented backlash. GPT-5's auto router (Aug 2025) and ChatGPT's safety router (Sep 2025) were criticised mainly for being invisible and taking away control; OpenAI responded with explicit mode pickers (Auto/Fast/Thinking), restored legacy models, and an "ask and it will tell you" disclosure that critics found insufficient. Microsoft's published pattern (visible agent tag plus a system control message on every join/leave) is the clearest positive model.

### Cited Findings
- GPT-5 (announced ~2025-08-07) used a real-time router choosing among variants; Altman pitched it as fixing a "very confusing mess" of models. Over the launch weekend, pushback turned the rollout into "a product and trust crisis"; users felt they lacked control over which model answered and some suspected deliberate obscuring — [Fortune, 2025-08-12](https://www.fortune.com/2025/08/12/openai-gpt-5-model-router-backlash-ai-future)
- Altman admitted faulty model switching and a bumpy rollout; OpenAI returned older models (GPT-4o) — [VentureBeat](https://venturebeat.com/ai/openai-returns-old-models-to-chatgpt-as-sam-altman-admits-bumpy-gpt-5-rollout)
- OpenAI fixed "buggy routing", raised limits and promised updates — [Fortune](https://www.fortune.com/2025/08/12/openai-gpt-5-model-router-backlash-ai-future)
- Within about a week OpenAI added Auto, Fast and Thinking modes to the picker, giving manual override — [iPhone in Canada, 2025-08-13](https://www.iphoneincanada.ca/2025/08/13/openai-gpt-5-new-auto-fast-thinking-modes/)
- Safety routing: announced 2025-09-02, rolled out late September 2025; detects emotionally sensitive chats and switches mid-chat to a reasoning model — [TechCrunch, 2025-09-02](https://techcrunch.com/2025/09/02/openai-to-route-sensitive-conversations-to-gpt-5-introduce-parental-controls); [TechCrunch, 2025-09-29](https://techcrunch.com/2025/09/29/openai-rolls-out-safety-routing-system-parental-controls-on-chatgpt)
- Nick Turley (Head of ChatGPT): "Routing happens on a per-message basis"; switching "happens on a temporary basis"; "ChatGPT will tell you which model is active when asked" (disclosure on request only) — [Simon Willison, 2025-09-28](https://simonwillison.net/2025/Sep/28/nick-turley/)
- Paying subscribers accused OpenAI of "secretly switching" to inferior models — [TechRadar](https://www.techradar.com/ai-platforms-assistants/chatgpt/openai-responds-to-furious-chatgpt-subscribers-who-accuse-it-of-secretly-switching-to-inferior-models); a petition claimed prompts were rerouted "without consent or notification" — [change.org](https://www.change.org/p/bring-back-full-creative-freedom-in-chatgpt)
- An independent (single-author, unverified) analysis claimed prompts were rerouted to an undocumented safety model — [lex-au whitepaper](https://lex-au.github.io/Whitepaper-GPT-5-Safety-Classifiers)
- An academic (Jiaxuan You) suspected, without confirmation, that parts of one query could go to different models, producing contradictions — [Fortune](https://www.fortune.com/2025/08/12/openai-gpt-5-model-router-backlash-ai-future)
- Current state: GPT-5 Instant/Thinking retired 2026-02-13; GPT-5.5 Instant is the default with a picker (Instant / Thinking); automatic switching from Instant to Thinking still occurs and does not count toward manual Thinking limits — [OpenAI Help, GPT-5.5 in ChatGPT](https://help-lb.openai.com/en/articles/11909943-gpt-55-in-chatgpt) (search summary; direct fetch 403)
- Microsoft's handoff pattern: visible agent tag in the composer plus system "control message" when an agent joins or stops responding — [Microsoft Learn](https://learn.microsoft.com/en-us/agents/design-guidelines/agent-entry-points)

### Inferences
- Silent switching of *who* answers is the failure mode users punish; the lesson transfers directly to domain agents. An auto-switch from "stays" to "restaurants" should be announced in-thread (a control-message-style divider naming the new agent), keep the composer tag in sync, and offer a one-tap "stay with Stays" undo.
- "Ask and it will tell you" is not adequate disclosure; persistent visible state is.
- Per-message routing risks incoherent threads; switching should happen at clear topic boundaries and persist until the user or a new clear signal changes it (hysteresis), rather than flipping per message.
- A suggest-then-confirm pattern ("This sounds like a restaurant question — switch to Dining?") is safer than a silent switch when the classifier is uncertain; auto-switch only on high confidence, and always reversible.

### Gaps
- No user research (quantitative) on auto-switch vs confirm-first in multi-agent chat found within budget.
- Whether ChatGPT now labels each response with the model that produced it could not be verified (help page 403).

## Q3. Conversational UX research: persona consistency, trust, mode indicators

### Takeaway
Within budget, only partial primary sources were retrieved. Microsoft's HAX guidelines (CHI 2019, 18 guidelines) are the canonical framework; NN/g's anthropomorphism study identifies four levels of user anthropomorphism; academic work notes persona consistency is hard and must be backed by real domain competence.

### Cited Findings
- Microsoft's "Guidelines for Human-AI Interaction": 18 generally applicable guidelines, CHI 2019, Honorable Mention — [Microsoft Research](https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/); toolkit and design library — [HAX Toolkit](https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/)
- Microsoft frames the agent tag and control messages as transparency, "a core principle of responsible AI design" — [Microsoft Learn](https://learn.microsoft.com/en-us/agents/design-guidelines/agent-entry-points)
- NN/g qualitative study of ChatGPT users identified four degrees of anthropomorphism: Courtesy, Reinforcement, Roleplay, Companionship (reported second-hand) — [uxdesign.cc summary](https://uxdesign.cc/our-human-habit-of-anthropomorphizing-everything-dd2d79488ea4); primary at nngroup.com/articles/anthropomorphism/ (not fetched)
- Persona research: building AI with consistent personas "isn't easy", and a persona needs domain knowledge, not only traits ("an AI playing the role of a doctor needs medical knowledge") — [arXiv 2407.11977](https://arxiv.org/html/2407.11977)

### Inferences
- From the HAX set (titles recalled from the CHI 2019 paper, not re-verified in this session — see Gaps), the most relevant guidelines for domain agents are: make clear what each agent can do (starters, scope), scope services when in doubt (ask before switching), make clear why the system did what it did (why it switched), support efficient correction/dismissal (undo switch), and notify users about changes.
- Visual identity per agent (colour, avatar) should be consistent across picker, composer tag, message attribution and history list, since Microsoft treats the small-scale tag as the main trust signal.

### Gaps
- Exact HAX guideline titles, Google PAIR People + AI Guidebook chapters ("Explainability + Trust", "Mental models"), and Apple HIG generative-AI guidance were not fetched; cite them only after verification.
- No NN/g article specifically on multi-agent switching or mode indicators was found.

## Q4. Animated assistant indicators and what state they convey

### Takeaway
Only Apple's Siri glow was researched; it is a non-blocking, voice-responsive edge glow tied to Apple Intelligence branding rather than a documented state machine.

### Cited Findings
- The Apple Intelligence Siri appears as a glow around the screen edges (iOS 18.1, late 2024) on Apple Intelligence devices; older devices keep the orb — [SlashGear](https://www.slashgear.com/1865686/iphone-glowing-around-edges-reason/); [9to5Mac, 2024-11-03](https://9to5mac.com/2024/11/03/new-apple-intelligence-siri-looks-different-works-the-same/)
- 9to5Mac: the new look signals Apple Intelligence but does not mean capabilities "meaningfully improved"; the animation responds to the user's voice and lets the user keep scrolling and typing — [9to5Mac](https://9to5mac.com/2024/11/03/new-apple-intelligence-siri-looks-different-works-the-same/)
- Developer commentary (not Apple): a glow should only appear when there is a real state to show; an always-on glow stops signalling — [vp0 blog](https://vp0.com/blogs/apple-intelligence-glow-border-effect-code-ios-free-ios-template-vibe-coding-gui)

### Inferences
- Animated identity marks should map to real states (listening, working, responding, idle) and stop when idle; a per-agent animated mark could tint by agent colour while keeping one shared state vocabulary.

### Gaps
- Gemini spark, Claude's thinking animation and Copilot's animated logo were not researched within the tool budget; no official design statements were found for any of them.
- No Apple HIG text on the glow's meaning was found.
