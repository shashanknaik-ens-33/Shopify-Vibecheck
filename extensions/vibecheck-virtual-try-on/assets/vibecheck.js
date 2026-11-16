(function () {
  "use strict";

  function initVibecheck(root) {
    if (!root || root.dataset.vibecheckInitialized === "true") return;

    const modal = root.querySelector("[data-vibecheck-modal]");
    const openButton = root.querySelector("[data-vibecheck-open]");
    const closeButtons = root.querySelectorAll("[data-vibecheck-close]");
    const options = root.querySelector("[data-vibecheck-options]");
    const experience = root.querySelector("[data-vibecheck-experience]");
    const experienceFrame = root.querySelector("[data-vibecheck-experience-frame]");
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
    const catalogJsonElement = root.querySelector(
      "[data-vibecheck-catalog-json]"
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
    let shopifyCatalog = [];
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

    try {
      shopifyCatalog = catalogJsonElement
        ? JSON.parse(catalogJsonElement.textContent)
        : [];
      if (!Array.isArray(shopifyCatalog)) shopifyCatalog = [];
    } catch (error) {
      shopifyCatalog = [];
    }

    // Automatically discover any other lipstick products the merchant has added
    async function discoverStoreLipsticks() {
      try {
        const response = await fetch("/products.json?limit=50");
        if (!response.ok) return;
        const data = await response.json();
        const existingIds = new Set(shopifyCatalog.map(function (p) { return String(p.id); }));
        (data.products || []).forEach(function (item) {
          if (existingIds.has(String(item.id))) return;
          const text = [item.title, item.product_type, (item.tags || []).join(" ")].join(" ").toLowerCase();
          if (/\b(lip|lipstick|lipgloss|lip gloss|lip tint|lip stain|lip oil)\b/.test(text)) {
            shopifyCatalog.push({
              id: item.id,
              title: item.title,
              handle: item.handle,
              type: item.product_type,
              image: item.images && item.images[0] ? item.images[0].src : "",
              price: item.variants && item.variants[0] ? "$" + item.variants[0].price : "",
              variants: (item.variants || []).map(function (v) {
                return {
                  id: v.id,
                  title: v.title,
                  options: [v.option1, v.option2, v.option3].filter(Boolean),
                  available: v.available !== false,
                  image: v.featured_image && v.featured_image.src ? v.featured_image.src : (item.images && item.images[0] ? item.images[0].src : ""),
                  swatch: ""
                };
              })
            });
            existingIds.add(String(item.id));
          }
        });
        sendDataToFrame();
      } catch (e) {
        // Silently continue if fetch is unavailable
      }
    }
    discoverStoreLipsticks();

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

      // Mount on <body> so theme headers / transformed ancestors can't cover or clip it.
      if (modal.parentElement !== document.body) document.body.appendChild(modal);

      modal.hidden = false;
      modal.classList.add("is-open");
      modal.setAttribute("aria-hidden", "false");
      openButton.setAttribute("aria-expanded", "true");
      document.body.style.overflow = "hidden";

      window.requestAnimationFrame(function () {
        if (panel) panel.focus();
        openProductCamera();
      });
    }

    function closeModal() {
      stopCamera();
      clearObjectUrl();
      hideReviewButtons();

      photoSource = null;
      modal.classList.remove("is-open");
      modal.classList.remove("is-experience-mode");
      if (panel) panel.classList.remove("is-experience-mode");
      modal.setAttribute("aria-hidden", "true");
      modal.hidden = true;

      openButton.setAttribute("aria-expanded", "false");
      document.body.style.overflow = previousBodyOverflow;

      showOptions();
      if (experience) experience.hidden = true;
      if (experienceFrame) experienceFrame.src = "about:blank";

      if (previousFocus && typeof previousFocus.focus === "function") {
        previousFocus.focus();
      } else {
        openButton.focus();
      }
    }

    function openProductCamera() {
      let appUrl = (root.dataset.appUrl || "").trim();

      if (!appUrl) {
        // Fallback: If not explicitly set in theme editor, use current host
        appUrl = window.location.origin;
      }

      let destination;
      try {
        destination = new URL(appUrl, window.location.origin);
      } catch (error) {
        setStatus("The Vibecheck app URL is invalid.");
        return;
      }

      const product = getProductContext();
      if (!product.id) {
        setStatus("Could not identify this Shopify product. Refresh and try again.");
        return;
      }

      destination.pathname = "/camera-test";
      destination.search = "";
      Object.entries(product).forEach(function ([key, value]) {
        if (value !== null && value !== undefined && value !== "") {
          destination.searchParams.set(key, String(value));
        }
      });
      destination.searchParams.set("embed", "1");
      // Pass only real Shopify variant metadata; never send a demo shade catalogue.
      const variants = (shopifyProduct?.variants || []).map(function (variant) {
        const variantImage = variant?.featured_image?.src || variant?.featured_image?.url || "";
        return {
          id: variant.id,
          title: variant.title || "Default",
          options: Array.isArray(variant.options) ? variant.options : [],
          available: variant.available !== false,
          image: variantImage
        };
      });
      if (variants.length) destination.searchParams.set("variants", JSON.stringify(variants));

      if (!experience || !experienceFrame) {
        setStatus("The embedded try-on view is unavailable. Please refresh and try again.");
        return;
      }

      stopCamera();
      clearObjectUrl();
      options.hidden = true;
      preview.hidden = true;
      experience.hidden = false;
      modal.classList.add("is-experience-mode");
      if (panel) panel.classList.add("is-experience-mode");
      if (experienceFrame) {
        experienceFrame.setAttribute("allow", "camera *; microphone *; fullscreen *; display-capture *");
      }

      function onFrameLoaded() {
        sendDataToFrame();
      }

      experienceFrame.removeEventListener("load", onFrameLoaded);
      experienceFrame.addEventListener("load", onFrameLoaded, { once: true });

      if (experienceFrame.src !== destination.toString()) {
        experienceFrame.src = destination.toString();
      } else {
        sendDataToFrame();
      }
      setStatus("Loading live try-on for " + product.title + "…");
    }

    function sendDataToFrame() {
      if (!experienceFrame || !experienceFrame.contentWindow) return;
      try {
        const product = getProductContext();
        experienceFrame.contentWindow.postMessage(
          {
            type: "VIBECHECK_DATA",
            product: {
              ...product,
              variants: shopifyProduct?.variants || []
            },
            catalog: shopifyCatalog
          },
          "*"
        );
      } catch (err) {
        // Frame may still be navigating
      }
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

    // Listen for iframe communication: ready handshake, variant selection, and close commands
    window.addEventListener("message", function (event) {
      if (!event.data || typeof event.data !== "object") return;
      if (event.data.type === "VIBECHECK_READY") {
        sendDataToFrame();
      } else if (event.data.type === "VIBECHECK_SELECT_VARIANT") {
        const variantId = event.data.variantId;
        const variantInput = document.querySelector(
          'form[action*="/cart/add"] [name="id"]'
        );
        if (variantInput && variantId) {
          variantInput.value = variantId;
        }
        const variantRadios = document.querySelectorAll(
          'input[type="radio"][value="' + variantId + '"]'
        );
        if (variantRadios.length) {
          variantRadios[0].checked = true;
        }
        const variantSelects = document.querySelectorAll(
          'select[name="id"]'
        );
        if (variantSelects.length && variantId) {
          variantSelects[0].value = variantId;
        }
      } else if (event.data.type === "VIBECHECK_NAVIGATE_PRODUCT") {
        if (event.data.handle) {
          window.location.href = "/products/" + encodeURIComponent(event.data.handle);
        }
      } else if (event.data.type === "VIBECHECK_CLOSE") {
        closeModal();
      } else if (event.data.type === "VIBECHECK_SESSION") {
        if (!experienceFrame || event.source !== experienceFrame.contentWindow) return;
        var sessionId = String(event.data.sessionId || "").slice(0, 64);
        if (!sessionId) return;
        fetch("/cart.js")
          .then(function (response) { return response.json(); })
          .then(function (cart) {
            var existing = String((cart.attributes || {}).vibecheck_session || "")
              .split(",")
              .filter(Boolean);
            if (existing.indexOf(sessionId) === -1) existing.push(sessionId);
            return fetch("/cart/update.js", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                attributes: { vibecheck_session: existing.slice(-5).join(",") }
              })
            });
          })
          .catch(function () {});
      }
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

  // Guard: Ensure the Virtual Try-On button is never hidden or removed by theme updates
  if (typeof window !== "undefined" && window.MutationObserver && document.body) {
    var domObserver = new MutationObserver(function () {
      var buttons = document.querySelectorAll("[data-vibecheck-open]");
      buttons.forEach(function (btn) {
        if (btn.style.display === "none") btn.style.display = "inline-flex";
        if (btn.style.visibility === "hidden") btn.style.visibility = "visible";
      });
    });
    domObserver.observe(document.body, { childList: true, subtree: true });
  }
})();