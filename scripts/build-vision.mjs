import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const vendorDirectory = join(projectRoot, "extension", "vendor", "transformers");
const workers = ["vision-worker", "ner-worker"];

await mkdir(vendorDirectory, { recursive: true });

const transformersRequire = createRequire(import.meta.resolve("@huggingface/transformers"));
const onnxEntry = transformersRequire.resolve("onnxruntime-web");
const onnxDist = dirname(onnxEntry);
const runtimeFiles = [
  "ort-wasm-simd-threaded.asyncify.mjs",
  "ort-wasm-simd-threaded.asyncify.wasm"
];

await Promise.all(runtimeFiles.map((file) =>
  copyFile(join(onnxDist, file), join(vendorDirectory, file))
));

await Promise.all(workers.map((worker) => build({
  entryPoints: [join(projectRoot, "extension", `${worker}.source.js`)],
  outfile: join(projectRoot, "extension", `${worker}.js`),
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  target: "chrome120",
  legalComments: "none"
})));

console.log("Built the local Florence-2 and NER workers and copied their WebAssembly runtime.");
