(function() {
  'use strict';

  const POLL_INTERVAL = 30000; // 30 seconds
  const PROGRESS_UPDATE_INTERVAL = 1000; // 1 second

  const spotifyCard = document.getElementById('spotify-card');
  const albumArt = document.getElementById('spotify-album-art');
  const titleEl = document.getElementById('spotify-title');
  const artistEl = document.getElementById('spotify-artist');
  const progressEl = document.getElementById('spotify-progress');

  let currentTrackId = null;
  let progressInterval = null;
  let currentProgress = 0;
  let currentDuration = 0;
  let lastFetchTime = 0;

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
    if (!currentDuration) return;

    var elapsed = Date.now() - lastFetchTime;
    var newProgress = Math.min(currentProgress + elapsed, currentDuration);
    var percentage = (newProgress / currentDuration) * 100;
    progressEl.style.width = percentage + '%';
  }

  function showSpotifyCard(data) {
    albumArt.src = data.albumArt;
    albumArt.alt = data.album + ' album art';
    titleEl.textContent = data.title;
    titleEl.href = data.songUrl;
    artistEl.textContent = data.artist;

    currentProgress = data.progress;
    currentDuration = data.duration;
    lastFetchTime = Date.now();

    var percentage = (data.progress / data.duration) * 100;
    progressEl.style.width = percentage + '%';

    spotifyCard.hidden = false;

    // Start progress animation
    if (progressInterval) {
      clearInterval(progressInterval);
    }
    progressInterval = setInterval(updateProgress, PROGRESS_UPDATE_INTERVAL);
  }

  function hideSpotifyCard() {
    spotifyCard.hidden = true;
    currentTrackId = null;

    if (progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    }
  }

  function update() {
    fetchNowPlaying().then(function(data) {
      if (data.isPlaying) {
        var trackId = data.title + '-' + data.artist;

        if (trackId !== currentTrackId) {
          currentTrackId = trackId;
          showSpotifyCard(data);
        } else {
          // Same track, just update progress
          currentProgress = data.progress;
          currentDuration = data.duration;
          lastFetchTime = Date.now();
        }
      } else {
        hideSpotifyCard();
      }
    });
  }

  // Initial fetch
  update();

  // Poll for updates
  setInterval(update, POLL_INTERVAL);

  // Pause progress animation when tab is hidden
  document.addEventListener('visibilitychange', function() {
    if (document.hidden && progressInterval) {
      clearInterval(progressInterval);
      progressInterval = null;
    } else if (!document.hidden && !spotifyCard.hidden) {
      progressInterval = setInterval(updateProgress, PROGRESS_UPDATE_INTERVAL);
    }
  });
})();
