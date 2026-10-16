import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
  FaceLandmarker,
  HandLandmarker,
  FilesetResolver,
} from "@mediapipe/tasks-vision";

const DEFAULT_SHADES = [
  { name: "Burgundy Wine", hex: "#6B1835" },
  { name: "Classic Red", hex: "#D71940" },
  { name: "Cherry Red", hex: "#B80F2E" },
  { name: "Ruby Velvet", hex: "#9B111E" },
  { name: "Crimson", hex: "#DC143C" },
  { name: "Coral Glow", hex: "#FF6F61" },
  { name: "Rose Pink", hex: "#E75480" },
  { name: "Soft Pink", hex: "#E85D91" },
  { name: "Berry Crush", hex: "#85244D" },
  { name: "Wine Diva", hex: "#722F37" },
  { name: "Mulberry", hex: "#70193D" },
  { name: "Plum Luxe", hex: "#673147" },
  { name: "Warm Nude", hex: "#C68670" },
  { name: "Nude Rose", hex: "#B86F70" },
  { name: "Peach Nude", hex: "#D9A08C" },
  { name: "Mocha", hex: "#6F4E37" },
  { name: "Terracotta", hex: "#E2725B" },
  { name: "Brick Red", hex: "#CB4154" },
];

const OUTER_LIPS = [
  61, 185, 40, 39, 37, 0, 267, 269, 270, 409,
  291, 375, 321, 405, 314, 17, 84, 181, 91, 146,
];

const INNER_LIPS = [
  78, 191, 80, 81, 82, 13, 312, 311, 310, 415,
  308, 324, 318, 402, 317, 14, 87, 178, 88, 95,
];

function makeLipPath(landmarks, indices, width, height) {
  if (!landmarks || indices.some((index) => !landmarks[index])) {
    return null;
  }

  const points = indices.map((index) => ({
    x: landmarks[index].x * width,
    y: landmarks[index].y * height,
  }));

  const midpoint = (a, b) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });

  const path = new Path2D();
  const start = midpoint(points[points.length - 1], points[0]);
  path.moveTo(start.x, start.y);

  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const mid = midpoint(current, next);
    path.quadraticCurveTo(current.x, current.y, mid.x, mid.y);
  }

  path.closePath();
  return path;
}

function hexToRgb(hex) {
  const value = String(hex || "").replace("#", "");
  return {
    r: parseInt(value.slice(0, 2) || "D7", 16),
    g: parseInt(value.slice(2, 4) || "19", 16),
    b: parseInt(value.slice(4, 6) || "40", 16),
  };
}

function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("");
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

function drawLipstick(ctx, landmarks, width, height, color) {
  if (!ctx || !landmarks || landmarks.length < 468) return;

  const outer = makeLipPath(landmarks, OUTER_LIPS, width, height);
  const inner = makeLipPath(landmarks, INNER_LIPS, width, height);
  if (!outer || !inner) return;

  const rgb = hexToRgb(color);
  const lipMask = new Path2D();
  lipMask.addPath(outer);
  lipMask.addPath(inner);

  ctx.save();
  ctx.clip(lipMask, "evenodd");

  ctx.globalCompositeOperation = "multiply";
  ctx.globalAlpha = 0.52;
  ctx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  ctx.fillRect(0, 0, width, height);

  ctx.globalCompositeOperation = "source-atop";
  ctx.globalAlpha = 0.14;
  ctx.fillStyle = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  ctx.fillRect(0, 0, width, height);

  ctx.restore();
}

function getCameraCrop(video, canvas, zoom = 1.2) {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  const targetAspect = canvas.width / canvas.height;

  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;

  if (sourceWidth / sourceHeight > targetAspect) {
    cropWidth = sourceHeight * targetAspect;
  } else {
    cropHeight = sourceWidth / targetAspect;
  }

  cropWidth /= zoom;
  cropHeight /= zoom;

  return {
    sx: (sourceWidth - cropWidth) / 2,
    sy: (sourceHeight - cropHeight) / 2,
    sw: cropWidth,
    sh: cropHeight,
  };
}

function cropLandmarks(landmarks, crop, video) {
  return landmarks.map((point) => ({
    ...point,
    x: (point.x * video.videoWidth - crop.sx) / crop.sw,
    y: (point.y * video.videoHeight - crop.sy) / crop.sh,
  }));
}

