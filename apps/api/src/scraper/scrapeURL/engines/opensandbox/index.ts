import { config } from "../../../../config";
import { EngineScrapeResult } from "..";
import { Meta } from "../..";
import { robustFetch } from "../../lib/fetch";
import { z } from "zod";

// OpenSandbox API types
type OpenSandboxAction =
  | { type: "wait"; ms?: number; selector?: string }
  | { type: "click"; selector: string; all?: boolean }
  | { type: "write"; text: string }
  | { type: "press"; key: string }
  | { type: "scroll"; direction: "up" | "down"; selector?: string }
  | { type: "screenshot"; fullScreen?: boolean }
  | { type: "scrape" }
  | { type: "executeJavascript"; code: string }
  | { type: "pdf" };

type OpenSandboxSession = {
  sessionId: string;
  createdAt: number;
};

// Create a new OpenSandbox session
async function createSession(
  url: string,
  proxyConfig: { server?: string; username?: string; password?: string },
  viewport: { width: number; height: number },
): Promise<OpenSandboxSession> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (config.OPENSANDBOX_API_KEY) {
    headers["OPEN-SANDBOX-API-KEY"] = config.OPENSANDBOX_API_KEY;
  }

  const response = await robustFetch({
    url: `${config.OPENSANDBOX_URL}/sessions`,
    headers,
    body: {
      url,
      proxy: proxyConfig.server ? {
        server: proxyConfig.server,
        username: proxyConfig.username,
        password: proxyConfig.password,
      } : undefined,
      viewport,
    },
    method: "POST",
    logger: null as any,
    schema: z.object({
      sessionId: z.string(),
    }),
    mock: null,
    abort: null as any,
  });

  return {
    sessionId: response.sessionId,
    createdAt: Date.now(),
  };
}

// Close a session
async function closeSession(sessionId: string): Promise<void> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (config.OPENSANDBOX_API_KEY) {
    headers["OPEN-SANDBOX-API-KEY"] = config.OPENSANDBOX_API_KEY;
  }

  await robustFetch({
    url: `${config.OPENSANDBOX_URL}/sessions/${sessionId}`,
    headers,
    method: "DELETE",
    logger: null as any,
    schema: z.object({}),
    mock: null,
    abort: null as any,
  });
}

// Execute an action on a session
async function executeAction(
  sessionId: string,
  action: OpenSandboxAction,
): Promise<any> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (config.OPENSANDBOX_API_KEY) {
    headers["OPEN-SANDBOX-API-KEY"] = config.OPENSANDBOX_API_KEY;
  }

  return await robustFetch({
    url: `${config.OPENSANDBOX_URL}/sessions/${sessionId}/actions`,
    headers,
    body: action,
    method: "POST",
    logger: null as any,
    schema: z.any(),
    mock: null,
    abort: null as any,
  });
}

// Map Firecrawl action to OpenSandbox action
function mapAction(action: any): OpenSandboxAction {
  switch (action.type) {
    case "wait":
      return {
        type: "wait",
        ms: action.ms,
        selector: action.selector,
      };
    case "click":
      return {
        type: "click",
        selector: action.selector,
        all: action.all,
      };
    case "write":
      return {
        type: "write",
        text: action.text,
      };
    case "press":
      return {
        type: "press",
        key: action.key,
      };
    case "scroll":
      return {
        type: "scroll",
        direction: action.direction,
        selector: action.selector,
      };
    case "screenshot":
      return {
        type: "screenshot",
        fullScreen: action.fullScreen,
      };
    case "scrape":
      return {
        type: "scrape",
      };
    case "executeJavascript":
      return {
        type: "executeJavascript",
        code: action.code,
      };
    case "pdf":
      return {
        type: "pdf",
      };
    default:
      throw new Error(`Unknown action type: ${(action as any).type}`);
  }
}

export async function scrapeURLWithOpenSandbox(
  meta: Meta,
): Promise<EngineScrapeResult> {
  const useStealth = meta.featureFlags.has("stealthProxy");
  const proxyConfig = useStealth
    ? {
        server: config.PROXY_STEALTH_SERVER || config.PROXY_SERVER,
        username: config.PROXY_STEALTH_USERNAME || config.PROXY_USERNAME,
        password: config.PROXY_STEALTH_PASSWORD || config.PROXY_PASSWORD,
      }
    : {
        server: config.PROXY_SERVER,
        username: config.PROXY_USERNAME,
        password: config.PROXY_PASSWORD,
      };

  const viewport = { width: 1280, height: 800 };

  // Create session
  const session = await createSession(
    meta.rewrittenUrl ?? meta.url,
    proxyConfig,
    viewport,
  );

  let html = "";
  const screenshots: string[] = [];
  const scrapes: any[] = [];
  const javascriptReturns: { type: string; value: unknown }[] = [];
  const pdfs: string[] = [];

  try {
    // Execute actions
    if (meta.options.actions && meta.options.actions.length > 0) {
      for (const action of meta.options.actions) {
        const openSandboxAction = mapAction(action);
        const result = await executeAction(session.sessionId, openSandboxAction);

        // Collect results
        if (openSandboxAction.type === "screenshot" && result.url) {
          screenshots.push(result.url);
        } else if (openSandboxAction.type === "scrape" && result.html) {
          html = result.html;
          scrapes.push({ html, url: meta.rewrittenUrl ?? meta.url });
        } else if (openSandboxAction.type === "executeJavascript" && result.returnValue !== undefined) {
          javascriptReturns.push({
            type: typeof result.returnValue,
            value: result.returnValue,
          });
        } else if (openSandboxAction.type === "pdf" && result.url) {
          pdfs.push(result.url);
        }
      }
    } else {
      // If no actions, just scrape
      const result = await executeAction(session.sessionId, { type: "scrape" });
      html = result.html;
    }

    const browserTimeMs = Date.now() - session.createdAt;

    return {
      url: meta.rewrittenUrl ?? meta.url,
      html,
      statusCode: 200,
      proxyUsed: useStealth ? "stealth" : "basic",
      actions: {
        screenshots,
        scrapes,
        javascriptReturns,
        pdfs,
      },
      browserTimeMs,
    };
  } finally {
    // Close session
    await closeSession(session.sessionId);
  }
}

export async function scrapeURLWithOpenSandboxStealth(
  meta: Meta,
): Promise<EngineScrapeResult> {
  // Force stealth proxy
  const metaWithStealth = {
    ...meta,
    featureFlags: new Set(meta.featureFlags).add("stealthProxy"),
  };
  return scrapeURLWithOpenSandbox(metaWithStealth);
}

export function opensandboxMaxReasonableTime(meta: Meta): number {
  // Base time + wait time + time for each action
  const baseTime = 10000; // 10 seconds base
  const waitTime = meta.options.waitFor || 0;
  const actionCount = meta.options.actions?.length || 0;
  const actionTime = actionCount * 2000; // 2 seconds per action
  return baseTime + waitTime + actionTime;
}
