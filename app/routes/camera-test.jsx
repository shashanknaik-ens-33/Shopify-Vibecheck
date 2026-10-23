import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
  getTryOnFaceDetector,
  getTryOnHandDetector,
  detectTryOnFace,
  detectTryOnHands,
} from "../utils/tryon-face-detector";

// ============================================================================
// CURATED LUXURY BEAUTY SHADES & FALLBACKS
// ============================================================================
const DEFAULT_SHADES = [
  { name: "Burgundy Wine", hex: "#6B1835", category: "Wine & Berry" },
  { name: "Classic Red", hex: "#D71940", category: "Classic Red" },
  { name: "Ruby Velvet", hex: "#9B111E", category: "Classic Red" },
  { name: "Cherry Crush", hex: "#B80F2E", category: "Classic Red" },
  { name: "Crimson Silk", hex: "#DC143C", category: "Classic Red" },
  { name: "Coral Glow", hex: "#FF6F61", category: "Coral & Peach" },
  { name: "Rose Pink", hex: "#E75480", category: "Pink" },
  { name: "Soft Blush", hex: "#E85D91", category: "Pink" },
  { name: "Berry Divine", hex: "#85244D", category: "Wine & Berry" },
  { name: "Wine Diva", hex: "#722F37", category: "Wine & Berry" },
  { name: "Mulberry Noir", hex: "#70193D", category: "Wine & Berry" },
  { name: "Plum Luxe", hex: "#673147", category: "Wine & Berry" },
  { name: "Warm Nude", hex: "#C68670", category: "Nude & Neutral" },
  { name: "Nude Rose", hex: "#B86F70", category: "Nude & Neutral" },
  { name: "Peach Nude", hex: "#D9A08C", category: "Nude & Neutral" },
  { name: "Mocha Silk", hex: "#6F4E37", category: "Nude & Neutral" },
  { name: "Terracotta", hex: "#E2725B", category: "Nude & Neutral" },
  { name: "Brick Elegance", hex: "#CB4154", category: "Classic Red" },
  { name: "Hot Fuchsia", hex: "#FF1493", category: "Pink" },
  { name: "Dusty Mauve", hex: "#B784A7", category: "Nude & Neutral" },
];

const PRESET_FINISHES = [
  { id: "matte", label: "Matte", desc: "Velvety, opaque, zero shine" },
  { id: "glossy", label: "Glossy", desc: "Plump 3D glass-like shine" },
  { id: "satin", label: "Satin", desc: "Creamy with soft natural lustre" },
  { id: "shimmer", label: "Shimmer", desc: "Micro-pearl light reflection" },
  { id: "sheer", label: "Sheer", desc: "Translucent watercolor tint" },
];

// ============================================================================
// MEDIAPIPE FACE MESH LIP LANDMARK ANATOMICAL INDICES
// ============================================================================
// Upper lip outer boundary (Cupid's bow: 61 -> 0 -> 291)
const UPPER_LIP_OUTER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291];
// Lower lip outer boundary (Vermilion border: 291 -> 17 -> 61)
const LOWER_LIP_OUTER = [291, 375, 321, 405, 314, 17, 84, 181, 91, 146, 61];

// Upper lip inner boundary (Inner upper contour: 78 -> 13 -> 308)
const UPPER_LIP_INNER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308];
// Lower lip inner boundary (Inner lower contour: 308 -> 14 -> 78)
const LOWER_LIP_INNER = [308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 78];

// Key anatomical landmark IDs:
const LM_UPPER_CENTER_OUTER = 0;
const LM_LOWER_CENTER_OUTER = 17;
const LM_UPPER_CENTER_INNER = 13;
const LM_LOWER_CENTER_INNER = 14;
const LM_CORNER_LEFT = 61;
const LM_CORNER_RIGHT = 291;

// ============================================================================
// ADAPTIVE ONE EURO FILTER (1€ FILTER) FOR JITTER-FREE, ZERO-LAG TRACKING
// ============================================================================
class LowPassFilter {
  constructor(alpha = 0) {
    this.alpha = alpha;
    this.s = null;
  }
  setAlpha(alpha) {
    this.alpha = Math.max(0, Math.min(1, alpha));
  }
  filter(value) {
    if (this.s === null) {
      this.s = value;
      return value;
    }
    this.s = this.alpha * value + (1.0 - this.alpha) * this.s;
    return this.s;
  }
  lastValue() {
    return this.s;
  }
  reset() {
    this.s = null;
  }
}

class OneEuroFilter {
  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.xFilter = new LowPassFilter();
    this.dxFilter = new LowPassFilter();
    this.lastTime = null;
  }

  alpha(cutoff, dt) {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    return 1.0 / (1.0 + tau / dt);
  }

  filter(x, timestamp) {
    if (this.lastTime === null || timestamp === undefined) {
      this.lastTime = timestamp || performance.now();
      this.xFilter.reset();
      this.dxFilter.reset();
      return this.xFilter.filter(x);
    }

    const dt = Math.max((timestamp - this.lastTime) / 1000.0, 0.001);
    this.lastTime = timestamp;

    const prevX = this.xFilter.lastValue();
    const dx = prevX !== null ? (x - prevX) / dt : 0;
    const edx = this.dxFilter.filter(dx);
    this.dxFilter.setAlpha(this.alpha(this.dCutoff, dt));

    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    this.xFilter.setAlpha(this.alpha(cutoff, dt));
    return this.xFilter.filter(x);
  }

  reset() {
    this.lastTime = null;
    this.xFilter.reset();
    this.dxFilter.reset();
  }
}

class MultiLandmarkSmoother {
  constructor() {
    this.filters = new Map();
  }

  filter(landmarks, timestamp) {
    if (!landmarks || !landmarks.length) return null;

    return landmarks.map((point, index) => {
      let f = this.filters.get(index);
      if (!f) {
        // minCutoff = 0.85 Hz: stops static sub-pixel sensor jitter completely
        // beta = 0.015: responsive tracking when head turns or mouth moves
        f = {
          x: new OneEuroFilter(1.2, 0.025, 1.0),
          y: new OneEuroFilter(1.2, 0.025, 1.0),
          z: new OneEuroFilter(1.2, 0.025, 1.0),
        };
        this.filters.set(index, f);
      }

      return {
        x: f.x.filter(point.x, timestamp),
        y: f.y.filter(point.y, timestamp),
        z: point.z !== undefined ? f.z.filter(point.z, timestamp) : 0,
      };
    });
  }

  reset() {
    this.filters.forEach((f) => {
      f.x.reset();
      f.y.reset();
      f.z.reset();
    });
    this.filters.clear();
  }
}

// ============================================================================
// COLOR & BLEND UTILITIES
// ============================================================================
function hexToRgb(hex) {
  const value = String(hex || "").replace("#", "");
  return {
    r: parseInt(value.slice(0, 2) || "D7", 16),
    g: parseInt(value.slice(2, 4) || "19", 16),
    b: parseInt(value.slice(4, 6) || "40", 16),
  };
}

function rgbToHex(r, g, b) {
  return (
    "#" +
    [r, g, b]
      .map((x) =>
        Math.max(0, Math.min(255, Math.round(x)))
          .toString(16)
          .padStart(2, "0")
      )
      .join("")
  );
}

function resolveShadeColor(label, fallbackHex) {
  const val = String(label || "").toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(val)) return val;
  const hexMatch = val.match(/#[0-9a-f]{6}/i);
  if (hexMatch) return hexMatch[0];

  if (/\b(oxblood|merlot|cabernet|black cherry)\b/.test(val)) return "#4A0404";
  if (/\b(burgundy|bordeaux|wine)\b/.test(val)) return "#6B1835";
  if (/\b(ruby|scarlet|crimson|cherry)\b/.test(val)) return "#9B111E";
  if (/\b(brick|terracotta|burnt)\b/.test(val)) return "#CB4154";
  if (/\b(red|classic red|chili)\b/.test(val)) return "#D71940";
  if (/\b(plum|mulberry|dark berry)\b/.test(val)) return "#70193D";
  if (/\b(berry|boysenberry)\b/.test(val)) return "#85244D";
  if (/\b(hot pink|fuchsia|magenta)\b/.test(val)) return "#FF1493";
  if (/\b(dusty rose|rosewood)\b/.test(val)) return "#C08081";
  if (/\b(mauve|lilac|grape)\b/.test(val)) return "#B784A7";
  if (/\b(rose|blush|soft pink)\b/.test(val)) return "#E75480";
  if (/\b(pink|baby pink)\b/.test(val)) return "#E85D91";
  if (/\b(coral|peach)\b/.test(val)) return "#FF6F61";
  if (/\b(nude rose|rosy nude)\b/.test(val)) return "#B86F70";
  if (/\b(peach nude|apricot)\b/.test(val)) return "#D9A08C";
  if (/\b(warm nude|honey|nude)\b/.test(val)) return "#C68670";
  if (/\b(caramel|toffee)\b/.test(val)) return "#A56B46";
  if (/\b(mocha|coffee)\b/.test(val)) return "#6F4E37";
  if (/\b(chocolate|espresso|brown)\b/.test(val)) return "#5C3317";
  if (/\b(brown sugar|cinnamon)\b/.test(val)) return "#8D5524";
  if (/\b(orange|tangerine)\b/.test(val)) return "#FF4500";
  if (/\b(purple|violet)\b/.test(val)) return "#673AB7";

  return fallbackHex || "#6B1835";
}

