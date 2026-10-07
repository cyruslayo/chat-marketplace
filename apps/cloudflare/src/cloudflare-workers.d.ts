// The Workers runtime module the Durable Object extends, declared locally so the Cloudflare app can type-check
// alongside the repository's DOM and Node globals (which conflict with the workers-types global script). The
// runtime behaviour comes from workerd; this only types the surface the app uses. `scripts/check-worker-bundle.mjs`
// and `cf build` compile and validate the real graph.
declare module "cloudflare:workers" {
  /** The bindings advertised to module-scope consumers (tests read `env` from here). */
  export const env: Cloudflare.Env;

  export class DurableObject<Env = unknown> {
    protected readonly ctx: import("@cloudflare/workers-types").DurableObjectState;
    protected readonly env: Env;
    constructor(
      ctx: import("@cloudflare/workers-types").DurableObjectState,
      env: Env,
    );
  }
}
