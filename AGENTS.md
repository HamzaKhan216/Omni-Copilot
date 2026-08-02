# AGENTS.md

## Project

Chrome Extension (Manifest V3) — AI chat side panel that reads the active tab. No build system, no dependencies, no package.json. All files are source.

## Workflow Philosophy

All work follows the philosophies in `Agentic Workflows -BLUEPRINT/AGENTS.md`:
- **3-Layer Architecture**: Directives (what) → Orchestration (decisions) → Execution (doing)
- **Check for tools first** before creating new ones
- **Self-anneal when things break**: fix → update tool → test → update directive → system is stronger
- **Update directives as you learn** — they are living documents, not one-offs
- **Be pragmatic. Be reliable.**

## Load & Test

1. Open `chrome://extensions/`
2. Enable Developer mode
3. Click **Load unpacked** → select repo root
4. Click extension icon or press `Ctrl+Shift+E` to open side panel
5. Set API key in Settings gear icon before first use

No lint, typecheck, or test runner exists. Verify changes by loading the unpacked extension and testing manually.

## Architecture

- `manifest.json` — Manifest V3 config, permissions: `sidePanel`, `activeTab`, `scripting`, `storage`
- `background.js` — Service worker (2 lines): opens side panel on icon click
- `sidepanel.js` — All application logic (single ~1160-line IIFE). No modules, no imports.
- `sidepanel.html` — UI shell
- `styles.css` — All styling (dark theme, code blocks, animations)
- `katex/` — Bundled KaTeX (JS, CSS, fonts) for math rendering

## Key Details

**API providers have different request/response formats.** `fetchAIResponse` in `sidepanel.js:842` handles OpenAI/Groq/Nvidia (shared OpenAI-compatible format), Claude (Anthropic format with `x-api-key` header), and Gemini (Google format with query-param API key). When modifying API calls, match the provider's exact format.

**Streaming is provider-specific.** OpenAI/Groq/Nvidia use SSE (`data: ` lines, `[DONE]` terminator). Claude uses SSE with `content_block_delta` events. Gemini uses SSE with JSON chunks. All three streaming branches live in `sidepanel.js:916-968`. Non-streaming responses have different shapes: `choices[0].message.content` vs `content[0].text` vs `candidates[0].content.parts[0].text`.

**Page context extraction** (`sidepanel.js:822`): Injects a function into the active tab via `chrome.scripting.executeScript`. Prioritizes user selection over full page. Strips noisy tags (`script`, `style`, `nav`, `footer`, etc.). Truncates to 15,000 chars. Fails silently on `chrome://` URLs.

**Session storage**: `chrome.storage.local`. Only the last 3 sessions are kept (pruned on save at `sidepanel.js:214`). Each session stores messages as `{role, content, responses, currentIndex}`. The `responses`/`currentIndex` fields support regeneration — they hold multiple AI responses for a single turn.

**Image paste**: Base64 data URLs stored in `pendingImages` array. Images are attached only to the next message sent. Provider-specific image formats: OpenAI uses `image_url` with full data URL, Claude uses `image` with base64-only data, Gemini uses `inline_data` with base64-only data.

**Markdown and syntax highlighting** are custom regex-based parsers in `sidepanel.js` (not a library). The highlighter tokenizes strings/comments first, then applies keyword/function/builtin/number regexes. Fragile — avoid adding new regex rules without understanding the token restore logic at `sidepanel.js:724`.

**Model fetching** (`sidepanel.js:37-65`): Auto-fetches available models from each provider's API endpoint and populates a dropdown. Falls back to hardcoded defaults on failure. Claude requires `anthropic-version` header; Gemini uses query-param auth.

**Thinking blocks**: `<think>` tags are parsed into collapsible `<details>` elements. During streaming, incomplete `<think>` tags are also handled (line 737-558). Avoid modifying the `parseMarkdown` function without understanding both streaming and non-streaming code paths.

**Math rendering** uses KaTeX (bundled locally in `katex/` — CDN scripts are blocked by Manifest V3's default CSP). The `parseMarkdown` function extracts math into a `mathBlocks` array *before* markdown processing, so LaTeX isn't destroyed by regex replacements (`\n` → `<br/>`, `*` → `<em>`, etc.). After markdown runs, `renderKaTeX()` converts each block to HTML via `katex.renderToString()`. Supported delimiters: `$$...$$`, `\[...\]` (display), `$...$`, `\(...\)` ( inline). A fallback `renderMathIn()` using auto-render catches anything the parser missed. CSS for KaTeX output is in `styles.css` under "KaTeX Math Styling".

**Horizontal rules**: `---` on its own line is converted to `<hr>`. Cleanup removes stray `<br/>` before/after `<hr>` tags.

**Key lesson — CDN scripts don't work in MV3 extensions.** Manifest V3's default CSP (`script-src 'self'`) blocks external scripts in extension pages (side panel, popup). Bundle third-party JS/CSS locally instead. This applies to KaTeX, MathJax, or any other library.
