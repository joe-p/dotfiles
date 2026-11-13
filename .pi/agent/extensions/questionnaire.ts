/**
 * Questionnaire extension
 *
 * Lets the agent ask one or more multiple-choice questions with:
 * - a recommended option (marked with ★ and preselected)
 * - a "Type something." option for a free-form answer
 * - a "Skip" option
 * - an optional per-question timeout that auto-selects the recommended option
 *
 * The timeout is off by default. The user opts in for the current session with
 * /qa-timeout <seconds|off>. It is kept in memory only and resets to zero for
 * every new session, so the agent never makes a decision on its own.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	Text,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

const MAX_TIMEOUT_SECONDS = 3600;

function normalizeTimeout(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return 0;
	return Math.min(MAX_TIMEOUT_SECONDS, Math.round(value * 10) / 10);
}

function formatSeconds(seconds: number): string {
	return Number.isInteger(seconds) ? `${seconds}` : seconds.toFixed(1);
}

// ---------------------------------------------------------------------------
// Schema / types
// ---------------------------------------------------------------------------

const OptionSchema = Type.Object({
	label: Type.String({ description: "Display label for the option" }),
	description: Type.Optional(Type.String({ description: "Optional description shown below the label" })),
	recommended: Type.Optional(
		Type.Boolean({
			description:
				"Mark as the recommended option. It is preselected and automatically chosen when the timeout expires.",
		}),
	),
});

const QuestionSchema = Type.Object({
	id: Type.Optional(
		Type.String({ description: "Stable identifier returned with the answer (defaults to Q1, Q2, ...)" }),
	),
	header: Type.Optional(
		Type.String({ description: "Short label for the question, e.g. 'Scope' or 'Priority' (defaults to the id)" }),
	),
	question: Type.String({ description: "The full question text" }),
	options: Type.Array(OptionSchema, {
		description: "Concrete options to choose from. Mark exactly one as recommended.",
		minItems: 1,
	}),
	allowOther: Type.Optional(
		Type.Boolean({ description: "Offer a 'Type something.' option for a free-form answer (default: true)" }),
	),
	allowSkip: Type.Optional(Type.Boolean({ description: "Offer a 'Skip' option (default: true)" })),
});

const QuestionnaireParams = Type.Object({
	questions: Type.Array(QuestionSchema, { description: "Questions to ask, in order", minItems: 1 }),
});

interface NormalizedOption {
	label: string;
	description?: string;
	recommended: boolean;
}

interface NormalizedQuestion {
	id: string;
	header: string;
	question: string;
	options: NormalizedOption[];
	allowOther: boolean;
	allowSkip: boolean;
	recommendedIndex: number;
}

type AnswerKind = "selected" | "custom" | "skipped" | "timeout";

interface Answer {
	id: string;
	header: string;
	question: string;
	value: string | null;
	label: string;
	kind: AnswerKind;
	/** 1-based display number of the selected option. */
	index?: number;
	recommended?: boolean;
	timedOut?: boolean;
}

interface QuestionnaireDetails {
	questions: { id: string; header: string; question: string }[];
	answers: Answer[];
	cancelled: boolean;
	timeoutSeconds: number;
}

interface ComponentResult {
	answers: Answer[];
	cancelled: boolean;
}

interface DisplayOption {
	label: string;
	description?: string;
	kind: "option" | "other" | "skip";
	recommended: boolean;
	optionIndex?: number;
}

