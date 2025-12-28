(function() {
  'use strict';

  const POLL_INTERVAL = 1000; // 1 second

  const spotifyCard = document.getElementById('spotify-card');
  const albumArt = document.getElementById('spotify-album-art');
  const titleEl = document.getElementById('spotify-title');
  const artistEl = document.getElementById('spotify-artist');
  const progressEl = document.getElementById('spotify-progress');

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

    var elapsed = Date.now() - lastFetchTime;
    var newProgress = Math.min(currentProgress + elapsed, currentDuration);
    var percentage = (newProgress / currentDuration) * 100;
    progressEl.style.width = percentage + '%';

    // Continue animation
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

  function updateMarqueePair(titleEl, artistEl) {
    var els = [titleEl, artistEl];

    // 1) Reset both
    els.forEach(function(el) {
      el.classList.remove('marquee');
      el.style.removeProperty('--marquee-offset');
      el.style.removeProperty('--marquee-duration');
    });

    // 2) Measure overflow
    function overflowPx(el) {
      return Math.max(0, Math.ceil(el.scrollWidth - el.clientWidth));
    }

    var titleOverflow = overflowPx(titleEl);
    var artistOverflow = overflowPx(artistEl);
    var maxOverflow = Math.max(titleOverflow, artistOverflow);

    if (maxOverflow === 0) return;

    // 3) Fixed scroll speed during the moving segment of keyframes
    var speedPxPerSec = 15;
    var moveFraction = 0.35;
    var minDurationSec = 6;

    var totalDurationSec = (maxOverflow / speedPxPerSec) / moveFraction;
    totalDurationSec = Math.max(totalDurationSec, minDurationSec);
    var duration = totalDurationSec + 's';

    // 4) Apply offsets (each element travels its own distance) and shared duration
    if (titleOverflow > 0) titleEl.style.setProperty('--marquee-offset', '-' + titleOverflow + 'px');
    if (artistOverflow > 0) artistEl.style.setProperty('--marquee-offset', '-' + artistOverflow + 'px');

    titleEl.style.setProperty('--marquee-duration', duration);
    artistEl.style.setProperty('--marquee-duration', duration);

    // 5) Force a reflow once so both animations restart together
    void titleEl.offsetWidth;

    if (titleOverflow > 0) titleEl.classList.add('marquee');
    if (artistOverflow > 0) artistEl.classList.add('marquee');
  }

  function showSpotifyCard(data) {
    // Only update DOM if track changed
    var trackId = data.title + '-' + data.artist;
    if (trackId !== currentTrackId) {
      currentTrackId = trackId;
      albumArt.src = data.albumArt;
      albumArt.alt = data.album + ' album art';
      titleEl.textContent = data.title;
      titleEl.href = data.songUrl;
      artistEl.textContent = data.artist;

      // Check for marquee after DOM update
      requestAnimationFrame(function() {
        updateMarqueePair(titleEl, artistEl);
      });
    }

    currentProgress = data.progress;
    currentDuration = data.duration;
    lastFetchTime = Date.now();
    isPlaying = data.isPlaying;

    var percentage = (data.progress / data.duration) * 100;
    progressEl.style.width = percentage + '%';

    if (spotifyCard.hidden) {
      spotifyCard.hidden = false;
    }

    // Start smooth progress animation
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

  // Initial fetch
  update();

  // Poll frequently for near real-time updates
  setInterval(update, POLL_INTERVAL);

  // Immediately update when tab becomes visible
  document.addEventListener('visibilitychange', function() {
    if (document.hidden) {
      stopProgressAnimation();
    } else {
      // Immediately fetch fresh data when tab becomes visible
      update();
    }
  });
})();
