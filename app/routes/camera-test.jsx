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
          x: new OneEuroFilter(1.5, 12, 1.0),
          y: new OneEuroFilter(1.5, 12, 1.0),
          z: new OneEuroFilter(1.5, 12, 1.0),
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
// REALISTIC LIPSTICK RENDERER
// ----------------------------------------------------------------------------
// Why the old version looked "painted on":
//   1. It filled a flat colour with `multiply` and clipped it with a hard
//      vector edge -> visible sticker outline, no feathering.
//   2. `multiply` + low-alpha `soft-light` darkens everything and flattens the
//      lip's own shading, so creases / light / shadow disappeared.
//
// How this version works:
//   1. Copy the lip area of the current frame into a small offscreen canvas.
//   2. Re-colour it with the `color` blend mode (takes hue+saturation from the
//      shade, KEEPS the lip's real brightness & texture), then add depth with
//      a light `multiply` / `soft-light` pass depending on shade darkness.
//   3. Add the finish (gloss / satin / shimmer) inside that layer.
//   4. Cut the layer with a SOFT (feathered) lip mask - teeth protected when
//      the mouth is open - and composite it back onto the frame.
// ============================================================================
let _lipLayerCanvas = null;
let _lipMaskCanvas = null;

function getScratchCanvas(existing, w, h) {
  const c = existing || document.createElement("canvas");
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
}

// Soft-edged fill that works in every browser (no ctx.filter needed):
// the shape is drawn far off-canvas and only its blurred SHADOW lands here.
function fillSoftPath(c, path, blurSigma, op, offsetX, offsetY, far) {
  c.save();
  c.globalCompositeOperation = op;
  c.translate(offsetX, offsetY);
  c.translate(-far, 0);
  c.shadowColor = "rgba(255,255,255,1)";
  c.shadowBlur = Math.max(0, blurSigma * 2); // canvas shadowBlur = 2 x sigma
  c.shadowOffsetX = far;
  c.shadowOffsetY = 0;
  c.fillStyle = "#fff";
  c.fill(path);
  c.restore();
}

function relativeLuminance(rgb) {
  return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
}

