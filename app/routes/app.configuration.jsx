export default function Configuration() {
  const areas = [
    {
      title: "Categories",
      text: "Choose which try-on effects are active: Glasses, Lipstick, Headbands and Clothing.",
    },
    {
      title: "Product detection",
      text: "Add your own keywords and decide how products are matched to a category.",
    },
    {
      title: "Product overrides",
      text: "Assign a product to a category by hand, or leave it out of try-on.",
    },
    {
      title: "Lipstick shades",
      text: "Pick the product field that holds each shade colour.",
    },
  ];

  return (
    <s-page heading="Configuration">
      <s-section>
        <s-stack direction="block" gap="base">
          {areas.map((area, index) => (
            <s-stack key={area.title} direction="block" gap="base">
              {index > 0 ? <s-divider /> : null}
              <s-stack direction="inline" gap="base" alignItems="center">
                <s-stack direction="block" gap="small">
                  <s-text type="strong">{area.title}</s-text>
                  <s-text color="subdued">{area.text}</s-text>
                </s-stack>
                <s-spacer />
                <s-badge tone="neutral">Coming soon</s-badge>
              </s-stack>
            </s-stack>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}