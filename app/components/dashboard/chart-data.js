const LETTERS = ["S", "M", "T", "W", "T", "F", "S"];

// Counts events per day for the last 7 days in the viewer's own time zone.
// Run this in the browser (useEffect), not during server rendering.
export function bucketLastSevenDays(isoTimes, now = new Date()) {
  const days = [];
  for (let i = 6; i >= 0; i -= 1) {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(day.getDate() - i);
    days.push({ key: day.toDateString(), label: LETTERS[day.getDay()], count: 0 });
  }

  const index = new Map(days.map((day, i) => [day.key, i]));
  for (const iso of isoTimes) {
    const position = index.get(new Date(iso).toDateString());
    if (position !== undefined) days[position].count += 1;
  }

  return {
    counts: days.map((day) => day.count),
    labels: days.map((day) => day.label),
  };
}

export function timeAgo(iso, now = Date.now()) {
  const seconds = Math.max(1, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}