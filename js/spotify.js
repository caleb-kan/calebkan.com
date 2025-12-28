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
    let progressAnimationId = null;
    let currentProgress = 0;
    let currentDuration = 0;
    let lastFetchTime = 0;
    let isPlaying = false;

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

    function updateProgress() {
      if (!currentDuration || !isPlaying) return;

      const elapsed = Date.now() - lastFetchTime;
      const newProgress = Math.min(currentProgress + elapsed, currentDuration);
      const percentage = (newProgress / currentDuration) * 100;
      progressEl.style.width = percentage + '%';

      progressAnimationId = requestAnimationFrame(updateProgress);
    }

    function startProgressAnimation() {
      if (progressAnimationId) {
        cancelAnimationFrame(progressAnimationId);
      }
      progressAnimationId = requestAnimationFrame(updateProgress);
    }

    function stopProgressAnimation() {
      if (progressAnimationId) {
        cancelAnimationFrame(progressAnimationId);
        progressAnimationId = null;
      }
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

    function showSpotifyCard(data) {
      const trackId = data.title + '-' + data.artist;

      if (trackId !== currentTrackId) {
        currentTrackId = trackId;
        albumArt.src = data.albumArt || PLACEHOLDER_IMAGE;
        albumArt.alt = data.album ? data.album + ' album art' : 'Album art';
        titleEl.textContent = data.title || 'Unknown';
        titleEl.href = data.songUrl || '#';
        artistEl.textContent = data.artist || 'Unknown';

        requestAnimationFrame(updateMarquee);
      }

      currentProgress = data.progress || 0;
      currentDuration = data.duration || 0;
      lastFetchTime = Date.now();
      isPlaying = data.isPlaying;

      const percentage = currentDuration > 0 ? (currentProgress / currentDuration) * 100 : 0;
      progressEl.style.width = percentage + '%';

      if (spotifyCard.hidden) {
        spotifyCard.hidden = false;
      }

      if (isPlaying) {
        startProgressAnimation();
      } else {
        stopProgressAnimation();
      }
    }

    function hideSpotifyCard() {
      if (!spotifyCard.hidden) {
        spotifyCard.hidden = true;
      }
      currentTrackId = null;
      isPlaying = false;
      stopProgressAnimation();
    }

    function update() {
      fetchNowPlaying().then(function(data) {
        if (data.isPlaying) {
          showSpotifyCard(data);
        } else {
          hideSpotifyCard();
        }
      });
    }

    update();

    setInterval(update, POLL_INTERVAL);

    document.addEventListener('visibilitychange', function() {
      if (document.hidden) {
        stopProgressAnimation();
      } else {
        update();
      }
    });
  });
})();
