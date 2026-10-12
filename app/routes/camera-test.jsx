
import { useEffect, useRef, useState } from "react";
import {
  FaceLandmarker,
  FilesetResolver,
} from "@mediapipe/tasks-vision";

const GLASSES = {
  black: "/images/glasses/black.svg",
  gold: "/images/glasses/gold.svg",
  silver: "/images/glasses/silver.svg",
  blue: "/images/glasses/blue.svg",
};

const LIPSTICKS = {
  red: { label: "Classic Red", color: "#D71940" },
  pink: { label: "Soft Pink", color: "#E85D91" },
  nude: { label: "Nude Rose", color: "#B86F70" },
  berry: { label: "Berry", color: "#85244D" },
};

const OUTER_LIPS = [
  61, 146, 91, 181, 84, 17, 314, 405, 321, 375,
  291, 409, 270, 269, 267, 0, 37, 39, 40, 185,
];

const INNER_LIPS = [
  78, 95, 88, 178, 87, 14, 317, 402, 318, 324,
  308, 415, 310, 311, 312, 13, 82, 81, 80, 191,
];

export default function CameraTest() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const landmarkerRef = useRef(null);
  const streamRef = useRef(null);
  const animationRef = useRef(null);

  const runningRef = useRef(false);
  const startingRef = useRef(false);
  const glassesImagesRef = useRef({});
  const latestFaceRef = useRef(null);
  const lastVideoTimeRef = useRef(-1);

  const glassesStyleRef = useRef("black");
  const lipShadeRef = useRef("red");
  const modeRef = useRef("glasses");
  const statusRef = useRef("");

  const [status, setStatus] = useState("Ready to start.");
  const [mode, setMode] = useState("glasses");
  const [glassesStyle, setGlassesStyle] = useState("black");
  const [lipShade, setLipShade] = useState("red");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    glassesStyleRef.current = glassesStyle;
  }, [glassesStyle]);

  useEffect(() => {
    lipShadeRef.current = lipShade;
  }, [lipShade]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  function updateStatus(message) {
    if (statusRef.current !== message) {
      statusRef.current = message;
      setStatus(message);
    }
  }

  // Load the four sample glasses SVGs.
  useEffect(() => {
    let cancelled = false;

    async function loadGlasses() {
      const entries = await Promise.all(
        Object.entries(GLASSES).map(
          ([name, src]) =>
            new Promise((resolve) => {
              const img = new Image();

              img.onload = () => resolve([name, img]);

              img.onerror = () => {
                console.error("Could not load glasses asset:", src);
                resolve([name, null]);
              };

              img.src = src;
            })
        )
      );

      if (!cancelled) {
        glassesImagesRef.current = Object.fromEntries(
          entries.filter(([, img]) => img)
        );
      }
    }

    loadGlasses();

    return () => {
      cancelled = true;
    };
  }, []);

  function stopCamera() {
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

    latestFaceRef.current = null;
    lastVideoTimeRef.current = -1;

    const canvas = canvasRef.current;

    if (canvas) {
      canvas.getContext("2d")?.clearRect(
        0,
        0,
        canvas.width,
        canvas.height
      );
    }

    setRunning(false);
    updateStatus("Camera stopped.");
  }

  // GLASSES
  // Render the entire SVG: no hard-coded crop that can cut off the frame.
  function drawGlasses(ctx, face, width, height) {
    const leftOuter = face[33];
    const rightOuter = face[263];

    if (!leftOuter || !rightOuter) return;

    const x1 = leftOuter.x * width;
    const y1 = leftOuter.y * height;
    const x2 = rightOuter.x * width;
    const y2 = rightOuter.y * height;

    const eyeSpan = Math.hypot(x2 - x1, y2 - y1);

    if (eyeSpan < 10) return;

    const centerX = (x1 + x2) / 2;
    const centerY = (y1 + y2) / 2;
    const angle = Math.atan2(y2 - y1, x2 - x1);

    const img = glassesImagesRef.current[glassesStyleRef.current];

    if (!img || !img.complete || !img.naturalWidth) return;

    // Tune these values after checking the frame against your face.
    const frameWidth = eyeSpan * 1.38;
    const frameHeight =
      frameWidth * (img.naturalHeight / img.naturalWidth);
    const verticalOffset = eyeSpan * 0.045;

    ctx.save();
    ctx.translate(centerX, centerY + verticalOffset);
    ctx.rotate(angle);

    ctx.drawImage(
      img,
      -frameWidth / 2,
      -frameHeight / 2,
      frameWidth,
      frameHeight
    );

    ctx.restore();
  }

  // LIPSTICK
  function traceLipContour(ctx, face, indices, width, height) {
    const first = face[indices[0]];

    if (!first) return false;

    ctx.moveTo(first.x * width, first.y * height);

    for (let i = 1; i < indices.length; i++) {
      const point = face[indices[i]];

      if (!point) return false;

      ctx.lineTo(point.x * width, point.y * height);
    }

    ctx.closePath();
    return true;
  }

  function drawLipstick(ctx, face, width, height, color) {
    if (
      !OUTER_LIPS.every((index) => face[index]) ||
      !INNER_LIPS.every((index) => face[index])
    ) {
      return;
    }

    ctx.save();
    ctx.beginPath();

    const outerValid = traceLipContour(
      ctx,
      face,
      OUTER_LIPS,
      width,
      height
    );

    const innerValid = traceLipContour(
      ctx,
      face,
      INNER_LIPS,
      width,
      height
    );

    if (!outerValid || !innerValid) {
      ctx.restore();
      return;
    }

    // A translucent overlay lets the original lip texture show through.
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 0.30;
    ctx.fillStyle = color;
    ctx.fill("evenodd");

    ctx.restore();
  }

  async function startCamera() {
    if (startingRef.current || runningRef.current) return;

    startingRef.current = true;

    try {
      updateStatus("Loading face tracking model...");

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

      updateStatus("Requesting camera permission...");

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

      if (!video) {
        throw new Error("Camera video element not found.");
      }

      video.srcObject = stream;
      await video.play();

      latestFaceRef.current = null;
      lastVideoTimeRef.current = -1;

      runningRef.current = true;
      startingRef.current = false;

      setRunning(true);
      updateStatus("Camera active. Looking for your face...");

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");

      if (!canvas || !ctx) {
        throw new Error("Unable to initialize the canvas.");
      }

      function drawFrame() {
        if (!runningRef.current) return;

        if (video.readyState < 2) {
          animationRef.current = requestAnimationFrame(drawFrame);
          return;
        }

        const width = video.videoWidth;
        const height = video.videoHeight;

        if (!width || !height) {
          animationRef.current = requestAnimationFrame(drawFrame);
          return;
        }

        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }

        // Detect only once per new camera frame.
        if (video.currentTime !== lastVideoTimeRef.current) {
          const result = landmarkerRef.current.detectForVideo(
            video,
            performance.now()
          );

          lastVideoTimeRef.current = video.currentTime;
          latestFaceRef.current = result.faceLandmarks?.[0] ?? null;
        }

        // Redraw overlays every animation frame for immediate selection changes.
        ctx.clearRect(0, 0, width, height);

        const face = latestFaceRef.current;

        if (face) {
          if (modeRef.current === "glasses") {
            drawGlasses(ctx, face, width, height);
            updateStatus("Face detected. Glasses try-on is active.");
          } else {
            drawLipstick(
              ctx,
              face,
              width,
              height,
              LIPSTICKS[lipShadeRef.current].color
            );

            updateStatus("Face detected. Lipstick try-on is active.");
          }
        } else {
          updateStatus("Camera active. Move your face into view.");
        }

        animationRef.current = requestAnimationFrame(drawFrame);
      }

      drawFrame();
    } catch (error) {
      console.error("Vibecheck camera error:", error);
      stopCamera();
      updateStatus(`Unable to start camera: ${error.message}`);
    }
  }

  useEffect(() => {
    return () => {
      runningRef.current = false;

      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
      }

      streamRef.current?.getTracks().forEach((track) => track.stop());
      landmarkerRef.current?.close();
    };
  }, []);

  return (
    <main
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: 24,
        fontFamily: "Arial, sans-serif",
      }}
    >
      <h1>Vibecheck — Virtual Try-On</h1>
      <p>Try glasses and lipstick using live face tracking.</p>

      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <button
          type="button"
          onClick={startCamera}
          disabled={running}
          style={{ padding: "10px 16px" }}
        >
          Start face tracking
        </button>

        <button
          type="button"
          onClick={stopCamera}
          disabled={!running && !startingRef.current}
          style={{ padding: "10px 16px" }}
        >
          Stop camera
        </button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <label htmlFor="tryon-mode">Try-on category</label>
        <br />

        <select
          id="tryon-mode"
          value={mode}
          onChange={(event) => setMode(event.target.value)}
          style={{ padding: 10, marginTop: 6 }}
        >
          <option value="glasses">Glasses</option>
          <option value="lipstick">Lipstick</option>
        </select>
      </div>

      {mode === "glasses" ? (
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="glasses-style">Glasses frame</label>
          <br />

          <select
            id="glasses-style"
            value={glassesStyle}
            onChange={(event) => setGlassesStyle(event.target.value)}
            style={{ padding: 10, marginTop: 6 }}
          >
            <option value="black">Classic black</option>
            <option value="gold">Gold</option>
            <option value="silver">Silver</option>
            <option value="blue">Blue</option>
          </select>
        </div>
      ) : (
        <div style={{ marginBottom: 16 }}>
          <label htmlFor="lip-shade">Lipstick shade</label>
          <br />

          <select
            id="lip-shade"
            value={lipShade}
            onChange={(event) => setLipShade(event.target.value)}
            style={{ padding: 10, marginTop: 6 }}
          >
            {Object.entries(LIPSTICKS).map(([key, shade]) => (
              <option key={key} value={key}>
                {shade.label}
              </option>
            ))}
          </select>

          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            {Object.entries(LIPSTICKS).map(([key, shade]) => (
              <button
                key={key}
                type="button"
                aria-label={shade.label}
                title={shade.label}
                onClick={() => setLipShade(key)}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  border:
                    lipShade === key
                      ? "3px solid #222"
                      : "1px solid #aaa",
                  background: shade.color,
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
        </div>
      )}

      <p role="status" aria-live="polite">{status}</p>

      <div
        style={{
          position: "relative",
          width: "100%",
          background: "#111",
          borderRadius: 12,
          overflow: "hidden",
          lineHeight: 0,
        }}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          style={{
            display: "block",
            width: "100%",
            height: "auto",
            transform: "scaleX(-1)",
          }}
        />

        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            transform: "scaleX(-1)",
            pointerEvents: "none",
          }}
        />
      </div>

      <p style={{ fontSize: 13, color: "#666", lineHeight: 1.5 }}>
        Experimental prototype. Glasses use sample SVG assets.
        Lipstick uses a landmark-based colour overlay.
      </p>
    </main>
  );
}
