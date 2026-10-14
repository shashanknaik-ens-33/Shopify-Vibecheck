import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import {
  FaceLandmarker,
  FilesetResolver,
} from "@mediapipe/tasks-vision";
const SHADES = [
  { name: "Classic Red", hex: "#D71940" },
  { name: "Cherry Red", hex: "#B80F2E" },
  { name: "Ruby", hex: "#9B111E" },
  { name: "Crimson", hex: "#DC143C" },
  { name: "Coral", hex: "#FF6F61" },
  { name: "Rose Pink", hex: "#E75480" },
  { name: "Soft Pink", hex: "#E85D91" },
  { name: "Hot Pink", hex: "#FF1493" },
  { name: "Dusty Rose", hex: "#C08081" },
  { name: "Mauve", hex: "#B784A7" },
  { name: "Berry", hex: "#85244D" },
  { name: "Mulberry", hex: "#70193D" },
  { name: "Plum", hex: "#673147" },
  { name: "Burgundy Wine", hex: "#6B1835" },
  { name: "Oxblood", hex: "#4A0404" },
  { name: "Wine Red", hex: "#722F37" },
  { name: "Rosewood", hex: "#65000B" },
  { name: "Nude Rose", hex: "#B86F70" },
  { name: "Peach Nude", hex: "#D9A08C" },
  { name: "Warm Nude", hex: "#C68670" },
  { name: "Caramel", hex: "#A56B46" },
  { name: "Mocha", hex: "#6F4E37" },
  { name: "Chocolate", hex: "#5C3317" },
  { name: "Brown Sugar", hex: "#8D5524" },
  { name: "Terracotta", hex: "#E2725B" },
  { name: "Orange Red", hex: "#FF4500" },
  { name: "Brick Red", hex: "#CB4154" },
  { name: "Deep Purple", hex: "#673AB7" },
  { name: "Magenta", hex: "#C2185B" },
  { name: "Custom shade", hex: "#C2185B" },
];
const OUTER_LIPS = [
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375,
  291, 409, 270, 269, 267, 0, 37, 39, 40, 185,
];
const INNER_LIPS = [
  78, 95, 88, 178, 87, 14, 317, 402, 318, 324,
  308, 415, 310, 311, 312, 13, 82, 81, 80, 191,
];
function traceContour(ctx, landmarks, indices, width, height) {
  const points = indices.map((index) => landmarks[index]);
  if (points.some((point) => !point) || points.length < 3) return false;

  const midpoint = (a, b) => ({
    x: ((a.x + b.x) / 2) * width,
    y: ((a.y + b.y) / 2) * height,
  });

  const firstMidpoint = midpoint(points[points.length - 1], points[0]);
  ctx.moveTo(firstMidpoint.x, firstMidpoint.y);

  for (let i = 0; i < points.length; i++) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    const nextMidpoint = midpoint(current, next);
    ctx.quadraticCurveTo(
      current.x * width,
      current.y * height,
      nextMidpoint.x,
      nextMidpoint.y
    );
  }

  ctx.closePath();
  return true;
}



function drawLipstick(ctx, landmarks, width, height, color) {
  if (
    !landmarks ||
    !OUTER_LIPS.every((i) => landmarks[i]) ||
    !INNER_LIPS.every((i) => landmarks[i])
  ) {
    return;
  }

  const createLipPath = (indices) => {
    const path = new Path2D();
    const points = indices.map((i) => ({
      x: landmarks[i].x * width,
      y: landmarks[i].y * height,
    }));

    if (points.length < 3) return path;

    const midpoint = (a, b) => ({
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    });

    const start = midpoint(points[points.length - 1], points[0]);
    path.moveTo(start.x, start.y);

    for (let i = 0; i < points.length; i++) {
      const current = points[i];
      const next = points[(i + 1) % points.length];
      const mid = midpoint(current, next);

      path.quadraticCurveTo(
        current.x,
        current.y,
        mid.x,
        mid.y
      );
    }

    path.closePath();
    return path;
  };

  const outerPath = createLipPath(OUTER_LIPS);
  const innerPath = createLipPath(INNER_LIPS);

  ctx.save();

  // Clip the drawing to the outer lip boundary.
  ctx.clip(outerPath);

  // Remove the mouth opening from the clip.
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "#000";
  ctx.fill(innerPath);

  // Restore a fresh outer clip for the lipstick layer.
  ctx.restore();
  ctx.save();

  ctx.clip(outerPath);

  // Draw lipstick inside the lip contour.
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 0.38;
  ctx.fillStyle = color;
  ctx.fill(outerPath);

  // Keep the inner mouth transparent.
  ctx.globalCompositeOperation = "destination-out";
  ctx.globalAlpha = 1;
  ctx.fill(innerPath);

  ctx.restore();
}



