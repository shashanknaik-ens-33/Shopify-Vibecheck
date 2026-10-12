
export async function loader() {
  const banubaConfigured = Boolean(
    process.env.BANUBA_CLIENT_TOKEN?.trim()
  );

  return Response.json({
    success: true,
    app: "Vibecheck",
    message: "Virtual Try-On API is running",
    providers: {
      banuba: banubaConfigured ? "configured" : "awaiting_credentials",
      fashn: "not_configured",
    },
    features: {
      liveCamera: "Available in the theme extension",
      photoUpload: "Available in the theme extension",
      aiProcessing: "Not integrated yet",
    },
  });
}
