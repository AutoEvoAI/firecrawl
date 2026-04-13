import type { Socket } from "net";
import { config } from "../../../../config";
import type { TLSSocket } from "tls";
import * as undici from "undici";
import { interceptors } from "undici";
import { CookieJar } from "tough-cookie";
import { cookie } from "http-cookie-agent/undici";
import IPAddr from "ipaddr.js";
export class InsecureConnectionError extends Error {
  constructor() {
    super("Connection violated security rules.");
  }
}

export function isIPPrivate(address: string): boolean {
  if (!IPAddr.isValid(address)) return false;

  const addr = IPAddr.parse(address);
  return addr.range() !== "unicast";
}

type ProxyConfig = {
  server?: string;
  username?: string;
  password?: string;
};

function createBaseAgent(
  skipTlsVerification: boolean,
  proxyConfig: ProxyConfig,
) {
  const baseAgent = proxyConfig.server
    ? new undici.ProxyAgent({
        uri: proxyConfig.server.includes("://")
          ? proxyConfig.server
          : "http://" + proxyConfig.server,
        token: proxyConfig.username
          ? `Basic ${Buffer.from(proxyConfig.username + ":" + (proxyConfig.password ?? "")).toString("base64")}`
          : undefined,
        requestTls: {
          rejectUnauthorized: !skipTlsVerification, // Only bypass SSL verification if explicitly requested
        },
      })
    : new undici.Agent({
        connect: {
          rejectUnauthorized: !skipTlsVerification, // Only bypass SSL verification if explicitly requested
        },
      });

  // Add redirect interceptor for handling redirects
  return baseAgent.compose(interceptors.redirect({ maxRedirections: 5000 }));
}

function attachSecurityCheck(agent: undici.Dispatcher) {
  agent.on("connect", (_, targets) => {
    const client: undici.Client = targets.slice(-1)[0] as undici.Client;
    const socketSymbol = Object.getOwnPropertySymbols(client).find(
      x => x.description === "socket",
    )!;
    const socket: Socket | TLSSocket = (client as any)[socketSymbol];

    if (
      socket.remoteAddress &&
      isIPPrivate(socket.remoteAddress) &&
      config.ALLOW_LOCAL_WEBHOOKS !== true
    ) {
      socket.destroy(new InsecureConnectionError());
    }
  });
}

// Dispatcher WITH cookie handling (for scraping - needs cookies for auth flows)
function makeSecureDispatcher(
  skipTlsVerification: boolean,
  proxyConfig: ProxyConfig,
) {
  const baseAgent = createBaseAgent(skipTlsVerification, proxyConfig);
  const cookieJar = new CookieJar();
  const agent = baseAgent.compose(cookie({ jar: cookieJar }));
  attachSecurityCheck(agent);
  return agent;
}

// Dispatcher WITHOUT cookie handling (for webhooks - avoids empty cookie header bug)
function makeSecureDispatcherNoCookies(
  skipTlsVerification: boolean,
  proxyConfig: ProxyConfig,
) {
  const agent = createBaseAgent(skipTlsVerification, proxyConfig);
  attachSecurityCheck(agent);
  return agent;
}

// Basic proxy configuration
const basicProxyConfig: ProxyConfig = {
  server: config.PROXY_SERVER,
  username: config.PROXY_USERNAME,
  password: config.PROXY_PASSWORD,
};

// Stealth proxy configuration (fallback to basic if not configured)
const stealthProxyConfig: ProxyConfig = {
  server: config.PROXY_STEALTH_SERVER || config.PROXY_SERVER,
  username: config.PROXY_STEALTH_USERNAME || config.PROXY_USERNAME,
  password: config.PROXY_STEALTH_PASSWORD || config.PROXY_PASSWORD,
};

// Basic proxy dispatchers (existing)
const secureDispatcher = makeSecureDispatcher(false, basicProxyConfig);
const secureDispatcherSkipTlsVerification = makeSecureDispatcher(
  true,
  basicProxyConfig,
);
const secureDispatcherNoCookies = makeSecureDispatcherNoCookies(
  false,
  basicProxyConfig,
);
const secureDispatcherNoCookiesSkipTlsVerification =
  makeSecureDispatcherNoCookies(true, basicProxyConfig);

// Stealth proxy dispatchers (new)
const stealthDispatcher = makeSecureDispatcher(false, stealthProxyConfig);
const stealthDispatcherSkipTlsVerification = makeSecureDispatcher(
  true,
  stealthProxyConfig,
);
const stealthDispatcherNoCookies = makeSecureDispatcherNoCookies(
  false,
  stealthProxyConfig,
);
const stealthDispatcherNoCookiesSkipTlsVerification =
  makeSecureDispatcherNoCookies(true, stealthProxyConfig);

export const getSecureDispatcher = (skipTlsVerification: boolean = false) =>
  skipTlsVerification ? secureDispatcherSkipTlsVerification : secureDispatcher;

// Use this for webhook delivery to avoid sending empty cookie headers
export const getSecureDispatcherNoCookies = (
  skipTlsVerification: boolean = false,
) =>
  skipTlsVerification
    ? secureDispatcherNoCookiesSkipTlsVerification
    : secureDispatcherNoCookies;

// New stealth proxy dispatchers
export const getStealthDispatcher = (skipTlsVerification: boolean = false) =>
  skipTlsVerification
    ? stealthDispatcherSkipTlsVerification
    : stealthDispatcher;

const getStealthDispatcherNoCookies = (skipTlsVerification: boolean = false) =>
  skipTlsVerification
    ? stealthDispatcherNoCookiesSkipTlsVerification
    : stealthDispatcherNoCookies;
