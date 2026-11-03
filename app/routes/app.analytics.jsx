export default function Analytics() {
  const metrics = ["Try-on sessions", "Unique visitors", "Camera vs photo"];

  return (
    <s-page heading="Analytics">
      <s-section>
        <s-grid
          gridTemplateColumns="repeat(auto-fit, minmax(180px, 1fr))"
          gap="base"
        >
          {metrics.map((label) => (
            <s-grid-item key={label}>
              <s-box padding="base" border="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-text color="subdued">{label}</s-text>
                  <s-heading>—</s-heading>
                </s-stack>
              </s-box>
            </s-grid-item>
          ))}
        </s-grid>
      </s-section>

      <s-section heading="Top products">
        <s-stack direction="block" gap="small">
          <s-text type="strong">No try-on activity yet</s-text>
          <s-text color="subdued">
            Once customers start trying products on, you'll see sessions, top
            products and category breakdowns here.
          </s-text>
        </s-stack>
      </s-section>
    </s-page>
  );
}