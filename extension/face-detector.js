import { FaceDetector, FilesetResolver } from "./vendor/mediapipe/vision_bundle.mjs";

let detectorPromise = null;

const getDetector = () => {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(
        chrome.runtime.getURL("vendor/mediapipe/wasm")
      );

      return FaceDetector.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: chrome.runtime.getURL("vendor/mediapipe/blaze_face_short_range.tflite"),
          delegate: "CPU"
        },
        runningMode: "IMAGE",
        minDetectionConfidence: 0.5,
        minSuppressionThreshold: 0.3
      });
    })().catch((error) => {
      detectorPromise = null;
      throw error;
    });
  }

  return detectorPromise;
};

const cropImageRegion = (image, region, scaleX, scaleY) => {
  const sourceX = Math.max(0, Math.round(region.x * scaleX));
  const sourceY = Math.max(0, Math.round(region.y * scaleY));
  const sourceWidth = Math.min(image.naturalWidth - sourceX, Math.max(1, Math.round(region.width * scaleX)));
  const sourceHeight = Math.min(image.naturalHeight - sourceY, Math.max(1, Math.round(region.height * scaleY)));
  const canvas = document.createElement("canvas");
  canvas.width = sourceWidth;
  canvas.height = sourceHeight;
  canvas.getContext("2d", { alpha: false }).drawImage(
    image,
    sourceX,
    sourceY,
    sourceWidth,
    sourceHeight,
    0,
    0,
    sourceWidth,
    sourceHeight
  );

  return { canvas, sourceX, sourceY };
};

export const detectFaceRegions = async (image, privacyMap) => {
  const startedAt = performance.now();
  const detector = await getDetector();
  const scaleX = image.naturalWidth / privacyMap.viewport.width;
  const scaleY = image.naturalHeight / privacyMap.viewport.height;
  const faceRegions = [];

  for (const imageRegion of privacyMap.imageRegions || []) {
    const { canvas, sourceX, sourceY } = cropImageRegion(image, imageRegion, scaleX, scaleY);
    if (canvas.width < 32 || canvas.height < 32) continue;

    const result = detector.detect(canvas);
    for (const detection of result.detections || []) {
      const box = detection.boundingBox;
      if (!box) continue;

      faceRegions.push({
        type: "face",
        x: sourceX + box.originX,
        y: sourceY + box.originY,
        width: box.width,
        height: box.height,
        confidence: detection.categories?.[0]?.score ?? null
      });
    }
  }

  return {
    regions: faceRegions,
    latencyMs: Math.round(performance.now() - startedAt)
  };
};
