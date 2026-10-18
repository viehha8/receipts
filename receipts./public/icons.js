// Small hand-drawn style line icons (used instead of emojis). All draw with currentColor.
const P = {
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  bolt: '<path d="M13.5 3L5.5 13.5h6l-1 7.5 8-10.5h-6z"/>',
  cancel: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  task: '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="3.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  pin: '<path d="M12 21s6.5-6 6.5-11.5a6.5 6.5 0 10-13 0C5.5 15 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.4"/>',
  bag: '<path d="M5 8.5h14l-1.2 11.5H6.2z"/><path d="M9 8.5V7a3 3 0 016 0v1.5"/>',
  coin: '<circle cx="12" cy="12" r="8.5"/><path d="M14.6 9.6c-.5-.9-1.5-1.4-2.6-1.4-1.5 0-2.6.8-2.6 1.9 0 2.6 5.2 1.4 5.2 4 0 1.1-1.1 1.9-2.6 1.9-1.1 0-2.1-.5-2.6-1.4M12 6.5v1.7M12 15.8v1.7"/>',
  note: '<path d="M6 3.5h8.5l4 4v13H6z"/><path d="M14 3.5V8h4.5M9 13h6M9 16.5h4"/>',
  shield: '<path d="M12 3l7.5 3v5.6c0 4.4-3.2 7.9-7.5 9.4-4.3-1.5-7.5-5-7.5-9.4V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="3"/><path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  chat: '<path d="M4.5 5.5h15v10.5H10l-5.5 4z"/>',
  upload: '<path d="M12 15V4.5M7.5 9L12 4.5 16.5 9"/><path d="M4.5 15v3.5a1.5 1.5 0 001.5 1.5h12a1.5 1.5 0 001.5-1.5V15"/>',
  clipboard: '<rect x="5.5" y="4.5" width="13" height="16" rx="2.5"/><path d="M9.5 4.5V3.5h5v1M9 11h6M9 14.5h4"/>',
  users: '<circle cx="9" cy="8.5" r="3.3"/><path d="M3 19.5c.6-3.2 3-5 6-5s5.4 1.8 6 5"/><circle cx="17" cy="9.5" r="2.4"/><path d="M17 14c2.2 0 3.6 1.4 4 3.8"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  clip: '<path d="M20 11.5l-8 8a5 5 0 01-7-7l8.5-8.5a3.3 3.3 0 014.7 4.7L9.8 17a1.7 1.7 0 01-2.4-2.4L15 7"/>',
  alert: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5M12 17.4v.1"/>',
  thumbdown: '<path d="M10 14.5v4a2 2 0 002 2l3.5-7.5V3.5H7a2 2 0 00-2 1.7l-1.2 7.5a2 2 0 002 2.3z"/><path d="M15.5 13h3a1.5 1.5 0 001.5-1.5V5a1.5 1.5 0 00-1.5-1.5h-3"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7.5a2 2 0 002 2h2.5"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  sparkle: '<path d="M12 3c.6 4.2 2.3 6 6.5 6.5-4.2.6-5.9 2.3-6.5 6.5-.6-4.2-2.3-5.9-6.5-6.5C9.7 9 11.4 7.2 12 3z"/><path d="M18.5 15.5c.3 1.6 1 2.3 2.5 2.5-1.5.3-2.2 1-2.5 2.5-.3-1.5-1-2.2-2.5-2.5 1.5-.2 2.2-.9 2.5-2.5z"/>',
  receipt: '<path d="M6 3h12v18l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4L6 21z"/><path d="M9 8h6M9 11.5h6M9 15h3.5"/>',
  send: '<path d="M4 11.5L20 4l-6.5 16-2.8-6.7z"/><path d="M10.7 13.3L20 4"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  user: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20.5c.9-3.8 3.8-6 7.5-6s6.6 2.2 7.5 6"/>',
  cursor: '<path d="M6 3.5l12.5 7-5.5 1.8-2 5.7z"/>',
  mask: '<path d="M3 9c3-1.5 6-1.5 9 0 3-1.5 6-1.5 9 0-.5 5-3 7.5-5.5 7.5S12.5 14 12 12c-.5 2-1 4.5-3.5 4.5S3.5 14 3 9z"/><path d="M7 10.5h2.5M14.5 10.5H17"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0112 7.3 4.3 4.3 0 0119.5 10c0 5.4-7.5 10-7.5 10z"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5s1.1-6.1 3.4-8.5z"/>',
};

export function icon(name, cls = '') {
  const body = P[name] || P.note;
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

/** Replaces every <i data-icon="name"></i> on the page with its SVG. */
export function hydrateIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((el) => {
    el.outerHTML = icon(el.dataset.icon, el.className || '');
  });
}