import { useState } from "react";
import "../styles/dashboard.css";

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
    <s-page heading="Settings" inlineSize="large">
      <div className="vc">
        <header className="vc-header">
          <div>
            <h1 className="vc-title">Settings</h1>
            <p className="vc-subtitle">
              Control what your customers can do with try-on.
            </p>
          </div>
        </header>

        <div className="vc-grid">
          <section className="vc-card vc-span-2" style={{ "--i": 0 }}>
            <div className="vc-card__head">
              <h2 className="vc-card__title">Customer experience</h2>
            </div>
            {options.map((option) => (
              <div className="vc-switch-row" key={option.title}>
                <div className="vc-row__body">
                  <div className="vc-row__title">{option.title}</div>
                  <div className="vc-row__meta" style={{ whiteSpace: "normal" }}>
                    {option.description}
                  </div>
                </div>
                <s-switch
                  label={option.title}
                  checked={option.checked}
                  onChange={(event) => option.change(event.currentTarget.checked)}
                />
              </div>
            ))}
            <p className="vc-note">
              These switches aren't saved yet and don't change your storefront.
              Saving is the next step.
            </p>
          </section>
        </div>
      </div>
    </s-page>
  );
}