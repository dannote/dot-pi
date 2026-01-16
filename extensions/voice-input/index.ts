/**
 * Voice Input Extension
 *
 * Press Ctrl+R to record audio, which is transcribed via ElevenLabs
 * and sent as a user message to the agent.
 *
 * Requires:
 * - ELEVENLABS_API_KEY in env
 * - sox installed: `brew install sox` (macOS) or `apt install sox` (Linux)
 *
 * Optional:
 * - ELEVENLABS_LANGUAGE - ISO-639-1/3 language code (e.g., "en", "ru", "de")
 */

import { CustomEditor, type ExtensionAPI, type ExtensionContext, type KeybindingsManager, type Theme } from "@mariozechner/pi-coding-agent";
import { type EditorTheme, Key, Loader, matchesKey, type TUI } from "@mariozechner/pi-tui";
import { spawnSync, spawn, type ChildProcess } from "child_process";
import { unlinkSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

function getApiKey(): string | undefined {
	return process.env.ELEVENLABS_API_KEY;
}

function getLanguageCode(): string | undefined {
	return process.env.ELEVENLABS_LANGUAGE;
}

interface TranscriptionResponse {
	text: string;
	language_code?: string;
}

async function transcribeAudio(audioPath: string): Promise<string> {
	const apiKey = getApiKey();
	if (!apiKey) {
		throw new Error("ELEVENLABS_API_KEY not set");
	}

	const audioData = readFileSync(audioPath);
	const formData = new FormData();
	formData.append("model_id", "scribe_v1");
	formData.append("file", new Blob([audioData]), "recording.wav");

	const languageCode = getLanguageCode();
	if (languageCode) {
		formData.append("language_code", languageCode);
	}

	const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
		method: "POST",
		headers: {
			"xi-api-key": apiKey,
		},
		body: formData,
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(`ElevenLabs API error: ${response.status} ${error}`);
	}

	const result = (await response.json()) as TranscriptionResponse;
	return result.text;
}

function checkRecAvailable(): boolean {
	const result = spawnSync("which", ["rec"], { encoding: "utf-8" });
	return result.status === 0;
}

function startRecording(outputPath: string): ChildProcess {
	const proc = spawn("rec", ["-q", "-c", "1", "-r", "16000", "-b", "16", outputPath], {
		stdio: ["ignore", "ignore", "ignore"],
	});
	return proc;
}

// Shared recording state
let isRecording = false;
let recordingProc: ChildProcess | null = null;
let audioPath: string | null = null;
let blinkInterval: NodeJS.Timeout | null = null;
let blinkState = true;
let onSubmit: (() => void) | null = null;
let onCancel: (() => void) | null = null;
let setStatusFn: ((text: string | undefined) => void) | null = null;
let setWidgetFn: ExtensionContext["ui"]["setWidget"] | null = null;
let currentTheme: Theme | null = null;

function updateStatus() {
	if (!setStatusFn || !currentTheme) return;
	const circle = blinkState ? currentTheme.fg("error", "●") : currentTheme.fg("muted", "○");
	setStatusFn(`${circle} Rec (⏎ send, esc cancel)`);
}

function startBlinking() {
	blinkState = true;
	updateStatus();
	blinkInterval = setInterval(() => {
		blinkState = !blinkState;
		updateStatus();
	}, 500);
}

function stopBlinking() {
	if (blinkInterval) {
		clearInterval(blinkInterval);
		blinkInterval = null;
	}
	clearStatus();
}

function clearStatus() {
	setStatusFn?.(undefined);
}

/**
 * Custom editor that intercepts Enter/Escape during voice recording.
 */
class VoiceInputEditor extends CustomEditor {
	constructor(_tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
		super(theme, keybindings);
	}