function errorResult(message: string): { content: { type: "text"; text: string }[]; details: QuestionnaireDetails } {
	return {
		content: [{ type: "text", text: message }],
		details: { questions: [], answers: [], cancelled: true, timeoutSeconds: 0 },
	};
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function questionnaire(pi: ExtensionAPI) {
	// User opt-in only, kept in memory and never persisted. Every new session
	// starts with timeouts disabled.
	let sessionTimeoutSeconds = 0;
	pi.on("session_start", async () => {
		sessionTimeoutSeconds = 0;
	});

	pi.registerCommand("qa-timeout", {
		description: "Set the questionnaire per-question timeout (seconds, or 'off'; omit to edit interactively)",
		getArgumentCompletions: (prefix: string) => {
			const items = [
				{ value: "off", label: "off", description: "Disable the auto-select timeout" },
				{ value: "30s", label: "30s", description: "Auto-select the recommended option after 30 seconds" },
				{ value: "60s", label: "60s", description: "Auto-select the recommended option after 60 seconds" },
				{ value: "120s", label: "120s", description: "Auto-select the recommended option after 120 seconds" },
			];
			const filtered = items.filter((item) => item.value.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			let raw = args.trim().toLowerCase();
			const current = sessionTimeoutSeconds;

			if (!raw) {
				const description =
					current > 0 ? `${formatSeconds(current)}s per question` : "disabled";

				// No argument: ask interactively so selecting the command from the
				// autocomplete list (which submits immediately) still does something visible.
				if (ctx.mode !== "tui") {
					ctx.ui.notify(
						`Questionnaire timeout: ${description}. Usage: /qa-timeout <seconds|off>`,
						"info",
					);
					return;
				}

				const answer = await ctx.ui.input(
					`Questionnaire timeout (currently ${description})`,
					"seconds or 'off'",
				);
				if (answer === undefined) return;
				raw = answer.trim().toLowerCase();
				if (!raw) return;
			}

			if (raw === "off" || raw === "none" || raw === "disabled") {
				sessionTimeoutSeconds = 0;
				ctx.ui.notify("Questionnaire timeout disabled for this session.", "info");
				return;
			}

			const parsed = Number(raw.replace(/s$/, ""));
			if (!Number.isFinite(parsed) || parsed < 0 || parsed > MAX_TIMEOUT_SECONDS) {
				ctx.ui.notify(
					`Invalid timeout '${raw}'. Use seconds between 0 and ${MAX_TIMEOUT_SECONDS}, or 'off'.`,
					"error",
				);
				return;
			}

			const seconds = normalizeTimeout(parsed);
			sessionTimeoutSeconds = seconds;
			ctx.ui.notify(
				seconds > 0
					? `Questionnaire timeout: ${formatSeconds(seconds)}s per question for this session.`
					: "Questionnaire timeout disabled for this session.",
				"info",
			);
		},
	});

	pi.registerTool({
		name: "questionnaire",
		label: "Questionnaire",
		description:
			"Ask the user one or more multiple-choice questions. Each question has options, one of which should be marked recommended. The user can pick an option, type a custom answer, or skip. If the user has enabled a per-question timeout with /qa-timeout, the recommended option is auto-selected when it expires; by default there is no timeout and the tool waits for the user. Use when you need a decision or preference from the user.",
		promptSnippet:
			"Ask the user multiple-choice questions with a recommended option, custom answer, skip, and an optional user-configured timeout.",
		promptGuidelines: [
			"Use questionnaire when you need the user to choose between concrete options.",
			"Mark exactly one option per question as recommended, unless no option is genuinely better.",
			"Keep question option labels short; put details in descriptions.",
		],
		parameters: QuestionnaireParams,
		executionMode: "sequential",

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (ctx.mode !== "tui") {
				return errorResult("Error: questionnaire requires an interactive TUI session.");
			}
			if (params.questions.length === 0) {
				return errorResult("Error: No questions provided.");
			}

			const questions: NormalizedQuestion[] = params.questions.map((q, i) => {
				const id = q.id?.trim() || `Q${i + 1}`;
				const options: NormalizedOption[] = q.options.map((o) => ({
					label: o.label,
					description: o.description,
					recommended: o.recommended === true,
				}));
				return {
					id,
					header: q.header?.trim() || id,
					question: q.question,
					options,
					allowOther: q.allowOther !== false,
					allowSkip: q.allowSkip !== false,
					// First recommended option wins if the model marks several.
					recommendedIndex: options.findIndex((o) => o.recommended),
				};
			});

			// Snapshot the user's opt-in for this call. Never let the model set it.
			const timeoutSeconds = sessionTimeoutSeconds;
			const timeoutMs = Math.round(timeoutSeconds * 1000);

			const publicQuestions = questions.map((q) => ({
				id: q.id,
				header: q.header,
				question: q.question,
			}));

			const buildDetails = (answers: Answer[], cancelled: boolean): QuestionnaireDetails => ({
				questions: publicQuestions,
				answers,
				cancelled,
				timeoutSeconds,
			});

			if (signal?.aborted) {
				return {
					content: [{ type: "text", text: "Questionnaire cancelled before it was shown." }],
					details: buildDetails([], true),
				};
			}

			const uiOptions = {
				overlay: false,
				blocked: { kind: "question" as const, message: publicQuestions[0]?.question ?? "Questionnaire" },
			};

			const result = await ctx.ui.custom<ComponentResult>(
				(tui, theme, keybindings, done) => {
					let questionIndex = 0;
					let optionIndex = Math.max(0, questions[0]!.recommendedIndex);
					let inputMode = false;
					let focused = false;
					let finished = false;
					let cachedWidth: number | undefined;
					let cachedLines: string[] | undefined;
					let timer: ReturnType<typeof setInterval> | undefined;
					let deadline = 0;
					const answers = new Map<number, Answer>();

					const editorTheme: EditorTheme = {
						borderColor: (s) => theme.fg("accent", s),
						selectList: {
							selectedPrefix: (t) => theme.fg("accent", t),
							selectedText: (t) => theme.fg("accent", t),
							description: (t) => theme.fg("muted", t),
							scrollInfo: (t) => theme.fg("dim", t),
							noMatch: (t) => theme.fg("warning", t),
						},
					};
					const editor = new Editor(tui, editorTheme);
					editor.onChange = () => invalidateAndRender();

					function invalidateAndRender(): void {
						cachedWidth = undefined;
						cachedLines = undefined;
						tui.requestRender();
					}

					function stopTimer(): void {
						if (timer !== undefined) {
							clearInterval(timer);
							timer = undefined;
						}
						deadline = 0;
					}

					function startTimer(): void {
						stopTimer();
						if (finished || inputMode || timeoutMs <= 0) return;
						deadline = Date.now() + timeoutMs;
						timer = setInterval(() => {
							if (finished || inputMode) return;
							if (deadline > 0 && Date.now() >= deadline) {
								deadline = 0;
								autoPickRecommended();
								return;
							}
							invalidateAndRender();
						}, 250);
					}

					function finish(cancelled: boolean): void {
						if (finished) return;
						finished = true;
						stopTimer();
						signal?.removeEventListener("abort", onAbort);
						const ordered = questions
							.map((_, i) => answers.get(i))
							.filter((a): a is Answer => a !== undefined);
						done({ answers: ordered, cancelled });
					}

					function onAbort(): void {
						finish(true);
					}

					function currentQuestion(): NormalizedQuestion {
						return questions[questionIndex]!;
					}

					function displayOptions(q: NormalizedQuestion): DisplayOption[] {
						const options: DisplayOption[] = q.options.map((o, i) => ({
							label: o.label,
							description: o.description,
							kind: "option",
							recommended: o.recommended,
							optionIndex: i,
						}));
						if (q.allowOther) {
							options.push({
								label: "Type something.",
								description: "Write your own answer",
								kind: "other",
								recommended: false,
							});
						}
						if (q.allowSkip) {
							options.push({ label: "Skip this question", kind: "skip", recommended: false });
						}
						return options;
					}

					function saveOption(q: NormalizedQuestion, option: DisplayOption): void {
						answers.set(questionIndex, {
							id: q.id,
							header: q.header,
							question: q.question,
							value: option.label,
							label: option.label,
							kind: "selected",
							index: option.optionIndex !== undefined ? option.optionIndex + 1 : undefined,
							recommended: option.recommended,
						});
					}

					function advance(): void {
						if (finished) return;
						if (questionIndex >= questions.length - 1) {
							finish(false);
							return;
						}
						questionIndex += 1;
						const q = currentQuestion();
						optionIndex = Math.max(0, q.recommendedIndex);
						inputMode = false;
						editor.focused = false;
						editor.setText("");
						invalidateAndRender();
						startTimer();
					}

					function autoPickRecommended(): void {
						const q = currentQuestion();
						if (q.recommendedIndex >= 0) {
							const option = q.options[q.recommendedIndex]!;
							answers.set(questionIndex, {
								id: q.id,
								header: q.header,
								question: q.question,
								value: option.label,
								label: option.label,
								kind: "timeout",
								index: q.recommendedIndex + 1,
								recommended: true,
								timedOut: true,
							});
						} else {
							answers.set(questionIndex, {
								id: q.id,
								header: q.header,
								question: q.question,
								value: null,
								label: "skipped",
								kind: "skipped",
								timedOut: true,
							});
						}
						advance();
					}

					function choose(option: DisplayOption | undefined): void {
						if (!option) return;
						const q = currentQuestion();
						if (option.kind === "other") {
							enterInputMode();
							return;
						}
						if (option.kind === "skip") {
							answers.set(questionIndex, {
								id: q.id,
								header: q.header,
								question: q.question,
								value: null,
								label: "skipped",
								kind: "skipped",
							});
							advance();
							return;
						}
						saveOption(q, option);
						advance();
					}

					function enterInputMode(): void {
						inputMode = true;
						stopTimer();
						editor.setText("");
						editor.focused = focused;
						invalidateAndRender();
					}

					function exitInputMode(): void {
						inputMode = false;
						editor.focused = false;
						editor.setText("");
						invalidateAndRender();
						startTimer();
					}

					editor.onSubmit = (value: string) => {
						if (!inputMode || finished) return;
						const q = currentQuestion();
						const trimmed = value.trim();
						if (trimmed) {
							answers.set(questionIndex, {
								id: q.id,
								header: q.header,
								question: q.question,
								value: trimmed,
								label: trimmed,
								kind: "custom",
							});
						} else {
							answers.set(questionIndex, {
								id: q.id,
								header: q.header,
								question: q.question,
								value: null,
								label: "skipped",
								kind: "skipped",
							});
						}
						inputMode = false;
						editor.focused = false;
						editor.setText("");
						advance();
					};

					function remainingSeconds(): number {
						if (deadline <= 0) return Math.max(0, Math.round(timeoutMs / 1000));
						return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
					}

					function render(width: number): string[] {
						if (cachedLines && cachedWidth === width) return cachedLines;
						const renderWidth = Math.max(1, width);
						const lines: string[] = [];

						const addWrapped = (text: string) => {
							lines.push(...wrapTextWithAnsi(text, renderWidth));
						};
						const addWrappedWithPrefix = (prefix: string, text: string) => {
							const prefixWidth = visibleWidth(prefix);
							if (prefixWidth >= renderWidth) {
								addWrapped(prefix + text);
								return;
							}
							const wrapped = wrapTextWithAnsi(text, renderWidth - prefixWidth);
							const continuation = " ".repeat(prefixWidth);
							wrapped.forEach((line, i) => {
								lines.push(`${i === 0 ? prefix : continuation}${line}`);
							});
						};

						const q = currentQuestion();
						const options = displayOptions(q);

						const header: string[] = [theme.fg("accent", theme.bold(q.header))];
						if (questions.length > 1) {
							header.push(theme.fg("muted", ` (${questionIndex + 1}/${questions.length})`));
						}
						if (inputMode) {
							header.push(theme.fg("warning", " • typing, timer paused"));
						} else if (timeoutMs > 0) {
							header.push(theme.fg("warning", ` • auto-selects ★ in ${remainingSeconds()}s`));
						} else {
							header.push(theme.fg("dim", " • no timeout"));
						}

						lines.push(theme.fg("accent", "─".repeat(renderWidth)));
						addWrappedWithPrefix(" ", header.join(""));
						lines.push("");
						addWrappedWithPrefix(" ", theme.fg("text", q.question));
						lines.push("");

						for (let i = 0; i < options.length; i++) {
							const option = options[i]!;
							const selected = !inputMode && i === optionIndex;
							const prefix = selected ? theme.fg("accent", "> ") : "  ";
							let label = `${i + 1}. ${option.label}`;
							if (option.recommended) {
								label += ` ${theme.fg("success", "★ recommended")}`;
							}
							addWrappedWithPrefix(prefix, theme.fg(selected ? "accent" : "text", label));
							if (option.description) {
								addWrappedWithPrefix("     ", theme.fg("muted", option.description));
							}
						}

						if (inputMode) {
							lines.push("");
							addWrappedWithPrefix(" ", theme.fg("muted", "Your answer:"));
							for (const line of editor.render(Math.max(1, renderWidth - 2))) {
								lines.push(` ${line}`);
							}
							lines.push("");
							addWrappedWithPrefix(" ", theme.fg("dim", "Enter submit • Esc back to options"));
						} else {
							lines.push("");
							const digits = Math.min(options.length, 9);
							addWrappedWithPrefix(
								" ",
								theme.fg(
									"dim",
									`↑↓ move • 1-${digits} quick pick • Enter select • Esc cancel`,
								),
							);
						}

						lines.push(theme.fg("accent", "─".repeat(renderWidth)));

						cachedWidth = renderWidth;
						cachedLines = lines;
						return lines;
					}

					function handleInput(data: string): void {
						if (finished) return;

						if (inputMode) {
							if (matchesKey(data, Key.escape)) {
								exitInputMode();
								return;
							}
							editor.handleInput(data);
							invalidateAndRender();
							return;
						}

						if (keybindings.matches(data, "tui.select.cancel")) {
							finish(true);
							return;
						}

						const q = currentQuestion();
						const options = displayOptions(q);

						if (keybindings.matches(data, "tui.select.up")) {
							optionIndex = (optionIndex - 1 + options.length) % options.length;
							invalidateAndRender();
							return;
						}
						if (keybindings.matches(data, "tui.select.down")) {
							optionIndex = (optionIndex + 1) % options.length;
							invalidateAndRender();
							return;
						}
						if (keybindings.matches(data, "tui.select.confirm")) {
							choose(options[optionIndex]);
							return;
						}

						if (/^[1-9]$/.test(data)) {
							const index = Number(data) - 1;
							if (index < options.length) {
								choose(options[index]);
								return;
							}
						}
					}

					if (signal) signal.addEventListener("abort", onAbort, { once: true });
					startTimer();

					return {
						get focused(): boolean {
							return focused;
						},
						set focused(value: boolean) {
							focused = value;
							editor.focused = value && inputMode;
						},
						render,
						handleInput,
						invalidate: () => {
							cachedWidth = undefined;
							cachedLines = undefined;
							editor.invalidate();
						},
						dispose: () => {
							stopTimer();
							signal?.removeEventListener("abort", onAbort);
						},
					};
				},
				uiOptions,
			);

			const details = buildDetails(result.answers, result.cancelled);

			if (result.cancelled) {
				const answered = result.answers.length;
				const lines = describeAnswers(result.answers, timeoutSeconds);
				const summary =
					answered > 0
						? `User cancelled the questionnaire after answering ${answered} of ${questions.length} questions.\n${lines}`
						: "User cancelled the questionnaire before answering.";
				return {
					content: [{ type: "text", text: summary }],
					details,
				};
			}

			return {
				content: [{ type: "text", text: describeAnswers(result.answers, timeoutSeconds) }],
				details,
			};
		},

		renderCall(args, theme) {
			const questionList = args.questions ?? [];
			const headers = questionList
				.map((q, i) => q.header?.trim() || q.id?.trim() || `Q${i + 1}`)
				.join(", ");
			let text = theme.fg("toolTitle", theme.bold("questionnaire "));
			text += theme.fg("muted", `${questionList.length} question${questionList.length === 1 ? "" : "s"}`);
			if (headers) {
				text += theme.fg("dim", ` (${headers})`);
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as QuestionnaireDetails | undefined;
			if (!details) {
				const first = result.content[0];
				return new Text(first?.type === "text" ? first.text : "", 0, 0);
			}

			const lines: string[] = [];
			if (details.cancelled) {
				lines.push(theme.fg("warning", details.answers.length > 0 ? "Cancelled (partial answers)" : "Cancelled"));
			}
			for (const answer of details.answers) {
				const head = `${theme.fg("accent", answer.header)}: `;
				if (answer.kind === "custom") {
					lines.push(`${theme.fg("success", "✓ ")}${head}${theme.fg("muted", "(wrote) ")}${answer.value ?? ""}`);
				} else if (answer.kind === "timeout") {
					const num = answer.index !== undefined ? `${answer.index}. ` : "";
					lines.push(
						`${theme.fg("warning", "⏱ ")}${head}${num}${answer.label} ${theme.fg("dim", "(recommended, auto-selected)")}`,
					);
				} else if (answer.kind === "skipped") {
					const reason = answer.timedOut ? "timeout, no recommendation" : "skipped";
					lines.push(`${theme.fg("dim", "○ ")}${head}${theme.fg("dim", reason)}`);
				} else {
					const num = answer.index !== undefined ? `${answer.index}. ` : "";
					const rec = answer.recommended ? ` ${theme.fg("success", "★")}` : "";
					lines.push(`${theme.fg("success", "✓ ")}${head}${num}${answer.label}${rec}`);
				}
			}
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}

// ---------------------------------------------------------------------------
// Model-facing answer summary
// ---------------------------------------------------------------------------

function describeAnswers(answers: Answer[], timeoutSeconds: number): string {
	if (answers.length === 0) return "No answers.";
	return answers
		.map((answer) => {
			const head = `${answer.id} [${answer.header}]`;
			switch (answer.kind) {
				case "custom":
					return `${head}: user wrote: ${answer.value ?? ""}`;
				case "timeout":
					return `${head}: auto-selected recommended option after ${formatSeconds(timeoutSeconds)}s timeout: ${answer.label}`;
				case "skipped":
					return answer.timedOut
						? `${head}: skipped (timeout expired, no recommended option)`
						: `${head}: skipped by user`;
				default: {
					const num = answer.index !== undefined ? `${answer.index}. ` : "";
					const rec = answer.recommended ? " (recommended)" : "";
					return `${head}: user selected: ${num}${answer.label}${rec}`;
				}
			}
		})
		.join("\n");
}
