# Private Vision Agent

A same-day hackathon prototype for a privacy-preserving browser assistant. The extension builds a structural map and combines native-resolution DOM rules, a local DistilBERT NER model, Florence-2 WebGPU vision, and local face detection before any sanitized context can leave the browser.

## Run the demo page

1. Install Node.js 20 or newer.
2. From this folder, run `npm.cmd start` in PowerShell. Using `npm.cmd` avoids the common Windows execution-policy block on `npm.ps1`.
3. Open `http://localhost:5173` in Chrome.

## Load the extension

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Choose **Load unpacked**.
4. Select the `extension` folder in this project.
5. Keep the demo page open and click the Private Vision Agent extension.
6. Choose **Capture and protect webpage**.

Expected result: the extension captures the visible page, builds the safe control map, runs local privacy detection, and shows a sanitized preview. The first run may download and cache local model weights.

The extension also supports ordinary `http://` and `https://` pages through Chrome's temporary `activeTab` permission. It injects the local reader only after the user opens the popup and clicks, rather than requesting permanent access to every website. Chrome internal pages, the Chrome Web Store, browser settings, and other protected origins remain inaccessible by design.

## Test the sanitized server round-trip

1. Restart the demo server after pulling/changing server code.
2. Reload the unpacked extension from `chrome://extensions`.
3. Open the demo page and the extension popup.
4. Click **Capture and protect webpage**.
5. Enter a goal and click **Ask private assistant**.

Expected result: the OpenRouter model returns one constrained action, the server validates it, and the popup displays its privacy receipt. No action executes automatically.

## Approve and execute the proposed action

1. Restart the server and reload the unpacked extension.
2. Refresh the demo page so it shows Step 1.
3. Run **Capture and protect webpage**, then **Ask private assistant**.
4. Confirm the Continue button receives a yellow highlight.
5. Click **Approve and continue** in the popup.

Expected result: the extension clicks only the validated `e_5` button and the page changes to **Profile confirmed — Step 2 of 2**.

## Local Florence-2 WebGPU performance spike

1. Reload the unpacked extension from `chrome://extensions` because the manifest now includes optional model-host permissions.
2. Expand the collapsed **Evaluation & analytics** section, then **Model diagnostics**.
3. Click **Run isolated vision benchmark**.
4. Approve access to Hugging Face when Chrome asks. This permission is used only to download model weights.
5. Keep the popup open while the first run downloads and caches approximately 340 MB of model weights.

Expected result: Florence-2 runs OCR-with-regions locally through WebGPU and the popup reports model-load time, inference time, and the number of OCR regions. The raw screenshot is passed only to an extension worker; it is never included in a model-weight request or sent to the project server.

Run `npm.cmd run build:vision` after changing either `extension/vision-worker.source.js` or `extension/ner-worker.source.js`. The build packages both Transformers.js workers and copies the local ONNX WebAssembly runtime into `extension/vendor/transformers`.

## Step 4: inspect local PII redaction

1. Reload the unpacked extension and refresh the demo page.
2. Open the extension and click **Capture and redact locally**.
3. Inspect the preview: applicant name, email, phone, address, payment-card number, email input, and password input should be covered by black boxes.

Expected result: the popup reports separate DOM, local NER, Florence-2 OCR, and face-mask counts and explicitly says the preview was not uploaded. On the first run, the quantized English NER model downloads about 66 MB and is then cached by Chrome. NER uses WASM while Florence uses WebGPU, so both passes run concurrently. Candidate text and Florence OCR text are processed locally and discarded; only PII mask types and coordinates can enter the sanitized server payload. If either local model pass fails, the privacy gate does not enable upload.

## Step 5: verify local face detection

1. Reload the unpacked extension and refresh the demo page.
2. Confirm the applicant card now uses a fictional generated portrait.
3. Click **Capture and redact locally**.
4. Confirm the face is fully covered by an opaque mask in the sanitized preview and the status reports `1 face(s) securely masked locally` with a measured latency.

