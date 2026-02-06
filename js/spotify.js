(function () {
  "use strict";

  const POLL_INTERVAL_ACTIVE = 1000;
  const POLL_INTERVAL_IDLE = 5000;
  const RESIZE_DEBOUNCE = 150;
  const MAX_CONSECUTIVE_ERRORS = 3;

  // 1x1 transparent placeholder to avoid broken image icon
  const PLACEHOLDER_IMAGE =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  const spotifyCard = document.getElementById("spotify-card");
  const albumArt = document.getElementById("spotify-album-art");
  const titleEl = document.getElementById("spotify-title");
  const artistEl = document.getElementById("spotify-artist");
  const progressEl = document.getElementById("spotify-progress");

  if (!spotifyCard || !albumArt || !titleEl || !artistEl || !progressEl) return;

  albumArt.addEventListener("error", function () {
    if (albumArt.src !== PLACEHOLDER_IMAGE) {
      albumArt.src = PLACEHOLDER_IMAGE;
    }
  });

  let currentTrackId = null;
  let pollTimeoutId = null;
  let inFlight = false;
  let isActive = false;
  let consecutiveErrors = 0;

  function fetchNowPlaying() {
    return fetch("/api/now-playing")
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Failed to fetch");
        }
        consecutiveErrors = 0;
        return response.json();
      })
      .catch(function (error) {
        consecutiveErrors++;
        console.warn("Spotify API error:", error);
        if (consecutiveErrors > MAX_CONSECUTIVE_ERRORS) {
          return { isPlaying: false };
        }
        return null;
      });
  }

  // Disable CSS transition temporarily for instant jumps
  function setProgressInstant(percentage) {
    progressEl.style.transition = "none";
    progressEl.style.transform = "scaleX(" + percentage / 100 + ")";
    progressEl.setAttribute("aria-valuenow", Math.round(percentage));
    void progressEl.offsetWidth;
    progressEl.style.transition = "";
  }

  // Set progress with smooth CSS transition (compositor-only, no layout)
  function setProgressSmooth(percentage) {
    progressEl.style.transform = "scaleX(" + percentage / 100 + ")";
    progressEl.setAttribute("aria-valuenow", Math.round(percentage));
  }

  function getOverflowPx(el) {
    return Math.max(0, Math.ceil(el.scrollWidth - el.clientWidth));
  }

  function updateMarquee() {
    // Reset both elements
    titleEl.classList.remove("marquee");
    artistEl.classList.remove("marquee");
    titleEl.style.removeProperty("--marquee-offset");
    titleEl.style.removeProperty("--marquee-duration");
    artistEl.style.removeProperty("--marquee-offset");
    artistEl.style.removeProperty("--marquee-duration");

    // Measure overflow
    const titleOverflow = getOverflowPx(titleEl);
    const artistOverflow = getOverflowPx(artistEl);
    const maxOverflow = Math.max(titleOverflow, artistOverflow);

    if (maxOverflow === 0) return;

    // Calculate animation duration based on scroll distance
    const speedPxPerSec = 15;
    const moveFraction = 0.35;
    const minDurationSec = 6;

    let totalDurationSec = maxOverflow / speedPxPerSec / moveFraction;
    totalDurationSec = Math.max(totalDurationSec, minDurationSec);
    const duration = totalDurationSec + "s";

    // Apply offsets and shared duration
    if (titleOverflow > 0) {
      titleEl.style.setProperty("--marquee-offset", "-" + titleOverflow + "px");
    }
    if (artistOverflow > 0) {
      artistEl.style.setProperty(
        "--marquee-offset",
        "-" + artistOverflow + "px",
      );
    }

    titleEl.style.setProperty("--marquee-duration", duration);
    artistEl.style.setProperty("--marquee-duration", duration);

    // Force reflow so animations restart in sync
    void titleEl.offsetWidth;

    if (titleOverflow > 0) titleEl.classList.add("marquee");
    if (artistOverflow > 0) artistEl.classList.add("marquee");
  }

  function scheduleMarqueeUpdate() {
    if (spotifyCard.hidden) return;
    requestAnimationFrame(updateMarquee);
  }

  function updateSongLink(songUrl) {
    if (songUrl) {
      titleEl.href = songUrl;
      titleEl.removeAttribute("aria-disabled");
      titleEl.classList.remove("is-disabled");
    } else {
      titleEl.removeAttribute("href");
      titleEl.setAttribute("aria-disabled", "true");
      titleEl.classList.add("is-disabled");
    }
  }

  function showSpotifyCard(data) {
    const trackId = data.songUrl || data.title + "-" + data.artist;
    const isNewTrack = trackId !== currentTrackId;

    if (isNewTrack) {
      currentTrackId = trackId;
      albumArt.src = data.albumArt || PLACEHOLDER_IMAGE;
      albumArt.alt = data.album ? data.album + " album art" : "Album art";
      titleEl.textContent = data.title || "Unknown";
      artistEl.textContent = data.artist || "Unknown";
      updateSongLink(data.songUrl || null);
    }

    const duration = data.duration || 0;
    const progress = data.progress || 0;
    const currentPercentage =
      duration > 0 ? Math.min((progress / duration) * 100, 100) : 0;

    if (spotifyCard.hidden) {
      spotifyCard.hidden = false;
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

      if (isNewTrack) {
        // New track: jump to current position instantly, then animate
        setProgressInstant(currentPercentage);
        requestAnimationFrame(function () {
          setProgressSmooth(targetPercentage);
        });
      } else {
        // Same track: smoothly animate to target
        setProgressSmooth(targetPercentage);
      }
    } else {
      // Paused: show current position without animation
      setProgressInstant(currentPercentage);
    }
  }

  function hideSpotifyCard() {
    if (!spotifyCard.hidden) {
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
        if (data === null) return; // Transient error, keep last state
        if (data.isPlaying) {
          showSpotifyCard(data);
        } else {
          hideSpotifyCard();
        }
      })
      .finally(function () {
        inFlight = false;
        if (!isActive) return;

        // Poll faster when playing, slower when idle
        const interval = spotifyCard.hidden
          ? POLL_INTERVAL_IDLE
          : POLL_INTERVAL_ACTIVE;
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
      startPolling();
    }
  });
})();
