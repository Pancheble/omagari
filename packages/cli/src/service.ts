// Registers the background runner to start at login (ADR-0049): a launchd agent on macOS, a systemd user unit on Linux and WSL2.
import { execFile } from "node:child_process";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, release } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const MAIN = fileURLToPath(new URL("./main.ts", import.meta.url));
const LABEL = "com.github.omagari-dev.runner";
const UNIT = "omagari-runner.service";
/** What the runner needs from the shell `setup` runs in: `claude`, `codex` and `git` on PATH, the temp folder its sockets are in, and where configs are. */
const CARRIED = ["PATH", "TMPDIR", "XDG_CONFIG_HOME", "CLAUDE_CONFIG_DIR", "CODEX_HOME"];

type Service = { args: string[]; env: Record<string, string>; log: string };

const run = (file: string, ...args: string[]) => promisify(execFile)(file, args);
const configHome = () => process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
const plistFile = () => join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const unitFile = () => join(configHome(), "systemd", "user", UNIT);

/** Why the background runner can't be registered on this machine, or undefined if it can. On Windows itself `setup` stops on this. */
export async function unsupported() {
  if (process.platform === "win32")
    return "Omagari runs on Windows through WSL2. Open a WSL2 terminal and run omagari setup there";
  if (process.platform === "darwin") return undefined;
  if (process.platform !== "linux") return `No background runner on ${process.platform}`;
  if (
    await access("/run/systemd/system").then(
      () => true,
      () => false,
    )
  )
    return undefined;
  if (/microsoft/i.test(release()))
    return "WSL2 is running without systemd, so the background runner can't start at login. Add these lines to /etc/wsl.conf, run wsl --shutdown in Windows, open WSL2 again and run omagari setup again:\n[boot]\nsystemd=true";
  return "This Linux has no systemd, so the background runner can't start at login. Run omagari runner in each repo folder instead";
}

/** Registers the background runner to start at login and (re)starts it now. Returns one line on what it did. */
export async function register() {
  const why = await unsupported();
  if (why) return `Background runner: not registered. ${why}`;
  const service: Service = {
    args: [process.execPath, MAIN, "runner", "background"],
    env: Object.fromEntries(
      CARRIED.flatMap((name) => (process.env[name] ? [[name, process.env[name]]] : [])),
    ),
    log: join(configHome(), "omagari", "background.log"),
  };
  if (process.platform === "darwin") {
    const file = plistFile();
    await mkdir(dirname(file), { recursive: true });
    await mkdir(dirname(service.log), { recursive: true, mode: 0o700 });
    await writeFile(file, plist(service));
    const domain = `gui/${process.getuid?.()}`;
    await run("launchctl", "bootout", `${domain}/${LABEL}`).catch(() => {}); // the one an earlier setup started
    await run("launchctl", "bootstrap", domain, file);
    return `Background runner: registered with launchd in ${file}. It starts at login, logs to ${service.log}, and watches the repos your agent sessions open.`;
  }
  const file = unitFile();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, unit(service));
  await run("systemctl", "--user", "daemon-reload");
  await run("systemctl", "--user", "enable", UNIT);
  await run("systemctl", "--user", "restart", UNIT);
  return `Background runner: registered with systemd in ${file}. It starts at login, logs to journalctl --user -u ${UNIT}, and watches the repos your agent sessions open.`;
}

/** Stops the background runner and removes its registration. Returns one line on what it did. */
export async function unregister() {
  if (process.platform === "darwin") {
    const file = plistFile();
    if (
      !(await access(file).then(
        () => true,
        () => false,
      ))
    )
      return "Background runner: none was registered.";
    await run("launchctl", "bootout", `gui/${process.getuid?.()}/${LABEL}`).catch(() => {});
    await rm(file);
    return `Background runner: stopped it and removed ${file}.`;
  }
  const file = unitFile();
  if (
    process.platform !== "linux" ||
    !(await access(file).then(
      () => true,
      () => false,
    ))
  )
    return "Background runner: none was registered.";
  await run("systemctl", "--user", "disable", "--now", UNIT).catch(() => {});
  await rm(file);
  await run("systemctl", "--user", "daemon-reload").catch(() => {});
  return `Background runner: stopped it and removed ${file}.`;
}

const xml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** The launchd agent. KeepAlive starts it again if it crashes. */
export function plist({ args, env, log }: Service) {
  const strings = (values: string[]) => values.map((v) => `    <string>${xml(v)}</string>`);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    `<dict>`,
    `  <key>Label</key>`,
    `  <string>${LABEL}</string>`,
    `  <key>ProgramArguments</key>`,
    `  <array>`,
    ...strings(args),
    `  </array>`,
    `  <key>EnvironmentVariables</key>`,
    `  <dict>`,
    ...Object.entries(env).flatMap(([name, value]) => [
      `    <key>${xml(name)}</key>`,
      `    <string>${xml(value)}</string>`,
    ]),
    `  </dict>`,
    `  <key>RunAtLoad</key>`,
    `  <true/>`,
    `  <key>KeepAlive</key>`,
    `  <true/>`,
    `  <key>StandardOutPath</key>`,
    `  <string>${xml(log)}</string>`,
    `  <key>StandardErrorPath</key>`,
    `  <string>${xml(log)}</string>`,
    `</dict>`,
    `</plist>`,
    "",
  ].join("\n");
}

/** One quoted systemd word. `%` starts a specifier, so it's doubled (systemd.unit, "Specifiers"). */
const quoted = (value: string) => `"${value.replace(/[\\"]/g, "\\$&").replaceAll("%", "%%")}"`;
/** In ExecStart `$` also starts a variable, so it's doubled too (systemd.service, "Command lines"). */
const command = (value: string) => quoted(value).replaceAll("$", "$$$$");

/** The systemd user unit. It starts with the user's session (default.target) and again if it crashes. */
export function unit({ args, env }: Service) {
  return [
    "[Unit]",
    "Description=Omagari background runner",
    "",
    "[Service]",
    `ExecStart=${args.map(command).join(" ")}`,
    ...Object.entries(env).map(([name, value]) => `Environment=${quoted(`${name}=${value}`)}`),
    "Restart=on-failure",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}