function isHandCoveringMouth(faceLandmarks, hands) {
  if (!faceLandmarks || !hands?.length) return false;

  const lipPoints = [61, 291, 13, 14].map((index) => faceLandmarks[index]);
  if (lipPoints.some((point) => !point)) return false;

  const xs = lipPoints.map((point) => point.x);
  const ys = lipPoints.map((point) => point.y);

  const lipWidth = Math.max(...xs) - Math.min(...xs);
  const lipHeight = Math.max(...ys) - Math.min(...ys);

  const marginX = Math.max(lipWidth * 0.8, 0.025);
  const marginY = Math.max(lipHeight * 2.5, 0.035);

  const mouth = {
    left: Math.min(...xs) - marginX,
    right: Math.max(...xs) + marginX,
    top: Math.min(...ys) - marginY,
    bottom: Math.max(...ys) + marginY,
  };

  const mouthArea = (mouth.right - mouth.left) * (mouth.bottom - mouth.top);
  if (mouthArea <= 0) return false;

  return hands.some((hand) => {
    if (!hand?.length) return false;
    let pointsInside = 0;
    for (const point of hand) {
      if (
        point.x >= mouth.left &&
        point.x <= mouth.right &&
        point.y >= mouth.top &&
        point.y <= mouth.bottom
      ) {
        pointsInside++;
      }
    }
    if (pointsInside >= 2) return true;

    const hx = hand.map((point) => point.x);
    const hy = hand.map((point) => point.y);

    const overlapWidth = Math.max(
      0,
      Math.min(mouth.right, Math.max(...hx)) - Math.max(mouth.left, Math.min(...hx))
    );
    const overlapHeight = Math.max(
      0,
      Math.min(mouth.bottom, Math.max(...hy)) - Math.max(mouth.top, Math.min(...hy))
    );

    return (overlapWidth * overlapHeight) / mouthArea > 0.08;
  });
}

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

  const [activeTab, setActiveTab] = useState("shades");

  const [zoom, setZoom] = useState(1.2);
  const zoomRef = useRef(1.2);
  const [facingMode, setFacingMode] = useState("user");
  const facingModeRef = useRef("user");
  const [splitMode, setSplitMode] = useState(false);
  const splitModeRef = useRef(false);
  const [splitRatio, setSplitRatio] = useState(0.5);
  const splitRatioRef = useRef(0.5);

  const initialColor = resolveShadeColor(
    initialShade || initialProductTitle,
    "#6B1835"
  );
  const shadeRef = useRef(initialColor);
  const [shade, setShade] = useState(initialColor);
  const [hexInput, setHexInput] = useState(initialColor);
  const [customHex, setCustomHex] = useState(initialColor);

  const [status, setStatus] = useState("Starting camera...");
  const [cameraReady, setCameraReady] = useState(false);
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoMode, setPhotoMode] = useState(false);

  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const uploadCanvasRef = useRef(null);
  const uploadImageRef = useRef(null);
  const fileInputRef = useRef(null);
  const landmarkerRef = useRef(null);
  const handLandmarkerRef = useRef(null);
  const imageLandmarkerRef = useRef(null);
  const streamRef = useRef(null);
  const animationRef = useRef(null);
  const runningRef = useRef(false);
  const startingRef = useRef(false);
  const smoothedLandmarksRef = useRef(null);
  const uploadRequestRef = useRef(0);
  const isDraggingSplitRef = useRef(false);

  const colorCacheRef = useRef({});

  const applyShade = useCallback((color) => {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return;
    shadeRef.current = color;
    setShade(color);
    setHexInput(color.toUpperCase());
  }, []);

  // Compute robust list of lipstick shades. Guaranteed to NEVER be empty.
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
            : resolveShadeColor([v.title, currentProduct.title, ...(v.options || [])].join(" "), "#6B1835");
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
        const pVariants = p.variants && p.variants.length ? p.variants : [{ id: p.id, title: p.title, image: p.image }];
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
                : resolveShadeColor([v.title, p.title, ...(v.options || [])].join(" "), "#B80F2E");
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

  // Receive dynamic data from parent storefront window (Liquid catalog + variants)
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
              product.shade || [first.title, product.title, ...(first.options || [])].join(" "),
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

  // Dynamic image color extraction for variant images
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
            const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
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

    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    handLandmarkerRef.current?.close();
    handLandmarkerRef.current = null;

    setCameraReady(false);
  }, []);

  // Asynchronous background loader for MediaPipe vision tasks (GPU with automatic CPU fallback)
  const initVisionTasks = useCallback(async () => {
    try {
      if (!landmarkerRef.current) {
        const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
        try {
          landmarkerRef.current = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: "/mediapipe/face_landmarker.task",
              delegate: "GPU",
            },
            runningMode: "VIDEO",
            numFaces: 1,
          });
        } catch (gpuError) {
          console.warn("GPU delegate unavailable, using CPU for FaceLandmarker", gpuError);
          landmarkerRef.current = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: "/mediapipe/face_landmarker.task",
              delegate: "CPU",
            },
            runningMode: "VIDEO",
            numFaces: 1,
          });
        }

        try {
          handLandmarkerRef.current = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: "/mediapipe/hand_landmarker.task",
              delegate: "CPU",
            },
            runningMode: "VIDEO",
            numHands: 2,
          });
        } catch (handError) {
          console.warn("HandLandmarker optional initialization note:", handError);
        }
      }
    } catch (err) {
      console.warn("Vision tasks background loading error:", err);
    }
  }, []);

  // Resilient multi-stage camera startup that NEVER stalls the video feed
  const startCamera = useCallback(async (mode = facingModeRef.current) => {
    if (startingRef.current || runningRef.current) return;
    startingRef.current = true;
    setStatus("Connecting live camera...");

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera API is unavailable in this browser.");
      }

      // Step 1: Start video stream immediately (multi-fallback)
      let stream = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
  facingMode: mode ? { ideal: mode } : "user",
  width: { ideal: 640 },
  height: { ideal: 480 },
  frameRate: { ideal: 60, max: 60 },
},
          audio: false,
        });
      } catch (err1) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: mode || "user" },
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
      setStatus("Camera ready. Align your lips to try on shades.");

      // Step 2: Initialize vision tasks in background without blocking the live camera
      initVisionTasks();

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) {
        throw new Error("Could not initialize the preview canvas.");
      }

      let lastVideoTime = -1;

      const drawFrame = () => {
        if (!runningRef.current) return;

        if (video.readyState >= 2) {
          const width = video.videoWidth;
          const height = video.videoHeight;

          if (width && height) {
            if (canvas.width !== width || canvas.height !== height) {
              canvas.width = width;
              canvas.height = height;
            }

            if (video.currentTime !== lastVideoTime) {
              const currentZoom = zoomRef.current;
              const crop = getCameraCrop(video, canvas, currentZoom);
              lastVideoTime = video.currentTime;

              // Always draw the live video stream smoothly
              ctx.clearRect(0, 0, width, height);
              ctx.globalCompositeOperation = "source-over";
              ctx.globalAlpha = 1;
              ctx.drawImage(
                video,
                crop.sx,
                crop.sy,
                crop.sw,
                crop.sh,
                0,
                0,
                width,
                height
              );

              // If FaceLandmarker has completed background loading, track lips
              if (landmarkerRef.current) {
                try {
                  const timestamp = performance.now();
                  const result = landmarkerRef.current.detectForVideo(video, timestamp);
                  const handResult = handLandmarkerRef.current
                    ? handLandmarkerRef.current.detectForVideo(video, timestamp)
                    : null;
                  const originalFace = result.faceLandmarks?.[0];
                  const hands = handResult?.landmarks ?? [];
                  const handCoversMouth = isHandCoveringMouth(originalFace, hands);

                  if (originalFace) {
                    const croppedFace = cropLandmarks(originalFace, crop, video);
                    const previous = smoothedLandmarksRef.current;
                    const smoothing = 0.35;

                    const smoothed =
                      previous && previous.length === croppedFace.length
                        ? croppedFace.map((point, index) => ({
                            x: previous[index].x * smoothing + point.x * (1 - smoothing),
                            y: previous[index].y * smoothing + point.y * (1 - smoothing),
                            z: (previous[index].z ?? 0) * smoothing + (point.z ?? 0) * (1 - smoothing),
                          }))
                        : croppedFace.map((point) => ({ ...point }));

                    smoothedLandmarksRef.current = smoothed;

                    if (!handCoversMouth) {
                      const isSplit = splitModeRef.current;
                      const ratio = splitRatioRef.current;

                      if (isSplit) {
                        ctx.save();
                        ctx.beginPath();
                        ctx.rect(width * ratio, 0, width * (1 - ratio), height);
                        ctx.clip();
                        drawLipstick(ctx, smoothed, width, height, shadeRef.current);
                        ctx.restore();

                        // Vertical divider line
                        ctx.save();
                        ctx.strokeStyle = "rgba(255, 255, 255, 0.95)";
                        ctx.lineWidth = 2.5;
                        ctx.beginPath();
                        ctx.moveTo(width * ratio, 0);
                        ctx.lineTo(width * ratio, height);
                        ctx.stroke();

                        // Center slider button
                        const midY = height / 2;
                        ctx.fillStyle = "#ffffff";
                        ctx.shadowColor = "rgba(0, 0, 0, 0.4)";
                        ctx.shadowBlur = 8;
                        ctx.beginPath();
                        ctx.arc(width * ratio, midY, 15, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.shadowBlur = 0;

                        ctx.fillStyle = "#111111";
                        ctx.font = "bold 12px sans-serif";
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        ctx.fillText("⇄", width * ratio, midY);

                        // Before & After badges
                        ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
                        ctx.beginPath();
                        ctx.roundRect(14, 16, 70, 24, 6);
                        ctx.fill();
                        ctx.fillStyle = "#ffffff";
                        ctx.font = "bold 10px sans-serif";
                        ctx.textAlign = "center";
                        ctx.textBaseline = "middle";
                        ctx.fillText("BEFORE", 49, 28);

                        ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
                        ctx.beginPath();
                        ctx.roundRect(width - 84, 16, 70, 24, 6);
                        ctx.fill();
                        ctx.fillStyle = "#ffffff";
                        ctx.fillText("AFTER", width - 49, 28);
                        ctx.restore();
                      } else {
                        drawLipstick(ctx, smoothed, width, height, shadeRef.current);
                      }
                    }
                  } else {
                    smoothedLandmarksRef.current = null;
                  }
                } catch {
                  // Keep video frame alive even if detection skips a cycle
                }
              }
            }
          }
        }
        animationRef.current = requestAnimationFrame(drawFrame);
      };

      drawFrame();
    } catch (error) {
      console.error("Camera startup error:", error);
      stopCamera();
      setStatus(
        error?.name === "NotAllowedError"
          ? "Camera permission denied. Allow camera access or upload a photo."
          : `Camera is currently unavailable: ${error.message || "Please retry"}`
      );
    }
  }, [stopCamera, initVisionTasks]);

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
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
      handLandmarkerRef.current?.close();
      handLandmarkerRef.current = null;
      uploadRequestRef.current += 1;
      imageLandmarkerRef.current?.close();
      imageLandmarkerRef.current = null;
    };
  }, [startCamera]);

  const renderUploadedPhoto = useCallback(async (image) => {
    const requestId = ++uploadRequestRef.current;
    try {
      if (!image.complete || !image.naturalWidth || !image.naturalHeight) return;
      setStatus("Detecting lips in photo...");

      if (!imageLandmarkerRef.current) {
        const vision = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
        imageLandmarkerRef.current = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "/mediapipe/face_landmarker.task",
            delegate: "GPU",
          },
          runningMode: "IMAGE",
          numFaces: 1,
        });
      }

      const result = imageLandmarkerRef.current.detect(image);
      if (requestId !== uploadRequestRef.current) return;

      const canvas = uploadCanvasRef.current;
      if (!canvas) return;

      const scale = Math.min(1, 1400 / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      const face = result.faceLandmarks?.[0];
      if (!face) {
        setPhotoUrl(canvas.toDataURL("image/jpeg", 0.94));
        setStatus("No face detected in photo. Try another front-facing image.");
        return;
      }

      drawLipstick(ctx, face, canvas.width, canvas.height, shadeRef.current);
      if (requestId !== uploadRequestRef.current) return;

      setPhotoUrl(canvas.toDataURL("image/jpeg", 0.94));
      setStatus("Shade applied to your photo! Select other shades to compare.");
    } catch (err) {
      console.error("Photo rendering error:", err);
      if (requestId === uploadRequestRef.current) {
        setStatus("Could not process photo. Please choose another.");
      }
    }
  }, []);

  useEffect(() => {
    if (photoMode && uploadImageRef.current) {
      renderUploadedPhoto(uploadImageRef.current);
    }
  }, [photoMode, shade, renderUploadedPhoto]);

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

  const handleZoomIn = () => {
    setZoom((prev) => {
      const next = Math.min(2.2, Math.round((prev + 0.25) * 100) / 100);
      zoomRef.current = next;
      return next;
    });
  };

  const handleZoomOut = () => {
    setZoom((prev) => {
      const next = Math.max(1.0, Math.round((prev - 0.25) * 100) / 100);
      zoomRef.current = next;
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
      ctx.translate(exportCanvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(canvas, 0, 0);
      downloadData = exportCanvas.toDataURL("image/jpeg", 0.94);
    }
    if (!downloadData) return;
    const a = document.createElement("a");
    a.href = downloadData;
    a.download = `vibecheck-${currentProduct.handle || "lipstick"}-tryon.jpg`;
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
    const output = document.createElement("canvas");
    output.width = overlay.width;
    output.height = overlay.height;
    const ctx = output.getContext("2d");
    if (!ctx) return;
    ctx.translate(output.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(overlay, 0, 0, output.width, output.height);
    const url = output.toDataURL("image/jpeg", 0.94);
    setPhotoUrl(url);
    setPhotoMode(true);
    stopCamera();
    setStatus("Snapshot captured! You can download or retake.");
  };

  const handleFileUpload = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatus("Please select a valid image.");
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
    const vars = prod.variants && prod.variants.length ? prod.variants : [{ id: prod.id, title: prod.title, image: prod.image }];
    setProductVariants(vars);
    const first = vars[0];
    setActiveVariantId(first.id);
    const firstColor =
      first.swatch ||
      resolveShadeColor([first.title, prod.title, ...(first.options || [])].join(" "), "#B80F2E");
    applyShade(firstColor);
    setActiveTab("shades");
  };

  const closeSelf = () => {
    window.parent?.postMessage({ type: "VIBECHECK_CLOSE" }, "*");
  };

  const handleSplitDrag = (clientX, rect) => {
    if (!rect.width) return;
    const ratio = Math.max(0.1, Math.min(0.9, (clientX - rect.left) / rect.width));
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
          background: #0c0c0e !important;
          -webkit-font-smoothing: antialiased;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        }
        *, *::before, *::after {
          box-sizing: border-box;
        }
        @keyframes vibecheck-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes vibecheck-pulse {
          0%, 100% { opacity: 0.6; transform: scale(0.96); }
          50% { opacity: 1; transform: scale(1.05); }
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

        {/* 70% Camera Viewport */}
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
          {!photoMode ? (
            <>
              <video ref={videoRef} muted playsInline style={styles.hiddenVideo} />
              <canvas
                ref={canvasRef}
                style={{
                  ...styles.cameraCanvas,
                  transform: facingMode === "user" ? "scaleX(-1)" : "none",
                }}
              />
              {!cameraReady && (
                <div style={styles.loadingOverlay}>
                  <div style={styles.loadingPulseIcon}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                      <circle cx="12" cy="13" r="4" />
                    </svg>
                  </div>
                  <div style={styles.spinner} />
                  <p style={{ marginTop: 12, fontSize: 13, color: "#fff", maxWidth: 280, lineHeight: 1.4 }}>{status}</p>
                  <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
                    <button
                      type="button"
                      onClick={() => startCamera()}
                      style={styles.retryButton}
                    >
                      Start Live Camera
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      style={styles.uploadAltButton}
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

        {/* Floating Controls Overlay - Right Edge */}
        <aside
          style={{
            ...styles.floatingToolbar,
            top: embedded ? 50 : 14,
          }}
          aria-label="Camera controls"
        >
          <button
            type="button"
            title="Toggle fullscreen"
            onClick={toggleFullscreen}
            style={styles.toolButton}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
            </svg>
          </button>

          <button
            type="button"
            title={`Flip camera (currently ${facingMode === "user" ? "front" : "back"})`}
            onClick={toggleFlipCamera}
            style={styles.toolButton}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 10c0-4.418-3.582-8-8-8s-8 3.582-8 8c0 1.954.702 3.745 1.87 5.143L4 18h6v-6l-2.09 2.09C7.03 12.91 6.5 11.52 6.5 10c0-3.038 2.462-5.5 5.5-5.5s5.5 2.462 5.5 5.5-2.462 5.5-5.5 5.5v2.5c4.418 0 8-3.582 8-8z" />
            </svg>
          </button>

          <button
            type="button"
            title={`Zoom In (${zoom.toFixed(1)}x)`}
            onClick={handleZoomIn}
            style={styles.toolButton}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>

          <button
            type="button"
            title={`Zoom Out (${zoom.toFixed(1)}x)`}
            onClick={handleZoomOut}
            style={styles.toolButton}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>

          <button
            type="button"
            title={`Split screen Before / After comparison (${Math.round(splitRatio * 100)}%)`}
            onClick={toggleSplitMode}
            style={{
              ...styles.toolButton,
              ...(splitMode ? styles.toolButtonActive : {}),
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <line x1="12" y1="3" x2="12" y2="21" strokeDasharray="3 3" />
            </svg>
          </button>

          <button
            type="button"
            title="Upload selfie photo"
            onClick={() => fileInputRef.current?.click()}
            style={styles.toolButton}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>

          <button
            type="button"
            title="Download snapshot"
            onClick={handleDownloadSnapshot}
            style={styles.toolButton}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
        </aside>

        {/* Shutter button in center bottom of camera view */}
        <div style={styles.shutterContainer}>
          {!photoMode ? (
            <button
              type="button"
              onClick={capturePhoto}
              title="Capture snapshot"
              style={styles.shutterButton}
            >
              <div style={styles.shutterInner} />
            </button>
          ) : (
            <button
              type="button"
              onClick={retakePhoto}
              title="Back to live camera"
              style={styles.retakeButton}
            >
              ↺ Retake Live
            </button>
          )}
        </div>

        {/* Watermark branding */}
        <div style={styles.watermark}>
          Powered by <strong style={{ color: "#fff" }}>Vibecheck</strong>
        </div>

        {/* Embedded close button */}
        {embedded && (
          <button
            type="button"
            onClick={closeSelf}
            title="Close try-on"
            style={styles.closeOverlayButton}
          >
            ✕
          </button>
        )}
      </div>

      {/* 30% Bottom Options Tray */}
      <div style={styles.bottomTray}>
        {/* Navigation Tabs */}
        <nav style={styles.tabBar}>
          <button
            type="button"
            onClick={() => setActiveTab("shades")}
            style={{
              ...styles.tabButton,
              ...(activeTab === "shades" ? styles.tabButtonActive : {}),
            }}
          >
            LIP COLOR
          </button>

          {catalog.length > 0 && (
            <button
              type="button"
              onClick={() => setActiveTab("products")}
              style={{
                ...styles.tabButton,
                ...(activeTab === "products" ? styles.tabButtonActive : {}),
              }}
            >
              MORE LIPSTICKS ({catalog.length})
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveTab("custom")}
            style={{
              ...styles.tabButton,
              ...(activeTab === "custom" ? styles.tabButtonActive : {}),
            }}
          >
            CUSTOM SHADE
          </button>
        </nav>

        {/* Shade / Product Carousel Area */}
        <div style={styles.carouselContainer}>
          {activeTab === "shades" && (
            <div style={styles.carouselTrack}>
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
                      ...styles.cardItem,
                      ...(isSelected ? styles.cardItemActive : {}),
                    }}
                  >
                    <div style={styles.thumbnailWrapper}>
                      {item.image ? (
                        <img
                          src={item.image}
                          alt={item.name}
                          style={styles.thumbnailImage}
                        />
                      ) : (
                        <div
                          style={{
                            ...styles.colorSwatchBlock,
                            background: item.hex,
                          }}
                        />
                      )}
                      <span
                        style={{
                          ...styles.swatchPip,
                          background: item.hex,
                        }}
                      />
                    </div>
                    <span style={styles.cardTitle}>{item.name}</span>
                  </button>
                );
              })}
            </div>
          )}

          {activeTab === "products" && (
            <div style={styles.carouselTrack}>
              {catalog.map((prod) => {
                const isSelected = String(prod.id) === String(currentProduct.id);
                return (
                  <button
                    key={prod.id}
                    type="button"
                    onClick={() => selectProduct(prod)}
                    title={`${prod.title} — ${prod.price || ""}`}
                    style={{
                      ...styles.cardItem,
                      ...(isSelected ? styles.cardItemActive : {}),
                    }}
                  >
                    <div style={styles.thumbnailWrapper}>
                      {prod.image ? (
                        <img
                          src={prod.image}
                          alt={prod.title}
                          style={styles.thumbnailImage}
                        />
                      ) : (
                        <div style={styles.placeholderThumbnail}>💄</div>
                      )}
                    </div>
                    <span style={styles.cardTitle}>{prod.title}</span>
                  </button>
                );
              })}
            </div>
          )}

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
                <span
                  style={{
                    ...styles.activeColorIndicator,
                    background: shade,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* The Action Options at the VERY BOTTOM */}
        <div style={styles.bottomActionsRow}>
          {!photoMode ? (
            <>
              <button
                type="button"
                onClick={() => {
                  if (!cameraReady) {
                    startCamera();
                  } else {
                    capturePhoto();
                  }
                }}
                style={styles.texturedButton}
                title="Capture photo from live camera"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                <span>Capture</span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={styles.texturedButton}
                title="Upload a photo from your device"
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
                style={styles.texturedButton}
                title="Return to live camera"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 10c0-4.418-3.582-8-8-8s-8 3.582-8 8c0 1.954.702 3.745 1.87 5.143L4 18h6v-6l-2.09 2.09C7.03 12.91 6.5 11.52 6.5 10c0-3.038 2.462-5.5 5.5-5.5s5.5 2.462 5.5 5.5-2.462 5.5-5.5 5.5v2.5c4.418 0 8-3.582 8-8z" />
                </svg>
                <span>Live Camera</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadSnapshot}
                style={styles.texturedButton}
                title="Download snapshot photo"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                <span>Download Photo</span>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
    </>
  );
}

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
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    color: "#181818",
    background: "#0c0c0e",
    borderRadius: 22,
    overflow: "hidden",
    boxShadow: "0 20px 50px rgba(0,0,0,0.15)",
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
  // 70% Camera Viewport
  cameraViewport: {
    position: "relative",
    width: "100%",
    height: "70%",
    flex: "0 0 70%",
    minHeight: "70%",
    maxHeight: "70%",
    background: "#0c0c0e",
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
},
  cameraCanvas: {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  transform: "scaleX(-1)",
  pointerEvents: "none",
},
  capturedPhoto: {
    position: "absolute",
    inset: 0,
    width: "100%",
    height: "100%",
    objectFit: "contain",
    background: "#0c0c0e",
  },
  loadingOverlay: {
    position: "absolute",
    inset: 0,
    background: "rgba(10, 10, 12, 0.85)",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    textAlign: "center",
    zIndex: 5,
  },
  loadingPulseIcon: {
    width: 48,
    height: 48,
    borderRadius: "50%",
    background: "rgba(255, 255, 255, 0.12)",
    border: "1px solid rgba(255, 255, 255, 0.25)",
    display: "grid",
    placeItems: "center",
    marginBottom: 8,
    animation: "vibecheck-pulse 1.8s ease-in-out infinite",
  },
  spinner: {
    width: 38,
    height: 38,
    border: "3px solid rgba(255,255,255,0.25)",
    borderTopColor: "#fff",
    borderRadius: "50%",
    animation: "vibecheck-spin 0.8s linear infinite",
  },
  retryButton: {
    marginTop: 14,
    padding: "8px 16px",
    borderRadius: 8,
    background: "#fff",
    color: "#111",
    border: "none",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  },
  uploadAltButton: {
    marginTop: 14,
    padding: "8px 14px",
    borderRadius: 8,
    background: "rgba(255, 255, 255, 0.18)",
    color: "#fff",
    border: "1px solid rgba(255, 255, 255, 0.3)",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
  },
  floatingToolbar: {
    position: "absolute",
    top: 14,
    right: 12,
    zIndex: 10,
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  toolButton: {
    width: 34,
    height: 34,
    borderRadius: "50%",
    border: "1px solid rgba(255, 255, 255, 0.22)",
    background: "rgba(0, 0, 0, 0.52)",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    color: "#ffffff",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    padding: 0,
    transition: "background 0.15s ease, transform 0.15s ease",
  },
  toolButtonActive: {
    background: "#E6004C",
    borderColor: "#E6004C",
    boxShadow: "0 0 10px rgba(230, 0, 76, 0.6)",
  },
  shutterContainer: {
    position: "absolute",
    bottom: 22,
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: 10,
  },
  shutterButton: {
    width: 50,
    height: 50,
    borderRadius: "50%",
    background: "rgba(255, 255, 255, 0.85)",
    border: "3px solid #ffffff",
    boxShadow: "0 4px 14px rgba(0, 0, 0, 0.35)",
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    padding: 0,
    transition: "transform 0.15s ease",
  },
  shutterInner: {
    width: 38,
    height: 38,
    borderRadius: "50%",
    background: "#ffffff",
    border: "2px solid #222",
  },
  retakeButton: {
    padding: "7px 16px",
    borderRadius: 20,
    background: "rgba(0,0,0,0.72)",
    border: "1px solid rgba(255,255,255,0.3)",
    color: "#fff",
    fontSize: 12,
    fontWeight: 650,
    cursor: "pointer",
    backdropFilter: "blur(6px)",
  },
  watermark: {
    position: "absolute",
    bottom: 5,
    left: 0,
    right: 0,
    textAlign: "center",
    color: "rgba(255, 255, 255, 0.65)",
    fontSize: 10,
    letterSpacing: 0.5,
    pointerEvents: "none",
    zIndex: 6,
  },
  closeOverlayButton: {
    position: "absolute",
    top: 10,
    left: 12,
    zIndex: 12,
    width: 30,
    height: 30,
    borderRadius: "50%",
    background: "rgba(0, 0, 0, 0.5)",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    color: "#fff",
    fontSize: 13,
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
  },
  // 30% Options Tray
  bottomTray: {
    position: "relative",
    background: "#ffffff",
    width: "100%",
    height: "30%",
    flex: "0 0 30%",
    minHeight: "30%",
    maxHeight: "30%",
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    padding: "6px 10px 8px",
    boxSizing: "border-box",
    overflow: "hidden",
    borderTop: "1px solid rgba(0, 0, 0, 0.08)",
  },
  tabBar: {
    display: "flex",
    alignItems: "center",
    gap: 16,
    padding: "0 6px",
    borderBottom: "1px solid #f0f0f0",
    flexShrink: 0,
  },
  tabButton: {
    background: "none",
    border: "none",
    borderBottom: "2px solid transparent",
    padding: "3px 2px 5px",
    color: "#777",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.8,
    cursor: "pointer",
    transition: "color 0.15s ease, border-color 0.15s ease",
  },
  tabButtonActive: {
    color: "#E6004C",
    borderBottomColor: "#E6004C",
  },
  carouselContainer: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    alignItems: "center",
    overflow: "hidden",
  },
  carouselTrack: {
    display: "flex",
    gap: 10,
    overflowX: "auto",
    padding: "2px 4px",
    scrollbarWidth: "none",
    WebkitOverflowScrolling: "touch",
    alignItems: "center",
    width: "100%",
  },
  cardItem: {
    flexShrink: 0,
    width: 58,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 3,
    background: "none",
    border: "2px solid transparent",
    borderRadius: 10,
    padding: "2px",
    cursor: "pointer",
    transition: "transform 0.15s ease, border-color 0.15s ease",
  },
  cardItemActive: {
    borderColor: "#E6004C",
    background: "#fff5f7",
    boxShadow: "0 0 8px rgba(230, 0, 76, 0.25)",
  },
  thumbnailWrapper: {
    position: "relative",
    width: 44,
    height: 44,
    borderRadius: 8,
    overflow: "hidden",
    border: "1px solid #e5e5e5",
    background: "#fafafa",
  },
  thumbnailImage: {
    width: "100%",
    height: "100%",
    objectFit: "contain",
  },
  colorSwatchBlock: {
    width: "100%",
    height: "100%",
  },
  placeholderThumbnail: {
    width: "100%",
    height: "100%",
    display: "grid",
    placeItems: "center",
    fontSize: 20,
  },
  swatchPip: {
    position: "absolute",
    bottom: 2,
    right: 2,
    width: 10,
    height: 10,
    borderRadius: "50%",
    border: "1.5px solid #fff",
    boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
  },
  cardTitle: {
    fontSize: 9.5,
    fontWeight: 600,
    color: "#222",
    textAlign: "center",
    width: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  customColorPanel: {
    padding: "2px 4px",
    width: "100%",
  },
  customColorRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  nativeColorInput: {
    width: 38,
    height: 30,
    border: "1px solid #ddd",
    borderRadius: 8,
    padding: 2,
    cursor: "pointer",
    background: "#fff",
  },
  hexTextInput: {
    flex: 1,
    height: 30,
    border: "1px solid #ddd",
    borderRadius: 8,
    padding: "0 10px",
    fontFamily: "monospace",
    fontSize: 12,
  },
  activeColorIndicator: {
    width: 30,
    height: 30,
    borderRadius: "50%",
    border: "1px solid rgba(0,0,0,0.15)",
    boxShadow: "inset 0 0 4px rgba(0,0,0,0.15)",
  },
  // Options placed at the VERY BOTTOM
  bottomActionsRow: {
    display: "flex",
    gap: 8,
    width: "100%",
    boxSizing: "border-box",
    paddingTop: 4,
    borderTop: "1px solid #f2f2f4",
    flexShrink: 0,
  },
  texturedButton: {
    flex: 1,
    height: 32,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    padding: "0 12px",
    borderRadius: 16,
    border: "1px solid rgba(255, 255, 255, 0.18)",
    background: "linear-gradient(145deg, #28282e 0%, #161619 100%)",
    boxShadow: "0 3px 8px rgba(0, 0, 0, 0.2), inset 0 1px 1px rgba(255, 255, 255, 0.22)",
    color: "#ffffff",
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: 0.3,
    cursor: "pointer",
    textDecoration: "none",
    transition: "all 0.16s ease",
  },
};
