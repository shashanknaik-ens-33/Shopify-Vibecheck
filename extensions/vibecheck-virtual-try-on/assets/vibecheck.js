(function () {
  function initVibecheck(root) {
    if (!root || root.dataset.vibecheckInitialized === "true") return;

    const modal = root.querySelector("[data-vibecheck-modal]");
    const openButton = root.querySelector("[data-vibecheck-open]");
    const closeButtons = root.querySelectorAll("[data-vibecheck-close]");
    const options = root.querySelector("[data-vibecheck-options]");
    const cameraButton = root.querySelector("[data-vibecheck-camera]");
    const uploadButton = root.querySelector("[data-vibecheck-upload]");
    const fileInput = root.querySelector("[data-vibecheck-file]");
    const preview = root.querySelector("[data-vibecheck-preview]");
    const video = root.querySelector("[data-vibecheck-video]");
    const image = root.querySelector("[data-vibecheck-image]");
    const status = root.querySelector("[data-vibecheck-status]");
    const backButton = root.querySelector("[data-vibecheck-back]");
    const captureButton = root.querySelector("[data-vibecheck-capture]");
    const liveIndicator = root.querySelector("[data-vibecheck-live-indicator]");
    const previewTitle = root.querySelector("[data-vibecheck-preview-title]");
    const panel = root.querySelector(".vibecheck-panel");

    if (
      !modal || !openButton || !cameraButton || !uploadButton ||
      !fileInput || !preview || !video || !image || !status ||
      !options || !backButton
    ) {
      console.warn("Vibecheck: required elements are missing.");
      return;
    }

    root.dataset.vibecheckInitialized = "true";

    let cameraStream = null;
    let currentObjectUrl = null;
    let previousBodyOverflow = "";
    let previousFocus = null;

    function setStatus(message) {
      status.textContent = message || "";
    }

    function clearObjectUrl() {
      if (currentObjectUrl) {
        URL.revokeObjectURL(currentObjectUrl);
        currentObjectUrl = null;
      }
    }

    function stopCamera() {
      if (cameraStream) {
        cameraStream.getTracks().forEach(function (track) {
          track.stop();
        });
        cameraStream = null;
      }

      video.pause();
      video.srcObject = null;

      if (liveIndicator) liveIndicator.hidden = true;
      if (captureButton) captureButton.hidden = true;
    }

    function showOptions() {
      stopCamera();
      clearObjectUrl();

      preview.hidden = true;
      options.hidden = false;
      video.hidden = true;
      image.hidden = true;
      image.removeAttribute("src");
      fileInput.value = "";

      if (previewTitle) previewTitle.textContent = "Preview";
      setStatus("");
    }

    function openModal() {
      previousFocus = document.activeElement;
      previousBodyOverflow = document.body.style.overflow;

      modal.hidden = false;
      modal.classList.add("is-open");
      modal.setAttribute("aria-hidden", "false");
      openButton.setAttribute("aria-expanded", "true");
      document.body.style.overflow = "hidden";

      window.requestAnimationFrame(function () {
        if (panel) panel.focus();
      });
    }

    function closeModal() {
      stopCamera();
      clearObjectUrl();

      modal.classList.remove("is-open");
      modal.setAttribute("aria-hidden", "true");
      modal.hidden = true;

      openButton.setAttribute("aria-expanded", "false");
      document.body.style.overflow = previousBodyOverflow;

      showOptions();

      if (previousFocus && typeof previousFocus.focus === "function") {
        previousFocus.focus();
      } else {
        openButton.focus();
      }
    }

    async function startCamera() {
      stopCamera();
      clearObjectUrl();

      options.hidden = true;
      preview.hidden = false;
      video.hidden = false;
      image.hidden = true;

      if (previewTitle) previewTitle.textContent = "Live camera preview";
      if (liveIndicator) liveIndicator.hidden = false;
      if (captureButton) captureButton.hidden = false;

      setStatus("Requesting camera permission…");

      try {
        if (!window.isSecureContext) {
          throw new Error("Camera access requires a secure HTTPS page.");
        }

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error(
            "This browser does not support camera access. Try an updated browser."
          );
        }

        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user" },
          audio: false
        });

        video.srcObject = cameraStream;
        await video.play();

        setStatus("Camera is on. Position yourself in the frame.");
      } catch (error) {
        console.error("Vibecheck camera error:", error);
        stopCamera();

        video.hidden = true;
        preview.hidden = true;
        options.hidden = false;

        const message =
          error && error.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access in your browser settings, then try again."
            : error && error.name === "NotFoundError"
              ? "No camera was found on this device. You can use Upload Photo instead."
              : error && error.name === "NotReadableError"
                ? "The camera may already be in use by another app. Close that app and try again."
                : (error && error.message) ||
                  "Unable to start the camera. Please try Upload Photo instead.";

        setStatus(message);
      }
    }

    function openUpload() {
      stopCamera();
      fileInput.click();
    }

    function handleUpload(event) {
      const file = event.target.files && event.target.files[0];
      if (!file) return;

      if (!file.type || !file.type.startsWith("image/")) {
        setStatus("Please choose a valid image file.");
        fileInput.value = "";
        return;
      }

      if (file.size > 15 * 1024 * 1024) {
        setStatus("Please choose an image smaller than 15 MB.");
        fileInput.value = "";
        return;
      }

      stopCamera();
      clearObjectUrl();

      currentObjectUrl = URL.createObjectURL(file);

      image.onload = function () {
        options.hidden = true;
        preview.hidden = false;
        video.hidden = true;
        image.hidden = false;

        if (previewTitle) previewTitle.textContent = "Your photo";

        setStatus(
          "Photo loaded. This is a photo preview; virtual product effects are not connected yet."
        );
      };

      image.onerror = function () {
        setStatus("This image could not be opened. Please choose another photo.");
        clearObjectUrl();
        image.removeAttribute("src");
      };

      image.src = currentObjectUrl;
    }

    function goBack() {
      showOptions();
    }

    function captureFrame() {
      if (!video.videoWidth || !video.videoHeight) {
        setStatus("Wait for the camera preview to appear before capturing.");
        return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const context = canvas.getContext("2d");

      if (!context) {
        setStatus("Could not capture the image. Please try again.");
        return;
      }

      context.translate(canvas.width, 0);
      context.scale(-1, 1);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      canvas.toBlob(function (blob) {
        if (!blob) {
          setStatus("Could not capture the image. Please try again.");
          return;
        }

        stopCamera();
        clearObjectUrl();

        currentObjectUrl = URL.createObjectURL(blob);
        image.src = currentObjectUrl;
        image.hidden = false;
        video.hidden = true;

        if (liveIndicator) liveIndicator.hidden = true;
        if (captureButton) captureButton.hidden = true;
        if (previewTitle) previewTitle.textContent = "Captured photo";

        setStatus(
          "Photo captured. Virtual product effects are not connected yet."
        );
      }, "image/jpeg", 0.92);
    }

    openButton.addEventListener("click", openModal);

    closeButtons.forEach(function (button) {
      button.addEventListener("click", closeModal);
    });

    cameraButton.addEventListener("click", startCamera);
    uploadButton.addEventListener("click", openUpload);
    fileInput.addEventListener("change", handleUpload);
    backButton.addEventListener("click", goBack);

    if (captureButton) {
      captureButton.addEventListener("click", captureFrame);
    }

    modal.addEventListener("click", function (event) {
      if (event.target === modal) closeModal();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !modal.hidden) {
        closeModal();
      }
    });
  }

  function initializeAll(scope) {
    (scope || document).querySelectorAll("[data-vibecheck]").forEach(initVibecheck);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      initializeAll(document);
    });
  } else {
    initializeAll(document);
  }

  document.addEventListener("shopify:section:load", function (event) {
    initializeAll(event.target);
  });
})();