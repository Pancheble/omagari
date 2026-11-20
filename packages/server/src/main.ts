import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CONTRACT_VERSION } from "@omagari/contract";
import { realGiphy, realGitHub, startServer } from "./index.ts";

const WEB_DIST = fileURLToPath(new URL("../../web/dist", import.meta.url));

const { OMAGARI_REPO, GITHUB_CLIENT_ID } = process.env;
// The list of GitHub accounts to accept (ADR-0043). Split by commas or spaces. `owner/name` accepts that account and is added each time that repo is turned on.
const list = (value?: string) => (value ?? "").split(/[\s,]+/).filter(Boolean);
const accept = list(OMAGARI_REPO);
// GitHub logins that approve access requests (ADR-0052). With operators, accounts can also come in by approved requests, so OMAGARI_REPO may be empty.
const operators = list(process.env.OMAGARI_OPERATORS);
if ((accept.length === 0 && operators.length === 0) || !GITHUB_CLIENT_ID) {
  console.error(
    "Set OMAGARI_REPO (the list of GitHub accounts to accept: owner or owner/name, separated by commas) or OMAGARI_OPERATORS (GitHub logins that approve access requests), and GITHUB_CLIENT_ID (the GitHub App or OAuth app with device flow on)",
  );
  process.exit(1);
}

// Without HOST, it only listens on this machine. When deploying, set it like HOST=0.0.0.0.
const server = await startServer({
  accept,
  operators,
  // Links to the terms and privacy policy. When set, an access request needs agreeing to them.
  terms: process.env.OMAGARI_TERMS_URL || undefined,
  privacy: process.env.OMAGARI_PRIVACY_URL || undefined,
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
  // The number of debate rounds. Three if not set.
  debateRounds: process.env.OMAGARI_DEBATE_ROUNDS
    ? Number(process.env.OMAGARI_DEBATE_ROUNDS)
    : undefined,
});
console.log(
  `Omagari server ${server.version} (contract ${CONTRACT_VERSION}): ${server.url} (${accept.join(", ")})`,
);
