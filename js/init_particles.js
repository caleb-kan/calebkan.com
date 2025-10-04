(function () {
  function initParticles() {
    var container = document.getElementById('particles-js');
    if (typeof particlesJS === 'function' && container) {
      particlesJS.load('particles-js', 'particles.json', function () {
        // Particles loaded successfully
      });
    } else if (container && typeof particlesJS !== 'function') {
      // Particles library failed to load - fail silently and continue without particles
      console.warn('particles.js library not loaded');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initParticles);
  } else {
    initParticles();
  }
})();
