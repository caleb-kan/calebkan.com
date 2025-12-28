(function() {
  'use strict';

  const FRAME_INTERVAL = 100;
  const frames = [
    './favicon/frame_00_delay_0.1s.ico',
    './favicon/frame_01_delay_0.1s.ico',
    './favicon/frame_02_delay_0.1s.ico',
    './favicon/frame_03_delay_0.1s.ico',
    './favicon/frame_04_delay_0.1s.ico',
    './favicon/frame_05_delay_0.1s.ico',
    './favicon/frame_06_delay_0.1s.ico',
    './favicon/frame_07_delay_0.1s.ico',
    './favicon/frame_08_delay_0.1s.ico',
    './favicon/frame_09_delay_0.1s.ico',
    './favicon/frame_10_delay_0.1s.ico',
    './favicon/frame_11_delay_0.1s.ico',
    './favicon/frame_12_delay_0.1s.ico'
  ];

  let currentFrame = 0;
  let intervalId = null;
  let faviconElement = null;

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  function getFaviconElement() {
    if (!faviconElement) {
      faviconElement = document.querySelector('link[rel*="icon"]');
      if (!faviconElement) {
        faviconElement = document.createElement('link');
        faviconElement.rel = 'icon';
        document.head.appendChild(faviconElement);
      }
    }
    return faviconElement;
  }

  function updateFavicon() {
    getFaviconElement().href = frames[currentFrame];
    currentFrame = (currentFrame + 1) % frames.length;
  }

  function startAnimation() {
    if (!intervalId && document.visibilityState === 'visible') {
      intervalId = setInterval(updateFavicon, FRAME_INTERVAL);
    }
  }

  function stopAnimation() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
      startAnimation();
    } else {
      stopAnimation();
    }
  });

  ready(function() {
    // Preload all frames
    frames.forEach(function(src) {
      const img = new Image();
      img.src = src;
    });

    startAnimation();
  });
})();