export default function CameraTest() {
  const [searchParams] = useSearchParams();
  const productId = searchParams.get("id") || "";
  const productTitle = searchParams.get("title") || "Virtual Try-On";
  const productHandle = searchParams.get("handle") || "";
  const productCategory = searchParams.get("category") || "";
  const productImage = searchParams.get("image") || "";
  const initialShade = searchParams.get("shade") || "";
  const initialColor =
    /^#[0-9a-f]{6}$/i.test(initialShade)
      ? initialShade
      : SHADES.find((s) =>
          initialShade &&
          s.name.toLowerCase().includes(initialShade.toLowerCase())
        )?.hex || "#D71940";
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const landmarkerRef = useRef(null);
  const streamRef = useRef(null);
  const animationRef = useRef(null);
  const runningRef = useRef(false);
  const startingRef = useRef(false);
  const smoothedLandmarksRef = useRef(null);
  const shadeRef = useRef(initialColor);
  const [shade, setShade] = useState(initialColor);
  const [hexInput, setHexInput] = useState(initialColor);
  const [status, setStatus] = useState("Preparing your camera...");
  const [cameraReady, setCameraReady] = useState(false);
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoMode, setPhotoMode] = useState(false);
  const [customHex, setCustomHex] = useState("#C2185B");
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
    setCameraReady(false);
  }, []);
  const applyShade = useCallback((color) => {
    if (!/^#[0-9a-f]{6}$/i.test(color)) return;
    shadeRef.current = color;
    setShade(color);
    setHexInput(color.toUpperCase());
  }, []);
  const startCamera = useCallback(async () => {
    if (startingRef.current || runningRef.current) return;
    startingRef.current = true;
    setStatus("Loading face tracking...");
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access is unavailable in this browser.");
      }
      if (!landmarkerRef.current) {
        const vision = await FilesetResolver.forVisionTasks(
          "/mediapipe/wasm"
        );
        landmarkerRef.current =
          await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: "/mediapipe/face_landmarker.task",
              delegate: "GPU",
            },
            runningMode: "VIDEO",
            numFaces: 1,
          });
      }
      setStatus("Requesting front-camera permission...");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error("Camera preview is unavailable.");
      video.srcObject = stream;
      await video.play();
      runningRef.current = true;
      startingRef.current = false;
      setCameraReady(true);
      setStatus("Camera ready. Position your face in the frame.");
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) {
        throw new Error("Could not initialize the preview.");
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
              const result = landmarkerRef.current.detectForVideo(
                video,
                performance.now()
              );
              lastVideoTime = video.currentTime;
              ctx.clearRect(0, 0, width, height);
              const face = result.faceLandmarks?.[0];
              if (face) {
                const previous = smoothedLandmarksRef.current;
                const smoothing = 0.35;
                const smoothed = previous && previous.length === face.length
                  ? face.map((point, index) => ({
                      x: previous[index].x * smoothing + point.x * (1 - smoothing),
                      y: previous[index].y * smoothing + point.y * (1 - smoothing),
                      z: (previous[index].z ?? 0) * smoothing + (point.z ?? 0) * (1 - smoothing),
                    }))
                  : face.map((point) => ({ ...point }));

                smoothedLandmarksRef.current = smoothed;
                drawLipstick(ctx, smoothed, width, height, shadeRef.current);
                setStatus("Face detected. Try your lipstick shades!");
              } else {
                smoothedLandmarksRef.current = null;
                setStatus("Camera ready. Move your face into view.");
              }
            }
          }
        }
        animationRef.current = requestAnimationFrame(drawFrame);
      };
      drawFrame();
    } catch (error) {
      console.error("Vibecheck camera error:", error);
      stopCamera();
      setStatus(
        error?.name === "NotAllowedError"
          ? "Camera permission denied. Allow camera access and try again, or upload a photo."
          : `Could not start the camera: ${error.message}`
      );
    }
  }, [stopCamera]);
  // Start the camera automatically when this page opens.
  useEffect(() => {
    startCamera();
    return () => {
      runningRef.current = false;
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      landmarkerRef.current?.close();
    };
  }, [startCamera]);
  function capturePhoto() {
    const video = videoRef.current;
    const overlay = canvasRef.current;
    if (!video || !overlay || !video.videoWidth) {
      setStatus("Wait until the camera preview is ready.");
      return;
    }
    const output = document.createElement("canvas");
    output.width = video.videoWidth;
    output.height = video.videoHeight;
    const ctx = output.getContext("2d");
    if (!ctx) return;
    // Mirror the selfie and its overlay together.
    ctx.translate(output.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, output.width, output.height);
    ctx.setTransform(-1, 0, 0, 1, output.width, 0);
    ctx.drawImage(overlay, 0, 0, output.width, output.height);
    const url = output.toDataURL("image/jpeg", 0.92);
    setPhotoUrl(url);
    setPhotoMode(true);
    stopCamera();
    setStatus("Photo captured. You can download it or retake it.");
  }
  function uploadPhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatus("Please choose a valid image.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setStatus("Choose an image smaller than 15 MB.");
      return;
    }
    const url = URL.createObjectURL(file);
    setPhotoUrl((old) => {
      if (old.startsWith("blob:")) URL.revokeObjectURL(old);
      return url;
    });
    setPhotoMode(true);
    stopCamera();
    setStatus(
      "Photo uploaded. Live lipstick tracking on uploaded photos is not enabled yet."
    );
    event.target.value = "";
  }
  function retakePhoto() {
    if (photoUrl.startsWith("blob:")) URL.revokeObjectURL(photoUrl);
    setPhotoUrl("");
    setPhotoMode(false);
    startCamera();
  }
  const productPageUrl = productHandle
    ? `/products/${encodeURIComponent(productHandle)}`
    : "";
  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <div style={styles.eyebrow}>VIBECHECK BEAUTY STUDIO</div>
          <h1 style={styles.heading}>Virtual Try-On</h1>
          <p style={styles.muted}>
            Try shades live and find your next favourite.
          </p>
        </div>
        {productPageUrl && (
          <a href={productPageUrl} style={styles.backLink}>
            Back to product
          </a>
        )}
      </header>
      <div style={styles.layout}>
        <section style={styles.cameraColumn}>
          <div style={styles.cameraFrame}>
            {!photoMode ? (
              <>
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  style={styles.video}
                />
                  <canvas
                    ref={canvasRef}
                    style={styles.overlay}
                  />
                {!cameraReady && (
                  <div style={styles.cameraMessage}>
                    <span style={{ fontSize: 34 }}>📷</span>
                    <p>{status}</p>
                    <button
                      type="button"
                      onClick={startCamera}
                      style={styles.primaryButton}
                    >
                      Start camera
                    </button>
                  </div>
                )}
              </>
            ) : (
              <img
                src={photoUrl}
                alt="Captured or uploaded preview"
                style={styles.photo}
              />
            )}
          </div>
          <p role="status" aria-live="polite" style={styles.status}>
            {status}
          </p>
          <div style={styles.actions}>
            {!photoMode ? (
              <>
                <button
                  type="button"
                  onClick={capturePhoto}
                  style={styles.primaryButton}
                  disabled={!cameraReady}
                >
                  📸 Capture Photo
                </button>
                <label style={styles.secondaryButton}>
                  🖼 Upload Photo
                  <input
                    type="file"
                    accept="image/*"
                    onChange={uploadPhoto}
                    style={{ display: "none" }}
                  />
                </label>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={retakePhoto}
                  style={styles.primaryButton}
                >
                  Retake / Try Live Camera
                </button>
                <a
                  href={photoUrl}
                  download="vibecheck-tryon.jpg"
                  style={styles.secondaryButton}
                >
                  Download Photo
                </a>
              </>
            )}
          </div>
        </section>
        <aside style={styles.panel}>
          <div style={styles.productCard}>
            {productImage && (
              <img
                src={productImage}
                alt={productTitle}
                style={styles.productImage}
              />
            )}
            <div>
              <div style={styles.eyebrow}>CURRENT PRODUCT</div>
              <strong>{productTitle}</strong>
              <div style={styles.muted}>
                {productCategory || "Choose a shade to begin"}
              </div>
            </div>
          </div>
          <div style={styles.sectionHeading}>Choose a lipstick shade</div>
          <p style={styles.muted}>
            Select a shade to apply it to your live preview.
          </p>
          <div style={styles.swatches}>
            {SHADES.map((item) => (
              <button
                key={item.name}
                type="button"
                title={`${item.name} — ${item.hex}`}
                aria-label={`${item.name}, ${item.hex}`}
                onClick={() => applyShade(item.hex)}
                style={{
                  ...styles.swatch,
                  background: item.hex,
                  outline:
                    shade.toLowerCase() === item.hex.toLowerCase()
                      ? "3px solid #171717"
                      : "none",
                  outlineOffset: 3,
                }}
              />
            ))}
          </div>
          <div style={styles.selectedShade}>
            <span
              style={{
                ...styles.selectedDot,
                background: shade,
              }}
            />
            <div>
              <div style={styles.muted}>Selected HEX code</div>
              <strong>{shade.toUpperCase()}</strong>
            </div>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(shade)}
              style={styles.copyButton}
            >
              Copy
            </button>
          </div>
          <label htmlFor="custom-color" style={styles.label}>
            Pick any custom color
          </label>
          <div style={styles.customColorRow}>
            <input
              id="custom-color"
              type="color"
              value={customHex}
              onChange={(event) => {
                setCustomHex(event.target.value);
                applyShade(event.target.value);
              }}
              style={styles.colorInput}
            />
            <input
              value={hexInput}
              onChange={(event) => {
                const value = event.target.value.toUpperCase();
                setHexInput(value);
                if (/^#[0-9A-F]{6}$/.test(value)) {
                  setCustomHex(value);
                  applyShade(value);
                }
              }}
              aria-label="Custom HEX color"
              placeholder="#C2185B"
              style={styles.hexInput}
            />
          </div>
          <div style={styles.matchingSection}>
            <div style={styles.sectionHeading}>Product matching</div>
            <p style={styles.muted}>
              The selected shade is currently a visual preview. Matching it
              to real products requires searching Shopify product and variant
              shade data.
            </p>
            {productPageUrl && (
              <a href={productPageUrl} style={styles.productLink}>
                View current Shopify product →
              </a>
            )}
            {productId && (
              <div style={styles.smallText}>
                Product ID: {productId}
              </div>
            )}
          </div>
        </aside>
      </div>
      <p style={styles.disclaimer}>
        Vibecheck is an experimental preview. Screen colors may differ from
        the physical product. Uploaded photos currently display a preview;
        live face tracking is available in camera mode.
      </p>
    </main>
  );
}
const styles = {
  page: {
    maxWidth: 1180,
    margin: "0 auto",
    padding: "24px 18px 40px",
    color: "#181818",
    fontFamily: "Arial, sans-serif",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 16,
    flexWrap: "wrap",
    marginBottom: 24,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1.5,
    color: "#9b3158",
    marginBottom: 8,
  },
  heading: {
    fontSize: "clamp(26px, 4vw, 38px)",
    margin: "0 0 8px",
  },
  muted: {
    color: "#737373",
    fontSize: 13,
    lineHeight: 1.5,
    margin: "6px 0",
  },
  layout: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1.25fr) minmax(300px, 0.85fr)",
    gap: 22,
    alignItems: "start",
  },
  cameraColumn: {
    minWidth: 0,
  },
  cameraFrame: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 18,
    background: "#171717",
    aspectRatio: "4 / 3",
    width: "100%",
  },
  video: {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "cover",
    transform: "scaleX(-1)",
  },
  
