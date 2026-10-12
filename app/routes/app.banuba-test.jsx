
import { useEffect, useRef, useState } from "react";
import { FaceLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

export default function BanubaTest() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const landmarkerRef = useRef(null);
  const streamRef = useRef(null);
  const frameRef = useRef(null);

  const [status, setStatus] = useState("Ready to start.");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      landmarkerRef.current?.close();
    };
  }, []);

  async function startCamera() {
    if (running) return;

    try {
      setStatus("Loading face tracking model…");

      if (!landmarkerRef.current) {
        const vision = await FilesetResolver.forVisionTasks(
          "/mediapipe/wasm"
        );

        landmarkerRef.current = await FaceLandmarker.createFromOptions(
          vision,
          {
            baseOptions: {
              modelAssetPath: "/mediapipe/face_landmarker.task",
              delegate: "GPU",
            },
            runningMode: "VIDEO",
            numFaces: 1,
        });
      }

      setStatus("Requesting camera permission…");

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });

      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();

      setRunning(true);
      setStatus("Camera active. Move your face to test tracking.");

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");

      function drawFrame() {
        if (!video || video.readyState < 2) {
          frameRef.current = requestAnimationFrame(drawFrame);
          return;
        }

        const width = video.videoWidth;
        const height = video.videoHeight;

        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }

        ctx.clearRect(0, 0, width, height);

        const results = landmarkerRef.current.detectForVideo(
          video,
          performance.now()
        );

        const face = results.faceLandmarks?.[0];

        if (face) {
          ctx.fillStyle = "#00e5a8";

          for (const point of face) {
            ctx.beginPath();
            ctx.arc(point.x * width, point.y * height, 1.5, 0, Math.PI * 2);
            ctx.fill();
          }

          // Prototype glasses overlay using eye landmark positions.
          const leftEye = face[468] || face[33];
          const rightEye = face[473] || face[263];

          if (leftEye && rightEye) {
            const x1 = leftEye.x * width;
            const y1 = leftEye.y * height;
            const x2 = rightEye.x * width;
            const y2 = rightEye.y * height;
            const distance = Math.hypot(x2 - x1, y2 - y1);
            const angle = Math.atan2(y2 - y1, x2 - x1);

            ctx.save();
            ctx.translate((x1 + x2) / 2, (y1 + y2) / 2);
            ctx.rotate(angle);
            ctx.strokeStyle = "#111111";
            ctx.lineWidth = Math.max(3, distance * 0.07);
            ctx.fillStyle = "rgba(30, 30, 30, 0.15)";

            const lensWidth = distance * 0.55;
            const lensHeight = distance * 0.38;

            ctx.beginPath();
            ctx.ellipse(
              -distance * 0.28,
              0,
              lensWidth / 2,
              lensHeight / 2,
              0,
              0,
              Math.PI * 2
            );
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            ctx.ellipse(
              distance * 0.28,
              0,
              lensWidth / 2,
              lensHeight / 2,
              0,
              0,
              Math.PI * 2
            );
            ctx.fill();
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(-distance * 0.05, 0);
            ctx.lineTo(distance * 0.05, 0);
            ctx.stroke();
            ctx.restore();
          }
        }

        frameRef.current = requestAnimationFrame(drawFrame);
      }

      drawFrame();
    } catch (error) {
      console.error("MediaPipe camera error:", error);
      stopCamera();
      setStatus(
        `Could not start: ${error?.message || "Unknown error"}. Check camera permission and browser console.`
      );
    }
  }

  function stopCamera() {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    if (videoRef.current) videoRef.current.srcObject = null;

    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);

    setRunning(false);
    setStatus("Camera stopped.");
  }

  return (
    <main style={{ padding: 24, maxWidth: 800, margin: "0 auto" }}>
      <h1>Vibecheck — Live Face Tracking</h1>
      <p>Free, browser-based face tracking prototype.</p>

      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <button onClick={startCamera} disabled={running}>
          Start camera
        </button>
        <button onClick={stopCamera} disabled={!running}>
          Stop camera
        </button>
      </div>

      <p role="status">{status}</p>

      <div
        style={{
          position: "relative",
          width: "100%",
          background: "#111",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          style={{ display: "block", width: "100%", height: "auto" }}
        />
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
          }}
        />
      </div>
    </main>
  );
}
