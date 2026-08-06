# Project Chrome DevTools MCP Design

## Goal

Make the Chrome DevTools MCP server declared in the repository's `.mcp.json`
available to Codex only while Codex is working in this trusted project.

## Configuration

Create `.codex/config.toml` with one project-scoped STDIO server:

```toml
[mcp_servers.chrome-devtools]
command = "npx"
args = ["-y", "chrome-devtools-mcp@latest", "--browserUrl=http://127.0.0.1:9222"]
```

The server name, executable, package version selector, and browser URL match
`.mcp.json` exactly. The existing `.mcp.json` remains unchanged so other clients
can continue to use it.

## Runtime Behavior

When Codex loads this trusted project, it starts the server through `npx`. The
server connects to a Chrome remote-debugging endpoint on `127.0.0.1:9222`.
Codex sessions outside this repository do not load the server.

If the npm package is not cached, `npx -y` may need network access to download
it. MCP tools that require a browser connection will not work unless Chrome is
running with remote debugging available on port 9222.

## Verification

1. Parse the new file as TOML.
2. Run `codex mcp list` from the repository and confirm `chrome-devtools` is
   configured with the expected command and arguments.
3. Confirm no application files or the existing `.mcp.json` were changed.

The active Codex client may require an MCP configuration reload or restart
before the new tools appear in an already-open conversation.
