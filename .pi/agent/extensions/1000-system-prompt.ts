/**
 * System Prompt Viewer
 *
 * `/system-prompt` shows the system prompt Pi currently sends to the model.
 *
 * - TUI: scrollable overlay (↑/↓, PgUp/PgDn, g/G, mouse wheel). `e` opens the
 *   prompt in the editor (handy for copying), `q`/Esc closes.
 * - RPC: opens the prompt in the editor dialog so the client can display it.
 * - print/json: writes it to a temp file and reports the path on stderr.
 *
 * Note: ctx.getSystemPrompt() reports Pi's built prompt (tools, context files,
 * skills, settings). Per-turn changes made by before_agent_start hooks in
 * other extensions and before_provider_request payload rewrites are not
 * included.
 */

import type {
  ExtensionAPI,
  ExtensionCommandContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  type Component,
  type TUI,
  type TuiMouseEvent,
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type ViewerAction = "closed" | "editor";

const TITLE = "System prompt";
const HINTS =
  "↑/↓ scroll · PgUp/PgDn page · g/G top/bottom · e editor · q close";

function buildViewer(
  prompt: string,
  tui: TUI,
  theme: Theme,
  done: (action: ViewerAction) => void,
): Component {
  const border = (text: string) => theme.fg("border", text);
  const rawLines = prompt.replace(/\t/g, "  ").split("\n");

  let wrappedWidth = 0;
  let wrappedLines: string[] | null = null;
  let scrollTop = 0;
  let viewportRows = 10;
  let maxScroll = 0;

  const wrap = (width: number): string[] => {
    if (wrappedLines && wrappedWidth === width) return wrappedLines;
    const lines: string[] = [];
    for (const line of rawLines) {
      if (line.length === 0) {
        lines.push("");
        continue;
      }
      lines.push(...wrapTextWithAnsi(line, Math.max(1, width)));
    }
    wrappedLines = lines;
    wrappedWidth = width;
    return lines;
  };

  const viewportHeight = (): number => {
    const rows = tui.terminal.rows;
    return Math.max(3, Math.min(rows - 6, Math.floor(rows * 0.8) - 4));
  };

  const scrollTo = (next: number) => {
    const clamped = Math.max(0, Math.min(maxScroll, next));
    if (clamped === scrollTop) return;
    scrollTop = clamped;
    tui.requestRender();
  };

  const render = (width: number): string[] => {
    const inner = Math.max(10, width - 2);
    const lines = wrap(inner);
    viewportRows = viewportHeight();
    maxScroll = Math.max(0, lines.length - viewportRows);
    if (scrollTop > maxScroll) scrollTop = maxScroll;

    const label = `${TITLE}  ${prompt.length.toLocaleString()} chars · ${rawLines.length.toLocaleString()} lines`;
    const labelWidth = Math.min(visibleWidth(label), Math.max(0, inner - 2));
    const topFill = Math.max(0, inner - labelWidth - 2);

    const output: string[] = [
      border("╭─ ") +
        theme.fg("accent", theme.bold(truncateToWidth(label, inner - 2, "…"))) +
        border(`${"─".repeat(topFill)}╮`),
    ];

    for (let row = 0; row < viewportRows; row++) {
      const line = lines[scrollTop + row] ?? "";
      output.push(
        border("│") + truncateToWidth(line, inner, "", true) + border("│"),
      );
    }

    const visibleEnd = Math.min(scrollTop + viewportRows, lines.length);
    const position =
      lines.length > viewportRows
        ? `${scrollTop + 1}-${visibleEnd}/${lines.length}`
        : `${lines.length}`;
    const bottomLabel = ` ${position} `;
    const bottomFill = Math.max(0, inner - visibleWidth(bottomLabel));
    output.push(
      border(`╰${"─".repeat(bottomFill)}`) +
        theme.fg("dim", bottomLabel) +
        border("╯"),
    );
    output.push(` ${theme.fg("dim", truncateToWidth(HINTS, width - 2, "…"))}`);

    return output;
  };

  return {
    render,
    invalidate() {
      wrappedLines = null;
    },
    handleInput(data: string): void {
      if (matchesKey(data, Key.up) || matchesKey(data, "k")) {
        scrollTo(scrollTop - 1);
      } else if (matchesKey(data, Key.down) || matchesKey(data, "j")) {
        scrollTo(scrollTop + 1);
      } else if (matchesKey(data, Key.pageUp)) {
        scrollTo(scrollTop - viewportRows);
      } else if (matchesKey(data, Key.pageDown)) {
        scrollTo(scrollTop + viewportRows);
      } else if (matchesKey(data, Key.home) || data === "g") {
        scrollTo(0);
      } else if (
        matchesKey(data, Key.end) ||
        data === "G" ||
        matchesKey(data, Key.shift("g"))
      ) {
        scrollTo(maxScroll);
      } else if (matchesKey(data, "e")) {
        done("editor");
      } else if (
        matchesKey(data, "q") ||
        matchesKey(data, Key.escape) ||
        matchesKey(data, Key.enter)
      ) {
        done("closed");
      }
    },
    handleMouse(event: TuiMouseEvent) {
      if (event.type === "wheel" && event.wheelDelta) {
        scrollTo(scrollTop + event.wheelDelta);
        return { handled: true };
      }
      return undefined;
    },
  };
}

async function writePromptFile(prompt: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(tmpdir(), `pi-system-prompt-${stamp}.md`);
  await writeFile(file, prompt.endsWith("\n") ? prompt : `${prompt}\n`, "utf8");
  return file;
}

async function showSystemPrompt(ctx: ExtensionCommandContext): Promise<void> {
  const prompt = ctx.getSystemPrompt();

  if (ctx.mode === "tui") {
    const action = await ctx.ui.custom<ViewerAction>(
      (tui, theme, _keybindings, done) => buildViewer(prompt, tui, theme, done),
      {
        overlay: true,
        overlayOptions: { width: "94%", maxHeight: "94%", margin: 1 },
      },
    );
    if (action === "editor") {
      await ctx.ui.editor("Current system prompt", prompt);
    }
    return;
  }

  if (ctx.mode === "rpc") {
    await ctx.ui.editor("Current system prompt", prompt);
    return;
  }

  const file = await writePromptFile(prompt);
  console.error(`System prompt written to ${file}`);
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("system-prompt", {
    description: "Show the current system prompt",
    handler: async (_args, ctx) => {
      await showSystemPrompt(ctx);
    },
  });
}
