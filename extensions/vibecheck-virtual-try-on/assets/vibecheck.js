
(function () {
  "use strict";

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
    const retakeButton = root.querySelector("[data-vibecheck-retake]");
    const usePhotoButton = root.querySelector("[data-vibecheck-use-photo]");
    const liveIndicator = root.querySelector("[data-vibecheck-live-indicator]");
    const previewTitle = root.querySelector("[data-vibecheck-preview-title]");
    const panel = root.querySelector(".vibecheck-panel");
    const productJsonElement = root.querySelector(
      "[data-vibecheck-product-json]"
    );

    if (
      !modal ||
      !openButton ||
      !cameraButton ||
      !uploadButton ||
      !fileInput ||
      !preview ||
      !video ||
      !image ||
      !status ||
      !options ||
      !backButton
    ) {
      console.warn("Vibecheck: required elements are missing.");
      return;
    }

    root.dataset.vibecheckInitialized = "true";

    let shopifyProduct = null;
    let cameraStream = null;
    let currentObjectUrl = null;
    let previousBodyOverflow = "";
    let previousFocus = null;
    let photoSource = null;

    try {
      shopifyProduct = productJsonElement
        ? JSON.parse(productJsonElement.textContent)
        : null;
    } catch (error) {
      console.error("Vibecheck: could not read Shopify product data.", error);
    }

    function setStatus(message) {
      status.textContent = message || "";
    }

    function getCurrentVariant() {
      const variants = shopifyProduct?.variants || [];
      const variantInput = document.querySelector(
        'form[action*="/cart/add"] [name="id"]'
      );
      const selectedId = variantInput?.value || root.dataset.variantId || "";

      return (
        variants.find(
          (variant) => String(variant.id) === String(selectedId)
        ) ||
        variants.find((variant) => variant.available) ||
        variants[0] ||
        null
      );
    }

    function getProductCategory(product) {
      const text = [
        product?.title,
        product?.product_type,
        root.dataset.productType,
        root.dataset.productTags
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (
        /\b(lipsticks?|lip gloss(?:es)?|lipgloss(?:es)?|lip tints?|lip stains?|lip colors?|lip colours?)\b/.test(
          text
        )
      ) {
        return "Lipstick";
      }

      if (
        /\b(glasses|eyeglasses|sunglasses|spectacles|eyewear|optical frames?|reading glasses)\b/.test(
          text
        )
      ) {
        return "Glasses";
      }

      if (/\b(headbands?|hair bands?|alice bands?|head wraps?)\b/.test(text)) {
        return "Headbands";
      }

      if (
        /\b(t shirts?|tshirts?|tees|shirts?|tops|blouses|dresses|hoodies|sweatshirts|jackets|coats|sweaters|jeans|trousers|pants|shorts|skirts|leggings|jumpsuits|rompers|cardigans)\b/.test(
          text
        )
      ) {
        return "Clothing";
      }

      return "Unsupported";
    }

    function getProductContext() {
      const variant = getCurrentVariant();
      const product = shopifyProduct || {};

      const variantImage =
        variant?.featured_image?.src ||
        variant?.featured_image?.url ||
        "";

      let imageUrl =
        variantImage ||
        root.dataset.productImage ||
        product.featured_image ||
        "";

      if (imageUrl && typeof imageUrl === "object") {
        imageUrl = imageUrl.src || imageUrl.url || "";
      }

      if (imageUrl.startsWith("//")) {
        imageUrl = window.location.protocol + imageUrl;
      }

      const title = product.title || root.dataset.productTitle || "";
      const variantTitle =
        variant?.title || root.dataset.variantTitle || "";

      const variantOptions =
        variant?.options?.join(" / ") ||
        root.dataset.variantOptions ||
        variantTitle;

      const shadePattern =
        /burgundy|wine|oxblood|merlot|berry|plum|mulberry|nude|rosewood|mauve|pink|blush|red|scarlet|crimson/i;

      const shade =
        [variantOptions, variantTitle, title].find(
          (value) => value && shadePattern.test(value)
        ) || "";

      return {
        id: product.id || root.dataset.productId || "",
        title,
        handle: product.handle || root.dataset.productHandle || "",
        image: imageUrl,
        category: getProductCategory(product),
        variantId: variant?.id || root.dataset.variantId || "",
        variantTitle,
        options: variantOptions,
        shade
      };
    }

    function refreshProductSummary() {
      const product = getProductContext();

      const titleElement = root.querySelector(
        "[data-vibecheck-product-title]"
      );

      const variantElement = root.querySelector(
        "[data-vibecheck-variant-title]"
      );

      const productImage = root.querySelector(
        "[data-vibecheck-product-image]"
      );

      if (titleElement) {
        titleElement.textContent = product.title;
      }

      if (variantElement) {
        variantElement.textContent = product.variantTitle;
      }

      if (productImage && product.image) {
        productImage.src = product.image;
        productImage.alt = product.title;
      }
    }

    function hideReviewButtons() {
      if (retakeButton) retakeButton.hidden = true;
      if (usePhotoButton) usePhotoButton.hidden = true;
    }

    function showReviewButtons() {
      if (retakeButton) retakeButton.hidden = false;
      if (usePhotoButton) usePhotoButton.hidden = false;
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
      hideReviewButtons();

      photoSource = null;
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
      refreshProductSummary();

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
      hideReviewButtons();

      photoSource = null;
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

    function openProductCamera() {
      const appUrl = (root.dataset.appUrl || "").trim();

      if (!appUrl) {
        setStatus(
          "The Vibecheck app URL is missing. Set it in the theme editor."
        );
        return;
      }

      let destination;

      try {
        destination = new URL(appUrl);
      } catch (error) {
        setStatus("The Vibecheck app URL is invalid.");
        return;
      }

      if (destination.protocol !== "https:") {
        setStatus("The Vibecheck app URL must use HTTPS.");
        return;
      }

      const product = getProductContext();

      if (!product.id) {
        setStatus(
          "Could not identify this Shopify product. Refresh and try again."
        );
        return;
      }

      destination.pathname = "/camera-test";
      destination.search = "";

      Object.entries(product).forEach(function ([key, value]) {
        if (value !== null && value !== undefined && value !== "") {
          destination.searchParams.set(key, String(value));
        }
      });

      // Navigate in the current tab instead of opening a new tab.
      setStatus("Opening the try-on experience for " + product.title + ".");
      window.location.href = destination.toString();
    }

    async function startCamera() {
      stopCamera();
      clearObjectUrl();
      hideReviewButtons();

      photoSource = null;
      fileInput.value = "";
      options.hidden = true;
      preview.hidden = false;
      video.hidden = false;
      image.hidden = true;
      image.removeAttribute("src");

      if (previewTitle) previewTitle.textContent = "Live camera preview";
      if (liveIndicator) liveIndicator.hidden = false;
      if (captureButton) captureButton.hidden = false;

      setStatus("Requesting camera permission…");

      try {
        if (!window.isSecureContext) {
          throw new Error("Camera access requires a secure HTTPS page.");
        }

        if (
          !navigator.mediaDevices ||
          !navigator.mediaDevices.getUserMedia
        ) {
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
        hideReviewButtons();

        const message =
          error?.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access in your browser settings, then try again."
            : error?.name === "NotFoundError"
              ? "No camera was found on this device. You can use Upload Photo instead."
              : error?.name === "NotReadableError"
                ? "The camera may already be in use by another app. Close that app and try again."
                : error?.message ||
                  "Unable to start the camera. Please try Upload Photo instead.";

        setStatus(message);
      }
    }

    function openUpload() {
      stopCamera();
      clearObjectUrl();
      hideReviewButtons();

      photoSource = null;
      fileInput.value = "";
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
      hideReviewButtons();

      photoSource = "upload";
      currentObjectUrl = URL.createObjectURL(file);

      image.onload = function () {
        options.hidden = true;
        preview.hidden = false;
        video.hidden = true;
        image.hidden = false;

        if (previewTitle) previewTitle.textContent = "Review your photo";

        showReviewButtons();

        setStatus(
          "Photo loaded. Review it, then continue or choose another option."
        );
      };

      image.onerror = function () {
        hideReviewButtons();
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

      canvas.toBlob(
        function (blob) {
          if (!blob) {
            setStatus("Could not capture the image. Please try again.");
            return;
          }

          stopCamera();
          clearObjectUrl();

          photoSource = "camera";
          currentObjectUrl = URL.createObjectURL(blob);
          image.src = currentObjectUrl;
          image.hidden = false;
          video.hidden = true;

          if (liveIndicator) liveIndicator.hidden = true;
          if (captureButton) captureButton.hidden = true;
          if (previewTitle) previewTitle.textContent = "Review your photo";

          showReviewButtons();

          setStatus("Photo captured successfully. Review it before continuing.");
        },
        "image/jpeg",
        0.92
      );
    }

    function retakePhoto() {
      if (photoSource === "camera") {
        startCamera();
      } else {
        showOptions();
      }
    }

    function usePhoto() {
      if (!image.getAttribute("src") || image.hidden) {
        setStatus("Please capture or upload a photo first.");
        return;
      }

      // The photo is currently only previewed in the storefront modal.
      // The photo-processing/try-on engine still needs to be connected here.
      setStatus(
        "Your photo is ready. Photo-based virtual rendering is not connected to this storefront flow yet."
      );
    }

    openButton.addEventListener("click", openModal);

    closeButtons.forEach(function (button) {
      button.addEventListener("click", closeModal);
    });

    cameraButton.addEventListener("click", openProductCamera);
    uploadButton.addEventListener("click", openUpload);
    fileInput.addEventListener("change", handleUpload);
    backButton.addEventListener("click", goBack);

    if (captureButton) {
      captureButton.addEventListener("click", captureFrame);
    }

    if (retakeButton) {
      retakeButton.addEventListener("click", retakePhoto);
    }

    if (usePhotoButton) {
      usePhotoButton.addEventListener("click", usePhoto);
    }

    document.addEventListener("change", function (event) {
      if (
        event.target instanceof Element &&
        event.target.matches('form[action*="/cart/add"] [name="id"]')
      ) {
        window.setTimeout(refreshProductSummary, 0);
      }
    });

    document.addEventListener("variant:change", refreshProductSummary);
    document.addEventListener("product:variant-change", refreshProductSummary);

    modal.addEventListener("click", function (event) {
      if (event.target === modal) closeModal();
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !modal.hidden) {
        closeModal();
      }
    });

    refreshProductSummary();
  }

  function initializeAll(scope) {
    (scope || document)
      .querySelectorAll("[data-vibecheck]")
      .forEach(initVibecheck);
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
