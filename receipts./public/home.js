import { hydrateIcons } from '/icons.js';

hydrateIcons();

// Fade sections in as you scroll.
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    }
  },
  { threshold: 0.15 },
);
document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

// Replay the hero animation every 11 seconds.
const scene = document.getElementById('scene');
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function play() {
  scene.classList.remove('play');
  void scene.offsetWidth; // restart CSS animations
  scene.classList.add('play');
}
if (reduce) scene.classList.add('static');
else {
  play();
  setInterval(() => {
    if (!document.hidden) play();
  }, 11000);
}

// The little buddy's eyes follow your mouse.
const eyes = document.querySelector('.buddy .eyes');
if (eyes && !reduce) {
  window.addEventListener('pointermove', (e) => {
    const r = eyes.ownerSVGElement.getBoundingClientRect();
    const dx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / 400));
    const dy = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 3)) / 400));
    eyes.style.transform = `translate(${dx * 3}px, ${dy * 3}px)`;
  });
}