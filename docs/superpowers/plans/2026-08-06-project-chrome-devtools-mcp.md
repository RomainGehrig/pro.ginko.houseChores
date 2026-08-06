# Project Chrome DevTools MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Configure Codex to load the repository's Chrome DevTools MCP server only for this trusted project.

**Architecture:** Add one project-scoped Codex configuration file that mirrors the existing `.mcp.json` STDIO command and arguments. Keep `.mcp.json` and all application files unchanged.

**Tech Stack:** Codex `config.toml`, TOML, Node.js `npx`, Chrome DevTools MCP

## Global Constraints

- Scope the MCP server to this repository through `.codex/config.toml`.
- Preserve the server name `chrome-devtools`.
- Preserve `npx -y chrome-devtools-mcp@latest --browserUrl=http://127.0.0.1:9222` exactly.
- Do not modify `.mcp.json` or application files.
- Do not stage or commit the pre-existing untracked `batch-1-foundations.md`.

---

### Task 1: Add and verify the project MCP configuration

**Files:**
- Create: `.codex/config.toml`
- Verify unchanged: `.mcp.json`

**Interfaces:**
- Consumes: The `chrome-devtools` STDIO declaration in `.mcp.json`.
- Produces: A project-scoped `[mcp_servers.chrome-devtools]` Codex configuration.

- [x] **Step 1: Confirm the configuration is not present yet**

Run:

```bash
test ! -e .codex/config.toml
```

Expected: exit status 0 before implementation.

- [x] **Step 2: Create the minimal Codex configuration**

Create `.codex/config.toml` with exactly:

```toml
[mcp_servers.chrome-devtools]
command = "npx"
args = ["-y", "chrome-devtools-mcp@latest", "--browserUrl=http://127.0.0.1:9222"]
```

- [x] **Step 3: Parse the file as TOML and verify its values**

Run:

```bash
python3 -c 'import pathlib, tomllib; d=tomllib.loads(pathlib.Path(".codex/config.toml").read_text()); s=d["mcp_servers"]["chrome-devtools"]; assert s == {"command": "npx", "args": ["-y", "chrome-devtools-mcp@latest", "--browserUrl=http://127.0.0.1:9222"]}'
```

Expected: exit status 0 with no output.

- [x] **Step 4: Verify Codex discovers the project MCP server**

Run:

```bash
codex mcp list
```

Expected: output contains an enabled `chrome-devtools` server using `npx` and the three configured arguments.

- [x] **Step 5: Confirm the change is scoped**

Run:

```bash
git status --short
git diff -- .mcp.json .codex/config.toml
```

Expected: `.codex/config.toml` is the only implementation file added; `.mcp.json` has no diff; `batch-1-foundations.md` remains untracked and unstaged.

- [x] **Step 6: Commit the implementation and plan**

```bash
git add .codex/config.toml docs/superpowers/plans/2026-08-06-project-chrome-devtools-mcp.md
git commit -m "chore: add project Chrome DevTools MCP"
```