function drawLipstickEnhanced(
  ctx,
  landmarks,
  width,
  height,
  color,
  finish = "matte",
  intensity = 0.75
) {
  if (!ctx || !landmarks || landmarks.length < 468 || intensity <= 0.001) return;

  const pTopOuter = landmarks[LM_UPPER_CENTER_OUTER];
  const pBottomOuter = landmarks[LM_LOWER_CENTER_OUTER];
  const pTopInner = landmarks[LM_UPPER_CENTER_INNER];
  const pBottomInner = landmarks[LM_LOWER_CENTER_INNER];
  const pLeftCorner = landmarks[LM_CORNER_LEFT];
  const pRightCorner = landmarks[LM_CORNER_RIGHT];
  if (!pTopOuter || !pBottomOuter || !pTopInner || !pBottomInner || !pLeftCorner || !pRightCorner) return;

  const outerPath = createFullOuterLipPath(landmarks, width, height);
  if (!outerPath) return;

  // ---- Mouth geometry ------------------------------------------------------
  const innerGapY = Math.abs(pBottomInner.y - pTopInner.y) * height;
  const totalLipHeight = Math.abs(pBottomOuter.y - pTopOuter.y) * height;
  const mouthOpen = innerGapY > 3.5 && innerGapY / Math.max(totalLipHeight, 1) > 0.12;
  const innerPath = mouthOpen ? createFullInnerLipPath(landmarks, width, height) : null;

  const lipWidthPx = Math.hypot(
    (pRightCorner.x - pLeftCorner.x) * width,
    (pRightCorner.y - pLeftCorner.y) * height
  );
  const lipAngle = Math.atan2(
    (pRightCorner.y - pLeftCorner.y) * height,
    (pRightCorner.x - pLeftCorner.x) * width
  );

  // ---- Bounding box of the lips (all work happens in this small area) -----
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const idx of [...UPPER_LIP_OUTER, ...LOWER_LIP_OUTER]) {
    const p = landmarks[idx];
    if (!p) continue;
    minX = Math.min(minX, p.x * width);
    maxX = Math.max(maxX, p.x * width);
    minY = Math.min(minY, p.y * height);
    maxY = Math.max(maxY, p.y * height);
  }
  if (!isFinite(minX) || maxX - minX < 4 || maxY - minY < 2) return;

  const pad = Math.max(8, lipWidthPx * 0.2);
  const bx = Math.max(0, Math.floor(minX - pad));
  const by = Math.max(0, Math.floor(minY - pad));
  const bw = Math.min(width, Math.ceil(maxX + pad)) - bx;
  const bh = Math.min(height, Math.ceil(maxY + pad)) - by;
  if (bw < 4 || bh < 4) return;

  const rgbRaw = hexToRgb(color);
  // Tame over-saturated swatches so the result looks like a real stain
  const grayRaw = 0.2126 * rgbRaw.r + 0.7152 * rgbRaw.g + 0.0722 * rgbRaw.b;
  const SAT = 0.80; // 1 = full swatch saturation, lower = more natural
  const rgb = {
    r: grayRaw + (rgbRaw.r - grayRaw) * SAT,
    g: grayRaw + (rgbRaw.g - grayRaw) * SAT,
    b: grayRaw + (rgbRaw.b - grayRaw) * SAT,
  };
  const colorStr = `rgb(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)})`;
  const shadeLum = relativeLuminance(rgb); // 0 = very dark, 1 = very light
  const darkness = 1 - shadeLum;

  // Edge softness scales with lip size (about 1-3px, like a real lip line).
  const feather = Math.min(2.0, Math.max(0.7, lipWidthPx * 0.012));
  const FAR = Math.max(4000, bw * 2);

  // ---- 1. SOFT MASK (outer lips minus open mouth) ---------------------------
  const maskCanvas = (_lipMaskCanvas = getScratchCanvas(_lipMaskCanvas, bw, bh));
  const mctx = maskCanvas.getContext("2d");
  mctx.setTransform(1, 0, 0, 1, 0, 0);
  mctx.globalCompositeOperation = "source-over";
  mctx.clearRect(0, 0, bw, bh);
  fillSoftPath(mctx, outerPath, feather, "source-over", -bx, -by, FAR);
  if (innerPath) {
    // slightly tighter feather inside so teeth/tongue stay clean
    fillSoftPath(mctx, innerPath, feather * 0.8, "destination-out", -bx, -by, FAR);
  }

  // ---- 2. COLOUR LAYER built from the real lip pixels ---------------------
  const layerCanvas = (_lipLayerCanvas = getScratchCanvas(_lipLayerCanvas, bw, bh));
  const lctx = layerCanvas.getContext("2d");
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.globalCompositeOperation = "source-over";
  lctx.globalAlpha = 1;
  lctx.clearRect(0, 0, bw, bh);
  lctx.drawImage(ctx.canvas, bx, by, bw, bh, 0, 0, bw, bh);

  // Per-finish recipe: how strongly to recolour / add depth.
  const recipe = {
    matte:   { hue: 0.55, mult: 0.30, tone: 0.20 },
    satin:   { hue: 0.50, mult: 0.26, tone: 0.20 },
    glossy:  { hue: 0.46, mult: 0.24, tone: 0.18 },
    shimmer: { hue: 0.48, mult: 0.25, tone: 0.18 },
    sheer:   { hue: 0.30, mult: 0.12, tone: 0.12 },
  }[finish] || { hue: 0.5, mult: 0.25, tone: 0.18 };

  // (a) Hue + saturation of the shade, brightness/texture of the real lips.
  lctx.globalCompositeOperation = "color";
  lctx.globalAlpha = recipe.hue;
  lctx.fillStyle = colorStr;
  lctx.fillRect(0, 0, bw, bh);

  // (b) Depth: multiply keeps the lip's own tone showing through (natural stain)
  lctx.globalCompositeOperation = "multiply";
  lctx.globalAlpha = recipe.mult * (0.6 + darkness * 0.8);
  lctx.fillStyle = colorStr;
  lctx.fillRect(0, 0, bw, bh);
  if (shadeLum > 0.55) {
    lctx.globalCompositeOperation = "soft-light";
    lctx.globalAlpha = 0.35;
    lctx.fillRect(0, 0, bw, bh);
  }

  // (c) Richness: a final soft-light pass keeps colour vibrant, not muddy.
  lctx.globalCompositeOperation = "soft-light";
  lctx.globalAlpha = recipe.tone;
  lctx.fillStyle = colorStr;
  lctx.fillRect(0, 0, bw, bh);

  // ---- 3. FINISH (highlights live INSIDE the layer so edges stay soft) ----
  lctx.save();
  lctx.translate(-bx, -by);
  const lowerCenterX = ((pBottomOuter.x + pBottomInner.x) / 2) * width;
  const lowerCenterY = ((pBottomOuter.y + pBottomInner.y) / 2) * height;
  const lowerLipThickness = Math.max(
    2,
    Math.abs(pBottomOuter.y - pBottomInner.y) * height
  );

  // Elliptical radial gradient aligned with the lip (follows head tilt).
  const softBlob = (cx, cy, rx, ry, peak) => {
    lctx.save();
    lctx.translate(cx, cy);
    lctx.rotate(lipAngle);
    lctx.scale(1, Math.max(0.05, ry / rx));
    const g = lctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, `rgba(255,255,255,${peak})`);
    g.addColorStop(0.45, `rgba(255,255,255,${peak * 0.35})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    lctx.fillStyle = g;
    lctx.beginPath();
    lctx.arc(0, 0, rx, 0, Math.PI * 2);
    lctx.fill();
    lctx.restore();
  };

  lctx.globalCompositeOperation = "screen";
  if (finish === "glossy") {
    lctx.globalAlpha = 1;
    // main wet highlight on lower lip, slightly off-centre like real light
    softBlob(lowerCenterX - lipWidthPx * 0.05, lowerCenterY - lowerLipThickness * 0.1,
      lipWidthPx * 0.2, lowerLipThickness * 0.38, 0.30);
    // smaller secondary glint
    softBlob(lowerCenterX + lipWidthPx * 0.16, lowerCenterY, lipWidthPx * 0.08,
      lowerLipThickness * 0.22, 0.20);
    // faint sheen on upper lip / cupid's bow
    softBlob(pTopOuter.x * width, pTopOuter.y * height + lowerLipThickness * 0.25,
      lipWidthPx * 0.12, lowerLipThickness * 0.2, 0.14);
  } else if (finish === "satin") {
    lctx.globalAlpha = 1;
    softBlob(lowerCenterX, lowerCenterY, lipWidthPx * 0.26, lowerLipThickness * 0.45, 0.14);
  } else if (finish === "shimmer") {
    lctx.globalAlpha = 1;
    softBlob(lowerCenterX, lowerCenterY, lipWidthPx * 0.24, lowerLipThickness * 0.4, 0.10);
    // deterministic micro-pearls (no random -> no flicker between frames)
    const n = 26;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const px = pLeftCorner.x * width + (pRightCorner.x - pLeftCorner.x) * width * (0.12 + 0.76 * t);
      const py = lowerCenterY + Math.sin(i * 12.9898) * lowerLipThickness * 0.28;
      const r = 0.6 + ((i * 7) % 5) * 0.28;
      lctx.fillStyle = `rgba(255,255,255,${0.15 + ((i * 3) % 4) * 0.06})`;
      lctx.beginPath();
      lctx.arc(px, py, r, 0, Math.PI * 2);
      lctx.fill();
    }
  }
  lctx.restore();

  // ---- 4. APPLY SOFT MASK, then composite onto the frame -----------------
  lctx.globalCompositeOperation = "destination-in";
  lctx.globalAlpha = 1;
  lctx.drawImage(maskCanvas, 0, 0);

  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = Math.min(1, Math.max(0, intensity * 0.9));
  ctx.drawImage(layerCanvas, bx, by);
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
              frameRate: { ideal: 60 },
            },
            audio: false,
          });
        } catch (err1) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({
              video: {
                facingMode: mode || "user",
                frameRate: { ideal: 60 },
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
        let minInferenceInterval = 16;
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
            minInferenceInterval = Math.min(100, Math.max(16, took * 1.15));
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
                  const k = 1 - Math.exp(-dtMs / 14);
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

  // ---- Redesign: derived values for the UI ----
  const accent = /^#[0-9a-f]{6}$/i.test(shade || "") ? shade : "#B5304A";
  const accentInk = (() => {
    const n = parseInt(accent.slice(1), 16);
    const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return l > 0.62 ? "#1a1117" : "#fbf6f1";
  })();
  const cleanName = (n) => String(n || "").replace(/^.*?\s[-\u2013\u2014]\s/, "");
  const selectedShade = availableShades.find(
    (item) =>
      activeVariantId === item.id ||
      (shade || "").toLowerCase() === item.hex.toLowerCase()
  );
  const shadeLabel = selectedShade ? cleanName(selectedShade.name) : "Custom shade";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Serif&family=Manrope:wght@400;500;600;700&display=swap');
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          width: 100% !important;
          height: 100% !important;
          max-height: 100% !important;
          overflow: hidden !important;
          background: #120d14 !important;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          font-family: Manrope, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          user-select: none;
          -webkit-user-select: none;
        }
        *, *::before, *::after { box-sizing: border-box; }
        button { font-family: inherit; -webkit-tap-highlight-color: transparent; }
        button:focus-visible { outline: 2px solid #f6efe9; outline-offset: 3px; }
        @keyframes studio-spin { to { transform: rotate(360deg); } }
        @keyframes studio-pulse {
          0%, 100% { opacity: 0.55; transform: scale(0.97); }
          50% { opacity: 1; transform: scale(1.04); }
        }
        @keyframes studio-flash { 0% { opacity: 0.9; } 100% { opacity: 0; } }
        @keyframes sheet-rise {
          from { opacity: 0; transform: translateY(26px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .vibe-scroll { scrollbar-width: none; scroll-snap-type: x proximity; }
        .vibe-scroll::-webkit-scrollbar { display: none; }
        .vibe-swatch { transition: transform .25s cubic-bezier(.2,.8,.2,1); }
        .vibe-swatch:active { transform: scale(.92); }
        .vibe-press:active { transform: scale(.94); }
        @media (prefers-reduced-motion: reduce) {
          * { animation-duration: .01ms !important; transition-duration: .01ms !important; }
        }
      `}</style>

      <div
        ref={containerRef}
        style={{
          ...styles.wrapper,
          ...(embedded ? styles.wrapperEmbedded : {}),
          "--accent": accent,
          "--accent-ink": accentInk,
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
        <div style={styles.topScrim} aria-hidden="true" />
        <header style={styles.topHud}>
          <div>
            {embedded && (
              <button
                type="button"
                onClick={closeSelf}
                title="Close"
                aria-label="Close virtual try-on"
                className="vibe-press"
                style={styles.glassBtn}
              >
                <Ico n="close" />
              </button>
            )}
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
                    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#f6efe9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
                      Turn on camera
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      style={styles.secondaryActionButton}
                    >
                      Use a photo
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <img src={photoUrl} alt="Try on preview" style={styles.capturedPhoto} />
          )}

          {/* Control rail: one quiet capsule instead of five floating discs */}
          <aside style={styles.rail} aria-label="Camera controls">
            <button type="button" className="vibe-press" onClick={handleZoomToggle}
              title={`Zoom ${zoom.toFixed(1)}x`} aria-label="Change zoom"
              style={{ ...styles.railBtn, ...(zoom > 1.0 ? styles.railBtnOn : {}) }}>
              <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.2 }}>{zoom.toFixed(1)}×</span>
            </button>
            <button type="button" className="vibe-press" onClick={toggleSplitMode}
              title="Compare before and after" aria-label="Compare before and after"
              style={{ ...styles.railBtn, ...(splitMode ? styles.railBtnOn : {}) }}>
              <Ico n="split" />
            </button>
            <button type="button" className="vibe-press" onClick={toggleLightingBoost}
              title="Low-light boost" aria-label="Low-light boost"
              style={{ ...styles.railBtn, ...(lightingBoost ? styles.railBtnOn : {}) }}>
              <Ico n="light" />
            </button>
          </aside>
        </div>

        {/* ------------------------------------------------------------- */}
        {/* BOTTOM SHEET: floats over the camera, no hard edge             */}
        {/* ------------------------------------------------------------- */}
        <section style={styles.sheet}>
          <div style={styles.shadeHead}>
            <span style={styles.productLine}>{currentProduct.title}</span>
            <span style={styles.shadeName}>{shadeLabel}</span>
          </div>

          <div style={styles.swatchTrack} className="vibe-scroll" role="group" aria-label="Lipstick shades">
            {availableShades.map((item) => {
              const isSelected =
                activeVariantId === item.id ||
                (shade || "").toLowerCase() === item.hex.toLowerCase();
              return (
                <button
                  key={item.id || item.name}
                  type="button"
                  className="vibe-swatch"
                  onClick={() => selectVariant(item)}
                  title={cleanName(item.name)}
                  aria-label={cleanName(item.name)}
                  aria-pressed={isSelected}
                  style={{
                    ...styles.swatch,
                    backgroundColor: item.hex,
                    ...(isSelected ? styles.swatchOn : {}),
                  }}
                />
              );
            })}
          </div>

          {!photoMode ? (
            <div style={styles.actions}>
              <button type="button" className="vibe-press" onClick={() => fileInputRef.current?.click()}
                style={styles.sideAction} aria-label="Upload a photo">
                <span style={styles.sideActionIcon}><Ico n="photo" /></span>
                <span style={styles.sideActionLabel}>Photo</span>
              </button>

              <button type="button" className="vibe-press" onClick={capturePhoto}
                title="Take snapshot" aria-label="Take snapshot" style={styles.shutter}>
                <span style={styles.shutterCore} />
              </button>

              <button type="button" className="vibe-press" onClick={handleDownloadSnapshot}
                style={styles.sideAction} aria-label="Save snapshot">
                <span style={styles.sideActionIcon}><Ico n="save" /></span>
                <span style={styles.sideActionLabel}>Save</span>
              </button>
            </div>
          ) : (
            <div style={styles.actionsPhoto}>
              <button type="button" className="vibe-press" onClick={retakePhoto} style={styles.ghostPill}>
                <Ico n="flip" /> Back to camera
              </button>
              <button type="button" className="vibe-press" onClick={handleDownloadSnapshot}
                style={{ ...styles.solidPill, background: accent, color: accentInk }}>
                <Ico n="save" /> Save photo
              </button>
            </div>
          )}
        </section>
      </div>
    </>
  );
}

