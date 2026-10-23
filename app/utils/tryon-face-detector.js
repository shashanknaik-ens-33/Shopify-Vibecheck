
import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-converter";
import "@tensorflow/tfjs-backend-webgl";

import * as faceLandmarks from "@tensorflow-models/face-landmarks-detection";
import * as handPose from "@tensorflow-models/hand-pose-detection";

let faceDetectorPromise = null;
let handDetectorPromise = null;

async function ensureTensorFlow() {
  await tf.ready();

  if (tf.getBackend() !== "webgl") {
    const changed = await tf.setBackend("webgl");

    if (!changed) {
      throw new Error("TensorFlow.js WebGL backend is unavailable.");
    }

    await tf.ready();
  }
}


export async function getTryOnFaceDetector() {
  if (!faceDetectorPromise) {
    faceDetectorPromise = (async () => {
      await ensureTensorFlow();

      const detector = await faceLandmarks.createDetector(
        faceLandmarks.SupportedModels.MediaPipeFaceMesh,
        {
          runtime: "mediapipe",
          maxFaces: 1,
          refineLandmarks: true,
          solutionPath:
            "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh",
        }
      );

      console.log("[Vibecheck] MediaPipe Face Mesh detector initialized.");
      return detector;
    })().catch((error) => {
      faceDetectorPromise = null;
      console.error("[Vibecheck] Face detector initialization failed:", error);
      throw error;
    });
  }

  return faceDetectorPromise;
}


export async function getTryOnHandDetector() {
  if (!handDetectorPromise) {
    handDetectorPromise = (async () => {
      await ensureTensorFlow();

      return handPose.createDetector(
        handPose.SupportedModels.MediaPipeHands,
        {
          runtime: "tfjs",
          modelType: "lite",
          maxHands: 2,
        }
      );
    })().catch((error) => {
      handDetectorPromise = null;
      throw error;
    });
  }

  return handDetectorPromise;
}


export async function detectTryOnFace(detector, source) {
  if (!detector || !source) {
    console.warn("[Vibecheck] Face detector or source is missing.");
    return null;
  }

  const width =
    source.videoWidth ||
    source.naturalWidth ||
    source.width;

  const height =
    source.videoHeight ||
    source.naturalHeight ||
    source.height;

  if (!width || !height) {
    console.warn("[Vibecheck] Camera source has no dimensions:", {
      width,
      height,
      readyState: source.readyState,
    });
    return null;
  }

  try {
    const faces = await detector.estimateFaces(source, {
      flipHorizontal: false,
    });

    if (!faces?.length) {
      console.warn("[Vibecheck] Detector returned zero faces.", {
        width,
        height,
        readyState: source.readyState,
        backend: tf.getBackend(),
      });
      return null;
    }

    const face = faces[0];
    const keypoints = face.keypoints;

    if (!keypoints || keypoints.length < 468) {
      console.warn("[Vibecheck] Unexpected landmark output:", {
        faceCount: faces.length,
        landmarkCount: keypoints?.length ?? 0,
        faceKeys: Object.keys(face),
      });
      return null;
    }

    const landmarks = keypoints.map((point) => ({
      x: point.x / width,
      y: point.y / height,
      z: point.z ?? 0,
    }));

    console.log("[Vibecheck] Face detected:", {
      landmarkCount: landmarks.length,
      width,
      height,
      backend: tf.getBackend(),
    });

    return landmarks;
  } catch (error) {
    console.error("[Vibecheck] estimateFaces failed:", error);
    throw error;
  }
}


export async function detectTryOnHands(detector, source) {
  if (!detector || !source) return [];

  const hands = await detector.estimateHands(source, {
    flipHorizontal: false,
    staticImageMode: false,
  });

  const width =
    source.videoWidth ||
    source.naturalWidth ||
    source.width;

  const height =
    source.videoHeight ||
    source.naturalHeight ||
    source.height;

  if (!width || !height) return [];

  return (hands || []).map((hand) =>
    (hand.keypoints || []).map((point) => ({
      x: point.x / width,
      y: point.y / height,
      z: point.z ?? 0,
    }))
  );
}

