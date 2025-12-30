(function() {
  'use strict';

  const POLL_INTERVAL = 1000;

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  // 1x1 transparent placeholder to avoid broken image icon
  const PLACEHOLDER_IMAGE = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  ready(function() {
    const spotifyCard = document.getElementById('spotify-card');
    const albumArt = document.getElementById('spotify-album-art');
    const titleEl = document.getElementById('spotify-title');
    const artistEl = document.getElementById('spotify-artist');
    const progressEl = document.getElementById('spotify-progress');

    if (!spotifyCard || !albumArt || !titleEl || !artistEl || !progressEl) return;

    let currentTrackId = null;
    let pollTimeoutId = null;
    let inFlight = false;
    let isActive = false;

    function fetchNowPlaying() {
      return fetch('/api/now-playing')
        .then(function(response) {
          if (!response.ok) {
            throw new Error('Failed to fetch');
          }
          return response.json();
        })
        .catch(function(error) {
          console.warn('Spotify API error:', error);
          return { isPlaying: false };
        });
    }

    // Disable CSS transition temporarily for instant jumps
    function setProgressInstant(percentage) {
      progressEl.style.transition = 'none';
      progressEl.style.width = percentage + '%';
      // Force reflow to apply instant change
      void progressEl.offsetWidth;
      progressEl.style.transition = '';
    }

    // Set progress with smooth CSS transition
    function setProgressSmooth(percentage) {
      progressEl.style.width = percentage + '%';
    }

    function getOverflowPx(el) {
      return Math.max(0, Math.ceil(el.scrollWidth - el.clientWidth));
    }

    function updateMarquee() {
      // Reset both elements
      titleEl.classList.remove('marquee');
      artistEl.classList.remove('marquee');
      titleEl.style.removeProperty('--marquee-offset');
      titleEl.style.removeProperty('--marquee-duration');
      artistEl.style.removeProperty('--marquee-offset');
      artistEl.style.removeProperty('--marquee-duration');

      // Measure overflow
      const titleOverflow = getOverflowPx(titleEl);
      const artistOverflow = getOverflowPx(artistEl);
      const maxOverflow = Math.max(titleOverflow, artistOverflow);

      if (maxOverflow === 0) return;

      // Calculate animation duration based on scroll distance
      const speedPxPerSec = 15;
      const moveFraction = 0.35;
      const minDurationSec = 6;

      let totalDurationSec = (maxOverflow / speedPxPerSec) / moveFraction;
      totalDurationSec = Math.max(totalDurationSec, minDurationSec);
      const duration = totalDurationSec + 's';

      // Apply offsets and shared duration
      if (titleOverflow > 0) {
        titleEl.style.setProperty('--marquee-offset', '-' + titleOverflow + 'px');
      }
      if (artistOverflow > 0) {
        artistEl.style.setProperty('--marquee-offset', '-' + artistOverflow + 'px');
      }

      titleEl.style.setProperty('--marquee-duration', duration);
      artistEl.style.setProperty('--marquee-duration', duration);

      // Force reflow so animations restart in sync
      void titleEl.offsetWidth;

      if (titleOverflow > 0) titleEl.classList.add('marquee');
      if (artistOverflow > 0) artistEl.classList.add('marquee');
    }

    function scheduleMarqueeUpdate() {
      if (spotifyCard.hidden) return;
      requestAnimationFrame(updateMarquee);
    }

    function updateSongLink(songUrl) {
      if (songUrl) {
        titleEl.href = songUrl;
        titleEl.removeAttribute('aria-disabled');
        titleEl.classList.remove('is-disabled');
      } else {
        titleEl.removeAttribute('href');
        titleEl.setAttribute('aria-disabled', 'true');
        titleEl.classList.add('is-disabled');
      }
    }

    function showSpotifyCard(data) {
      const trackId = data.songUrl || (data.title + '-' + data.artist);
      const isNewTrack = trackId !== currentTrackId;

      if (isNewTrack) {
        currentTrackId = trackId;
        albumArt.src = data.albumArt || PLACEHOLDER_IMAGE;
        albumArt.alt = data.album ? data.album + ' album art' : 'Album art';
        titleEl.textContent = data.title || 'Unknown';
        artistEl.textContent = data.artist || 'Unknown';
      }

      updateSongLink(data.songUrl || '');

      const duration = data.duration || 0;
      const progress = data.progress || 0;
      const currentPercentage = duration > 0 ? Math.min((progress / duration) * 100, 100) : 0;

      if (spotifyCard.hidden) {
        spotifyCard.hidden = false;
      }

      // Schedule marquee update after card is visible so measurements work
      if (isNewTrack) {
        scheduleMarqueeUpdate();
      }

      if (data.isPlaying && duration > 0) {
        // Calculate where progress will be at the next poll
        const progressAtNextPoll = Math.min(progress + POLL_INTERVAL, duration);
        const targetPercentage = Math.min((progressAtNextPoll / duration) * 100, 100);

        if (isNewTrack) {
          // New track: jump to current position instantly, then animate
          setProgressInstant(currentPercentage);
          requestAnimationFrame(function() {
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
        .then(function(data) {
          if (data.isPlaying) {
            showSpotifyCard(data);
          } else {
            hideSpotifyCard();
          }
        })
        .finally(function() {
          inFlight = false;
          if (!isActive) return;

          // Schedule next poll relative to when this poll started
          // to prevent latency from causing drift
          const elapsed = Date.now() - pollStartTime;
          const delay = Math.max(0, POLL_INTERVAL - elapsed);
          pollTimeoutId = setTimeout(function() {
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

    window.addEventListener('resize', scheduleMarqueeUpdate);
    window.addEventListener('load', scheduleMarqueeUpdate);

    document.addEventListener('visibilitychange', function() {
      if (document.hidden) {
        stopPolling();
      } else {
        startPolling();
      }
    });
  });
})();
