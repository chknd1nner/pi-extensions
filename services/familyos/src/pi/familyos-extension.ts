import type { ExtensionAPI, ExtensionFactory } from "@mariozechner/pi-coding-agent";
import type { AuditLog } from "../audit-log.js";
import type { ResolvedUser } from "../types.js";
import { injectHandoffIntoProviderPayload, OneShotHandoff } from "./handoff.js";

export interface FamilyOSExtensionOptions {
  user: ResolvedUser;
  handoff: OneShotHandoff;
  audit: AuditLog;
  onEvent?: (event: { type: string; userSlug: string; data?: Record<string, unknown> }) => void;
}

export function createFamilyOSExtension(options: FamilyOSExtensionOptions): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    // Source-verified against the installed SDK: BeforeProviderRequestEvent carries
    // the provider payload on event.payload.
    pi.on("before_provider_request", (event) => {
      // Consume the handoff upfront so it always fires exactly once, regardless
      // of whether the payload shape supports injection.
      const handoff = options.handoff.consume();
      if (!handoff) return undefined;

      const result = injectHandoffIntoProviderPayload(event.payload, handoff);
      if (!result.injected) {
        options.audit.append({
          type: "handoff_payload_unsupported",
          userSlug: options.user.slug,
          data: { hasSystemArray: Array.isArray((event.payload as any)?.system) },
        });
        return undefined;
      }

      return result.payload;
    });

    pi.on("agent_start", () => {
      options.onEvent?.({ type: "agent_start", userSlug: options.user.slug });
    });

    pi.on("agent_end", () => {
      options.onEvent?.({ type: "agent_end", userSlug: options.user.slug });
    });

    pi.on("session_compact", () => {
      options.onEvent?.({ type: "session_compact", userSlug: options.user.slug });
    });
  };
}