// Build smooth curved Path2D from landmarks array and indices
function createSmoothPolygonPath(landmarks, indices, width, height) {
  if (!landmarks || !indices || indices.length < 3) return null;

  const points = indices.map((idx) => {
    const lm = landmarks[idx];
    return {
      x: lm ? lm.x * width : 0,
      y: lm ? lm.y * height : 0,
    };
  });

  const path = new Path2D();
  const len = points.length;
  const startMid = {
    x: (points[len - 1].x + points[0].x) / 2,
    y: (points[len - 1].y + points[0].y) / 2,
  };

  path.moveTo(startMid.x, startMid.y);

  for (let i = 0; i < len; i++) {
    const curr = points[i];
    const next = points[(i + 1) % len];
    const midX = (curr.x + next.x) / 2;
    const midY = (curr.y + next.y) / 2;
    path.quadraticCurveTo(curr.x, curr.y, midX, midY);
  }

  path.closePath();
  return path;
}

// Build outer full lip loop: Upper Outer + Lower Outer
function createFullOuterLipPath(landmarks, width, height) {
  const outerIndices = [
    61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291,
    375, 321, 405, 314, 17, 84, 181, 91, 146,
  ];
  return createSmoothPolygonPath(landmarks, outerIndices, width, height);
}

// Build inner mouth loop: Upper Inner + Lower Inner
function createFullInnerLipPath(landmarks, width, height) {
  const innerIndices = [
    78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308,
    324, 318, 402, 317, 14, 87, 178, 88, 95,
  ];
  return createSmoothPolygonPath(landmarks, innerIndices, width, height);
}

