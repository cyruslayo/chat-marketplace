# The backend and web application own authoritative transaction state

Authoritative conversation and transaction state lives in platform backend services and is presented most fully by the web application. WhatsApp and Instagram are channel adapters for acquisition, domain-bounded conversation, compact results, notifications, payment links, support, and human handoff; they translate domain results but are not systems of record. This preserves consistent booking behavior across channels and avoids coupling the product to channel-specific interface and policy constraints.
