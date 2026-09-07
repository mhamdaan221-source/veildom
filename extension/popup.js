import { detectFaceRegions } from "./face-detector.js";
import { ocrBoxToRegion } from "./ocr-privacy.js";

const statusText = document.querySelector("#status");
const errorText = document.querySelector("#error");
const results = document.querySelector("#results");
const pageTitle = document.querySelector("#page-title");
const elementCount = document.querySelector("#element-count");
const elementList = document.querySelector("#element-list");
const assistButton = document.querySelector("#assist");
const taskInput = document.querySelector("#task");
const assistantResponse = document.querySelector("#assistant-response");
const assistantMessage = document.querySelector("#assistant-message");
const assistantAction = document.querySelector("#assistant-action");
const privacyReceipt = document.querySelector("#privacy-receipt");
const applyActionButton = document.querySelector("#apply-action");
const redactButton = document.querySelector("#redact");
const redactionResult = document.querySelector("#redaction-result");
const redactedPreview = document.querySelector("#redacted-preview");
const redactionSummary = document.querySelector("#redaction-summary");
const visionBenchmarkButton = document.querySelector("#vision-benchmark");
const visionResult = document.querySelector("#vision-result");
const visionProgress = document.querySelector("#vision-progress");
const visionStatus = document.querySelector("#vision-status");
const visionMetrics = document.querySelector("#vision-metrics");
const visionLoadTime = document.querySelector("#vision-load-time");
const visionInferenceTime = document.querySelector("#vision-inference-time");
const visionRegionCount = document.querySelector("#vision-region-count");
const evaluationDetails = document.querySelector("#evaluation-details");
const analyticsSection = document.querySelector("#analytics-section");
const evalTotalLatency = document.querySelector("#eval-total-latency");
const evalMaskCount = document.querySelector("#eval-mask-count");
const evalFlorenceLatency = document.querySelector("#eval-florence-latency");
const evalNerLatency = document.querySelector("#eval-ner-latency");
const evalFaceLatency = document.querySelector("#eval-face-latency");
const evalHeapChange = document.querySelector("#eval-heap-change");
const evalImageSize = document.querySelector("#eval-image-size");
const evalOcrCount = document.querySelector("#eval-ocr-count");
const evalAssistantLatency = document.querySelector("#eval-assistant-latency");
const evalE2eLatency = document.querySelector("#eval-e2e-latency");
const evalFalsePositive = document.querySelector("#eval-false-positive");
const evalMissed = document.querySelector("#eval-missed");
const evalImprecise = document.querySelector("#eval-imprecise");
const evalFalseControls = document.querySelector("#eval-false-controls");
const evalMissedControls = document.querySelector("#eval-missed-controls");
const saveEvaluationButton = document.querySelector("#save-evaluation");
const evaluationError = document.querySelector("#evaluation-error");
const evaluationScores = document.querySelector("#evaluation-scores");
const evalPrecision = document.querySelector("#eval-precision");
const evalRecall = document.querySelector("#eval-recall");
const evalRedactionPrecision = document.querySelector("#eval-redaction-precision");
const evalContextF1 = document.querySelector("#eval-context-f1");
const evaluationHistory = document.querySelector("#evaluation-history");
const provenanceDetails = document.querySelector("#provenance-details");
const provenancePreview = document.querySelector("#provenance-preview");
const provenanceSummary = document.querySelector("#provenance-summary");
const networkProof = document.querySelector("#network-proof");
const proofValueFields = document.querySelector("#proof-value-fields");
const proofRawFields = document.querySelector("#proof-raw-fields");
const proofTaskPii = document.querySelector("#proof-task-pii");
const proofImageHash = document.querySelector("#proof-image-hash");
const proofRegionCount = document.querySelector("#proof-region-count");
const exportJsonButton = document.querySelector("#export-json");
const exportCsvButton = document.querySelector("#export-csv");
const exportStatus = document.querySelector("#export-status");
let activePageMap = null;
let activeTabId = null;
let activeWindowId = null;
let pendingAction = null;
let sanitizedScreenshotDataUrl = null;
let lastPrivacyReport = null;
let visionWorker = null;
let nerWorker = null;
let currentEvaluationRun = null;

const getHeapBytes = () => Number.isFinite(performance.memory?.usedJSHeapSize)
  ? performance.memory.usedJSHeapSize
  : null;

const dataUrlBytes = (dataUrl) => {
  const encoded = String(dataUrl || "").split(",")[1] || "";
  return Math.max(0, Math.floor(encoded.length * 0.75) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0));
};

