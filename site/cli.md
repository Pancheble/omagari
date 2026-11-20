# Commands

| Command | What it does |
|---|---|
| `omagari setup [<address>]` | Sign in, save the server address, put the hooks and the status line skill into this machine's agents, and register the background runner to start at login |
| `omagari uninstall` | Remove the hooks, the skill, and the background runner (`--sign-out` also ends your session) |
| `omagari runner` | Start the runner in a repo folder (`--share full\|declared\|intent` picks what you upload, `--merge-check on\|off`) |
| `omagari share on\|off` | Share this repo with your team once (it follows you to other machines), or stop sharing it. Until then your runner doesn't observe it |
| `omagari runner check` | Run the check command once on your current work, in the sandbox |
| `omagari runner ask <message>` / `runner log` | Ask this repo's runner session, or see what the runner ran |
| `omagari status` / `status set <line>` | See what the team is doing, or write your status line |
| `omagari claim <path>` / `release` | Say what you plan to change, and let go when you're done |
| `omagari impact <symbol>` | See who uses a symbol and who's changing it |
| `omagari ask <member> <question>` / `wait` | Ask a teammate's agent, and wait for the answer |
| `omagari debate <post>` | Ask for a debate on a conflict post, with an agenda and grounds |
| `omagari metrics` | See daily members and Q&A counts |
| `omagari --version` | See the installed version and contract version |

Most of these are for your agent. The status line skill that `setup` installs tells it when to use them.
