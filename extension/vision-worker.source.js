import {
  AutoProcessor,
  AutoTokenizer,
  Florence2ForConditionalGeneration,
  RawImage,
  env,
  full
} from "@huggingface/transformers";

const MODEL_ID = "onnx-community/Florence-2-base-ft";
const OCR_TASK = "<OCR_WITH_REGION>";
const runtimeMjs = new URL("./vendor/transformers/ort-wasm-simd-threaded.asyncify.mjs", import.meta.url).href;
const runtimeWasm = new URL("./vendor/transformers/ort-wasm-simd-threaded.asyncify.wasm", import.meta.url).href;

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
// Transformers.js normally converts the ONNX runtime module to a blob URL so
// it can cache the WASM binary. Chrome MV3 extension CSP rejects executable
// blob modules, so load the packaged extension module directly instead.
env.useWasmCache = false;
env.backends.onnx.wasm.wasmPaths = { mjs: runtimeMjs, wasm: runtimeWasm };

const supportsFp16 = async () => {
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    return Boolean(adapter?.features.has("shader-f16"));
  } catch {
    return false;
  }
};

let modelPromise;
let tokenizerPromise;
let processorPromise;
let loadMetrics;

const loadModel = async (requestId) => {
  if (modelPromise && tokenizerPromise && processorPromise) {
    return { ...(await loadMetrics), cachedInWorker: true };
  }

  const startedAt = performance.now();
  const fp16 = await supportsFp16();
  const reportProgress = (progress) => self.postMessage({
    requestId,
    status: "model-progress",
    file: progress.file,
    progress: progress.progress,
    loaded: progress.loaded,
    total: progress.total
  });

  tokenizerPromise = AutoTokenizer.from_pretrained(MODEL_ID);
  processorPromise = AutoProcessor.from_pretrained(MODEL_ID);
  modelPromise = Florence2ForConditionalGeneration.from_pretrained(MODEL_ID, {
    device: "webgpu",
    dtype: {
      embed_tokens: fp16 ? "fp16" : "fp32",
      vision_encoder: fp16 ? "fp16" : "fp32",
      encoder_model: "q4",
      decoder_model_merged: "q4"
    },
    progress_callback: reportProgress
  });

  loadMetrics = Promise.all([modelPromise, tokenizerPromise, processorPromise])
    .then(async ([model, tokenizer]) => {
      self.postMessage({ requestId, status: "warming-up" });
      const textInputs = tokenizer("a");
      const pixelValues = full([1, 3, 768, 768], 0);
      const warmupStartedAt = performance.now();
      await model.generate({ ...textInputs, pixel_values: pixelValues, max_new_tokens: 1 });
      return {
        modelLoadMs: Math.round(performance.now() - startedAt),
        warmupMs: Math.round(performance.now() - warmupStartedAt),
        fp16,
        cachedInWorker: false
      };
    });

  return loadMetrics;
};

const extractOcrItems = (result) => {
  const output = result?.[OCR_TASK];
  if (!output || typeof output === "string") return [];

  const labels = Array.isArray(output.labels) ? output.labels : [];
  const boxes = Array.isArray(output.quad_boxes)
    ? output.quad_boxes
    : Array.isArray(output.bboxes) ? output.bboxes : [];

  return labels.slice(0, 250).map((text, index) => ({
    text: String(text || "").slice(0, 500),
    box: Array.isArray(boxes[index]) ? boxes[index].map(Number) : []
  })).filter((item) => item.text.trim() && [4, 8].includes(item.box.length) && item.box.every(Number.isFinite));
};

const runBenchmark = async ({ requestId, screenshotDataUrl }) => {
  if (!navigator.gpu) throw new Error("WebGPU is not available in this Chrome session.");

  self.postMessage({ requestId, status: "loading-model" });
  const metrics = await loadModel(requestId);
  const [model, tokenizer, processor] = await Promise.all([modelPromise, tokenizerPromise, processorPromise]);

  self.postMessage({ requestId, status: "running-inference" });
  const inferenceStartedAt = performance.now();
  const image = await RawImage.fromURL(screenshotDataUrl);
  const visionInputs = await processor(image);
  const prompts = processor.construct_prompts(OCR_TASK);
  const textInputs = tokenizer(prompts);
  const generatedIds = await model.generate({
    ...textInputs,
    ...visionInputs,
    max_new_tokens: 128,
    num_beams: 1,
    do_sample: false
  });
  const generatedText = tokenizer.batch_decode(generatedIds, { skip_special_tokens: false })[0];
  const result = processor.post_process_generation(generatedText, OCR_TASK, image.size);
  const inferenceMs = Math.round(performance.now() - inferenceStartedAt);
  const ocrItems = extractOcrItems(result);

  self.postMessage({
    requestId,
    status: "complete",
    metrics: {
      ...metrics,
      inferenceMs,
      totalMs: metrics.cachedInWorker ? inferenceMs : metrics.modelLoadMs + inferenceMs,
      ocrRegions: ocrItems.length,
      imageWidth: image.width,
      imageHeight: image.height,
      model: MODEL_ID,
      device: "WebGPU"
    },
    ocrItems
  });
};

self.addEventListener("message", async ({ data }) => {
  if (data?.type !== "RUN_BENCHMARK") return;
  try {
    await runBenchmark(data);
  } catch (error) {
    self.postMessage({
      requestId: data.requestId,
      status: "error",
      error: error?.message || String(error)
    });
  }
});
