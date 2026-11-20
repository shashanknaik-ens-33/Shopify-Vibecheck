// Single source of truth for try-on status. When an effect ships, change one line here.
export const STATUS = {
  live: { label: "Live", tone: "live" },
  prototype: { label: "Prototype", tone: "proto" },
  soon: { label: "Coming soon", tone: "soon" },
  unsupported: { label: "Not supported", tone: "off" },
};

const CATEGORY_STATUS = {
  Lipstick: "live",
  Glasses: "prototype",
  Headbands: "soon",
  Clothing: "soon",
};

export const statusKeyFor = (category) =>
  CATEGORY_STATUS[category] ?? "unsupported";

export const CATEGORIES = [
  { name: "Lipstick", description: "Live lip tracking and shade preview" },
  { name: "Glasses", description: "Face tracking and frame overlay" },
  { name: "Headbands", description: "Forehead tracking and accessory overlay" },
  { name: "Clothing", description: "Garment preview" },
];