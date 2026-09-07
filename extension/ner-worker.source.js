import { env, pipeline } from "@huggingface/transformers";

const MODEL_ID = "onnx-community/distilbert-NER-ONNX";
const runtimeMjs = new URL("./vendor/transformers/ort-wasm-simd-threaded.asyncify.mjs", import.meta.url).href;
const runtimeWasm = new URL("./vendor/transformers/ort-wasm-simd-threaded.asyncify.wasm", import.meta.url).href;

env.allowLocalModels = false;
env.allowRemoteModels = true;
env.useBrowserCache = true;
env.useWasmCache = false;
env.backends.onnx.wasm.wasmPaths = { mjs: runtimeMjs, wasm: runtimeWasm };
env.backends.onnx.wasm.numThreads = 1;

let classifierPromise;

const getClassifier = (requestId) => {
  if (!classifierPromise) {
    classifierPromise = pipeline("token-classification", MODEL_ID, {
      device: "wasm",
      dtype: "q8",
      progress_callback: (progress) => self.postMessage({
        requestId,
        status: "model-progress",
        file: progress.file,
        progress: progress.progress
      })
    });
  }
  return classifierPromise;
};

const normalizeBatch = (output, expectedLength) => {
  if (expectedLength === 1 && Array.isArray(output) && !Array.isArray(output[0])) return [output];
  return Array.isArray(output) ? output : [];
};

const runNer = async ({ requestId, candidates }) => {
  const safeCandidates = Array.isArray(candidates)
    ? candidates.slice(0, 120).filter((item) => typeof item?.id === "string" && typeof item?.text === "string")
    : [];
  if (!safeCandidates.length) {
    self.postMessage({ requestId, status: "complete", regions: [], metrics: { modelLoadMs: 0, inferenceMs: 0, candidates: 0, matches: 0, model: MODEL_ID } });
    return;
  }

  self.postMessage({ requestId, status: "loading-model" });
  const loadStartedAt = performance.now();
  const classifier = await getClassifier(requestId);
  const modelLoadMs = Math.round(performance.now() - loadStartedAt);

  self.postMessage({ requestId, status: "running-inference" });
  const inferenceStartedAt = performance.now();
  const output = await classifier(safeCandidates.map((item) => item.text), {
    aggregation_strategy: "simple"
  });
  const batches = normalizeBatch(output, safeCandidates.length);
  const regions = [];

  batches.forEach((entities, index) => {
    const candidate = safeCandidates[index];
    if (!candidate || !Array.isArray(entities)) return;
    const accepted = entities
      .map((entity) => ({
        type: String(entity.entity_group || entity.entity || "").replace(/^B-|^I-/, ""),
        score: Number(entity.score)
      }))
      .filter((entity) => entity.type === "PER" ? entity.score >= 0.75 : entity.type === "LOC" && entity.score >= 0.88);
    if (!accepted.length) return;

    const strongest = accepted.sort((left, right) => right.score - left.score)[0];
    // Never return the model's `word` field. Only the opaque candidate ID and
    // classification metadata leave this local worker.
    regions.push({ candidateId: candidate.id, type: strongest.type === "PER" ? "person-name-ner" : "location-ner", score: strongest.score });
  });

  self.postMessage({
    requestId,
    status: "complete",
    regions,
    metrics: {
      modelLoadMs,
      inferenceMs: Math.round(performance.now() - inferenceStartedAt),
      candidates: safeCandidates.length,
      matches: regions.length,
      model: MODEL_ID,
      device: "WASM q8"
    }
  });
};

self.addEventListener("message", async ({ data }) => {
  if (data?.type !== "RUN_NER") return;
  try {
    await runNer(data);
  } catch (error) {
    self.postMessage({ requestId: data.requestId, status: "error", error: error?.message || String(error) });
  }
});