const hashDataUrl = async (dataUrl) => {
  const imageBytes = await (await fetch(dataUrl)).arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", imageBytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const formatDuration = (milliseconds) => Number.isFinite(milliseconds)
  ? milliseconds >= 1000 ? `${(milliseconds / 1000).toFixed(2)} s` : `${milliseconds} ms`
  : "—";

const formatBytes = (bytes, signed = false) => {
  if (!Number.isFinite(bytes)) return "Unavailable";
  const prefix = signed && bytes > 0 ? "+" : "";
  return `${prefix}${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const scorePercent = (value) => `${(value * 100).toFixed(1)}%`;

const toExportRecord = (run) => ({
  runId: run.id,
  createdAt: run.createdAt,
  site: run.site,
  totalLatencyMs: run.totalLatencyMs,
  assistantRoundTripMs: run.assistantRoundTripMs ?? null,
  endToEndComputeMs: run.endToEndComputeMs ?? null,
  serverLatencyMs: run.serverLatencyMs ?? null,
  decisionMode: run.decisionMode ?? null,
  actionSucceeded: run.actionSucceeded ?? null,
  controlCount: run.controlCount,
  totalMasks: run.totalMasks,
  domMasks: run.domMasks,
  nerMasks: run.nerMasks,
  florenceMasks: run.florenceMasks,
  faceMasks: run.faceMasks,
  ocrRegionsRead: run.ocrRegionsRead,
  florenceInferenceMs: run.florenceInferenceMs,
  florenceModelLoadMs: run.florenceModelLoadMs,
  nerInferenceMs: run.nerInferenceMs,
  nerModelLoadMs: run.nerModelLoadMs,
  faceLatencyMs: run.faceLatencyMs,
  sanitizedImageBytes: run.sanitizedImageBytes,
  heapDeltaBytes: run.heapDeltaBytes,
  viewportPixels: run.viewportPixels,
  hardwareConcurrency: run.hardwareConcurrency,
  deviceMemoryGb: run.deviceMemoryGb,
  privacyProofPassed: run.privacyProof
    ? run.privacyProof.fingerprintMatched === true &&
      run.privacyProof.elementValueFieldCount === 0 && run.privacyProof.rawScreenshotFieldCount === 0
    : null,
  redactionRegionCount: run.privacyProof?.redactionRegionCount ?? null,
  falsePositiveMasks: run.audit?.falsePositives ?? null,
  missedPii: run.audit?.missed ?? null,
  impreciseMasks: run.audit?.imprecise ?? null,
  falseControls: run.audit?.falseControls ?? null,
  missedControls: run.audit?.missedControls ?? null,
  piiPrecision: run.audit?.precision ?? null,
  piiRecall: run.audit?.recall ?? null,
  maskPrecision: run.audit?.redactionPrecision ?? null,
  visualContextF1: run.audit?.contextF1 ?? null
});

const csvCell = (value) => {
  if (value === null || value === undefined) return "";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  let text = String(value);
  if (/^[=+@-]/u.test(text)) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
};

const recordsToCsv = (records) => {
  if (!records.length) return "";
  const headers = Object.keys(records[0]);
  return [
    headers.map(csvCell).join(","),
    ...records.map((record) => headers.map((header) => csvCell(record[header])).join(","))
  ].join("\r\n");
};

const downloadLocalFile = (filename, contents, mimeType) => {
  const url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const loadEvaluationRuns = async () => {
  const result = await chrome.storage.local.get("evaluationRuns");
  return Array.isArray(result.evaluationRuns) ? result.evaluationRuns : [];
};

const renderEvaluationHistory = async () => {
  const runs = await loadEvaluationRuns();
  if (!runs.length) {
    evaluationHistory.textContent = "No completed runs yet.";
    exportJsonButton.disabled = true;
    exportCsvButton.disabled = true;
    return;
  }
  exportJsonButton.disabled = false;
  exportCsvButton.disabled = false;
  const averageLatency = runs.reduce((sum, run) => sum + (run.totalLatencyMs || 0), 0) / runs.length;
  const audited = runs.filter((run) => run.audit && Number.isFinite(run.audit.precision));
  const contextAudits = audited.filter((run) => Number.isFinite(run.audit.contextF1));
  const contextSummary = contextAudits.length
    ? ` · visual context F1 ${scorePercent(contextAudits.reduce((sum, run) => sum + run.audit.contextF1, 0) / contextAudits.length)}`
    : "";
  const auditSummary = audited.length
    ? ` ${audited.length} audited · average PII precision ${scorePercent(audited.reduce((sum, run) => sum + run.audit.precision, 0) / audited.length)} · recall ${scorePercent(audited.reduce((sum, run) => sum + run.audit.recall, 0) / audited.length)}${contextSummary}.`
    : " No accuracy audits saved yet.";
  evaluationHistory.textContent = `${runs.length} local run${runs.length === 1 ? "" : "s"} · average privacy latency ${formatDuration(averageLatency)}.${auditSummary}`;
};

const persistEvaluationRun = async (run) => {
  const runs = await loadEvaluationRuns();
  const nextRuns = [run, ...runs.filter((item) => item.id !== run.id)].slice(0, 20);
  await chrome.storage.local.set({ evaluationRuns: nextRuns });
  await renderEvaluationHistory();
};

const persistEvaluationRunSafely = async (run) => {
  try {
    await persistEvaluationRun(run);
  } catch {
    evaluationHistory.textContent = "This run completed, but local history could not be updated.";
  }
};

const renderEvaluationRun = (run) => {
  evalTotalLatency.textContent = formatDuration(run.totalLatencyMs);
  evalMaskCount.textContent = String(run.totalMasks);
  evalFlorenceLatency.textContent = formatDuration(run.florenceInferenceMs);
  evalNerLatency.textContent = formatDuration(run.nerInferenceMs);
  evalFaceLatency.textContent = formatDuration(run.faceLatencyMs);
  evalHeapChange.textContent = formatBytes(run.heapDeltaBytes, true);
  evalImageSize.textContent = formatBytes(run.sanitizedImageBytes);
  evalOcrCount.textContent = String(run.ocrRegionsRead);
  evalAssistantLatency.textContent = Number.isFinite(run.assistantRoundTripMs)
    ? formatDuration(run.assistantRoundTripMs)
    : "Not run";
  evalE2eLatency.textContent = Number.isFinite(run.endToEndComputeMs)
    ? formatDuration(run.endToEndComputeMs)
    : "Not run";
};

renderEvaluationHistory().catch(() => {
  evaluationHistory.textContent = "Local history is unavailable.";
});

const exportEvaluationRuns = async (format) => {
  exportStatus.textContent = "";
  const records = (await loadEvaluationRuns()).map(toExportRecord);
  if (!records.length) {
    exportStatus.textContent = "Run local protection before exporting metrics.";
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  if (format === "json") {
    downloadLocalFile(
      `private-vision-evaluation-${date}.json`,
      JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), records }, null, 2),
      "application/json"
    );
  } else {
    downloadLocalFile(
      `private-vision-evaluation-${date}.csv`,
      recordsToCsv(records),
      "text/csv;charset=utf-8"
    );
  }
  exportStatus.textContent = `${records.length} safe metric run${records.length === 1 ? "" : "s"} exported locally as ${format.toUpperCase()}.`;
};

exportJsonButton.addEventListener("click", () => {
  exportEvaluationRuns("json").catch(() => {
    exportStatus.textContent = "The JSON export could not be created.";
  });
});

exportCsvButton.addEventListener("click", () => {
  exportEvaluationRuns("csv").catch(() => {
    exportStatus.textContent = "The CSV export could not be created.";
  });
});

const MODEL_HOSTS = [
  "https://huggingface.co/*",
  "https://*.huggingface.co/*",
  "https://*.hf.co/*"
];

const showError = (message) => {
  errorText.textContent = message;
  statusText.textContent = "Could not inspect this tab";
};

const requestElementMap = async (tabId) => {
  try {
    return await chrome.tabs.sendMessage(tabId, { type: "BUILD_ELEMENT_MAP" });
  } catch (error) {
    const missingReceiver = error.message?.includes("Receiving end does not exist") ||
      error.message?.includes("Could not establish connection");

    if (!missingReceiver) throw error;

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });

    return chrome.tabs.sendMessage(tabId, { type: "BUILD_ELEMENT_MAP" });
  }
};

const readActivePage = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let protocol;
  try {
    protocol = new URL(tab?.url).protocol;
  } catch {
    protocol = null;
  }

  if (!tab?.id || !["http:", "https:"].includes(protocol)) {
    throw new Error("Open a normal http:// or https:// webpage first. Chrome blocks extensions on internal pages.");
  }

  activeTabId = tab.id;
  activeWindowId = tab.windowId;
  return requestElementMap(tab.id);
};

const renderPageMap = (response) => {
  activePageMap = response;
  pageTitle.textContent = response.title;
  elementCount.textContent = response.elements.length;
  elementList.replaceChildren(
    ...response.elements.map((element) => {
      const item = document.createElement("li");
      const role = document.createElement("span");
      const label = document.createElement("span");
      role.textContent = element.role;
      label.textContent = element.label;
      item.append(role, label);
      return item;
    })
  );
  results.hidden = false;
};

const loadImage = (source) => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error("Chrome returned an unreadable tab capture."));
  image.src = source;
});

const createProvenancePreview = async (sanitizedDataUrl, report) => {
  const image = await loadImage(sanitizedDataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { alpha: false });
  context.drawImage(image, 0, 0);

  const scaleX = image.naturalWidth / report.privacyMap.viewport.width;
  const scaleY = image.naturalHeight / report.privacyMap.viewport.height;
  const toImageRegion = (region) => ({
    x: region.x * scaleX,
    y: region.y * scaleY,
    width: region.width * scaleX,
    height: region.height * scaleY
  });
  const faceMaskRegion = (face) => {
    const expansion = Math.max(12, Math.round(Math.max(face.width, face.height) * 0.32));
    return {
      x: Math.max(0, face.x - expansion),
      y: Math.max(0, face.y - expansion),
      width: Math.min(image.naturalWidth - Math.max(0, face.x - expansion), face.width + expansion * 2),
      height: Math.min(image.naturalHeight - Math.max(0, face.y - expansion), face.height + expansion * 2)
    };
  };
  const sources = [
    { tag: "DOM", color: "#3783ff", regions: report.privacyMap.regions.map(toImageRegion) },
    { tag: "NER", color: "#20b67f", regions: report.nerRegions.map(toImageRegion) },
    { tag: "VIT", color: "#ff9f1c", regions: report.ocrRegions },
    { tag: "FACE", color: "#e052c6", regions: report.faceDetection.regions.map(faceMaskRegion) }
  ];
  const fontSize = Math.max(18, Math.round(image.naturalWidth / 55));
  context.font = `800 ${fontSize}px system-ui, sans-serif`;
  context.textBaseline = "top";

  for (const source of sources) {
    source.regions.forEach((region, index) => {
      const x = Math.max(0, Math.round(region.x));
      const y = Math.max(0, Math.round(region.y));
      const width = Math.max(2, Math.min(image.naturalWidth - x, Math.round(region.width)));
      const height = Math.max(2, Math.min(image.naturalHeight - y, Math.round(region.height)));
      context.strokeStyle = source.color;
      context.lineWidth = Math.max(3, Math.round(image.naturalWidth / 500));
      context.strokeRect(x, y, width, height);

      const label = `${source.tag} ${index + 1}`;
      const labelWidth = context.measureText(label).width + 12;
      const labelY = Math.min(image.naturalHeight - fontSize - 8, y + 3);
      context.fillStyle = source.color;
      context.fillRect(x + 3, labelY, labelWidth, fontSize + 6);
      context.fillStyle = "#ffffff";
      context.fillText(label, x + 9, labelY + 3);
    });
  }

  return canvas.toDataURL("image/jpeg", 0.84);
};

const getVisionWorker = () => {
  visionWorker ??= new Worker(chrome.runtime.getURL("vision-worker.js"), { type: "module" });
  return visionWorker;
};

const getNerWorker = () => {
  nerWorker ??= new Worker(chrome.runtime.getURL("ner-worker.js"), { type: "module" });
  return nerWorker;
};

const runNerWorker = (candidates, onStatus = () => {}) => new Promise((resolve, reject) => {
  const worker = getNerWorker();
  const requestId = crypto.randomUUID();
  const timeoutId = setTimeout(() => {
    cleanup();
    reject(new Error("The local NER privacy pass exceeded 5 minutes."));
  }, 5 * 60 * 1000);

  const cleanup = () => {
    clearTimeout(timeoutId);
    worker.removeEventListener("message", onMessage);
    worker.removeEventListener("error", onWorkerError);
  };
  const onWorkerError = (event) => {
    cleanup();
    reject(new Error(event.message || "The local NER worker stopped unexpectedly."));
  };
  const onMessage = ({ data }) => {
    if (data?.requestId !== requestId) return;
    onStatus(data);
    if (data.status === "complete") {
      cleanup();
      resolve({ regions: data.regions || [], metrics: data.metrics });
    } else if (data.status === "error") {
      cleanup();
      reject(new Error(data.error || "Local NER inference failed."));
    }
  };

  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onWorkerError);
  worker.postMessage({ type: "RUN_NER", requestId, candidates });
});

const runVisionWorker = (screenshotDataUrl, onStatus = () => {}) => new Promise((resolve, reject) => {
  const worker = getVisionWorker();
  const requestId = crypto.randomUUID();
  const timeoutId = setTimeout(() => {
    cleanup();
    reject(new Error("The local vision benchmark exceeded 10 minutes."));
  }, 10 * 60 * 1000);

  const cleanup = () => {
    clearTimeout(timeoutId);
    worker.removeEventListener("message", onMessage);
    worker.removeEventListener("error", onWorkerError);
  };

  const onWorkerError = (event) => {
    cleanup();
    reject(new Error(event.message || "The local vision worker stopped unexpectedly."));
  };

  const onMessage = ({ data }) => {
    if (data?.requestId !== requestId) return;
    onStatus(data);

    if (data.status === "complete") {
      cleanup();
      resolve({ metrics: data.metrics, ocrItems: data.ocrItems || [] });
      return;
    }

    if (data.status === "error") {
      cleanup();
      reject(new Error(data.error || "Local vision inference failed."));
    }
  };

  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onWorkerError);
  worker.postMessage({ type: "RUN_BENCHMARK", requestId, screenshotDataUrl });
});

const renderVisionStatus = (data) => {
  if (data.status === "model-progress") {
    const percentage = Number.isFinite(data.progress) ? Math.round(data.progress) : 0;
    visionProgress.value = Math.max(0, Math.min(100, percentage));
    const file = data.file?.split("/").pop() || "model weights";
    visionStatus.textContent = `Downloading ${file}… ${percentage}%`;
  } else if (data.status === "loading-model") {
    visionStatus.textContent = "Loading Florence-2 locally…";
  } else if (data.status === "warming-up") {
    visionProgress.removeAttribute("value");
    visionStatus.textContent = "Compiling WebGPU shaders…";
  } else if (data.status === "running-inference") {
    visionProgress.removeAttribute("value");
    visionStatus.textContent = "Reading this screenshot locally…";
  }
};

const createRedactedScreenshot = async (rawCapture, privacyMap, ocrItems = [], nerRegions = []) => {
  const image = await loadImage(rawCapture);
  const faceDetection = await detectFaceRegions(image, privacyMap);
  const ocrRegions = ocrItems
    .map((item) => ocrBoxToRegion(item, image.naturalWidth, image.naturalHeight))
    .filter(Boolean);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { alpha: false });
  context.drawImage(image, 0, 0);

  const scaleX = image.naturalWidth / privacyMap.viewport.width;
  const scaleY = image.naturalHeight / privacyMap.viewport.height;

  for (const face of faceDetection.regions) {
    const expansion = Math.max(12, Math.round(Math.max(face.width, face.height) * 0.32));
    const x = Math.max(0, face.x - expansion);
    const y = Math.max(0, face.y - expansion);
    const width = Math.min(image.naturalWidth - x, face.width + expansion * 2);
    const height = Math.min(image.naturalHeight - y, face.height + expansion * 2);
    context.save();
    context.filter = `blur(${Math.max(36, Math.round(width * 0.34))}px)`;
    context.drawImage(image, x, y, width, height, x, y, width, height);
    context.restore();

    // Blur alone can leave a small portrait identifiable. The opaque mask is
    // the actual privacy boundary; the blur pass prevents sharp edge leakage.
    context.fillStyle = "#05070c";
    context.fillRect(x, y, width, height);
  }

  context.fillStyle = "#05070c";

  for (const region of nerRegions) {
    const padding = 4;
    context.fillRect(
      Math.max(0, (region.x - padding) * scaleX),
      Math.max(0, (region.y - padding) * scaleY),
      (region.width + padding * 2) * scaleX,
      (region.height + padding * 2) * scaleY
    );
  }

  for (const region of ocrRegions) {
    const padding = 4;
    context.fillRect(
      Math.max(0, region.x - padding),
      Math.max(0, region.y - padding),
      Math.min(image.naturalWidth - region.x, region.width + padding * 2),
      Math.min(image.naturalHeight - region.y, region.height + padding * 2)
    );
  }

  for (const region of privacyMap.regions) {
    const padding = 3;
    context.fillRect(
      Math.max(0, (region.x - padding) * scaleX),
      Math.max(0, (region.y - padding) * scaleY),
      (region.width + padding * 2) * scaleX,
      (region.height + padding * 2) * scaleY
    );
  }

  return {
    dataUrl: canvas.toDataURL("image/jpeg", 0.82),
    faceDetection,
    ocrRegions
  };
};

const waitForPageToSettle = async (tabId, timeoutMs = 6500) => {
  // Give client-side handlers and SPA transitions a short head start. For a
  // full navigation, continue polling until Chrome reports the tab complete.
  await new Promise((resolve) => setTimeout(resolve, 700));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === "complete") {
        await new Promise((resolve) => setTimeout(resolve, 350));
        return;
      }
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};

visionBenchmarkButton.addEventListener("click", async () => {
  visionBenchmarkButton.disabled = true;
  errorText.textContent = "";
  visionResult.hidden = false;
  visionMetrics.hidden = true;
  visionProgress.value = 0;
  visionStatus.textContent = "Checking WebGPU and model access…";
  statusText.textContent = "Preparing local vision benchmark…";

  try {
    if (!navigator.gpu) {
      throw new Error("WebGPU is unavailable. Update Chrome and confirm hardware acceleration is enabled.");
    }

    const modelAccessGranted = await chrome.permissions.request({ origins: MODEL_HOSTS });
    if (!modelAccessGranted) {
      throw new Error("Model download permission was not granted. No screenshot was processed.");
    }

    renderPageMap(await readActivePage());
    const screenshotDataUrl = await chrome.tabs.captureVisibleTab(activeWindowId, { format: "png" });
    const { metrics } = await runVisionWorker(screenshotDataUrl, renderVisionStatus);

    visionProgress.value = 100;
    visionLoadTime.textContent = `${(metrics.modelLoadMs / 1000).toFixed(1)} s`;
    visionInferenceTime.textContent = `${(metrics.inferenceMs / 1000).toFixed(1)} s`;
    visionRegionCount.textContent = String(metrics.ocrRegions);
    visionMetrics.hidden = false;
    visionStatus.textContent = `Florence-2 read a ${metrics.imageWidth}×${metrics.imageHeight} screenshot entirely on this device.`;
    statusText.textContent = "Local vision benchmark complete";
  } catch (error) {
    visionProgress.value = 0;
    visionStatus.textContent = error.message || "Local vision benchmark failed.";
    errorText.textContent = error.message || "Local vision benchmark failed.";
    statusText.textContent = "Local vision benchmark needs attention";
  } finally {
    visionBenchmarkButton.disabled = false;
  }
});

assistButton.addEventListener("click", async () => {
  const assistStartedAt = performance.now();
  assistButton.disabled = true;
  errorText.textContent = "";
  assistantResponse.hidden = true;
  applyActionButton.hidden = true;
  pendingAction = null;
  statusText.textContent = "Sending sanitized structure…";

  try {
    activePageMap = activePageMap || await readActivePage();
    const task = taskInput.value.trim();
    if (!task) throw new Error("Enter a task for the assistant first.");
    if (!sanitizedScreenshotDataUrl || !lastPrivacyReport) {
      throw new Error("Capture and inspect the locally redacted screenshot before sending anything.");
    }
    const clientSanitizedImageSha256 = await hashDataUrl(sanitizedScreenshotDataUrl);

    const response = await fetch("http://localhost:5173/api/assist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task,
        page: {
          origin: activePageMap.origin,
          title: activePageMap.title,
          viewport: lastPrivacyReport.privacyMap.viewport
        },
        sanitization: {
          source: "dom-plus-local-ner-plus-florence2-plus-face-model",
          redactionApplied: true,
          rawValuesIncluded: false
        },
        sanitizedScreenshot: {
          mimeType: "image/jpeg",
          dataUrl: sanitizedScreenshotDataUrl,
          redactionApplied: true,
          regions: [
            ...lastPrivacyReport.privacyMap.regions.map(({ type, x, y, width, height }) => ({
              type, x, y, width, height
            })),
            ...lastPrivacyReport.faceDetection.regions.map(({ type, x, y, width, height }) => ({
              type, x, y, width, height
            })),
            ...lastPrivacyReport.ocrRegions.map(({ type, x, y, width, height }) => ({
              type, x, y, width, height
            })),
            ...lastPrivacyReport.nerRegions.map(({ type, x, y, width, height }) => ({
              type, x, y, width, height
            }))
          ]
        },
        elements: activePageMap.elements
      })
    });

    const responseText = await response.text();
    let body;
    try {
      body = JSON.parse(responseText);
    } catch {
      throw new Error("The server is running old code. Stop it, restart npm.cmd start, then try again.");
    }
    if (!response.ok) throw new Error(body.error || `Server returned ${response.status}`);
    const proof = body.debug?.privacyProof;
    const fingerprintMatches = proof?.sanitizedImageSha256 === clientSanitizedImageSha256;
    if (!proof || proof.elementValueFieldCount !== 0 || proof.rawScreenshotFieldCount !== 0 || !fingerprintMatches) {
      throw new Error("The server privacy receipt did not match the sanitized client payload, so the response was blocked.");
    }

    proofValueFields.textContent = "0 · passed";
    proofRawFields.textContent = "0 · passed";
    proofTaskPii.textContent = proof.taskStructuredPiiDetected ? "Blocked" : "Passed";
    proofImageHash.textContent = `Matched · ${clientSanitizedImageSha256.slice(0, 12)}…`;
    proofRegionCount.textContent = String(proof.redactionRegionCount);
    networkProof.hidden = false;

    if (currentEvaluationRun) {
      currentEvaluationRun = {
        ...currentEvaluationRun,
        assistantRoundTripMs: Math.round(performance.now() - assistStartedAt),
        serverLatencyMs: body.debug.serverLatencyMs,
        decisionMode: body.debug.mode
      };
      currentEvaluationRun.privacyProof = {
        elementValueFieldCount: proof.elementValueFieldCount,
        rawScreenshotFieldCount: proof.rawScreenshotFieldCount,
        taskStructuredPiiDetected: proof.taskStructuredPiiDetected,
        redactionRegionCount: proof.redactionRegionCount,
        fingerprintMatched: true
      };
      currentEvaluationRun.endToEndComputeMs = currentEvaluationRun.totalLatencyMs + currentEvaluationRun.assistantRoundTripMs;
      renderEvaluationRun(currentEvaluationRun);
      await persistEvaluationRunSafely(currentEvaluationRun);
    }

    assistantMessage.textContent = body.message;
    assistantAction.textContent = body.action
      ? `Proposed action: ${body.action.type} ${body.action.targetId}`
      : "No action proposed.";
    const source = body.debug.mode === "model"
      ? `real model via ${body.debug.provider}: ${body.debug.model}`
      : `safe fallback (${body.debug.modelError})`;
    privacyReceipt.textContent = `Privacy receipt: ${body.debug.receivedElementCount} controls, no raw values, ${Math.round(body.debug.sanitizedImageBytes / 1024)} KB sanitized image. Decision source: ${source}. Server/model time: ${body.debug.serverLatencyMs} ms.`;
    assistantResponse.hidden = false;
    assistantResponse.scrollIntoView({ behavior: "smooth", block: "nearest" });
    pendingAction = body.action;

    if (pendingAction) {
      const preview = await chrome.tabs.sendMessage(activeTabId, {
        type: "PREVIEW_ACTION",
        action: pendingAction
      });
      if (!preview.ok) throw new Error(preview.error);
      applyActionButton.hidden = false;
      statusText.textContent = body.debug.mode === "model"
        ? "Model action highlighted — approval required"
        : "Fallback action highlighted — approval required";
    } else {
      statusText.textContent = "Sanitized round-trip complete";
    }
  } catch (error) {
    showError(error.message || "Could not contact the local server.");
  } finally {
    assistButton.disabled = !sanitizedScreenshotDataUrl;
  }
});

applyActionButton.addEventListener("click", async () => {
  applyActionButton.disabled = true;
  errorText.textContent = "";

  try {
    if (!pendingAction || !activeTabId) throw new Error("No action is waiting for approval.");
    const execution = await chrome.tabs.sendMessage(activeTabId, {
      type: "EXECUTE_ACTION",
      action: pendingAction
    });
    if (!execution.ok) throw new Error(execution.error);

    assistantMessage.textContent = "Approved action executed successfully.";
    assistantAction.textContent = `Clicked ${pendingAction.targetId}; the approved action was completed.`;
    applyActionButton.hidden = true;
    pendingAction = null;
    activePageMap = null;
    sanitizedScreenshotDataUrl = null;
    lastPrivacyReport = null;
    assistButton.disabled = true;
    statusText.textContent = "Approved action completed";
    if (currentEvaluationRun) {
      currentEvaluationRun = { ...currentEvaluationRun, actionSucceeded: true };
      await persistEvaluationRunSafely(currentEvaluationRun);
    }

    statusText.textContent = "Action completed - waiting for the updated page…";
    assistantAction.textContent = "The approved click completed. Waiting for the page to settle before a new local capture.";
    await waitForPageToSettle(activeTabId);
    const recaptured = await runLocalRedaction({ afterAction: true });
    if (recaptured) {
      assistantMessage.textContent = "Approved action completed and the updated page was protected locally.";
      assistantAction.textContent = "A fresh sanitized capture is ready. Nothing was sent to the model automatically.";
    } else {
      assistantMessage.textContent = "The approved action completed, but automatic recapture needs attention.";
      assistantAction.textContent = "No follow-up model request or action was performed.";
    }
  } catch (error) {
    showError(error.message || "Could not execute the approved action.");
  } finally {
    applyActionButton.disabled = false;
  }
});

saveEvaluationButton.addEventListener("click", async () => {
  evaluationError.textContent = "";
  if (!currentEvaluationRun) {
    evaluationError.textContent = "Run local redaction before saving an evaluation.";
    return;
  }

  const falsePositives = Number(evalFalsePositive.value);
  const missed = Number(evalMissed.value);
  const imprecise = Number(evalImprecise.value);
  const falseControls = Number(evalFalseControls.value);
  const missedControls = Number(evalMissedControls.value);
  const values = [falsePositives, missed, imprecise, falseControls, missedControls];
  if (values.some((value) => !Number.isInteger(value) || value < 0)) {
    evaluationError.textContent = "Enter whole numbers of zero or greater.";
    return;
  }
  if (falsePositives > currentEvaluationRun.totalMasks) {
    evaluationError.textContent = "False masks cannot exceed the total mask count.";
    return;
  }

  const truePositives = currentEvaluationRun.totalMasks - falsePositives;
  if (imprecise > truePositives) {
    evaluationError.textContent = "Poorly fitted masks cannot exceed correct PII detections.";
    return;
  }
  if (falseControls > currentEvaluationRun.controlCount) {
    evaluationError.textContent = "False controls cannot exceed the detected control count.";
    return;
  }

  const precision = currentEvaluationRun.totalMasks ? truePositives / currentEvaluationRun.totalMasks : missed ? 0 : 1;
  const recall = truePositives + missed ? truePositives / (truePositives + missed) : 1;
  const redactionPrecision = truePositives ? (truePositives - imprecise) / truePositives : 1;
  const trueControls = currentEvaluationRun.controlCount - falseControls;
  const contextPrecision = currentEvaluationRun.controlCount ? trueControls / currentEvaluationRun.controlCount : missedControls ? 0 : 1;
  const contextRecall = trueControls + missedControls ? trueControls / (trueControls + missedControls) : 1;
  const contextF1 = contextPrecision + contextRecall ? 2 * contextPrecision * contextRecall / (contextPrecision + contextRecall) : 0;
  currentEvaluationRun = {
    ...currentEvaluationRun,
    audit: {
      falsePositives,
      missed,
      imprecise,
      falseControls,
      missedControls,
      truePositives,
      precision,
      recall,
      redactionPrecision,
      contextPrecision,
      contextRecall,
      contextF1,
      auditedAt: new Date().toISOString()
    }
  };

  evalPrecision.textContent = scorePercent(precision);
  evalRecall.textContent = scorePercent(recall);
  evalRedactionPrecision.textContent = scorePercent(redactionPrecision);
  evalContextF1.textContent = scorePercent(contextF1);
  evaluationScores.hidden = false;
  saveEvaluationButton.disabled = true;
  try {
    await persistEvaluationRun(currentEvaluationRun);
    saveEvaluationButton.textContent = "Evaluation saved locally";
  } catch (error) {
    evaluationError.textContent = error.message || "Could not save the local evaluation.";
    saveEvaluationButton.disabled = false;
  }
});

const runLocalRedaction = async ({ afterAction = false } = {}) => {
  let succeeded = false;
  const redactionStartedAt = performance.now();
  const heapBefore = getHeapBytes();
  redactButton.disabled = true;
  errorText.textContent = "";
  redactionResult.hidden = true;
  networkProof.hidden = true;
  statusText.textContent = afterAction ? "Recapturing and protecting the updated page locally…" : "Detecting private regions locally…";

  try {
    if (!navigator.gpu) {
      throw new Error("WebGPU is required for the local vision privacy pass on this build.");
    }
    const alreadyGranted = await chrome.permissions.contains({ origins: MODEL_HOSTS });
    const modelAccessGranted = alreadyGranted || await chrome.permissions.request({ origins: MODEL_HOSTS });
    if (!modelAccessGranted) {
      throw new Error("Local model access was not granted, so the privacy gate blocked screenshot creation.");
    }

    renderPageMap(await readActivePage());
    const response = await chrome.tabs.sendMessage(activeTabId, { type: "BUILD_PRIVACY_MAP" });
    if (!response.ok) throw new Error(response.error);

    const { textCandidates = [], ...privacyMap } = response.privacyMap;
    const guardedFields = Array.isArray(privacyMap.guardedFields) ? privacyMap.guardedFields : [];
    const isCoveredByDomMask = (field) => privacyMap.regions.some((region) =>
      region.x <= field.x && region.y <= field.y &&
      region.x + region.width >= field.x + field.width &&
      region.y + region.height >= field.y + field.height
    );
    const uncoveredFields = guardedFields.filter((field) => !isCoveredByDomMask(field));
    if (uncoveredFields.length) {
      throw new Error(`Privacy gate blocked capture: ${uncoveredFields.length} filled or sensitive form field(s) were not fully covered.`);
    }
    const candidateRects = new Map(textCandidates.map((candidate) => [candidate.id, candidate.rect]));
    const rawCapture = await chrome.tabs.captureVisibleTab(activeWindowId, { format: "png" });
    const [visionOutput, nerOutput] = await Promise.all([
      runVisionWorker(rawCapture, (data) => {
        if (data.status === "loading-model") statusText.textContent = "Loading Florence-2 locally…";
        if (data.status === "warming-up") statusText.textContent = "Preparing WebGPU locally…";
        if (data.status === "running-inference") statusText.textContent = "Florence-2 is finding visual text regions…";
      }),
      runNerWorker(textCandidates, (data) => {
        if (data.status === "loading-model") statusText.textContent = "Loading the local name and location detector…";
        if (data.status === "running-inference") statusText.textContent = "Checking uncertain text locally with NER…";
      })
    ]);
    const nerRegions = nerOutput.regions.map((region) => {
      const rect = candidateRects.get(region.candidateId);
      return rect ? { type: region.type, score: region.score, ...rect } : null;
    }).filter(Boolean);
    statusText.textContent = "Classifying and masking private regions locally…";
    const sanitized = await createRedactedScreenshot(rawCapture, privacyMap, visionOutput.ocrItems, nerRegions);
    sanitizedScreenshotDataUrl = sanitized.dataUrl;
    lastPrivacyReport = {
      privacyMap,
      faceDetection: sanitized.faceDetection,
      ocrRegions: sanitized.ocrRegions,
      nerRegions,
      visionMetrics: visionOutput.metrics,
      nerMetrics: nerOutput.metrics
    };
    const heapAfter = getHeapBytes();
    const totalMasks = privacyMap.regions.length + nerRegions.length + sanitized.ocrRegions.length + sanitized.faceDetection.regions.length;
    currentEvaluationRun = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      site: activePageMap?.origin ? new URL(activePageMap.origin).hostname : "unknown",
      totalLatencyMs: Math.round(performance.now() - redactionStartedAt),
      totalMasks,
      controlCount: activePageMap?.elements?.length || 0,
      domMasks: privacyMap.regions.length,
      nerMasks: nerRegions.length,
      florenceMasks: sanitized.ocrRegions.length,
      faceMasks: sanitized.faceDetection.regions.length,
      ocrRegionsRead: visionOutput.metrics.ocrRegions,
      florenceInferenceMs: visionOutput.metrics.inferenceMs,
      florenceModelLoadMs: visionOutput.metrics.modelLoadMs,
      nerInferenceMs: nerOutput.metrics.inferenceMs,
      nerModelLoadMs: nerOutput.metrics.modelLoadMs,
      faceLatencyMs: sanitized.faceDetection.latencyMs,
      sanitizedImageBytes: dataUrlBytes(sanitizedScreenshotDataUrl),
      heapDeltaBytes: Number.isFinite(heapBefore) && Number.isFinite(heapAfter) ? heapAfter - heapBefore : null,
      viewportPixels: privacyMap.viewport.width * privacyMap.viewport.height,
      hardwareConcurrency: navigator.hardwareConcurrency || null,
      deviceMemoryGb: navigator.deviceMemory || null,
      audited: false
    };
    renderEvaluationRun(currentEvaluationRun);
    evalFalsePositive.value = "0";
    evalMissed.value = "0";
    evalImprecise.value = "0";
    evalFalseControls.value = "0";
    evalMissedControls.value = "0";
    evaluationScores.hidden = true;
    evaluationError.textContent = "";
    saveEvaluationButton.disabled = false;
    saveEvaluationButton.textContent = "Save local evaluation";
    analyticsSection.hidden = false;
    evaluationDetails.open = false;
    await persistEvaluationRunSafely(currentEvaluationRun);
    redactedPreview.src = sanitizedScreenshotDataUrl;
    provenanceDetails.hidden = false;
    provenanceDetails.open = false;
    provenanceSummary.textContent = `DOM ${privacyMap.regions.length} · NER ${nerRegions.length} · ViT ${sanitized.ocrRegions.length} · Face ${sanitized.faceDetection.regions.length} · raw values retained in outbound payload: 0.`;
    createProvenancePreview(sanitizedScreenshotDataUrl, lastPrivacyReport)
      .then((dataUrl) => {
        provenancePreview.src = dataUrl;
      })
      .catch(() => {
        provenanceSummary.textContent += " The annotated preview could not be rendered, but source counts remain available.";
      });
    redactionSummary.textContent = `${privacyMap.regions.length} DOM PII regions, ${nerRegions.length} local NER regions, and ${sanitized.ocrRegions.length} of ${visionOutput.metrics.ocrRegions} Florence OCR regions were classified as sensitive; ${sanitized.faceDetection.regions.length} face(s) masked. Parallel inference: Florence ${visionOutput.metrics.inferenceMs} ms, NER ${nerOutput.metrics.inferenceMs} ms.`;
    redactionResult.hidden = false;
    assistButton.disabled = false;
    statusText.textContent = "Local redaction complete — nothing uploaded";
    succeeded = true;
  } catch (error) {
    sanitizedScreenshotDataUrl = null;
    lastPrivacyReport = null;
    assistButton.disabled = true;
    showError(error.message || "Could not create the local redacted preview.");
  } finally {
    redactButton.disabled = false;
  }
  return succeeded;
};

redactButton.addEventListener("click", () => {
  void runLocalRedaction();
});
