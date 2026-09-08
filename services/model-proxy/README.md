# Product Model Proxy — M2 local gate

The product Model Proxy is a private named service entrypoint. Trusted Pi can reach only `POST https://model-proxy.riffology.internal/v1/responses` through the Sandbox outbound interceptor. The interceptor strips caller headers and signs the actual container ID, request time, capability digest, and body digest with a Worker-only key.

The handler verifies that MAC within 30 seconds, verifies the short-lived Turn capability with a separate key, resolves the capability's derived Trusted Pi actor name to the observed Sandbox DO ID, and rejects any caller-selected provider, model, credential, base URL, or output authority. It then reserves and dispatches through the tenant's `TenantModelBudget`. Replayed HTTP requests may reach that durable ledger, but one stable call creates one reservation row and only the first durable dispatch fence may invoke the provider.

Provider adapters receive only the fixed provider and model, a bounded provider payload, a stable idempotency key, and the maximum output tokens. They do not receive the capability, Tenant, Project, Workspace, Session, Turn, submitting user, authentication version, Sandbox actor, or Worker secrets.

The production `ModelProxyService` currently has no provider adapter and returns `model_provider_unavailable` before creating a reservation. This keeps the M2 release fail closed. Provider credentials, production bindings, cloud deployment, streaming, provider reconciliation, prices, balances, payment, and settlement are outside this local gate candidate.
