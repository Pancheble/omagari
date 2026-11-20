import assert from "node:assert/strict";
import { test } from "node:test";
import { plist, unit } from "./service.ts";

const service = {
  args: [
    "/opt/node $24/bin/node",
    "/home/a&b/omagari/packages/cli/src/main.ts",
    "runner",
    "background",
  ],
  env: { PATH: "/usr/bin:/home/x/50%$HOME", CODEX_HOME: '/home/"q"\\c' },
  log: "/home/a<b>/.config/omagari/background.log",
};

test("the launchd agent runs the background runner at login with the carried environment, escaped as XML", () => {
  assert.equal(
    plist(service),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.github.omagari-dev.runner</string>
  <key>ProgramArguments</key>
  <array>
    <string>/opt/node $24/bin/node</string>
    <string>/home/a&amp;b/omagari/packages/cli/src/main.ts</string>
    <string>runner</string>
    <string>background</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/usr/bin:/home/x/50%$HOME</string>
    <key>CODEX_HOME</key>
    <string>/home/"q"\\c</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/home/a&lt;b&gt;/.config/omagari/background.log</string>
  <key>StandardErrorPath</key>
  <string>/home/a&lt;b&gt;/.config/omagari/background.log</string>
</dict>
</plist>
`,
  );
});

test("the systemd user unit quotes each word and doubles % (and $ in ExecStart)", () => {
  assert.equal(
    unit(service),
    `[Unit]
Description=Omagari background runner

[Service]
ExecStart="/opt/node $$24/bin/node" "/home/a&b/omagari/packages/cli/src/main.ts" "runner" "background"
Environment="PATH=/usr/bin:/home/x/50%%$HOME"
Environment="CODEX_HOME=/home/\\"q\\"\\\\c"
Restart=on-failure

[Install]
WantedBy=default.target
`,
  );
});
