import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { createSpotifyPoller } from "../lib/spotify-poller";
import {
  INITIAL_SPOTIFY_STATE,
  PLACEHOLDER_IMAGE,
  POLL_INTERVAL_ACTIVE,
  RESIZE_DEBOUNCE,
  marqueeDuration,
  progressPosition,
  spotifyReducer,
  type PlaybackSample,
} from "../lib/spotify";

const ALBUM_ART_SIZE = 160; // Match the root --album-art-size CSS value.
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

interface MarqueeLayout {
  title: number;
  artist: number;
  duration: string;
  generation: number;
}

interface MarqueeStyle extends CSSProperties {
  "--marquee-offset": string;
  "--marquee-duration": string;
}

const INITIAL_MARQUEE: MarqueeLayout = {
  title: 0,
  artist: 0,
  duration: "",
  generation: 0,
};

function marqueeStyle(
  overflow: number,
  duration: string,
): MarqueeStyle | undefined {
  return overflow > 0
    ? { "--marquee-offset": `-${overflow}px`, "--marquee-duration": duration }
    : undefined;
}

function overflowPixels(element: HTMLElement): number {
  // The inner span's own width excludes its animated transform. Reading the
  // outer scrollWidth during a marquee would otherwise change the measurement.
  const inner = element.querySelector<HTMLElement>(".marquee-inner");
  const width = inner ? inner.scrollWidth : element.scrollWidth;
  return Math.max(0, Math.ceil(width - element.clientWidth));
}

function useMarquee(
  hidden: boolean,
  trackId: string | null,
  titleRef: RefObject<HTMLAnchorElement | null>,
  artistRef: RefObject<HTMLParagraphElement | null>,
): MarqueeLayout {
  const [layout, setLayout] = useState(INITIAL_MARQUEE);

  useLayoutEffect(() => {
    setLayout(INITIAL_MARQUEE);
    if (hidden) return;
    let frame: number | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const media = window.matchMedia(REDUCED_MOTION_QUERY);

    function measure() {
      frame = null;
      const title = titleRef.current;
      const artist = artistRef.current;
      if (!title || !artist) return;
      const titleOverflow = media.matches ? 0 : overflowPixels(title);
      const artistOverflow = media.matches ? 0 : overflowPixels(artist);
      setLayout((previous) => ({
        title: titleOverflow,
        artist: artistOverflow,
        duration: marqueeDuration(titleOverflow, artistOverflow),
        generation: previous.generation + 1,
      }));
    }

    function schedule() {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    }

    function resize() {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(schedule, RESIZE_DEBOUNCE);
    }

    function visibility() {
      if (!document.hidden) schedule();
    }

    // Hydration can finish before styles arrive. Observe the measured elements
    // so their final CSS dimensions trigger the same debounced recalculation
    // as a viewport resize, even when that first measurement was zero.
    const observer = new ResizeObserver(resize);
    if (titleRef.current) observer.observe(titleRef.current);
    if (artistRef.current) observer.observe(artistRef.current);
    schedule();
    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", visibility);
    media.addEventListener("change", schedule);
    return () => {
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", visibility);
      media.removeEventListener("change", schedule);
    };
  }, [hidden, trackId, titleRef, artistRef]);

  return layout;
}