// ============================================================================
// REDESIGN: "lacquer & pearl" — plum-ink glass over the camera, pearl type,
// and one accent that follows the lipstick shade the shopper is wearing.
// ============================================================================
const ICONS = {
  close: <path d="M6 6l12 12M18 6L6 18" />,
  expand: <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />,
  flip: <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.2L3 16M3 21v-5h5" />,
  split: (<><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M12 4v16" /></>),
  light: (<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  photo: (<><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="1.6" /><path d="M21 15l-5-5L5 21" /></>),
  save: <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />,
};

const Ico = ({ n, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {ICONS[n]}
  </svg>
);

const INK = "#120d14";
const PEARL = "#f6efe9";
const MUTED = "#b9aab2";
const GLASS = "rgba(24, 17, 28, 0.5)";
const HAIRLINE = "1px solid rgba(246, 239, 233, 0.14)";
const BLUR = "blur(18px) saturate(1.2)";
const EASE = "cubic-bezier(.2,.8,.2,1)";

const styles = {
  wrapper: {
    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
    width: "100vw", height: "100vh", maxWidth: 480, margin: "0 auto",
    color: PEARL, background: INK, borderRadius: 28, overflow: "hidden",
    boxShadow: "0 25px 60px rgba(0, 0, 0, 0.45)",
    display: "flex", flexDirection: "column",
  },
  wrapperEmbedded: {
    width: "100%", height: "100%", maxWidth: "100%", margin: 0,
    borderRadius: 0, boxShadow: "none",
  },

  // ---------------- TOP ----------------
  topScrim: {
    position: "absolute", top: 0, left: 0, right: 0, height: 110, zIndex: 5,
    background: "linear-gradient(to bottom, rgba(18,13,20,0.55), rgba(18,13,20,0))",
    pointerEvents: "none",
  },
  topHud: {
    position: "absolute", top: 16, left: 16, right: 16, zIndex: 20,
    display: "flex", alignItems: "center", justifyContent: "space-between",
    pointerEvents: "none",
  },
  glassBtn: {
    width: 40, height: 40, borderRadius: "50%", padding: 0,
    background: GLASS, backdropFilter: BLUR, WebkitBackdropFilter: BLUR,
    border: HAIRLINE, color: PEARL, display: "grid", placeItems: "center",
    cursor: "pointer", pointerEvents: "auto",
    transition: `transform .2s ${EASE}, background .2s ease`,
  },

  // ---------------- CAMERA ----------------
  cameraViewport: {
    position: "absolute", inset: 0, width: "100%", height: "100%",
    background: INK, overflow: "hidden",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  hiddenVideo: {
    position: "absolute", inset: 0, width: "100%", height: "100%",
    objectFit: "cover", transform: "scaleX(-1)", pointerEvents: "none", opacity: 0,
  },
  cameraCanvas: {
    position: "absolute", inset: 0, width: "100%", height: "100%",
    objectFit: "cover", pointerEvents: "none",
  },
  capturedPhoto: {
    position: "absolute", inset: 0, width: "100%", height: "100%",
    objectFit: "contain", background: INK,
  },
  flashOverlay: {
    position: "absolute", inset: 0, background: "#ffffff", zIndex: 35,
    animation: "studio-flash 0.3s ease-out forwards", pointerEvents: "none",
  },

  // ---------------- RIGHT CONTROL RAIL ----------------
  rail: {
    position: "absolute", top: 72, right: 16, zIndex: 15,
    display: "flex", flexDirection: "column", gap: 2, padding: 5,
    borderRadius: 30, background: GLASS, border: HAIRLINE,
    backdropFilter: BLUR, WebkitBackdropFilter: BLUR,
  },
  railBtn: {
    width: 42, height: 42, borderRadius: "50%", padding: 0, border: "none",
    background: "transparent", color: PEARL, display: "grid", placeItems: "center",
    cursor: "pointer", transition: `background .35s ease, color .35s ease, transform .2s ${EASE}`,
  },
  railBtnOn: { background: "var(--accent)", color: "var(--accent-ink)" },

  // ---------------- LOADING STATE ----------------
  loadingOverlay: {
    position: "absolute", inset: 0, background: "rgba(18, 13, 20, 0.9)",
    backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)",
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", padding: 28, textAlign: "center", zIndex: 10,
  },
  loadingPulseIcon: {
    width: 56, height: 56, borderRadius: "50%",
    background: "rgba(246, 239, 233, 0.06)", border: HAIRLINE,
    display: "grid", placeItems: "center", marginBottom: 14,
    animation: "studio-pulse 2s ease-in-out infinite",
  },
  spinner: {
    width: 28, height: 28, border: "2px solid rgba(246, 239, 233, 0.16)",
    borderTopColor: PEARL, borderRadius: "50%", animation: "studio-spin 0.9s linear infinite",
  },
  loadingText: { marginTop: 16, fontSize: 14, color: PEARL, maxWidth: 260, lineHeight: 1.5 },
  primaryActionButton: {
    height: 46, padding: "0 22px", borderRadius: 23, border: "none",
    background: PEARL, color: INK, fontWeight: 700, fontSize: 14, cursor: "pointer",
  },
  secondaryActionButton: {
    height: 46, padding: "0 20px", borderRadius: 23, border: HAIRLINE,
    background: "rgba(246, 239, 233, 0.08)", color: PEARL, fontWeight: 600,
    fontSize: 14, cursor: "pointer",
  },

  // ---------------- BOTTOM SHEET ----------------
  sheet: {
    position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 20,
    padding: "84px 22px 24px",
    display: "flex", flexDirection: "column", gap: 14,
    background:
      "linear-gradient(to top, rgba(18,13,20,0.96) 0%, rgba(18,13,20,0.86) 52%, rgba(18,13,20,0) 100%)",
    animation: `sheet-rise .8s ${EASE} both`,
  },
  shadeHead: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  productLine: {
    fontSize: 12.5, fontWeight: 500, color: MUTED, letterSpacing: 0.1,
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  },
  shadeName: {
    fontFamily: '"Instrument Serif", "Cormorant Garamond", Georgia, serif',
    fontSize: 32, lineHeight: 1.05, color: PEARL, letterSpacing: -0.2,
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  },
  swatchTrack: {
    display: "flex", alignItems: "center", gap: 16, overflowX: "auto",
    padding: "8px 14px", margin: "0 -14px",
    WebkitMaskImage: "linear-gradient(90deg, transparent 0, #000 14px, #000 calc(100% - 14px), transparent 100%)",
    maskImage: "linear-gradient(90deg, transparent 0, #000 14px, #000 calc(100% - 14px), transparent 100%)",
  },
  swatch: {
    flexShrink: 0, width: 40, height: 40, borderRadius: "50%", border: "none",
    padding: 0, cursor: "pointer", scrollSnapAlign: "center",
    boxShadow: "inset 0 1px 2px rgba(255,255,255,0.4), inset 0 -7px 10px rgba(0,0,0,0.2)",
  },
  swatchOn: {
    boxShadow:
      `inset 0 1px 2px rgba(255,255,255,0.4), inset 0 -7px 10px rgba(0,0,0,0.2), 0 0 0 3px ${INK}, 0 0 0 4.5px ${PEARL}`,
    transform: "scale(1.1)",
  },

  // ---------------- ACTIONS ----------------
  actions: {
    display: "grid", gridTemplateColumns: "1fr auto 1fr",
    alignItems: "center", paddingTop: 4,
  },
  sideAction: {
    display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
    background: "none", border: "none", color: PEARL, cursor: "pointer", padding: 0,
  },
  sideActionIcon: {
    width: 48, height: 48, borderRadius: "50%", display: "grid", placeItems: "center",
    background: GLASS, border: HAIRLINE, backdropFilter: BLUR, WebkitBackdropFilter: BLUR,
  },
  sideActionLabel: { fontSize: 11.5, fontWeight: 500, color: MUTED },
  shutter: {
    width: 78, height: 78, borderRadius: "50%", padding: 5, background: "transparent",
    border: "2px solid rgba(246, 239, 233, 0.92)", cursor: "pointer",
    display: "grid", placeItems: "center",
    transition: `transform .2s ${EASE}`,
  },
  shutterCore: {
    display: "block", width: "100%", height: "100%", borderRadius: "50%",
    background: "var(--accent)",
    boxShadow:
      "inset 0 2px 6px rgba(255,255,255,0.35), inset 0 -10px 16px rgba(0,0,0,0.22), 0 8px 26px -6px var(--accent)",
    transition: "background .4s ease, box-shadow .4s ease",
  },
  actionsPhoto: { display: "flex", justifyContent: "center", gap: 12, paddingTop: 6 },
  ghostPill: {
    height: 50, padding: "0 22px", borderRadius: 25, border: HAIRLINE,
    background: GLASS, backdropFilter: BLUR, WebkitBackdropFilter: BLUR,
    color: PEARL, fontSize: 14, fontWeight: 600, cursor: "pointer",
    display: "inline-flex", alignItems: "center", gap: 8,
  },
  solidPill: {
    height: 50, padding: "0 26px", borderRadius: 25, border: "none",
    fontSize: 14, fontWeight: 700, cursor: "pointer",
    display: "inline-flex", alignItems: "center", gap: 8,
    boxShadow: "0 10px 28px -8px var(--accent)",
    transition: "background .4s ease, color .4s ease",
  },
};
