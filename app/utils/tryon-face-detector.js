// Face + hand tracking for the virtual try-on.
//
// Uses MediaPipe Tasks Vision (already a dependency) with the models and WASM
// bundled in /public/mediapipe. In VIDEO mode the landmarker keeps tracking the
// face between frames instead of re-detecting from scratch every time, which is
// what keeps the lip landmarks stable on slower Windows GPUs/webcams.
//
// This replaces the previous TF.js + CDN setup, which ran two separate WebGL
// runtimes (TF.js WebGL + MediaPipe Face Mesh) at the same time and fetched the
// model from a CDN on every load.

import {
  FaceLandmarker,
  HandLandmarker,
  FilesetResolver,
} from "@mediapipe/tasks-vision";

let visionPromise = null;
let faceDetectorPromise = null;
let handDetectorPromise = null;

function assetUrl(path) {
  return new URL(path, window.location.origin).href;
}

function getVision() {
  if (!visionPromise) {
    visionPromise = FilesetResolver.forVisionTasks(
      assetUrl("/mediapipe/wasm")
    ).catch((error) => {
      visionPromise = null;
      throw error;
    });
  }
  return visionPromise;
}

// Try the GPU delegate first, fall back to CPU if the browser/GPU driver
// refuses it (common on older Windows laptops and remote desktops).
async function createWithFallback(create) {
  try {
    return await create("GPU");
  } catch (gpuError) {
    console.warn("[Vibecheck] GPU delegate unavailable, using CPU.", gpuError);
    return create("CPU");
  }
}

function createFaceLandmarker(vision, runningMode) {
  return createWithFallback((delegate) =>
    FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: assetUrl("/mediapipe/face_landmarker.task"),
        delegate,
      },
      runningMode,
      numFaces: 1,
      minFaceDetectionConfidence: 0.5,
      minFacePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    })
  );
}

export function getTryOnFaceDetector() {
  if (!faceDetectorPromise) {
    faceDetectorPromise = (async () => {
      const vision = await getVision();
      const video = await createFaceLandmarker(vision, "VIDEO");

      // Photo uploads need an IMAGE-mode landmarker; create it lazily.
      let imagePromise = null;
      const getImage = () => {
        if (!imagePromise) {
          imagePromise = createFaceLandmarker(vision, "IMAGE").catch((e) => {
            imagePromise = null;
            throw e;
          });
        }
        return imagePromise;
      };

      return { video, getImage, lastVideoTimestamp: -1 };
    })().catch((error) => {
      faceDetectorPromise = null;
      console.error("[Vibecheck] Face detector initialization failed:", error);
      throw error;
    });
  }
  return faceDetectorPromise;
}

export function getTryOnHandDetector() {
  if (!handDetectorPromise) {
    handDetectorPromise = (async () => {
      const vision = await getVision();
      const landmarker = await createWithFallback((delegate) =>
        HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: assetUrl("/mediapipe/hand_landmarker.task"),
            delegate,
          },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.6,
          minHandPresenceConfidence: 0.6,
          minTrackingConfidence: 0.6,
        })
      );
      return { landmarker, lastVideoTimestamp: -1 };
    })().catch((error) => {
      handDetectorPromise = null;
      throw error;
    });
  }
  return handDetectorPromise;
}

// MediaPipe requires strictly increasing timestamps in VIDEO mode.
function nextTimestamp(holder) {
  const now = performance.now();
  holder.lastVideoTimestamp =
    now > holder.lastVideoTimestamp ? now : holder.lastVideoTimestamp + 1;
  return holder.lastVideoTimestamp;
}

function isVideo(source) {
  return typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement;
}

const toPoint = (p) => ({ x: p.x, y: p.y, z: p.z ?? 0 });

// Returns normalized (0..1, relative to the source) landmarks, or null.
export async function detectTryOnFace(detector, source) {
  if (!detector || !source) return null;

  try {
    let result;
    if (isVideo(source)) {
      if (!source.videoWidth || !source.videoHeight) return null;
      result = detector.video.detectForVideo(source, nextTimestamp(detector));
    } else {
      const imageLandmarker = await detector.getImage();
      result = imageLandmarker.detect(source);
    }

    const points = result?.faceLandmarks?.[0];
    if (!points || points.length < 468) return null;
    return points.map(toPoint);
  } catch (error) {
    console.error("[Vibecheck] Face detection failed:", error);
    throw error;
  }
}

// Returns an array of hands, each an array of normalized landmarks.
export async function detectTryOnHands(detector, source) {
  if (!detector || !source || !isVideo(source)) return [];
  if (!source.videoWidth || !source.videoHeight) return [];

  const result = detector.landmarker.detectForVideo(source, nextTimestamp(detector));
  return (result?.landmarks || []).map((hand) => hand.map(toPoint));
}
