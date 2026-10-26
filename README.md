# Silk Web — Day 1 starter

**State:** template created; not an assertion of installation on your computer.

## Deliverable
A private Git monorepo scaffold and a zero-model-cost MCP `ping` tool. The server
speaks stdio (not HTTP) and returns validated JSON with both a text block and
structured content. See `docs/day1-checklist.md` for evidence requirements.

### 1. Prerequisites
Node.js 20+ (recommend current LTS), npm, Git, and Muse Code installed using
Meta's official OS-specific guide: https://dev.meta.ai/docs/quickstart

Run:
```sh
node --version
npm --version
git --version
muse --version
```
If `muse` is not installed, follow the official OS-specific installer rather
than guessing a third-party npm package.

### 2. Build and test MCP locally (no model calls)
Run these commands **from the repository root**:
```sh
cd apps/mcp-server
npm install
npm run check
cd ../..
node scripts/show-muse-config.mjs
```
`npm install` creates `apps/mcp-server/package-lock.json`. **Commit that file**.
Expected smoke output:
`PASS MCP initialization, tools/list and ping: {"ok":true,"service":"silkweb"}`.
If the smoke fails, do not proceed to Muse; capture the actual error.

### 3. Connect to Muse Code
Merge the generated `mcp_servers.silkweb` entry into your existing
`~/.config/muse/settings.json` (do not overwrite other settings). Run Muse
Code from the repo root in Standard mode, once billing and limits are checked:
```sh
muse --model muse-spark-1.3 --contributor-mode off
```
Inside Muse Code, run `/models` and `/mcp`. Confirm `silkweb` and `ping` are
listed. Ask: "Call the silkweb ping MCP tool, then show its exact JSON result."
Watch an actual tool invocation; inventory alone is insufficient. A successful
model call may have a usage charge; do not do this until billing is verified.

### 4. Commit a reproducible checkpoint
```sh
git init -b main
git add .
git commit -m "day1: scaffold Silk Web and local MCP ping"
git status
```
Create a private repository named `silkweb` under your GitHub account, then:
```sh
git remote add origin YOUR_PRIVATE_REPO_URL
git push -u origin main
```
Use Git Credential Manager or your existing GitHub sign-in rather than pasting
a token into a command or conversation.

Official references:
- https://dev.meta.ai/docs/muse-code/extending
- https://dev.meta.ai/docs/muse-code/configuration
- https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-server
