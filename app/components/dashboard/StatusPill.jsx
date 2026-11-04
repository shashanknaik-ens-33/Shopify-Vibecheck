import { STATUS } from "./status";

export default function StatusPill({ status }) {
  const item = STATUS[status] ?? STATUS.unsupported;
  return <span className={`vc-pill vc-pill--${item.tone}`}>{item.label}</span>;
}