MediaPipe BlazeFace, its WASM runtime, and the model file are vendored under `extension/vendor/mediapipe`; face pixels do not leave the extension.

The face box is expanded by 32%, blurred to avoid sharp edge leakage, and then covered by an opaque mask. Blur alone proved insufficient on a small profile portrait, so the opaque mask is the actual privacy boundary.

## Local evaluation dashboard

After **Protect screenshot locally** completes, a separate collapsed **Evaluation & analytics** section becomes available below the main workflow. The extension automatically records total privacy latency, Florence-2/NER/face-model inference time, mask and OCR counts, sanitized-image size, approximate JavaScript heap change, assistant round-trip latency, and combined end-to-end compute time. Up to 20 runs are retained in `chrome.storage.local`; evaluation data is not uploaded.

Accuracy requires labelled ground truth. Inspect the sanitized preview and enter false masks, missed PII, poorly fitted masks, false controls, and missed controls. The extension then calculates PII precision, PII recall, a region-level mask-precision score, and visual-context F1. These manually audited scores should be used for the evaluation report rather than treating raw detection counts as accuracy.

Expand **Mask provenance** to view a second, local-only diagnostic preview. Colored outlines identify masks produced by DOM rules, local NER, Florence-2 ViT OCR, and face detection. This annotated preview is generated from the already-sanitized image and is never used in the server payload.

After an assistant round trip, **Outbound privacy proof** compares a SHA-256 fingerprint calculated independently by the extension and server for the sanitized image. It also verifies that the request contained zero element-value fields, zero raw-screenshot fields, and a task that passed the structured-PII check. Only a short fingerprint prefix is displayed; fingerprints and analytics cannot reconstruct the image.

Use **Export JSON** for a structured archive or **Export CSV** for spreadsheets and charts. Exports contain a fixed whitelist of timings, counts, resource indicators, privacy-proof results, and manual audit scores. They never contain screenshots, page text, API keys, full image fingerprints, or model prompts.

## Step 6: connect the hosted open-weight VLM

1. Copy `.env.example` to `.env` and replace the token placeholder with your Hugging Face token.
2. Restart the Node server so it reads `.env`.
3. Reload the extension and refresh the demo page.
4. Click **Capture and redact locally** and inspect the sanitized preview.
5. Click **Send sanitized context to model**.

The server rejects requests without `redactionApplied: true`, rejects element values and structured PII in the task, and accepts only a bounded PNG/JPEG data URL. It calls `Qwen/Qwen3-VL-30B-A3B-Instruct` through Hugging Face Inference Providers, validates the model action against the safe element map, and reports whether the decision came from the model or the visible deterministic fallback.

### OpenRouter alternative

Set `AI_PROVIDER=openrouter`, `OPENROUTER_API_KEY`, and `OPENROUTER_MODEL=qwen/qwen3-vl-30b-a3b-instruct` in `.env`. This paid multimodal route supports image input and strict JSON Schema responses and is substantially more predictable for the demo than free-provider routing. The server still validates every returned action against the sanitized element map; no browser privacy logic changes.

## Cut corners log

- Chrome only.
- One controlled localhost demo page.
- Local NER currently uses an English CoNLL-2003 DistilBERT model. It masks detected people and locations, but ignores organizations by default to reduce over-redaction and is not yet multilingual.
- The resource dashboard reports an approximate extension-page JavaScript heap delta; Chrome does not expose complete WebGPU model memory through the popup API.
- Browser execution currently allows only a visible, enabled `HTMLButtonElement` click after explicit approval; multi-step workflows and other action types remain future work.
- DOM rules, Florence-2 OCR, local NER, and face detection cover the current demonstration, but arbitrary canvas content and every possible PII format are not guaranteed.
- Face detection scans visible image regions rather than every pixel of the full tab to reduce client inference cost.
