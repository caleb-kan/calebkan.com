(function () {
  function initParticles() {
    if (typeof particlesJS === 'function' && document.getElementById('particles-js')) {
      particlesJS.load('particles-js', 'particles.json', function () {
        console.log('particles.json loaded');
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initParticles);
  } else {
    initParticles();
  }
})();
