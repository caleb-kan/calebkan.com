(function() {
  const frames = [
    './favicon/frame_00_delay-0.1s.ico',
    './favicon/frame_01_delay-0.1s.ico',
    './favicon/frame_02_delay-0.1s.ico',
    './favicon/frame_03_delay-0.1s.ico',
    './favicon/frame_04_delay-0.1s.ico',
    './favicon/frame_05_delay-0.1s.ico',
    './favicon/frame_06_delay-0.1s.ico',
    './favicon/frame_07_delay-0.1s.ico',
    './favicon/frame_08_delay-0.1s.ico',
    './favicon/frame_09_delay-0.1s.ico',
    './favicon/frame_10_delay-0.1s.ico',
    './favicon/frame_11_delay-0.1s.ico',
    './favicon/frame_12_delay-0.1s.ico'
  ];

  let currentFrame = 0;
  let intervalId = null;
  let faviconElement = null;

  // Preload frames
  frames.forEach(src => { const img = new Image(); img.src = src; });

  function getFaviconElement() {
    if (!faviconElement) {
      // Match common rel values (icon, shortcut icon, etc.)
      faviconElement = document.querySelector('link[rel*="icon"]');
      if (!faviconElement) {
        faviconElement = document.createElement('link');
        faviconElement.rel = 'icon';
        document.head.appendChild(faviconElement);
      }
    }
    return faviconElement;
  }

  function setFavicon(index) {
    getFaviconElement().href = frames[index];
  }

  function updateFavicon() {
    setFavicon(currentFrame);
    currentFrame = (currentFrame + 1) % frames.length;
  }

  function startAnimation() {
    if (!intervalId) {
      intervalId = setInterval(updateFavicon, 100);
    }
  }

  function stopAnimation() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      startAnimation();
    } else {
      stopAnimation();
    }
  }

  document.addEventListener('visibilitychange', handleVisibilityChange);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startAnimation);
  } else {
    startAnimation();
  }
})();
