import { useState } from "react";

export default function Settings() {
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [uploadEnabled, setUploadEnabled] = useState(true);
  const [autoDetect, setAutoDetect] = useState(true);

  const options = [
    {
      title: "Live camera",
      description: "Let customers try products on with their camera.",
      checked: cameraEnabled,
      change: setCameraEnabled,
    },
    {
      title: "Photo upload",
      description: "Let customers try products on with a photo.",
      checked: uploadEnabled,
      change: setUploadEnabled,
    },
    {
      title: "Automatic product detection",
      description: "Match products to a category using titles, types and tags.",
      checked: autoDetect,
      change: setAutoDetect,
    },
  ];

  return (
    <s-page heading="Settings">
      <s-section heading="Customer experience">
        <s-stack direction="block" gap="base">
          {options.map((option, index) => (
            <s-stack key={option.title} direction="block" gap="base">
              {index > 0 ? <s-divider /> : null}
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-stack direction="block" gap="small">
                  <s-text type="strong">{option.title}</s-text>
                  <s-text color="subdued">{option.description}</s-text>
                </s-stack>
                <s-spacer />
                <s-switch
                  checked={option.checked}
                  onChange={(event) =>
                    option.change(event.currentTarget.checked)
                  }
                />
              </s-stack>
            </s-stack>
          ))}
        </s-stack>

        <s-banner tone="info">
          These switches aren't saved yet and don't change your storefront.
          Saving is the next step.
        </s-banner>
      </s-section>
    </s-page>
  );
}