// ============================================================================
// ADVANCED COSMETIC MAKEUP RENDERER (FEATHERED & MULTI-FINISH)
// ============================================================================
function drawLipstickEnhanced(
  ctx,
  landmarks,
  width,
  height,
  color,
  finish = "matte",
  intensity = 0.75
) {
  if (!ctx || !landmarks || landmarks.length < 468) return;

  const pTopOuter = landmarks[LM_UPPER_CENTER_OUTER];
  const pBottomOuter = landmarks[LM_LOWER_CENTER_OUTER];
  const pTopInner = landmarks[LM_UPPER_CENTER_INNER];
  const pBottomInner = landmarks[LM_LOWER_CENTER_INNER];
  const pLeftCorner = landmarks[LM_CORNER_LEFT];
  const pRightCorner = landmarks[LM_CORNER_RIGHT];

  if (!pTopOuter || !pBottomOuter || !pTopInner || !pBottomInner) return;

  const outerPath = createFullOuterLipPath(landmarks, width, height);
  if (!outerPath) return;

  // Compute mouth opening geometry
  const innerGapY = Math.abs(pBottomInner.y - pTopInner.y) * height;
  const totalLipHeight = Math.abs(pBottomOuter.y - pTopOuter.y) * height;
  const mouthOpen = innerGapY > 3.5 && innerGapY / Math.max(totalLipHeight, 1) > 0.12;

  const innerPath = mouthOpen
    ? createFullInnerLipPath(landmarks, width, height)
    : null;

  const rgb = hexToRgb(color);
  const colorStr = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;

  ctx.save();

  // Create clipping mask: Outer lips minus Inner lips (protects teeth)
  const clipMask = new Path2D();
  clipMask.addPath(outerPath);
  if (innerPath) {
    clipMask.addPath(innerPath);
    ctx.clip(clipMask, "evenodd");
  } else {
    ctx.clip(clipMask);
  }

  // --- LAYER 1: Base Dye & Crease-preserving Pigment (Multiply) ---
  const baseAlpha =
    finish === "sheer"
      ? 0.38 * intensity
      : finish === "glossy"
      ? 0.52 * intensity
      : 0.62 * intensity;

  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = baseAlpha;
  ctx.fillStyle = colorStr;
  ctx.fillRect(0, 0, width, height);

  // --- LAYER 2: Vibrant Tone Layer (Soft-Light or Source-Atop) ---
  const toneAlpha =
    finish === "matte"
      ? 0.42 * intensity
      : finish === "glossy"
      ? 0.30 * intensity
      : finish === "satin"
      ? 0.38 * intensity
      : finish === "shimmer"
      ? 0.36 * intensity
      : 0.18 * intensity;

  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = toneAlpha;
  ctx.fillStyle = colorStr;
  ctx.fillRect(0, 0, width, height);

  // --- LAYER 3: Finish-Specific Highlights & Texture ---
  const lowerCenterX =
  ((pBottomOuter.x + pBottomInner.x) / 2) * width;

const lowerCenterY =
  ((pBottomOuter.y + pBottomInner.y) / 2) * height;
  const lipWidthPx = Math.abs((pRightCorner?.x || 1) - (pLeftCorner?.x || 0)) * width;

  if (finish === "glossy") {
    // 3D Glass Plump Specular Sheen on lower lip
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.48 * intensity;

    const glossRadiusX = Math.max(lipWidthPx * 0.22, 10);
    const glossRadiusY = Math.max(totalLipHeight * 0.28, 4);

    const grad = ctx.createRadialGradient(
      lowerCenterX,
      lowerCenterY,
      1,
      lowerCenterX,
      lowerCenterY,
      glossRadiusX
    );
    grad.addColorStop(0, "rgba(255, 255, 255, 0.75)");
    grad.addColorStop(0.5, "rgba(255, 255, 255, 0.25)");
    grad.addColorStop(1, "rgba(255, 255, 255, 0)");

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(
      lowerCenterX,
      lowerCenterY + 1,
      glossRadiusX,
      glossRadiusY,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // Subtle Cupid's Bow specular sheen
    const cupidX = pTopOuter.x * width;
    const cupidY = pTopOuter.y * height;
    const cupidGrad = ctx.createRadialGradient(
      cupidX,
      cupidY,
      0.5,
      cupidX,
      cupidY,
      glossRadiusX * 0.5
    );
    cupidGrad.addColorStop(0, "rgba(255, 255, 255, 0.55)");
    cupidGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = cupidGrad;
    ctx.beginPath();
    ctx.arc(cupidX, cupidY, glossRadiusX * 0.4, 0, Math.PI * 2);
    ctx.fill();
  } else if (finish === "satin") {
    // Elegant soft-focus creamy lustre
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.20 * intensity;
    const grad = ctx.createRadialGradient(
      lowerCenterX,
      lowerCenterY,
      2,
      lowerCenterX,
      lowerCenterY,
      lipWidthPx * 0.3
    );
    grad.addColorStop(0, "rgba(255, 255, 255, 0.5)");
    grad.addColorStop(1, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(
      lowerCenterX,
      lowerCenterY,
      lipWidthPx * 0.28,
      totalLipHeight * 0.25,
      0,
      0,
      Math.PI * 2
    );
    ctx.fill();
  } else if (finish === "shimmer") {
    // Micro-pearl shimmering reflection
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.35 * intensity;
    const numSparkles = 14;
    for (let i = 0; i < numSparkles; i++) {
      const offsetX = ((i - numSparkles / 2) / (numSparkles / 2)) * (lipWidthPx * 0.3);
      const offsetY = Math.sin(i * 1.8) * (totalLipHeight * 0.15);
      const radius = 1.0 + (i % 3) * 0.8;
      ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
      ctx.beginPath();
      ctx.arc(lowerCenterX + offsetX, lowerCenterY + offsetY, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --- LAYER 4: Soft-edge Feathering around vermilion border ---
  ctx.restore(); // Exit clip

  // Subtle feathered perimeter stroke to avoid sharp vector edges
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 0.16 * intensity;
  ctx.strokeStyle = colorStr;
  ctx.lineWidth = 1.6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(outerPath);
  ctx.restore();
}

// Camera aspect ratio and zoom sub-rectangle calculation
function getCameraCrop(video, canvas, zoom = 1.15) {
  const sourceWidth = video.videoWidth || 640;
  const sourceHeight = video.videoHeight || 480;
  const targetAspect = (canvas.width || 640) / (canvas.height || 480);

  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;

  if (sourceWidth / sourceHeight > targetAspect) {
    cropWidth = sourceHeight * targetAspect;
  } else {
    cropHeight = sourceWidth / targetAspect;
  }

  const safeZoom = Math.max(1.0, zoom);
  cropWidth /= safeZoom;
  cropHeight /= safeZoom;

  return {
    sx: Math.max(0, (sourceWidth - cropWidth) / 2),
    sy: Math.max(0, (sourceHeight - cropHeight) / 2),
    sw: cropWidth,
    sh: cropHeight,
  };
}

function cropLandmarks(landmarks, crop, video) {
  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  return landmarks.map((point) => ({
    ...point,
    x: (point.x * vw - crop.sx) / crop.sw,
    y: (point.y * vh - crop.sy) / crop.sh,
  }));
}



function isHandCoveringMouth(faceLandmarks, hands) {
  if (!faceLandmarks || !hands?.length) return false;

  // Use the actual lip corners and inner lip landmarks.
  const lipPoints = [61, 291, 13, 14]
    .map((index) => faceLandmarks[index])
    .filter(Boolean);

  if (lipPoints.length !== 4) return false;

  const xs = lipPoints.map((p) => p.x);
  const ys = lipPoints.map((p) => p.y);

  const lipWidth = Math.max(...xs) - Math.min(...xs);
  const lipHeight = Math.max(...ys) - Math.min(...ys);

  // Expand the mouth region to account for hands covering the lips
  // before all fingertips or palm landmarks reach the lip boundary.
  const padX = Math.max(lipWidth * 0.8, 0.025);
  const padY = Math.max(lipHeight * 2.5, 0.035);

  const left = Math.min(...xs) - padX;
  const right = Math.max(...xs) + padX;
  const top = Math.min(...ys) - padY;
  const bottom = Math.max(...ys) + padY;

  return hands.some((hand) => {
    if (!hand || hand.length < 10) return false;

    const xs = hand.map((p) => p.x);
    const ys = hand.map((p) => p.y);

    const handLeft = Math.min(...xs);
    const handRight = Math.max(...xs);
    const handTop = Math.min(...ys);
    const handBottom = Math.max(...ys);

    const overlapWidth = Math.max(
      0,
      Math.min(right, handRight) - Math.max(left, handLeft)
    );

    const overlapHeight = Math.max(
      0,
      Math.min(bottom, handBottom) - Math.max(top, handTop)
    );

    // Require meaningful overlap in both dimensions.
    return (
      overlapWidth / Math.max(right - left, 0.001) >= 0.25 &&
      overlapHeight / Math.max(bottom - top, 0.001) >= 0.2
    );
  });
}



// ============================================================================
// MAIN VIRTUAL TRY-ON COMPONENT
// ============================================================================
export default function CameraTest() {
  const [searchParams] = useSearchParams();
  const embedded = searchParams.get("embed") === "1";

  const initialProductId = searchParams.get("id") || "";
  const initialProductTitle = searchParams.get("title") || "Virtual Try-On";
  const initialProductHandle = searchParams.get("handle") || "";
  const initialProductImage = searchParams.get("image") || "";
  const initialShade = searchParams.get("shade") || "";

  let parsedUrlVariants = [];
  try {
    parsedUrlVariants = JSON.parse(searchParams.get("variants") || "[]");
    if (!Array.isArray(parsedUrlVariants)) parsedUrlVariants = [];
  } catch {
    parsedUrlVariants = [];
  }

  const [currentProduct, setCurrentProduct] = useState({
    id: initialProductId,
    title: initialProductTitle,
    handle: initialProductHandle,
    image: initialProductImage,
  });

  const [catalog, setCatalog] = useState([]);
  const [productVariants, setProductVariants] = useState(parsedUrlVariants);
  const [activeVariantId, setActiveVariantId] = useState(
    parsedUrlVariants[0]?.id || ""
  );

  // Experience Settings
  const [activeTab, setActiveTab] = useState("shades");
  const [zoom, setZoom] = useState(1.15);
  const zoomRef = useRef(1.15);
  const [facingMode, setFacingMode] = useState("user");
  const facingModeRef = useRef("user");
  const [splitMode, setSplitMode] = useState(false);
  const splitModeRef = useRef(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const splitRatioRef = useRef(0.5);
  const [finish, setFinish] = useState("matte");
  const finishRef = useRef("matte");
  const [intensity, setIntensity] = useState(0.78);
  const intensityRef = useRef(0.78);
  const [lightingBoost, setLightingBoost] = useState(false);
  const lightingBoostRef = useRef(false);

  // Shade state
  const initialColor = resolveShadeColor(
    initialShade || initialProductTitle,
    "#6B1835"
  );
  const shadeRef = useRef(initialColor);
  const [shade, setShade] = useState(initialColor);
  const [hexInput, setHexInput] = useState(initialColor);
  const [customHex, setCustomHex] = useState(initialColor);

  // Camera & Tracking State
  const [status, setStatus] = useState("Initializing camera...");
  const [cameraReady, setCameraReady] = useState(false);
  const [isFaceDetected, setIsFaceDetected] = useState(false);
  const [fps, setFps] = useState(60);
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoMode, setPhotoMode] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  // References
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const uploadCanvasRef = useRef(null);
  const uploadImageRef = useRef(null);
  const fileInputRef = useRef(null);

  const landmarkerRef = useRef(null);
  const handLandmarkerRef = useRef(null);
  const imageLandmarkerRef = useRef(null);
  const smootherRef = useRef(new MultiLandmarkSmoother());
  const activeLandmarksRef = useRef(null);
  const mouthOccludedRef = useRef(false);
  const isInferringRef = useRef(false);
  const lastFaceTimestampRef = useRef(-1);
const lastHandTimestampRef = useRef(-1);
const lastConfirmedOcclusionRef = useRef(0);
  // Flicker-proofing: inference writes the target, the render loop eases the
  // displayed landmarks toward it and fades the lipstick in/out.
  const targetLandmarksRef = useRef(null);
  const displayLandmarksRef = useRef(null);
  const visibilityRef = useRef(0);
  const streamRef = useRef(null);
  const animationRef = useRef(null);
  const runningRef = useRef(false);
  const startingRef = useRef(false);
  const uploadRequestRef = useRef(0);
  const isDraggingSplitRef = useRef(false);
  const frameCounterRef = useRef({ count: 0, lastTime: performance.now() });

  const colorCacheRef = useRef({});

  // Sync state refs for rendering loop
  const applyShade = useCallback((color) => {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return;
    shadeRef.current = color;
    setShade(color);
    setHexInput(color.toUpperCase());
    setCustomHex(color.toUpperCase());
  }, []);

  const handleFinishChange = (newFinish) => {
    finishRef.current = newFinish;
    setFinish(newFinish);
  };

  const handleIntensityChange = (val) => {
    const num = parseFloat(val);
    intensityRef.current = num;
    setIntensity(num);
  };

  // Compute robust list of lipstick shades
  const availableShades = (() => {
    const list = [];
    const seen = new Set();

    (productVariants || []).forEach((v) => {
      const title =
        v.title && v.title !== "Default Title"
          ? v.title
          : currentProduct.title || "Shade";
      const key = String(v.id || title);
      if (!seen.has(key)) {
        seen.add(key);
        const resolved =
          v.swatch && /^#[0-9a-f]{6}$/i.test(v.swatch)
            ? v.swatch
            : resolveShadeColor(
                [v.title, currentProduct.title, ...(v.options || [])].join(" "),
                "#6B1835"
              );
        list.push({
          id: v.id || key,
          name: title,
          hex: resolved,
          image: v.image || currentProduct.image || "",
          productHandle: currentProduct.handle,
        });
      }
    });

    if (list.length < 5 && catalog.length > 0) {
      catalog.forEach((p) => {
        const pVariants =
          p.variants && p.variants.length
            ? p.variants
            : [{ id: p.id, title: p.title, image: p.image }];
        pVariants.forEach((v) => {
          const title =
            v.title && v.title !== "Default Title" && v.title !== p.title
              ? `${p.title} - ${v.title}`
              : p.title;
          const key = String(v.id || p.id);
          if (!seen.has(key)) {
            seen.add(key);
            const resolved =
              v.swatch && /^#[0-9a-f]{6}$/i.test(v.swatch)
                ? v.swatch
                : resolveShadeColor(
                    [v.title, p.title, ...(v.options || [])].join(" "),
                    "#B80F2E"
                  );
            list.push({
              id: v.id || p.id,
              name: title,
              hex: resolved,
              image: v.image || p.image || "",
              productHandle: p.handle,
            });
          }
        });
      });
    }

    if (list.length === 0) {
      DEFAULT_SHADES.forEach((s, idx) => {
        list.push({
          id: `default-${idx}`,
          name: s.name,
          hex: s.hex,
          image: currentProduct.image || "",
          productHandle: currentProduct.handle,
        });
      });
    }

    return list;
  })();

  // Receive dynamic data from parent storefront window
  useEffect(() => {
    function handleMessage(event) {
      if (!event.data || typeof event.data !== "object") return;

      if (event.data.type === "VIBECHECK_DATA") {
        const { product, catalog: incomingCatalog } = event.data;
        if (product) {
          setCurrentProduct({
            id: product.id || "",
            title: product.title || "Virtual Try-On",
            handle: product.handle || "",
            image: product.image || "",
          });
          if (Array.isArray(product.variants) && product.variants.length) {
            setProductVariants(product.variants);
            const first = product.variants[0];
            setActiveVariantId(product.variantId || first.id);
            const firstColor = resolveShadeColor(
              product.shade ||
                [first.title, product.title, ...(first.options || [])].join(" "),
              "#6B1835"
            );
            applyShade(firstColor);
          }
        }
        if (Array.isArray(incomingCatalog) && incomingCatalog.length) {
          setCatalog(incomingCatalog);
        }
      }
    }

    window.addEventListener("message", handleMessage);
    window.parent?.postMessage({ type: "VIBECHECK_READY" }, "*");

    return () => window.removeEventListener("message", handleMessage);
  }, [applyShade]);

  // Color extraction from product images
  useEffect(() => {
    availableShades.forEach((item) => {
      if (!item.image || colorCacheRef.current[item.image]) return;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          c.width = 40;
          c.height = 40;
          const ctx = c.getContext("2d");
          if (!ctx) return;
          ctx.drawImage(img, 0, 0, 40, 40);
          const data = ctx.getImageData(0, 0, 40, 40).data;
          let bestHex = null;
          let maxChroma = 0;
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i],
              g = data[i + 1],
              b = data[i + 2],
              a = data[i + 3];
            if (a < 120) continue;
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const sat = max === 0 ? 0 : (max - min) / max;
            const lum = max / 255;
            if (lum > 0.94 && sat < 0.12) continue;
            if (lum < 0.08) continue;
            if (r > g && r > 65) {
              const score = sat * 0.7 + (r / 255) * 0.3;
              if (score > maxChroma) {
                maxChroma = score;
                bestHex = rgbToHex(r, g, b);
              }
            }
          }
          if (bestHex) {
            colorCacheRef.current[item.image] = bestHex;
          }
        } catch {
          // ignore CORS
        }
      };
      img.src = item.image;
    });
  }, [availableShades]);

  const stopCamera = useCallback(() => {
    runningRef.current = false;
    startingRef.current = false;

    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }

    landmarkerRef.current = null;
    handLandmarkerRef.current = null;
    smootherRef.current.reset();
    activeLandmarksRef.current = null;
    targetLandmarksRef.current = null;
    displayLandmarksRef.current = null;
    visibilityRef.current = 0;
    lastFaceTimestampRef.current = -1;
    mouthOccludedRef.current = false;

    setCameraReady(false);
    setIsFaceDetected(false);
  }, []);

  // Initialize MediaPipe vision tasks in background with GPU delegate
  

const initVisionTasks = useCallback(async () => {
  try {
    if (!landmarkerRef.current) {
      landmarkerRef.current = await getTryOnFaceDetector();
    }

    if (!handLandmarkerRef.current) {
      try {
        handLandmarkerRef.current = await getTryOnHandDetector();
      } catch (handError) {
        console.warn(
          "Hand detector unavailable; occlusion detection is disabled.",
          handError
        );
      }
    }

    setStatus("Ready! Smooth tracking active.");
  } catch (error) {
    console.error("TensorFlow.js detector initialization failed:", error);
    setStatus("Could not initialize face tracking. Please refresh and try again.");
  }
}, []);


  // START HIGH-PERFORMANCE DECOUPLED CAMERA & RENDER PIPELINE
  const startCamera = useCallback(
    async (mode = facingModeRef.current) => {
      if (startingRef.current || runningRef.current) return;
      startingRef.current = true;
      setStatus("Starting ultra-smooth camera...");

      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("Camera API is unavailable in this browser.");
        }

        // Request fluid 60fps video stream with ideal resolution
        let stream = null;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: mode ? { ideal: mode } : "user",
              width: { ideal: 1280, min: 640 },
              height: { ideal: 720, min: 480 },
              frameRate: { ideal: 30 },
            },
            audio: false,
          });
        } catch (err1) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: {
                facingMode: mode || "user",
                frameRate: { ideal: 30 },
              },
              audio: false,
            });
          } catch (err2) {
            stream = await navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            });
          }
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) throw new Error("Video element is not ready.");

        video.muted = true;
        video.playsInline = true;
        video.setAttribute("playsinline", "true");
        video.setAttribute("muted", "true");
        video.setAttribute("autoplay", "true");
        video.srcObject = stream;

        try {
          await video.play();
        } catch (playErr) {
          console.warn("video.play() autoplay note:", playErr);
        }

        if (streamRef.current !== stream || video.srcObject !== stream) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        runningRef.current = true;
        startingRef.current = false;
        setCameraReady(true);
        setStatus("Ready! Smooth tracking active.");

        // Initialize vision tasks in background without halting the camera
        initVisionTasks();

        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d", { alpha: false });
        if (!canvas || !ctx) {
          throw new Error("Could not initialize the preview canvas.");
        }

        smootherRef.current.reset();

        // --------------------------------------------------------------------
        // DECOUPLED INFERENCE WORKER LOOP (Never blocks the 60fps render loop!)
        // --------------------------------------------------------------------
        const FACE_HOLD_MS = 450; // keep the lipstick through brief tracking misses
        let lastInferenceTime = 0;
        let minInferenceInterval = 33;
        let lastVideoTime = -1;
        let handStep = 0;
        let lastHandsRaw = [];
        let coveredStreak = 0;
        let clearStreak = 0;

        const runInferenceStep = async (now) => {
          if (
            isInferringRef.current ||
            !landmarkerRef.current ||
            !video ||
            video.readyState < 2
          ) {
            return;
          }

          // Only run when the camera produced a new frame, and never faster
          // than this machine can keep up with.
          if (video.currentTime === lastVideoTime) return;
          if (now - lastInferenceTime < minInferenceInterval) return;

          lastVideoTime = video.currentTime;
          lastInferenceTime = now;
          isInferringRef.current = true;
          const startedAt = performance.now();

          try {
            const face = await detectTryOnFace(landmarkerRef.current, video);
            if (!runningRef.current) return;

            if (!face) {
              // Do NOT clear anything here. The render loop keeps drawing the
              // last good landmarks for FACE_HOLD_MS and then fades out.
              if (performance.now() - lastFaceTimestampRef.current > FACE_HOLD_MS) {
                setIsFaceDetected(false);
              }
              return;
            }

            const crop = getCameraCrop(video, canvas, zoomRef.current);
            const cropped = cropLandmarks(face, crop, video);

            // ---- Hand-over-mouth detection (every 2nd step, with hysteresis) ----
            if (handLandmarkerRef.current) {
              handStep += 1;
              if (handStep % 2 === 0) {
                lastHandsRaw = await detectTryOnHands(
                  handLandmarkerRef.current,
                  video
                );
                if (!runningRef.current) return;

                const croppedHands = lastHandsRaw.map((hand) =>
                  hand.map((point) => ({
                    ...point,
                    x: (point.x * video.videoWidth - crop.sx) / crop.sw,
                    y: (point.y * video.videoHeight - crop.sy) / crop.sh,
                  }))
                );

                if (isHandCoveringMouth(cropped, croppedHands)) {
                  coveredStreak += 1;
                  clearStreak = 0;
                  // One noisy frame must not hide the lipstick.
                  if (coveredStreak >= 2) {
                    mouthOccludedRef.current = true;
                    lastConfirmedOcclusionRef.current = performance.now();
                  }
                } else {
                  coveredStreak = 0;
                  if (mouthOccludedRef.current) {
                    clearStreak += 1;
                    if (
                      clearStreak >= 3 &&
                      performance.now() - lastConfirmedOcclusionRef.current > 250
                    ) {
                      mouthOccludedRef.current = false;
                      clearStreak = 0;
                    }
                  }
                }
              }
            } else {
              mouthOccludedRef.current = false;
            }

            // ---- Smooth + publish the new target ----
            const wasLost =
              !targetLandmarksRef.current ||
              performance.now() - lastFaceTimestampRef.current > FACE_HOLD_MS;
            if (wasLost) smootherRef.current.reset();

            const smoothed = smootherRef.current.filter(cropped, now);
            targetLandmarksRef.current = smoothed;
            if (wasLost || !displayLandmarksRef.current) {
              // Snap (don't glide) when the face is re-acquired.
              displayLandmarksRef.current = smoothed.map((p) => ({ ...p }));
            }
            lastFaceTimestampRef.current = performance.now();
            setIsFaceDetected(true);
          } catch (error) {
            console.warn("Try-on inference skipped:", error);
          } finally {
            const took = performance.now() - startedAt;
            // Adapt to slower machines instead of flooding them.
            minInferenceInterval = Math.min(100, Math.max(33, took * 1.5));
            isInferringRef.current = false;
          }
        };

        let lastRenderTime = performance.now();

        // --------------------------------------------------------------------
        // PRIMARY RENDER LOOP (Native 60 FPS RequestAnimationFrame)
        // --------------------------------------------------------------------
        let lastFrameTime = performance.now();
        let frameCount = 0;

        const renderFrame = (now) => {
          if (!runningRef.current) return;

          // FPS Calculation
          frameCount++;
          if (now - frameCounterRef.current.lastTime >= 1000) {
            setFps(Math.round((frameCount * 1000) / (now - frameCounterRef.current.lastTime)));
            frameCount = 0;
            frameCounterRef.current.lastTime = now;
          }

          if (video.readyState >= 2) {
            const vw = video.videoWidth;
            const vh = video.videoHeight;

            if (vw && vh) {
              if (canvas.width !== vw || canvas.height !== vh) {
                canvas.width = vw;
                canvas.height = vh;
              }

              const currentZoom = zoomRef.current;
              const crop = getCameraCrop(video, canvas, currentZoom);

              // 1. Draw raw live video frame smoothly
              ctx.save();
              if (lightingBoostRef.current) {
                ctx.filter = "brightness(1.08) contrast(1.04) saturate(1.03)";
              }

              ctx.drawImage(
                video,
                crop.sx,
                crop.sy,
                crop.sw,
                crop.sh,
                0,
                0,
                vw,
                vh
              );
              ctx.restore();

              // 2. Ease displayed landmarks toward the latest tracked ones and
              //    fade the lipstick in/out so tracking blips never pop.
              const dtMs = Math.min(100, Math.max(1, now - lastRenderTime));
              lastRenderTime = now;

              const target = targetLandmarksRef.current;
              const faceFresh =
                !!target &&
                performance.now() - lastFaceTimestampRef.current < FACE_HOLD_MS;
              const wantVisible = faceFresh && !mouthOccludedRef.current;
              visibilityRef.current = wantVisible
                ? Math.min(1, visibilityRef.current + dtMs / 90)
                : Math.max(0, visibilityRef.current - dtMs / 160);

              let disp = displayLandmarksRef.current;
              if (target) {
                if (!disp || disp.length !== target.length) {
                  disp = target.map((p) => ({ ...p }));
                } else {
                  const k = 1 - Math.exp(-dtMs / 35);
                  for (let i = 0; i < target.length; i++) {
                    disp[i].x += (target[i].x - disp[i].x) * k;
                    disp[i].y += (target[i].y - disp[i].y) * k;
                    disp[i].z += (target[i].z - disp[i].z) * k;
                  }
                }
                displayLandmarksRef.current = disp;
              }

              // 3. Render lipstick overlay
              const smoothed = displayLandmarksRef.current;
              const visibility = visibilityRef.current;
              if (smoothed && visibility > 0.01) {
                const isSplit = splitModeRef.current;
                const ratio = splitRatioRef.current;
                const currentColor = shadeRef.current;
                const currentFinish = finishRef.current;
                const currentIntensity = intensityRef.current * visibility;

                if (isSplit) {
                  // BEFORE / AFTER SPLIT VIEW
                  ctx.save();
                  ctx.beginPath();
                  ctx.rect(vw * ratio, 0, vw * (1 - ratio), vh);
                  ctx.clip();

                  drawLipstickEnhanced(
                    ctx,
                    smoothed,
                    vw,
                    vh,
                    currentColor,
                    currentFinish,
                    currentIntensity
                  );
                  ctx.restore();

                  // Vertical divider line
                  ctx.save();
                  ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
                  ctx.lineWidth = 3;
                  ctx.beginPath();
                  ctx.moveTo(vw * ratio, 0);
                  ctx.lineTo(vw * ratio, vh);
                  ctx.stroke();

                  // Center slider draggable handle
                  const midY = vh / 2;
                  ctx.fillStyle = "#ffffff";
                  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
                  ctx.shadowBlur = 10;
                  ctx.beginPath();
                  ctx.arc(vw * ratio, midY, 17, 0, Math.PI * 2);
                  ctx.fill();
                  ctx.shadowBlur = 0;

                  ctx.fillStyle = "#111111";
                  ctx.font = "bold 13px sans-serif";
                  ctx.textAlign = "center";
                  ctx.textBaseline = "middle";
                  ctx.fillText("⇄", vw * ratio, midY);

                  // Floating Badges: Original & Try-on
                  ctx.fillStyle = "rgba(10, 10, 12, 0.72)";
                  ctx.beginPath();
                  ctx.roundRect(16, 18, 76, 26, 7);
                  ctx.fill();
                  ctx.fillStyle = "#ffffff";
                  ctx.font = "600 10.5px sans-serif";
                  ctx.textAlign = "center";
                  ctx.textBaseline = "middle";
                  ctx.fillText("ORIGINAL", 54, 31);

                  ctx.fillStyle = "rgba(10, 10, 12, 0.72)";
                  ctx.beginPath();
                  ctx.roundRect(vw - 92, 18, 76, 26, 7);
                  ctx.fill();
                  ctx.fillStyle = "#ffffff";
                  ctx.fillText("TRY-ON", vw - 54, 31);
                  ctx.restore();
                } else {
                  // FULL TRY-ON VIEW
                  drawLipstickEnhanced(
                    ctx,
                    smoothed,
                    vw,
                    vh,
                    currentColor,
                    currentFinish,
                    currentIntensity
                  );
                }
              }
            }
          }

          // Inference runs after this frame has been painted.
          runInferenceStep(now);

          animationRef.current = requestAnimationFrame(renderFrame);
        };

        animationRef.current = requestAnimationFrame(renderFrame);
      } catch (error) {
        console.error("Camera startup error:", error);
        stopCamera();
        setStatus(
          error?.name === "NotAllowedError"
            ? "Camera permission denied. Click below to allow camera or upload a photo."
            : `Camera unavailable: ${error.message || "Please check permissions"}`
        );
      }
    },
    [stopCamera, initVisionTasks]
  );

  useEffect(() => {
    startCamera();
    return () => {
      runningRef.current = false;
      startingRef.current = false;
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      landmarkerRef.current = null;
      smootherRef.current.reset();
      activeLandmarksRef.current = null;
      uploadRequestRef.current += 1;
      imageLandmarkerRef.current = null;
    };
  }, [startCamera]);

  // PHOTO UPLOAD PROCESSING
  
