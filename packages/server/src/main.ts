import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CONTRACT_VERSION } from "@omagari/contract";
import { realGiphy, realGitHub, startServer } from "./index.ts";

const WEB_DIST = fileURLToPath(new URL("../../web/dist", import.meta.url));

const { OMAGARI_REPO, GITHUB_CLIENT_ID } = process.env;
// The list of GitHub accounts to accept (ADR-0043). Split by commas or spaces. `owner/name` accepts that account and is added each time that repo is turned on.
const accept = (OMAGARI_REPO ?? "").split(/[\s,]+/).filter(Boolean);
if (accept.length === 0 || !GITHUB_CLIENT_ID) {
  console.error(
    "Set OMAGARI_REPO (the list of GitHub accounts to accept: owner or owner/name, separated by commas) and GITHUB_CLIENT_ID (the GitHub App or OAuth app with device flow on)",
  );
  process.exit(1);
}

// Without HOST, it only listens on this machine. When deploying, set it like HOST=0.0.0.0.
const server = await startServer({
  accept,
  github: realGitHub(GITHUB_CLIENT_ID),
  // With a GitHub App (ADR-0053), its slug (github.com/apps/<slug>). "No access" then says to install the App, with the link. Not set for an OAuth app.
  githubApp: process.env.GITHUB_APP_SLUG || undefined,
  // GIF search (ADR-0044). Without a key there's no GIF button. With a production key, raise the hourly limit with GIPHY_PER_HOUR (beta keys get 100).
  giphy: process.env.GIPHY_API_KEY
    ? realGiphy(process.env.GIPHY_API_KEY, {
        perHour: process.env.GIPHY_PER_HOUR ? Number(process.env.GIPHY_PER_HOUR) : undefined,
      })
    : undefined,
  database: process.env.OMAGARI_DB ?? "omagari.db",
  // Encrypts GitHub tokens in the database (ADR-0053). Without it, a key file is made next to the database.
  tokenKey: process.env.OMAGARI_TOKEN_KEY || undefined,
  port: Number(process.env.PORT ?? 3000),
  hostname: process.env.HOST,
  // If there's a built web UI (`npm run build -w @omagari/web`, the deploy image), serve it from the same address.
  webDir: existsSync(WEB_DIST) ? WEB_DIST : undefined,
  // The address people open the web at. Used for the source of decision files (post links). If not set, it's the address the server listens on.
  // On Fly it's https://<app name>.fly.dev even if not set.
  publicUrl:
    process.env.OMAGARI_URL ??
    (process.env.FLY_APP_NAME ? `https://${process.env.FLY_APP_NAME}.fly.dev` : undefined),
  // Section 13 of AGPL-3.0: if you change the server, point the settings' "Source code" link at your fork. Omagari's repo if not set.
  sourceUrl: process.env.OMAGARI_SOURCE_URL || undefined,
  // Fly sets FLY_APP_NAME on the machine. Only then do we trust the Fly-Client-IP in front.
  behindFly: Boolean(process.env.FLY_APP_NAME),
  // Limits (ADR-0052). Each unset one is no limit, so a self-hosted server works as before. The hosted server sets them (site/server.md).
  limits: Object.fromEntries(
    Object.entries({
      requests: process.env.OMAGARI_LIMIT_REQUESTS,
      repos: process.env.OMAGARI_LIMIT_REPOS,
      storage: process.env.OMAGARI_LIMIT_STORAGE_MB,
      gifs: process.env.OMAGARI_LIMIT_GIFS,
    }).flatMap(([name, value]) => (value ? [[name, Number(value)]] : [])),
  ),
  // The number of debate rounds. Three if not set.
  debateRounds: process.env.OMAGARI_DEBATE_ROUNDS
    ? Number(process.env.OMAGARI_DEBATE_ROUNDS)
    : undefined,
});
console.log(
  `Omagari server ${server.version} (contract ${CONTRACT_VERSION}): ${server.url} (${accept.join(", ")})`,
);
