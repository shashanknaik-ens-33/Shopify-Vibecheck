const base = {
  width: 18,
  height: 18,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
};

export const ArrowUpRight = (props) => (
  <svg {...base} {...props}>
    <path d="M7 17 17 7M8 7h9v9" />
  </svg>
);

export const Check = (props) => (
  <svg {...base} width={12} height={12} strokeWidth={3} {...props}>
    <path d="m5 12 5 5 9-10" />
  </svg>
);

export const Camera = (props) => (
  <svg {...base} {...props}>
    <path d="M4 8h3l2-2h6l2 2h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);

export const Plus = (props) => (
  <svg {...base} {...props}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const Refresh = (props) => (
  <svg {...base} {...props}>
    <path d="M20 11a8 8 0 0 0-14.9-3M4 5v4h4M4 13a8 8 0 0 0 14.9 3M20 19v-4h-4" />
  </svg>
);