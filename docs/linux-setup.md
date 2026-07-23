# Linux Setup (systemd user service)

Run the proxy automatically in the background on Linux using a systemd user unit.

> **Using fnm / nvm for Node?** A bare `ExecStart=/usr/bin/env node ...` runs
> under systemd's minimal PATH and will not find a version-manager-managed node.
> Either point `ExecStart` at the resolved node binary (`fnm which default` /
> `nvm which default` — an absolute path under `~/.local/share/fnm/...` or
> `~/.nvm/...`), or skip systemd and use the bundled launcher
> [`scripts/proxyctl.sh`](../scripts/proxyctl.sh), which resolves node from PATH
> or fnm and the Claude CLI from `CLAUDE_BIN`/PATH/`~/.local/bin/claude`:
>
> ```bash
> scripts/proxyctl.sh start [port]     # default 3456, or CLAUDE_PROXY_PORT
> scripts/proxyctl.sh status
> scripts/proxyctl.sh stop
> ```

## 1. Authenticate the Claude CLI (headless-friendly)

The proxy has no credentials of its own — it reuses whatever the Claude CLI is
authenticated with, so the CLI must be logged in once on the server. The normal
`claude auth login` flow tries to open a browser, but neither option below needs
one on the server:

- **`claude setup-token`** — prints a URL in the terminal. Open it on any other
  device (phone, laptop), approve access with your Claude Max account, and paste
  the resulting code back into the SSH session.
- **Copy credentials from an already-authenticated Linux machine** — Claude Code
  stores credentials in `~/.claude/.credentials.json` on Linux. Copy that file to
  the same path on the server and restrict it to your user:

  ```bash
  scp other-machine:~/.claude/.credentials.json ~/.claude/
  chmod 600 ~/.claude/.credentials.json
  ```

  macOS stores credentials in the Keychain instead of a file, so this route only
  works Linux → Linux.

Authentication errors are not detected at proxy startup — they surface on the
first real request, as a `result` message with `is_error: true`. If requests fail
right after setup, re-check this step.

## 2. Build the project

```bash
cd ~/Projects/claude-evergreen-proxy
npm install
npm run build
```

## 3. Create the unit file

`~/.config/systemd/user/claude-evergreen-proxy.service`:

```ini
[Unit]
Description=Claude Evergreen Proxy (OpenAI/Anthropic-compatible wrapper for Claude Code CLI)
After=network.target

[Service]
ExecStart=/usr/bin/env node %h/Projects/claude-evergreen-proxy/dist/server/standalone.js 3456
WorkingDirectory=%h/Projects/claude-evergreen-proxy
Restart=on-failure
RestartSec=5
# Optional hardening / configuration:
# Environment=CLAUDE_PROXY_API_KEY=change-me
# Environment=CLAUDE_PROXY_MODELS=claude-opus-4-8,claude-sonnet-5
# Environment=CLAUDE_BIN=%h/.local/bin/claude

[Install]
WantedBy=default.target
```

Adjust `ExecStart`/`WorkingDirectory` if you cloned the repo elsewhere. `WorkingDirectory` matters: `models.json` is written there by default.

## 4. Enable and start

```bash
systemctl --user daemon-reload
systemctl --user enable --now claude-evergreen-proxy
```

To keep the service running when you are not logged in:

```bash
loginctl enable-linger "$USER"
```

## 5. Manage the service

```bash
systemctl --user status claude-evergreen-proxy    # status
systemctl --user restart claude-evergreen-proxy   # restart
systemctl --user stop claude-evergreen-proxy      # stop
journalctl --user -u claude-evergreen-proxy -f    # follow logs
```

## 6. Verify

```bash
curl http://localhost:3456/health
curl http://localhost:3456/v1/models
```
