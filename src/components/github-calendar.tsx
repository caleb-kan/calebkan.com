import { useEffect, useState } from "react";
import {
  CALENDAR_VIEW_BOX,
  CELL_CORNER_RADIUS,
  CELL_SIZE,
  STROKE_WIDTH,
  getCalendarColors,
  startCalendarPolling,
  type CalendarCell,
} from "../lib/github-calendar";

interface CalendarGraphicProps {
  cells: CalendarCell[];
  isDark: boolean;
}

export function CalendarGraphic({ cells, isDark }: CalendarGraphicProps) {
  const { colors, stroke } = getCalendarColors(isDark);
  return (
    <svg viewBox={CALENDAR_VIEW_BOX} role="img" aria-labelledby="gh-cal-title">
      <title id="gh-cal-title">GitHub contribution calendar</title>
      {cells.map((cell) => (
        <rect
          key={cell.date}
          width={CELL_SIZE}
          height={CELL_SIZE}
          x={cell.x}
          y={cell.y}
          rx={CELL_CORNER_RADIUS}
          data-level={cell.level}
          strokeWidth={STROKE_WIDTH}
          style={{ fill: colors[cell.level], stroke }}
        >
          <title>{cell.title}</title>
        </rect>
      ))}
    </svg>
  );
}

export function GithubCalendar() {
  const [cells, setCells] = useState<CalendarCell[] | null>(null);
  const [hasError, setHasError] = useState(false);
  const [isDark, setIsDark] = useState(
    () =>
      typeof document === "undefined" ||
      document.documentElement.classList.contains("dark"),
  );

  useEffect(() => {
    const updateColors = () => {
      setIsDark(document.documentElement.classList.contains("dark"));
    };
    const observer = new MutationObserver(updateColors);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    updateColors();
    return () => observer.disconnect();
  }, []);

  useEffect(
    () =>
      startCalendarPolling({
        visibility: document,
        onUpdate: setCells,
        onError: () => setHasError(true),
      }),
    [],
  );

  return (
    <div id="github-calendar" aria-live="polite">
      {cells ? (
        <CalendarGraphic cells={cells} isDark={isDark} />
      ) : hasError ? (
        "Unable to display contributions"
      ) : (
        "Loading contributions..."
      )}
    </div>
  );
}