overlay: {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
  objectFit: "cover",
  transform: "scaleX(-1)",
  pointerEvents: "none",
},

  cameraMessage: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    textAlign: "center",
    color: "white",
    background: "rgba(0,0,0,0.72)",
    lineHeight: 1.5,
  },
  photo: {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "contain",
    background: "#171717",
  },
  status: {
    fontSize: 13,
    lineHeight: 1.5,
    minHeight: 20,
    color: "#595959",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 14,
  },
  primaryButton: {
    border: 0,
    borderRadius: 9,
    background: "#171717",
    color: "white",
    padding: "12px 16px",
    fontWeight: 700,
    cursor: "pointer",
    textDecoration: "none",
  },
  secondaryButton: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    border: "1px solid #dedede",
    borderRadius: 9,
    background: "white",
    color: "#171717",
    padding: "12px 16px",
    fontWeight: 700,
    cursor: "pointer",
    textDecoration: "none",
    fontSize: 13,
  },
  backLink: {
    color: "#292929",
    fontSize: 13,
    textDecoration: "none",
    border: "1px solid #ddd",
    borderRadius: 8,
    padding: "10px 12px",
  },
  panel: {
    border: "1px solid #e8e8e8",
    borderRadius: 16,
    padding: 20,
    minWidth: 0,
    background: "#fff",
    boxShadow: "0 8px 28px rgba(0,0,0,0.04)",
  },
  productCard: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    paddingBottom: 18,
    borderBottom: "1px solid #eee",
    marginBottom: 20,
    overflowWrap: "anywhere",
  },
  productImage: {
    width: 66,
    height: 66,
    objectFit: "contain",
    border: "1px solid #eee",
    borderRadius: 10,
    background: "#fafafa",
  },
  sectionHeading: {
    fontSize: 17,
    fontWeight: 700,
    marginBottom: 8,
  },
  swatches: {
    display: "grid",
    gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
    gap: 12,
    padding: "12px 4px 18px",
  },
  swatch: {
    width: "100%",
    aspectRatio: "1",
    maxWidth: 38,
    border: "2px solid white",
    borderRadius: "50%",
    cursor: "pointer",
    boxShadow: "0 0 0 1px #ddd",
    justifySelf: "center",
  },
  selectedShade: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    border: "1px solid #eee",
    borderRadius: 10,
    padding: 12,
    marginBottom: 18,
  },
  selectedDot: {
    width: 30,
    height: 30,
    flexShrink: 0,
    borderRadius: "50%",
    border: "1px solid rgba(0,0,0,.12)",
  },
  copyButton: {
    marginLeft: "auto",
    border: "1px solid #ddd",
    borderRadius: 7,
    background: "#fff",
    padding: "7px 10px",
    cursor: "pointer",
  },
  label: {
    display: "block",
    fontWeight: 700,
    fontSize: 13,
    marginBottom: 8,
  },
  customColorRow: {
    display: "flex",
    gap: 10,
    marginBottom: 20,
  },
  colorInput: {
    width: 48,
    height: 42,
    padding: 2,
    border: "1px solid #ddd",
    borderRadius: 8,
    background: "white",
    cursor: "pointer",
  },
  hexInput: {
    flex: 1,
    minWidth: 0,
    border: "1px solid #ddd",
    borderRadius: 8,
    padding: "10px 12px",
    fontFamily: "monospace",
  },
  matchingSection: {
    borderTop: "1px solid #eee",
    paddingTop: 18,
  },
  productLink: {
    display: "inline-block",
    marginTop: 8,
    color: "#9b3158",
    fontWeight: 700,
    fontSize: 13,
    textDecoration: "none",
  },
  smallText: {
    color: "#777",
    fontSize: 11,
    marginTop: 12,
    overflowWrap: "anywhere",
  },
  disclaimer: {
    color: "#777",
    fontSize: 12,
    lineHeight: 1.6,
    marginTop: 22,
  },
};
