# AGENTS.md

Instructions for coding agents (Claude Code, Codex, Hermes, ...) that are asked to **install** 나란 (Nanran) for a user or to **work on** this repository. Nanran is a macOS Tauri 2 app that shows an English paper and its Korean translation side by side. Translation and AI paper search run through the user's logged-in Claude Code CLI; there is no API key.

## Installing for a user

Run the one-line installer. It is idempotent: running it again upgrades in place.

```sh
curl -fsSL https://raw.githubusercontent.com/sionic-ai/paper-desktop/main/install.sh | bash -s -- --no-login
```

Use `--no-login` when you run without an interactive terminal. Login is browser-based OAuth and must be done by the human. Never type, paste, or ask for the user's credentials.

Then read the result from the exit code:

| Exit | Meaning | What to do |
|---|---|---|
| `0` | App installed, Claude Code installed and logged in | Done. Tell the user the app is in `/Applications/Nanran.app` (or `~/Applications`) |
| `2` | App installed, Claude Code is not logged in | Ask the user to run `claude auth login` in their own terminal. Then verify with `--check` |
| `1` | Error (message on stderr, in Korean) | See troubleshooting below |

Verify at any time without changing anything:

```sh
curl -fsSL https://raw.githubusercontent.com/sionic-ai/paper-desktop/main/install.sh | bash -s -- --check
```

```
app: /Applications/Nanran.app
app_version: 0.1.0
claude: /Users/<you>/.local/bin/claude
claude_login: yes
```

`--check` exits `0` only when all three are ready. `claude auth status` prints JSON with `"loggedIn": true|false` if you need to check Claude alone.

Other flags: `--no-open` (do not launch the app), `--no-claude` (skip Claude Code entirely), `--dir <path>`, `--version <tag>`. The same flags exist as env vars: `NANRAN_NO_OPEN=1`, `NANRAN_NO_CLAUDE=1`, `NANRAN_NO_LOGIN=1`, `NANRAN_DIR`, `NANRAN_VERSION`.

What the installer touches, so you can report it:

- Downloads `Nanran-macos-universal.zip` from the latest GitHub release of `sionic-ai/paper-desktop`
- Writes `Nanran.app` to `/Applications` (falls back to `~/Applications` if not writable). Quits a running copy first
- Removes the `com.apple.quarantine` xattr from the app. The build is ad-hoc signed and not notarized, so Gatekeeper would otherwise block it
- If `claude` is missing, runs Anthropic's official `https://claude.ai/install.sh`, which installs to `~/.local/bin/claude`
- Does not use `sudo`, does not edit shell profiles, and stores no secrets

Troubleshooting:

- `macOS에서만 설치할 수 있어요` → Linux and Windows are not supported
- `앱을 내려받지 못했어요` → network problem, or the `--version` tag does not exist. List tags with `gh release list -R sionic-ai/paper-desktop`
- The app says Claude Code is not logged in → have the user run `claude auth login`. The app re-checks when its window regains focus
- Translation fails with a usage-limit message → the Claude account hit its limit. Nothing to fix locally
- User data lives in `~/Library/Application Support/dev.rlaope.nanran/papers/`. Do not delete it unless asked

Uninstall: `rm -rf /Applications/Nanran.app` (and the data folder above only if the user asks).

## Working on the code

Stack: Tauri 2 + Rust (`src-tauri/`) + React 19 / Vite (`src/`). macOS only. The pipeline table in [README.md](README.md#동작-방식) maps each stage to its file.

```sh
pnpm install
pnpm dev                                    # run the app
pnpm build                                  # typecheck + web build
cd src-tauri && cargo test --lib && cargo clippy --all-targets
cargo run --release --features probe --bin nanran-probe -- claude -   # CLI probes, see README
```

Rules:

- **Claude only through the CLI.** No API keys and no HTTP calls to Anthropic. `translate::run_claude_with` runs `claude -p` with a scrubbed env, no tools/MCP/settings, in an empty temp dir. Reuse it for new prompts.
- **Never show model-invented papers.** The AI finder (`recommend.rs`) lets Claude plan queries, fetches real arXiv results, and keeps only picks whose IDs are in those results. Keep that invariant.
- **Be polite to arXiv.** Keep ≥1 s between API requests (`ARXIV_GAP`).
- **UI copy and error messages are Korean 해요체**, e.g. `번역을 시작하지 못했어요`. Keep the minimal design. Colors live in CSS variables in `src/style.css` (`--accent` is the accent); light is `:root`, dark is `:root[data-theme='dark']`, so new styles must use variables, not raw hex.
- The library is plain JSON files under the app data dir. There is no database.
- Verify UI changes in the running app or with a mocked `window.__TAURI_INTERNALS__` in a browser (`pnpm dev:web`). Run `pnpm build` and `cargo test --lib` before committing.
- Make small commits, one logical change each. Write commit messages in English, imperative mood.

## Releasing (maintainers)

```sh
scripts/release.sh v0.1.1     # bumps nothing; uses the version in tauri.conf.json
```

The script builds `--target universal-apple-darwin`, zips `Nanran.app` with `ditto` as `Nanran-macos-universal.zip`, and creates or updates the GitHub release for that tag. `install.sh` always downloads that exact asset name from `releases/latest`, so keep the name unchanged.