function SpotifyProgress({ sample }: { sample: PlaybackSample | null }) {
  const progressRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(() => progressPosition(0, 0));

  useLayoutEffect(() => {
    const element = progressRef.current;
    if (!element || !sample) return;
    let frame: number | null = null;

    function apply(progress: number, instant: boolean) {
      if (!element || !sample) return;
      const nextPosition = progressPosition(progress, sample.duration);
      if (instant) element.style.transition = "none";
      element.style.transform = `scaleX(${nextPosition.fraction})`;
      setPosition(nextPosition);
      if (instant) {
        // Commit the initial position before restoring the CSS transition.
        // React batching must not collapse this browser animation boundary.
        void element.offsetWidth;
        element.style.transition = "";
      }
    }

    if (sample.duration > 0) {
      const nextProgress = Math.min(
        sample.progress + POLL_INTERVAL_ACTIVE,
        sample.duration,
      );
      if (sample.instant) {
        apply(sample.progress, true);
        frame = requestAnimationFrame(() => {
          frame = null;
          apply(nextProgress, false);
        });
      } else {
        apply(nextProgress, false);
      }
    } else {
      apply(sample.progress, true);
    }

    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [sample]);

  return (
    <div className="spotify-progress-container">
      <div
        ref={progressRef}
        id="spotify-progress"
        className="spotify-progress"
        role="progressbar"
        aria-label="Song progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={position.percentage}
        aria-valuetext={position.text}
      />
    </div>
  );
}

export function SpotifyCard() {
  const [state, dispatch] = useReducer(spotifyReducer, INITIAL_SPOTIFY_STATE);
  const cardRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLAnchorElement>(null);
  const artistRef = useRef<HTMLParagraphElement>(null);
  const marquee = useMarquee(state.hidden, state.trackId, titleRef, artistRef);

  useEffect(() => {
    const poller = createSpotifyPoller((data, resumed) => {
      if (
        !data.isPlaying &&
        cardRef.current?.contains(document.activeElement)
      ) {
        document.getElementById("page-title")?.focus();
      }
      dispatch({ type: "playback", data, resumed });
    });
    function visibility() {
      if (document.hidden) poller.stop();
      else poller.start(true);
    }
    if (!document.hidden) poller.start();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      poller.dispose();
    };
  }, []);

  const track = state.track;
  const titleClasses = ["spotify-title"];
  if (track && !track.songUrl) titleClasses.push("is-disabled");
  if (marquee.title > 0) titleClasses.push("marquee");

  return (
    <section
      ref={cardRef}
      id="spotify-card"
      className="card-spotify"
      aria-labelledby="spotify-heading"
      hidden={state.hidden}
    >
      <h2 id="spotify-heading" className="spotify-header">
        <i className="fa-brands fa-spotify" aria-hidden="true" />
        <span>Now Playing</span>
      </h2>
      <div className="spotify-content">
        <img
          id="spotify-album-art"
          src={track?.artUrl ?? PLACEHOLDER_IMAGE}
          alt={track?.artAlt ?? ""}
          width={ALBUM_ART_SIZE}
          height={ALBUM_ART_SIZE}
          className="spotify-album-art"
          onError={(event) => {
            const url = event.currentTarget.getAttribute("src");
            if (url && url !== PLACEHOLDER_IMAGE) {
              console.warn("spotify: album art failed to load:", url);
              dispatch({ type: "art-error", url });
            }
          }}
        />
        <div className="spotify-info" aria-live="polite">
          <a
            ref={titleRef}
            id="spotify-title"
            className={titleClasses.join(" ")}
            style={marqueeStyle(marquee.title, marquee.duration)}
            href={track?.songUrl}
            target={track?.songUrl ? "_blank" : undefined}
            rel={track?.songUrl ? "noopener noreferrer" : undefined}
            aria-label={
              track?.songUrl ? `${track.title} on Spotify` : undefined
            }
          >
            {marquee.title > 0 ? (
              <span key={marquee.generation} className="marquee-inner">
                {track?.title}
              </span>
            ) : (
              track?.title
            )}
          </a>
          <p
            ref={artistRef}
            id="spotify-artist"
            className={`spotify-artist${marquee.artist > 0 ? " marquee" : ""}`}
            style={marqueeStyle(marquee.artist, marquee.duration)}
          >
            {marquee.artist > 0 ? (
              <span key={marquee.generation} className="marquee-inner">
                {track?.artist}
              </span>
            ) : (
              track?.artist
            )}
          </p>
        </div>
      </div>
      <SpotifyProgress sample={state.sample} />
    </section>
  );
}