const renderUploadedPhoto = useCallback(async (image) => {
  const requestId = ++uploadRequestRef.current;

  try {
    if (!image.complete || !image.naturalWidth || !image.naturalHeight) {
      return;
    }

    setStatus("Detecting lips in photo...");

    const detector = await getTryOnFaceDetector();

    if (requestId !== uploadRequestRef.current) return;

    const face = await detectTryOnFace(detector, image);

    if (requestId !== uploadRequestRef.current) return;

    const canvas = uploadCanvasRef.current;
    if (!canvas) return;

    const scale = Math.min(
      1,
      1400 / Math.max(image.naturalWidth, image.naturalHeight)
    );

    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    if (!face || face.length < 468) {
      setPhotoUrl(canvas.toDataURL("image/jpeg", 0.94));
      setStatus("No face detected in photo. Try another front-facing selfie.");
      return;
    }

    // The helper returns normalized landmarks, matching the existing renderer.
    drawLipstickEnhanced(
      ctx,
      face,
      canvas.width,
      canvas.height,
      shadeRef.current,
      finishRef.current,
      intensityRef.current
    );

    if (requestId !== uploadRequestRef.current) return;

    setPhotoUrl(canvas.toDataURL("image/jpeg", 0.94));
    setStatus("Shade applied! Select colors or finishes to preview.");
  } catch (error) {
    console.error("Photo rendering error:", error);

    if (requestId === uploadRequestRef.current) {
      setStatus("Could not process photo. Please choose another.");
    }
  }
}, []);


  useEffect(() => {
    if (photoMode && uploadImageRef.current) {
      renderUploadedPhoto(uploadImageRef.current);
    }
  }, [photoMode, shade, finish, intensity, renderUploadedPhoto]);

  // CONTROLS & EVENT HANDLERS
  const toggleFullscreen = () => {
    const root = containerRef.current || document.documentElement;
    if (!document.fullscreenElement) {
      if (root.requestFullscreen) root.requestFullscreen();
      else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
    } else {
      if (document.exitFullscreen) document.exitFullscreen();
    }
  };

  const toggleFlipCamera = () => {
    const nextMode = facingModeRef.current === "user" ? "environment" : "user";
    facingModeRef.current = nextMode;
    setFacingMode(nextMode);
    stopCamera();
    startCamera(nextMode);
  };

  const handleZoomToggle = () => {
    setZoom((prev) => {
      const next = prev === 1.0 ? 1.25 : prev === 1.25 ? 1.55 : 1.0;
      zoomRef.current = next;
      return next;
    });
  };

  const toggleLightingBoost = () => {
    setLightingBoost((prev) => {
      const next = !prev;
      lightingBoostRef.current = next;
      return next;
    });
  };

  const toggleSplitMode = () => {
    setSplitMode((prev) => {
      const next = !prev;
      splitModeRef.current = next;
      return next;
    });
  };

  const handleDownloadSnapshot = () => {
    let downloadData = photoUrl;
    if (!photoMode) {
      const canvas = canvasRef.current;
      if (!canvas || !canvas.width) return;
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = canvas.width;
      exportCanvas.height = canvas.height;
      const ctx = exportCanvas.getContext("2d");
      if (!ctx) return;
      if (facingMode === "user") {
        ctx.translate(exportCanvas.width, 0);
        ctx.scale(-1, 1);
      }
      ctx.drawImage(canvas, 0, 0);

      // Elegant watermark branding
      ctx.save();
      ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
      ctx.fillRect(0, exportCanvas.height - 36, exportCanvas.width, 36);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(
        `${currentProduct.title} • Vibecheck Virtual Try-On`,
        exportCanvas.width / 2,
        exportCanvas.height - 13
      );
      ctx.restore();

      downloadData = exportCanvas.toDataURL("image/jpeg", 0.95);
    }
    if (!downloadData) return;
    const a = document.createElement("a");
    a.href = downloadData;
    a.download = `vibecheck-${currentProduct.handle || "tryon"}.jpg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const capturePhoto = () => {
    const overlay = canvasRef.current;
    if (!overlay || !overlay.width || !overlay.height) {
      setStatus("Wait for camera to be ready.");
      return;
    }
    setIsCapturing(true);
    setTimeout(() => setIsCapturing(false), 280);

    const output = document.createElement("canvas");
    output.width = overlay.width;
    output.height = overlay.height;
    const ctx = output.getContext("2d");
    if (!ctx) return;
    if (facingMode === "user") {
      ctx.translate(output.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(overlay, 0, 0, output.width, output.height);
    const url = output.toDataURL("image/jpeg", 0.95);
    setPhotoUrl(url);
    setPhotoMode(true);
    stopCamera();
    setStatus("Snapshot captured! Compare shades, retake, or save.");
  };

  const handleFileUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatus("Please select a valid image file.");
      return;
    }
    const objUrl = URL.createObjectURL(file);
    const img = new Image();
    uploadRequestRef.current += 1;
    uploadImageRef.current = img;

    img.onload = async () => {
      setPhotoMode(true);
      setPhotoUrl(objUrl);
      stopCamera();
      await renderUploadedPhoto(img);
      URL.revokeObjectURL(objUrl);
    };
    img.src = objUrl;
    event.target.value = "";
  };

  const retakePhoto = () => {
    uploadRequestRef.current += 1;
    uploadImageRef.current = null;
    setPhotoUrl("");
    setPhotoMode(false);
    startCamera();
  };

  const selectVariant = (item) => {
    setActiveVariantId(item.id);
    const effectiveHex = colorCacheRef.current[item.image] || item.hex;
    applyShade(effectiveHex);
    window.parent?.postMessage(
      {
        type: "VIBECHECK_SELECT_VARIANT",
        variantId: item.id,
        productHandle: item.productHandle || currentProduct.handle,
      },
      "*"
    );
  };

  const selectProduct = (prod) => {
    setCurrentProduct({
      id: prod.id,
      title: prod.title,
      handle: prod.handle,
      image: prod.image,
    });
    const vars =
      prod.variants && prod.variants.length
        ? prod.variants
        : [{ id: prod.id, title: prod.title, image: prod.image }];
    setProductVariants(vars);
    const first = vars[0];
    setActiveVariantId(first.id);
    const firstColor =
      first.swatch ||
      resolveShadeColor(
        [first.title, prod.title, ...(first.options || [])].join(" "),
        "#B80F2E"
      );
    applyShade(firstColor);
    setActiveTab("shades");
  };

  const closeSelf = () => {
    window.parent?.postMessage({ type: "VIBECHECK_CLOSE" }, "*");
  };

  const handleSplitDrag = (clientX, rect) => {
    if (!rect.width) return;
    const ratio = Math.max(0.08, Math.min(0.92, (clientX - rect.left) / rect.width));
    setSplitRatio(ratio);
    splitRatioRef.current = ratio;
  };

  return (
    <>
      <style>{`
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          width: 100% !important;
          height: 100% !important;
          max-height: 100% !important;
          overflow: hidden !important;
          background: #09090c !important;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          user-select: none;
          -webkit-user-select: none;
        }
        *, *::before, *::after {
          box-sizing: border-box;
        }
        @keyframes studio-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes studio-pulse {
          0%, 100% { opacity: 0.55; transform: scale(0.97); }
          50% { opacity: 1; transform: scale(1.04); }
        }
        @keyframes studio-flash {
          0% { opacity: 0.95; }
          100% { opacity: 0; }
        }
        @keyframes subtle-float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-3px); }
        }
        .vibe-scroll::-webkit-scrollbar {
          display: none;
        }
      `}</style>

      <div
        ref={containerRef}
        style={{
          ...styles.wrapper,
          ...(embedded ? styles.wrapperEmbedded : {}),
        }}
      >
        <canvas ref={uploadCanvasRef} style={{ display: "none" }} aria-hidden="true" />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileUpload}
          style={{ display: "none" }}
        />

        {/* ------------------------------------------------------------- */}
        {/* TOP BRAND & STATUS HUD (Floating Glass Overlay) */}
        {/* ------------------------------------------------------------- */}
        <header style={styles.topHud}>
          <div style={styles.topHudLeft}>
            {embedded && (
              <button
                type="button"
                onClick={closeSelf}
                title="Close virtual try-on"
                style={styles.closeGlassBtn}
              >
                ✕
              </button>
            )}
            <div style={styles.productBadge}>
              <span style={styles.sparkleDot}>✨</span>
              <span style={styles.productBadgeText}>
                {currentProduct.title || "Virtual Try-On"}
              </span>
            </div>
          </div>

          {/* Real-time Tracking & FPS Pill */}
          <div style={styles.hudStatusPill}>
            <span
              style={{
                ...styles.hudLiveIndicator,
                backgroundColor: isFaceDetected ? "#10B981" : "#F59E0B",
                boxShadow: isFaceDetected
                  ? "0 0 10px rgba(16, 185, 129, 0.7)"
                  : "0 0 8px rgba(245, 158, 11, 0.5)",
              }}
            />
            <span style={styles.hudStatusText}>
              {!photoMode
                ? isFaceDetected
                  ? `Lips Locked • ${fps} FPS`
                  : "Align Face"
                : "Photo Mode"}
            </span>
          </div>

          {/* Quick Toolbar (Fullscreen & Lighting) */}
          <div style={styles.topHudRight}>
            <button
              type="button"
              onClick={toggleLightingBoost}
              title={`Toggle Low-light Beauty Boost (${lightingBoost ? "ON" : "OFF"})`}
              style={{
                ...styles.hudToolBtn,
                ...(lightingBoost ? styles.hudToolBtnActive : {}),
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            </button>
            <button
              type="button"
              onClick={toggleFullscreen}
              title="Toggle Fullscreen"
              style={styles.hudToolBtn}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </svg>
            </button>
          </div>
        </header>

        {/* ------------------------------------------------------------- */}
        {/* 70% MAIN CAMERA / PHOTO VIEWPORT */}
        {/* ------------------------------------------------------------- */}
        <div
          style={styles.cameraViewport}
          onPointerDown={(e) => {
            if (splitMode) {
              isDraggingSplitRef.current = true;
              handleSplitDrag(e.clientX, e.currentTarget.getBoundingClientRect());
            }
          }}
          onPointerMove={(e) => {
            if (splitMode && isDraggingSplitRef.current) {
              handleSplitDrag(e.clientX, e.currentTarget.getBoundingClientRect());
            }
          }}
          onPointerUp={() => {
            isDraggingSplitRef.current = false;
          }}
        >
          {/* Shutter Flash Animation Effect */}
          {isCapturing && <div style={styles.flashOverlay} />}

          {!photoMode ? (
            <>
              <video
                ref={videoRef}
                muted
                playsInline
                autoPlay
                style={styles.hiddenVideo}
              />
              <canvas
                ref={canvasRef}
                style={{
                  ...styles.cameraCanvas,
                  transform: facingMode === "user" ? "scaleX(-1)" : "none",
                }}
              />

              {/* Startup / Connecting Overlay */}
              {!cameraReady && (
                <div style={styles.loadingOverlay}>
                  <div style={styles.loadingPulseIcon}>
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#e5c07b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                  </div>
                  <div style={styles.spinner} />
                  <p style={styles.loadingText}>{status}</p>
                  <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
                    <button
                      type="button"
                      onClick={() => startCamera()}
                      style={styles.primaryActionButton}
                    >
                      Connect Live Camera
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      style={styles.secondaryActionButton}
                    >
                      Upload Photo
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <img src={photoUrl} alt="Try on preview" style={styles.capturedPhoto} />
          )}

          {/* Right Floating Control Pill Toolbar */}
          <aside style={styles.floatingToolbar} aria-label="Camera Controls">
            <button
              type="button"
              title={`Flip Camera (currently ${facingMode === "user" ? "front" : "rear"})`}
              onClick={toggleFlipCamera}
              style={styles.sideToolButton}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 10c0-4.418-3.582-8-8-8s-8 3.582-8 8c0 1.954.702 3.745 1.87 5.143L4 18h6v-6l-2.09 2.09C7.03 12.91 6.5 11.52 6.5 10c0-3.038 2.462-5.5 5.5-5.5s5.5 2.462 5.5 5.5-2.462 5.5-5.5 5.5v2.5c4.418 0 8-3.582 8-8z" />
              </svg>
            </button>

            <button
              type="button"
              title={`Zoom: ${zoom.toFixed(2)}x`}
              onClick={handleZoomToggle}
              style={{
                ...styles.sideToolButton,
                ...(zoom > 1.0 ? styles.sideToolButtonActive : {}),
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 700 }}>
                {zoom.toFixed(1)}x
              </span>
            </button>

            <button
              type="button"
              title={`Before / After Split (${Math.round(splitRatio * 100)}%)`}
              onClick={toggleSplitMode}
              style={{
                ...styles.sideToolButton,
                ...(splitMode ? styles.sideToolButtonActive : {}),
              }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="3" />
                <line x1="12" y1="3" x2="12" y2="21" strokeDasharray="3 3" />
              </svg>
            </button>

            <button
              type="button"
              title="Upload Selfie Photo"
              onClick={() => fileInputRef.current?.click()}
              style={styles.sideToolButton}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </button>

            <button
              type="button"
              title="Save Snapshot Photo"
              onClick={handleDownloadSnapshot}
              style={styles.sideToolButton}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
          </aside>

          {/* Central Shutter Capture Button */}
          <div style={styles.shutterContainer}>
            {!photoMode ? (
              <button
                type="button"
                onClick={capturePhoto}
                title="Capture snapshot"
                style={styles.shutterButton}
              >
                <div style={styles.shutterRing}>
                  <div style={styles.shutterCenter} />
                </div>
              </button>
            ) : (
              <button
                type="button"
                onClick={retakePhoto}
                title="Return to live camera"
                style={styles.retakeLiveButton}
              >
                ↺ Retake Live Camera
              </button>
            )}
          </div>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* 30% LUXURY BEAUTY CONTROL DRAWER */}
        {/* ------------------------------------------------------------- */}
        <section style={styles.bottomDrawer}>
          {/* Navigation Pill Tabs */}
          <nav style={styles.tabNav}>
            <button
              type="button"
              onClick={() => setActiveTab("shades")}
              style={{
                ...styles.tabPill,
                ...(activeTab === "shades" ? styles.tabPillActive : {}),
              }}
            >
              💄 SHADES
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("finishes")}
              style={{
                ...styles.tabPill,
                ...(activeTab === "finishes" ? styles.tabPillActive : {}),
              }}
            >
              ✨ FINISH
            </button>

            <button
              type="button"
              onClick={() => setActiveTab("intensity")}
              style={{
                ...styles.tabPill,
                ...(activeTab === "intensity" ? styles.tabPillActive : {}),
              }}
            >
              🎚️ INTENSITY
            </button>

            {catalog.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab("products")}
                style={{
                  ...styles.tabPill,
                  ...(activeTab === "products" ? styles.tabPillActive : {}),
                }}
              >
                🛍️ PRODUCTS ({catalog.length})
              </button>
            )}

            <button
              type="button"
              onClick={() => setActiveTab("custom")}
              style={{
                ...styles.tabPill,
                ...(activeTab === "custom" ? styles.tabPillActive : {}),
              }}
            >
              🎨 CUSTOM
            </button>
          </nav>

          {/* Interactive Tab Panels */}
          <div style={styles.tabPanelBody}>
            {/* 1. SHADES TAB */}
            {activeTab === "shades" && (
              <div style={styles.horizontalScrollTrack} className="vibe-scroll">
                {availableShades.map((item) => {
                  const isSelected =
                    activeVariantId === item.id ||
                    shade.toLowerCase() === item.hex.toLowerCase();
                  return (
                    <button
                      key={item.id || item.name}
                      type="button"
                      onClick={() => selectVariant(item)}
                      title={`${item.name} (${item.hex})`}
                      style={{
                        ...styles.shadeCard,
                        ...(isSelected ? styles.shadeCardSelected : {}),
                      }}
                    >
                      <div style={styles.shadeCircleWrapper}>
                        <div
                          style={{
                            ...styles.shadeCircle,
                            backgroundColor: item.hex,
                          }}
                        />
                        {isSelected && (
                          <div style={styles.shadeSelectedIndicator} />
                        )}
                      </div>
                      <span style={styles.shadeNameLabel}>{item.name}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* 2. FINISHES TAB */}
            {activeTab === "finishes" && (
              <div style={styles.finishesTrack}>
                {PRESET_FINISHES.map((f) => {
                  const isSelected = finish === f.id;
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => handleFinishChange(f.id)}
                      style={{
                        ...styles.finishCard,
                        ...(isSelected ? styles.finishCardSelected : {}),
                      }}
                    >
                      <span style={styles.finishTitle}>{f.label}</span>
                      <span style={styles.finishSubtitle}>{f.desc}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* 3. INTENSITY TAB */}
            {activeTab === "intensity" && (
              <div style={styles.intensityPanel}>
                <div style={styles.sliderHeaderRow}>
                  <span style={styles.sliderLabel}>Coverage & Pigmentation</span>
                  <span style={styles.sliderValueBadge}>
                    {Math.round(intensity * 100)}%
                  </span>
                </div>
                <div style={styles.sliderWrapper}>
                  <span style={styles.sliderMinMax}>Sheer</span>
                  <input
                    type="range"
                    min="0.2"
                    max="1.0"
                    step="0.02"
                    value={intensity}
                    onChange={(e) => handleIntensityChange(e.target.value)}
                    style={styles.intensitySlider}
                  />
                  <span style={styles.sliderMinMax}>Bold</span>
                </div>
              </div>
            )}

            {/* 4. PRODUCTS CATALOG TAB */}
            {activeTab === "products" && (
              <div style={styles.horizontalScrollTrack} className="vibe-scroll">
                {catalog.map((prod) => {
                  const isSelected = String(prod.id) === String(currentProduct.id);
                  return (
                    <button
                      key={prod.id}
                      type="button"
                      onClick={() => selectProduct(prod)}
                      title={`${prod.title} — ${prod.price || ""}`}
                      style={{
                        ...styles.productCard,
                        ...(isSelected ? styles.productCardSelected : {}),
                      }}
                    >
                      <div style={styles.productThumbWrap}>
                        {prod.image ? (
                          <img
                            src={prod.image}
                            alt={prod.title}
                            style={styles.productThumbImg}
                          />
                        ) : (
                          <div style={styles.productThumbPlaceholder}>💄</div>
                        )}
                      </div>
                      <span style={styles.productCardTitle}>{prod.title}</span>
                      {prod.price && (
                        <span style={styles.productCardPrice}>{prod.price}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* 5. CUSTOM COLOR PICKER TAB */}
            {activeTab === "custom" && (
              <div style={styles.customColorPanel}>
                <div style={styles.customColorRow}>
                  <input
                    type="color"
                    value={customHex}
                    onChange={(e) => {
                      setCustomHex(e.target.value);
                      applyShade(e.target.value);
                    }}
                    style={styles.nativeColorInput}
                  />
                  <input
                    type="text"
                    value={hexInput}
                    onChange={(e) => {
                      const val = e.target.value.toUpperCase();
                      setHexInput(val);
                      if (/^#[0-9A-F]{6}$/.test(val)) {
                        setCustomHex(val);
                        applyShade(val);
                      }
                    }}
                    placeholder="#D71940"
                    style={styles.hexTextInput}
                  />
                  <div
                    style={{
                      ...styles.activeColorIndicator,
                      backgroundColor: shade,
                    }}
                  />
                </div>
                {/* Fast Color Swatches */}
                <div style={styles.quickSwatchesRow}>
                  {["#6B1835", "#D71940", "#B80F2E", "#FF6F61", "#E75480", "#C68670", "#6F4E37"].map(
                    (quickHex) => (
                      <button
                        key={quickHex}
                        type="button"
                        onClick={() => applyShade(quickHex)}
                        style={{
                          ...styles.quickSwatchCircle,
                          backgroundColor: quickHex,
                          outline:
                            shade.toLowerCase() === quickHex.toLowerCase()
                              ? "2px solid #ffffff"
                              : "none",
                        }}
                      />
                    )
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Bottom Action Footer */}
          <footer style={styles.drawerFooter}>
            {!photoMode ? (
              <>
                <button
                  type="button"
                  onClick={capturePhoto}
                  style={styles.luxuryButtonPrimary}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                    <circle cx="12" cy="13" r="4" />
                  </svg>
                  <span>Snapshot</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  style={styles.luxuryButtonSecondary}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                    <circle cx="8.5" cy="8.5" r="1.5" />
                    <polyline points="21 15 16 10 5 21" />
                  </svg>
                  <span>Upload Photo</span>
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={retakePhoto}
                  style={styles.luxuryButtonPrimary}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 10c0-4.418-3.582-8-8-8s-8 3.582-8 8c0 1.954.702 3.745 1.87 5.143L4 18h6v-6l-2.09 2.09C7.03 12.91 6.5 11.52 6.5 10c0-3.038 2.462-5.5 5.5-5.5s5.5 2.462 5.5 5.5-2.462 5.5-5.5 5.5v2.5c4.418 0 8-3.582 8-8z" />
                  </svg>
                  <span>Live Camera</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadSnapshot}
                  style={styles.luxuryButtonSecondary}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  <span>Save Photo</span>
                </button>
              </>
            )}
          </footer>
        </section>
      </div>
    </>
  );
}

// ============================================================================
// LUXURY MODERN BEAUTY AR DESIGN SYSTEM STYLES
// ============================================================================
const styles = {
  wrapper: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: "100vw",
    height: "100vh",
    maxWidth: 480,
    margin: "0 auto",
    color: "#ffffff",
    background: "#09090c",
    borderRadius: 24,
    overflow: "hidden",
    boxShadow: "0 25px 60px rgba(0, 0, 0, 0.45)",
    display: "flex",
    flexDirection: "column",
  },
  wrapperEmbedded: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: "100%",
    height: "100%",
    maxWidth: "100%",
    margin: 0,
    borderRadius: 0,
    boxShadow: "none",
  },

  // ---------------- TOP HUD ----------------
  topHud: {
    position: "absolute",
    top: 14,
    left: 14,
    right: 14,
    zIndex: 20,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    pointerEvents: "none",
  },
  topHudLeft: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    pointerEvents: "auto",
  },
  closeGlassBtn: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    background: "rgba(18, 18, 24, 0.72)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255, 255, 255, 0.16)",
    color: "#ffffff",
    fontSize: 13,
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    transition: "transform 0.15s ease",
  },
  productBadge: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 12px",
    borderRadius: 20,
    background: "rgba(18, 18, 24, 0.72)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255, 255, 255, 0.14)",
    maxWidth: 160,
  },
  sparkleDot: {
    fontSize: 12,
  },
  productBadgeText: {
    fontSize: 11.5,
    fontWeight: 650,
    letterSpacing: 0.3,
    color: "#ffffff",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  hudStatusPill: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "5px 11px",
    borderRadius: 16,
    background: "rgba(14, 14, 18, 0.8)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    pointerEvents: "auto",
  },
  hudLiveIndicator: {
    width: 7,
    height: 7,
    borderRadius: "50%",
  },
  hudStatusText: {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: 0.4,
    color: "#f3f4f6",
  },
  topHudRight: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    pointerEvents: "auto",
  },
  hudToolBtn: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    background: "rgba(18, 18, 24, 0.72)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    border: "1px solid rgba(255, 255, 255, 0.16)",
    color: "#ffffff",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    transition: "background 0.15s ease, transform 0.15s ease",
  },
  hudToolBtnActive: {
    background: "#D71940",
    borderColor: "#D71940",
    boxShadow: "0 0 10px rgba(215, 25, 64, 0.5)",
  },

  // ---------------- CAMERA VIEWPORT ----------------
  cameraViewport: {
    position: "relative",
    width: "100%",
    height: "70%",
    flex: "0 0 70%",
    minHeight: "70%",
    maxHeight: "70%",
    background: "#08080a",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  hiddenVideo: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: "scaleX(-1)",
    pointerEvents: "none",
    opacity: 0,
  },
  cameraCanvas: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "cover",
    pointerEvents: "none",
  },
  capturedPhoto: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "contain",
    background: "#08080a",
  },
  flashOverlay: {
    position: "absolute",
    inset: 0,
    background: "#ffffff",
    zIndex: 35,
    animation: "studio-flash 0.28s ease-out forwards",
    pointerEvents: "none",
  },

  // ---------------- FLOATING TOOLBAR (RIGHT) ----------------
  floatingToolbar: {
    position: "absolute",
    top: 64,
    right: 14,
    zIndex: 15,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  sideToolButton: {
    width: 38,
    height: 38,
    borderRadius: "50%",
    border: "1px solid rgba(255, 255, 255, 0.16)",
    background: "rgba(16, 16, 22, 0.72)",
    backdropFilter: "blur(14px)",
    WebkitBackdropFilter: "blur(14px)",
    color: "#ffffff",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    padding: 0,
    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.25)",
    transition: "background 0.15s ease, transform 0.15s ease",
  },
  sideToolButtonActive: {
    background: "#D71940",
    borderColor: "#D71940",
    boxShadow: "0 0 12px rgba(215, 25, 64, 0.6)",
  },

  // ---------------- SHUTTER CONTAINER ----------------
  shutterContainer: {
    position: "absolute",
    bottom: 18,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 15,
  },
  shutterButton: {
    width: 58,
    height: 58,
    borderRadius: "50%",
    background: "rgba(255, 255, 255, 0.22)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
    border: "2.5px solid rgba(255, 255, 255, 0.85)",
    boxShadow: "0 6px 20px rgba(0, 0, 0, 0.4)",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    padding: 0,
    transition: "transform 0.12s ease",
  },
  shutterRing: {
    width: 44,
    height: 44,
    borderRadius: "50%",
    background: "#ffffff",
    display: "grid",
    placeItems: "center",
  },
  shutterCenter: {
    width: 38,
    height: 38,
    borderRadius: "50%",
    background: "radial-gradient(circle, #f9fafb 0%, #e5e7eb 100%)",
  },
  retakeLiveButton: {
    padding: "8px 18px",
    borderRadius: 24,
    background: "rgba(20, 20, 26, 0.85)",
    border: "1px solid rgba(255, 255, 255, 0.25)",
    color: "#ffffff",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0.3,
    cursor: "pointer",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    boxShadow: "0 6px 16px rgba(0, 0, 0, 0.35)",
  },

  // ---------------- LOADING STATE OVERLAY ----------------
  loadingOverlay: {
    position: "absolute",
    inset: 0,
    background: "rgba(9, 9, 12, 0.88)",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    textAlign: "center",
    zIndex: 10,
  },
  loadingPulseIcon: {
    width: 54,
    height: 54,
    borderRadius: "50%",
    background: "rgba(229, 192, 123, 0.12)",
    border: "1px solid rgba(229, 192, 123, 0.3)",
    display: "grid",
    placeItems: "center",
    marginBottom: 12,
    animation: "studio-pulse 1.8s ease-in-out infinite",
  },
  spinner: {
    width: 36,
    height: 36,
    border: "3px solid rgba(255, 255, 255, 0.18)",
    borderTopColor: "#e5c07b",
    borderRadius: "50%",
    animation: "studio-spin 0.8s linear infinite",
  },
  loadingText: {
    marginTop: 14,
    fontSize: 13,
    color: "#f3f4f6",
    maxWidth: 260,
    lineHeight: 1.4,
  },
  primaryActionButton: {
    padding: "9px 18px",
    borderRadius: 10,
    background: "#ffffff",
    color: "#0a0a0c",
    border: "none",
    fontWeight: 700,
    fontSize: 12.5,
    cursor: "pointer",
    boxShadow: "0 4px 14px rgba(255, 255, 255, 0.2)",
  },
  secondaryActionButton: {
    padding: "9px 16px",
    borderRadius: 10,
    background: "rgba(255, 255, 255, 0.14)",
    color: "#ffffff",
    border: "1px solid rgba(255, 255, 255, 0.22)",
    fontWeight: 650,
    fontSize: 12.5,
    cursor: "pointer",
  },

  // ---------------- 30% BOTTOM DRAWER ----------------
  bottomDrawer: {
    position: "relative",
    background: "linear-gradient(180deg, #131318 0%, #0c0c10 100%)",
    width: "100%",
    height: "30%",
    flex: "0 0 30%",
    minHeight: "30%",
    maxHeight: "30%",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    padding: "8px 12px 10px",
    boxSizing: "border-box",
    overflow: "hidden",
    borderTop: "1px solid rgba(255, 255, 255, 0.08)",
  },

  // ---------------- TAB NAVIGATION PILLS ----------------
  tabNav: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    overflowX: "auto",
    paddingBottom: 4,
    scrollbarWidth: "none",
    flexShrink: 0,
  },
  tabPill: {
    background: "rgba(255, 255, 255, 0.06)",
    border: "1px solid rgba(255, 255, 255, 0.09)",
    borderRadius: 14,
    padding: "4px 11px",
    color: "#9ca3af",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.5,
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "all 0.15s ease",
  },
  tabPillActive: {
    background: "rgba(215, 25, 64, 0.18)",
    borderColor: "#D71940",
    color: "#ffffff",
    boxShadow: "0 0 10px rgba(215, 25, 64, 0.3)",
  },

  // ---------------- TAB CONTENT BODY ----------------
  tabPanelBody: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    alignItems: "center",
    overflow: "hidden",
  },
  horizontalScrollTrack: {
    display: "flex",
    gap: 12,
    overflowX: "auto",
    padding: "4px 2px",
    alignItems: "center",
    width: "100%",
  },

  // Shade Cards
  shadeCard: {
    flexShrink: 0,
    width: 56,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 5,
    background: "none",
    border: "none",
    padding: "2px",
    cursor: "pointer",
    transition: "transform 0.15s ease",
  },
  shadeCardSelected: {
    transform: "scale(1.08)",
  },
  shadeCircleWrapper: {
    position: "relative",
    width: 36,
    height: 36,
    borderRadius: "50%",
    padding: 2,
    border: "2px solid transparent",
  },
  shadeCircle: {
    width: "100%",
    height: "100%",
    borderRadius: "50%",
    boxShadow: "inset 0 1px 3px rgba(255, 255, 255, 0.3), 0 3px 8px rgba(0, 0, 0, 0.4)",
  },
  shadeSelectedIndicator: {
    position: "absolute",
    inset: -3,
    borderRadius: "50%",
    border: "2px solid #ffffff",
    boxShadow: "0 0 8px rgba(255, 255, 255, 0.8)",
  },
  shadeNameLabel: {
    fontSize: 9.5,
    fontWeight: 650,
    color: "#d1d5db",
    textAlign: "center",
    width: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  // Finishes
  finishesTrack: {
    display: "flex",
    gap: 8,
    overflowX: "auto",
    width: "100%",
    padding: "2px",
  },
  finishCard: {
    flex: "1 0 auto",
    minWidth: 84,
    padding: "6px 10px",
    borderRadius: 12,
    background: "rgba(255, 255, 255, 0.05)",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  finishCardSelected: {
    background: "linear-gradient(135deg, rgba(215, 25, 64, 0.25) 0%, rgba(215, 25, 64, 0.08) 100%)",
    borderColor: "#D71940",
    boxShadow: "0 0 10px rgba(215, 25, 64, 0.25)",
  },
  finishTitle: {
    fontSize: 11.5,
    fontWeight: 700,
    color: "#ffffff",
  },
  finishSubtitle: {
    fontSize: 8.5,
    color: "#9ca3af",
    textAlign: "center",
  },

  // Intensity
  intensityPanel: {
    width: "100%",
    padding: "4px 8px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  sliderHeaderRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sliderLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: "#9ca3af",
    letterSpacing: 0.3,
  },
  sliderValueBadge: {
    fontSize: 11,
    fontWeight: 700,
    color: "#ffffff",
    background: "rgba(255, 255, 255, 0.1)",
    padding: "2px 8px",
    borderRadius: 8,
  },
  sliderWrapper: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  sliderMinMax: {
    fontSize: 10,
    fontWeight: 600,
    color: "#6b7280",
    textTransform: "uppercase",
  },
  intensitySlider: {
    flex: 1,
    height: 5,
    accentColor: "#D71940",
    cursor: "pointer",
  },

  // Product Catalog Cards
  productCard: {
    flexShrink: 0,
    width: 68,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 3,
    background: "rgba(255, 255, 255, 0.04)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: 12,
    padding: "5px 4px",
    cursor: "pointer",
  },
  productCardSelected: {
    borderColor: "#D71940",
    background: "rgba(215, 25, 64, 0.15)",
  },
  productThumbWrap: {
    width: 38,
    height: 38,
    borderRadius: 8,
    overflow: "hidden",
    background: "#181820",
    display: "grid",
    placeItems: "center",
  },
  productThumbImg: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
  },
  productThumbPlaceholder: {
    fontSize: 18,
  },
  productCardTitle: {
    fontSize: 9,
    fontWeight: 600,
    color: "#e5e7eb",
    textAlign: "center",
    width: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  productCardPrice: {
    fontSize: 8.5,
    color: "#9ca3af",
  },

  // Custom Color Panel
  customColorPanel: {
    width: "100%",
    padding: "2px 4px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  customColorRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  nativeColorInput: {
    width: 34,
    height: 30,
    border: "1px solid rgba(255, 255, 255, 0.2)",
    borderRadius: 8,
    padding: 1,
    cursor: "pointer",
    background: "transparent",
  },
  hexTextInput: {
    flex: 1,
    height: 30,
    border: "1px solid rgba(255, 255, 255, 0.15)",
    borderRadius: 8,
    padding: "0 10px",
    fontFamily: "monospace",
    fontSize: 12,
    color: "#ffffff",
    background: "rgba(255, 255, 255, 0.06)",
  },
  activeColorIndicator: {
    width: 28,
    height: 28,
    borderRadius: "50%",
    border: "2px solid #ffffff",
    boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
  },
  quickSwatchesRow: {
    display: "flex",
    gap: 10,
    alignItems: "center",
  },
  quickSwatchCircle: {
    width: 22,
    height: 22,
    borderRadius: "50%",
    border: "none",
    cursor: "pointer",
    padding: 0,
    boxShadow: "0 2px 4px rgba(0, 0, 0, 0.3)",
  },

  // ---------------- BOTTOM FOOTER ACTIONS ----------------
  drawerFooter: {
    display: "flex",
    gap: 8,
    width: "100%",
    paddingTop: 6,
    borderTop: "1px solid rgba(255, 255, 255, 0.06)",
    flexShrink: 0,
  },
  luxuryButtonPrimary: {
    flex: 1,
    height: 34,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 17,
    border: "none",
    background: "linear-gradient(135deg, #e6004c 0%, #b80f2e 100%)",
    boxShadow: "0 3px 10px rgba(230, 0, 76, 0.35)",
    color: "#ffffff",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: 0.3,
    cursor: "pointer",
    transition: "transform 0.15s ease",
  },
  luxuryButtonSecondary: {
    flex: 1,
    height: 34,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderRadius: 17,
    border: "1px solid rgba(255, 255, 255, 0.14)",
    background: "rgba(255, 255, 255, 0.07)",
    color: "#ffffff",
    fontSize: 12,
    fontWeight: 650,
    letterSpacing: 0.3,
    cursor: "pointer",
    transition: "transform 0.15s ease",
  },
};
