# Private Vision Agent

A privacy-preserving Chrome assistant that sanitizes webpage context locally before anything can be sent to an AI provider.

Private Vision Agent combines DOM inspection, local named-entity recognition, Florence-2 WebGPU vision, and MediaPipe face detection to identify and mask sensitive information. The assistant receives a sanitized screenshot and a constrained map of safe page controls—never raw form values or an unrestricted browser interface.

## Highlights

- Local-first privacy processing inside the browser extension
- PII detection using DOM rules, local DistilBERT NER, and Florence-2 OCR
- Local face detection and opaque face masking with MediaPipe BlazeFace
- Fail-closed privacy gate when a required detection stage fails
- Explicit user approval before a proposed browser action executes
- Server-side validation against a bounded map of visible, enabled controls
- Local evaluation dashboard with timing, accuracy, and privacy-proof metrics
- JSON and CSV analytics exports that exclude screenshots, page text, prompts, and secrets

## How it works

1. The extension captures the visible browser tab after a user request.
2. DOM rules identify sensitive fields and collect a structural map without field values.
3. Local NER, OCR, and face-detection workers find additional sensitive regions.
4. Sensitive regions are covered with opaque masks before the screenshot becomes eligible for upload.
5. The sanitized screenshot and safe control map are sent to the local server.
6. The server asks the configured vision model for one constrained action and validates the response.
7. The extension highlights the proposed control and waits for explicit user approval before clicking it.

## Privacy model

The project is designed around a simple boundary: raw visual context stays in the browser.

- Input values, passwords, and typed form content are omitted from the element map.
- Candidate DOM text and OCR text are processed locally and discarded.
- Face pixels are detected and masked locally.
- The server rejects payloads that are not marked as redacted, contain element values, include raw-screenshot fields, or contain structured PII in the task.
- Browser execution is limited to a validated, visible, enabled button from the current safe element map.
- Evaluation history is stored locally in `chrome.storage.local`.

The popup's **Outbound privacy proof** compares SHA-256 fingerprints calculated independently by the extension and server. It also reports whether the request contained raw screenshots, element values, or unsafe task text.

## Requirements

- Node.js 20 or newer
- pnpm
- Google Chrome with WebGPU support
- An OpenRouter API key or Hugging Face token for model-backed actions

## Quick start

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure the AI provider

Copy `.env.example` to `.env`, then replace the placeholder for your chosen provider.

OpenRouter is the default configuration:

```env
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=your_key_here
OPENROUTER_MODEL=qwen/qwen3-vl-30b-a3b-instruct
```

To use Hugging Face instead:

```env
AI_PROVIDER=huggingface
HF_TOKEN=your_token_here
HF_MODEL=Qwen/Qwen3-VL-30B-A3B-Instruct
```

Never commit the `.env` file. It is excluded by `.gitignore`.

### 3. Start the demo server

```bash
pnpm start
```

Open `http://localhost:5173` in Chrome.

### 4. Load the Chrome extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the `extension` directory from this repository.
5. Keep the demo page open and launch **Private Vision Agent** from the Chrome toolbar.

## Using the assistant

1. Click **Capture and protect webpage** in the extension popup.
2. Inspect the sanitized preview and privacy results.
3. Enter a goal and click **Ask private assistant**.
4. Review the highlighted action proposed by the model.
5. Click **Approve and continue** to execute the validated action.

The extension uses Chrome's temporary `activeTab` permission. It reads a page only after the user opens the popup and starts a capture; it does not request permanent access to every website. Chrome internal pages, browser settings, and the Chrome Web Store remain inaccessible.

## Local models

The first privacy scan may download and cache model weights in Chrome:

- Florence-2 performs OCR with regions through WebGPU.
- A quantized DistilBERT model performs English named-entity recognition through WebAssembly.
- MediaPipe BlazeFace detects faces using vendored model and runtime files.

The Florence-2 download is approximately 340 MB, and the NER model is approximately 66 MB. Model requests do not include the captured screenshot.

To run an isolated Florence-2 check, expand **Evaluation & analytics**, open **Model diagnostics**, and select **Run isolated vision benchmark**.

## Development

After changing `extension/vision-worker.source.js` or `extension/ner-worker.source.js`, rebuild the bundled workers:

```bash
pnpm run build:vision
```

The command bundles both Transformers.js workers and copies the local ONNX WebAssembly runtime into `extension/vendor/transformers`.

## Evaluation

After a local privacy scan, the evaluation dashboard records:

- Total privacy-processing latency
- Florence-2, NER, and face-detection inference time
- Mask and OCR-region counts
- Sanitized image size
- Approximate JavaScript heap change
- Assistant round-trip and end-to-end compute time
- Manually audited PII precision, recall, mask precision, and visual-context F1

Up to 20 runs are retained locally. **Mask provenance** shows which local detector produced each mask, while **Export JSON** and **Export CSV** create sanitized metric archives.

## Project structure

```text
demo/                  Controlled webpage for local testing
extension/             Chrome extension, privacy pipeline, and local workers
extension/vendor/      Vendored MediaPipe and ONNX WebAssembly runtimes
server/                Local server and constrained model integration
scripts/               Worker build scripts
```

## Current limitations

- Chrome is the only supported browser.
- The included workflow is tested primarily against the controlled local demo page.
- Local NER currently uses an English CoNLL-2003 model and is not multilingual.
- Browser execution currently supports only an approved click on a visible, enabled `HTMLButtonElement`.
- DOM rules and local models reduce privacy risk but cannot guarantee detection of every PII format or arbitrary canvas content.
- Face detection scans visible image regions rather than every pixel of the full tab to reduce inference cost.
- The local server uses development-oriented CORS and transport settings and should be hardened before production deployment.
