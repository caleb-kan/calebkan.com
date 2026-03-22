(function () {
  "use strict";

  const POLL_INTERVAL_ACTIVE = 1000; // Must stay in sync with --spotify-progress-duration in jemdoc.css
  const POLL_INTERVAL_IDLE = 5000;
  const RESIZE_DEBOUNCE = 150;
  const MAX_CONSECUTIVE_ERRORS = 3;
  const MARQUEE_SPEED_PX_PER_SEC = 30;
  const MARQUEE_MOVE_FRACTION = 0.35; // Must match CSS @keyframes marquee movement phases (10%-45% and 55%-90%)
  const MARQUEE_MIN_DURATION_SEC = 4;
  const POLL_INTERVAL_BACKOFF = 30000;
  const API_URL = "/api/now-playing";
  const FETCH_TIMEOUT_MS = 5000;

  // 1x1 transparent placeholder to avoid broken image icon
  const PLACEHOLDER_IMAGE =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  const spotifyCard = document.getElementById("spotify-card");
  const albumArt = document.getElementById("spotify-album-art");
  const titleEl = document.getElementById("spotify-title");
  const artistEl = document.getElementById("spotify-artist");
  const progressEl = document.getElementById("spotify-progress");
  const pageTitleEl = document.getElementById("page-title");

  if (!spotifyCard || !albumArt || !titleEl || !artistEl || !progressEl) {
    console.warn("spotify: missing required DOM element(s)");
    return;
  }

  let placeholderActive = false;
  let lastFailedArtUrl = null;
  albumArt.addEventListener("error", function () {
    if (!placeholderActive) {
      console.warn("spotify: album art failed to load:", albumArt.src);
      lastFailedArtUrl = albumArt.src;
      placeholderActive = true;
      albumArt.src = PLACEHOLDER_IMAGE;
    }
  });

  let currentTrackId = null;
  let pollTimeoutId = null;
  let inFlight = false;
  let isActive = false;
  let consecutiveErrors = 0;
  let resumedFromHidden = false;

  function fetchNowPlaying() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    return fetch(API_URL, { signal: controller.signal })
      .then(function (response) {
        if (!response.ok) {
          throw new Error(`Spotify returned HTTP ${response.status}`);
        }
        return response.json().catch(function (parseError) {
          throw new Error("Spotify API returned non-JSON response", {
            cause: parseError,
          });
        });
      })
      .then(function (data) {
        consecutiveErrors = 0;
        return data;
      })
      .catch(function (error) {
        consecutiveErrors++;
        if (consecutiveErrors === MAX_CONSECUTIVE_ERRORS) {
          console.error(
            "Spotify API: persistent failure after",
            consecutiveErrors,
            "attempts:",
            error,
          );
        } else {
          console.warn("Spotify API error:", error);
        }
        return null;
      })
      .finally(() => clearTimeout(timeout));
  }

  function formatTime(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
  }

  function setProgress(percentage, instant, progressMs, durationMs) {
    if (!Number.isFinite(percentage)) percentage = 0;
    if (instant) progressEl.style.transition = "none";
    progressEl.style.transform = `scaleX(${percentage / 100})`;
    const rounded = Math.round(percentage);
    progressEl.setAttribute("aria-valuenow", rounded);
    if (durationMs > 0 && Number.isFinite(progressMs)) {
      progressEl.setAttribute(
        "aria-valuetext",
        formatTime(progressMs) + " of " + formatTime(durationMs),
      );
    } else {
      progressEl.setAttribute("aria-valuetext", `${rounded}%`);
    }
    if (instant) {
      void progressEl.offsetWidth; // force reflow before re-enabling transition
      progressEl.style.transition = "";
    }
  }

  function getOverflowPx(el) {
    return Math.max(0, Math.ceil(el.scrollWidth - el.clientWidth));
  }

  function resetMarquee(el) {
    el.classList.remove("marquee");
    el.style.removeProperty("--marquee-offset");
    el.style.removeProperty("--marquee-duration");
    const inner = el.querySelector(".marquee-inner");
    if (inner) {
      el.textContent = inner.textContent;
    }
  }

  function wrapInMarquee(el) {
    const span = document.createElement("span");
    span.className = "marquee-inner";
    span.append(...Array.from(el.childNodes));
    el.replaceChildren(span);
  }

  function updateMarquee() {
    resetMarquee(titleEl);
    resetMarquee(artistEl);

    // Skip animation for users who prefer reduced motion;
    // CSS handles the text-overflow: ellipsis fallback
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const titleOverflow = getOverflowPx(titleEl);
    const artistOverflow = getOverflowPx(artistEl);
    const maxOverflow = Math.max(titleOverflow, artistOverflow);

    if (maxOverflow === 0) return;

    // Calculate shared animation duration based on the longest scroll distance
    const rawDuration =
      maxOverflow / MARQUEE_SPEED_PX_PER_SEC / MARQUEE_MOVE_FRACTION;
    const duration = `${Math.max(rawDuration, MARQUEE_MIN_DURATION_SEC)}s`;

    // Apply offsets and shared duration, then wrap text in inner span for animation
    for (const [el, overflow] of [
      [titleEl, titleOverflow],
      [artistEl, artistOverflow],
    ]) {
      if (overflow > 0) {
        el.style.setProperty("--marquee-offset", `-${overflow}px`);
        el.style.setProperty("--marquee-duration", duration);
        wrapInMarquee(el);
      }
    }

    // Force reflow, then activate .marquee on both so animations start in sync
    void titleEl.offsetWidth;

    if (titleOverflow > 0) titleEl.classList.add("marquee");
    if (artistOverflow > 0) artistEl.classList.add("marquee");
  }

  function scheduleMarqueeUpdate() {
    if (spotifyCard.hidden) return;
    requestAnimationFrame(updateMarquee);
  }

  function isSafeUrl(url) {
    try {
      const parsed = new URL(url);
      return (
        parsed.protocol === "https:" && parsed.hostname === "open.spotify.com"
      );
    } catch (e) {
      console.warn("spotify: rejected malformed songUrl:", url);
      return false;
    }
  }

  function updateSongLink(songUrl) {
    if (songUrl && isSafeUrl(songUrl)) {
      titleEl.href = songUrl;
      titleEl.target = "_blank";
      titleEl.rel = "noopener noreferrer";
      titleEl.removeAttribute("aria-disabled");
      titleEl.classList.remove("is-disabled");
    } else {
      titleEl.removeAttribute("href");
      titleEl.removeAttribute("target");
      titleEl.removeAttribute("rel");
      titleEl.setAttribute("aria-disabled", "true");
      titleEl.classList.add("is-disabled");
    }
  }

  function showSpotifyCard(data) {
    const trackId = data.songUrl || `${data.title}-${data.artist}`;
    const isNewTrack = trackId !== currentTrackId;

    if (isNewTrack) {
      resetMarquee(titleEl);
      resetMarquee(artistEl);
      currentTrackId = trackId;
      lastFailedArtUrl = null;
      placeholderActive = !data.albumArt;
      albumArt.src = data.albumArt || PLACEHOLDER_IMAGE;
      albumArt.alt = data.album ? `${data.album} album art` : "Album art";
      const title = data.title || "Unknown";
      titleEl.textContent = title;
      titleEl.setAttribute("aria-label", `${title} on Spotify`);
      artistEl.textContent = data.artist || "Unknown";
      updateSongLink(data.songUrl);
    } else if (
      placeholderActive &&
      data.albumArt &&
      data.albumArt !== lastFailedArtUrl
    ) {
      lastFailedArtUrl = null;
      placeholderActive = false;
      albumArt.src = data.albumArt;
    }

    const duration = data.duration ?? 0;
    const progress = data.progress ?? 0;
    const currentPercentage =
      duration > 0 ? Math.min((progress / duration) * 100, 100) : 0;

    if (spotifyCard.hidden) {
      spotifyCard.hidden = false;
      spotifyCard.style.animation = "none";
      void spotifyCard.offsetWidth;
      spotifyCard.style.animation = "";
    }

    // Schedule marquee update after card is visible so measurements work
    if (isNewTrack) {
      scheduleMarqueeUpdate();
    }

    if (data.isPlaying && duration > 0) {
      // Calculate where progress will be at the next poll
      const progressAtNextPoll = Math.min(
        progress + POLL_INTERVAL_ACTIVE,
        duration,
      );
      const targetPercentage = Math.min(
        (progressAtNextPoll / duration) * 100,
        100,
      );

      if (isNewTrack || resumedFromHidden) {
        // New track or tab restore: jump to current position instantly, then animate
        setProgress(currentPercentage, true, progress, duration);
        requestAnimationFrame(function () {
          setProgress(targetPercentage, false, progressAtNextPoll, duration);
        });
      } else {
        // Same track: smoothly animate to target
        setProgress(targetPercentage, false, progressAtNextPoll, duration);
      }
    } else {
      // Paused or missing duration: show current position without animation
      setProgress(currentPercentage, true, progress, duration);
    }
  }

  function hideSpotifyCard() {
    if (!spotifyCard.hidden) {
      if (pageTitleEl && spotifyCard.contains(document.activeElement)) {
        pageTitleEl.focus();
      }
      spotifyCard.hidden = true;
    }
    currentTrackId = null;
  }

  function pollOnce() {
    if (!isActive || inFlight) return;

    const pollStartTime = Date.now();
    inFlight = true;

    fetchNowPlaying()
      .then(function (data) {
        if (data === null) return; // Transient error: preserve resumedFromHidden for next poll
        if (data.isPlaying) {
          showSpotifyCard(data);
        } else {
          hideSpotifyCard();
        }
        resumedFromHidden = false;
      })
      .catch(function (error) {
        console.error("Spotify render error:", error);
        resumedFromHidden = false;
        currentTrackId = null; // Force full re-render on next poll
      })
      .finally(function () {
        inFlight = false;
        if (!isActive) return;

        // Back off after persistent errors, otherwise poll based on state
        let interval;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          interval = POLL_INTERVAL_BACKOFF;
        } else if (spotifyCard.hidden) {
          interval = POLL_INTERVAL_IDLE;
        } else {
          interval = POLL_INTERVAL_ACTIVE;
        }
        const elapsed = Date.now() - pollStartTime;
        const delay = Math.max(0, interval - elapsed);
        pollTimeoutId = setTimeout(function () {
          pollTimeoutId = null;
          pollOnce();
        }, delay);
      });
  }

  function startPolling() {
    if (isActive) return;
    isActive = true;
    pollOnce();
  }

  function stopPolling() {
    isActive = false;
    if (pollTimeoutId) clearTimeout(pollTimeoutId);
    pollTimeoutId = null;
  }

  startPolling();

  let resizeTimer = null;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(scheduleMarqueeUpdate, RESIZE_DEBOUNCE);
  });
  window.addEventListener("load", scheduleMarqueeUpdate);

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) {
      stopPolling();
    } else {
      resumedFromHidden = true;
      startPolling();
      scheduleMarqueeUpdate();
    }
  });
})();