	handleInput(data: string): void {
		if (isRecording) {
			// Enter or Ctrl+R: submit
			if (matchesKey(data, Key.enter) || matchesKey(data, Key.ctrl("r"))) {
				onSubmit?.();
				return;
			}
			// Escape: cancel
			if (matchesKey(data, Key.escape)) {
				onCancel?.();
				return;
			}
			// Ignore other input while recording
			return;
		}

		// Not recording - pass to parent
		super.handleInput(data);
	}
}

export default function (pi: ExtensionAPI) {
	const recAvailable = checkRecAvailable();

	if (!recAvailable) {
		pi.on("session_start", (_event, ctx) => {
			ctx.ui.notify("Voice input disabled: missing sox (brew install sox)", "warning");
		});
		return;
	}

	pi.on("session_start", (_event, ctx) => {
		if (!getApiKey()) {
			ctx.ui.notify("Voice input disabled: missing ELEVENLABS_API_KEY", "warning");
		}

		// Install custom editor
		ctx.ui.setEditorComponent((tui, theme, keybindings) => {
			return new VoiceInputEditor(tui, theme, keybindings);
		});

		// Store status setter, widget setter and theme
		setStatusFn = (text) => ctx.ui.setStatus("voice", text);
		setWidgetFn = ctx.ui.setWidget.bind(ctx.ui);
		currentTheme = ctx.ui.theme;
	});

	let transcribeLoader: Loader | null = null;

	function startTranscribeLoader(message: string) {
		setWidgetFn?.("voice", (tui, theme) => {
			transcribeLoader = new Loader(
				tui,
				(s) => theme.fg("accent", s),
				(t) => theme.fg("muted", t),
				message,
			);
			return transcribeLoader;
		});
	}

	function stopTranscribeLoader() {
		transcribeLoader?.stop();
		transcribeLoader = null;
		setWidgetFn?.("voice", undefined);
	}

	async function stopAndTranscribe(): Promise<string | null> {
		if (!recordingProc || !audioPath) return null;

		const path = audioPath;
		recordingProc.kill("SIGTERM");
		recordingProc = null;
		audioPath = null;
		isRecording = false;
		stopBlinking();

		startTranscribeLoader("Transcribing...");

		await new Promise((r) => setTimeout(r, 300));

		try {
			const text = await transcribeAudio(path);
			return text;
		} finally {
			try { unlinkSync(path); } catch {}
			stopTranscribeLoader();
		}
	}

	function cancelRecording() {
		if (recordingProc) {
			recordingProc.kill("SIGTERM");
			recordingProc = null;
		}
		if (audioPath) {
			try { unlinkSync(audioPath); } catch {}
			audioPath = null;
		}
		isRecording = false;
		stopBlinking();
		clearStatus();
	}

	function startNewRecording(notifyFn: (msg: string, type: "error" | "warning") => void) {
		audioPath = join(tmpdir(), `pi-voice-${Date.now()}.wav`);
		recordingProc = startRecording(audioPath);
		isRecording = true;

		recordingProc.on("error", (err) => {
			notifyFn(`Recording error: ${err.message}`, "error");
			cancelRecording();
		});

		startBlinking();
	}

	// Set up callbacks
	onSubmit = async () => {
		const text = await stopAndTranscribe();
		if (text?.trim()) {
			pi.sendUserMessage(text.trim());
		}
	};

	onCancel = () => {
		cancelRecording();
	};

	// Ctrl+R: start recording (or submit if already recording)
	pi.registerShortcut("ctrl+r", {
		description: "Record voice input",
		handler: async (ctx) => {
			if (!ctx.hasUI) return;
			if (!getApiKey()) {
				ctx.ui.notify("ELEVENLABS_API_KEY not set", "error");
				return;
			}

			if (isRecording) {
				// Submit
				const text = await stopAndTranscribe();
				if (text?.trim()) {
					pi.sendUserMessage(text.trim());
				} else {
					ctx.ui.notify("No speech detected", "warning");
				}
			} else {
				// Start recording
				startNewRecording((msg, type) => ctx.ui.notify(msg, type));
			}
		},
	});
}
