// Movimiento de la página: revelados al entrar en pantalla, dibujo inicial del motivo,
// sección activa en la navegación y paso activo del caso. Nada corre en bucle, nada toma
// el control del scroll, y todo cede ante "reducir movimiento".

let started = false;

export function initMotion() {
  if (started) return;
  started = true;
  const root = document.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const targets = [...document.querySelectorAll('[data-reveal]')];
  const motif = document.querySelector('.intro-motif');
  const revealAll = () => {
    targets.forEach(el => el.classList.add('is-revealed'));
    motif?.classList.add('is-drawn');
  };

  if (motif) {
    motif.querySelectorAll('.motif-links path').forEach((path, i) => {
      path.setAttribute('pathLength', '1');
      path.style.setProperty('--i', i);
    });
    motif.querySelectorAll('.motif-nodes > *').forEach((node, i) => node.style.setProperty('--i', i));
  }

  if (reduced.matches || !('IntersectionObserver' in window)) {
    revealAll();
  } else {
    root.classList.add('motion-ready');
    const revealer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-revealed');
        if (motif && entry.target.contains(motif)) motif.classList.add('is-drawn');
        revealer.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.04 });
    targets.forEach((el, i) => {
      el.style.transitionDelay = `${Math.min(i, 2) * 70}ms`;
      revealer.observe(el);
    });
    if (motif && !motif.closest('[data-reveal]')) motif.classList.add('is-drawn');
    reduced.addEventListener?.('change', event => { if (event.matches) revealAll(); });
    // Si algo impide observar (pestaña en segundo plano, impresión), el contenido igual aparece.
    window.addEventListener('beforeprint', revealAll);
  }

  initActiveSection();
  initTopbarShadow();
  initFoldedTargets();
}

// Alto de lo que queda fijo arriba: la barra y, cuando el mapa está acoplado sobre el contenido, el mapa.
function stuckHeight() {
  const topbar = document.querySelector('.topbar');
  const dock = document.querySelector('.dock');
  let height = topbar ? topbar.getBoundingClientRect().height : 0;
  if (dock && getComputedStyle(dock).position === 'sticky' && window.matchMedia('(max-width: 1079px)').matches) {
    const canvas = dock.querySelector('.graph-canvas');
    height += canvas ? canvas.offsetTop + canvas.offsetHeight : dock.offsetHeight;
  }
  return height;
}

// Avisa qué paso (`data-scene`) cruza la franja de lectura, o null si no hay ninguno. Solo observa: el scroll es el del navegador.
export function watchScenes(onChange) {
  const scenes = [...document.querySelectorAll('[data-scene]')];
  if (!scenes.length || !('IntersectionObserver' in window)) return;
  const visible = new Set();
  let observer = null;
  let timer = 0;
  let current = null;
  const build = () => {
    observer?.disconnect();
    visible.clear();
    const viewport = window.innerHeight;
    const top = Math.min(stuckHeight(), viewport * 0.7);
    const rest = viewport - top;
    // Una franja angosta, a un tercio del espacio de lectura: el paso que la cruza es el que se está leyendo.
    const from = Math.round(top + rest * 0.3);
    const to = Math.round(top + rest * 0.4);
    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      let next = null;
      for (const scene of scenes) if (visible.has(scene)) next = scene;
      const id = next?.dataset.scene ?? null;
      clearTimeout(timer);
      if (id === current) return;
      // Una pausa corta evita redibujar el mapa por cada paso que se cruza al saltar a otra sección.
      timer = setTimeout(() => { current = id; onChange(id); }, 160);
    }, { rootMargin: `-${from}px 0px -${Math.max(0, viewport - to)}px 0px` });
    scenes.forEach(scene => observer.observe(scene));
  };
  build();
  let resizeTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(build, 200); });
}

// Un enlace a algo que está dentro de un plegable cerrado lo abre antes de llegar.
function initFoldedTargets() {
  const reveal = (hash, scroll) => {
    if (!hash || hash.length < 2) return;
    let target = null;
    try { target = document.getElementById(decodeURIComponent(hash.slice(1))); } catch { return; }
    if (!target) return;
    const folded = [];
    for (let node = target.closest('details'); node; node = node.parentElement?.closest('details')) if (!node.open) folded.push(node);
    if (!folded.length) return;
    for (const node of folded) {
      // Sin transición: el destino tiene que estar en su lugar antes de que el navegador lo busque.
      node.classList.add('is-instant');
      node.open = true;
      requestAnimationFrame(() => requestAnimationFrame(() => node.classList.remove('is-instant')));
    }
    if (scroll) target.scrollIntoView();
  };
  document.addEventListener('click', event => {
    const link = event.target instanceof Element ? event.target.closest('a[href^="#"]') : null;
    if (link) reveal(link.getAttribute('href'), false);
  });
  window.addEventListener('hashchange', () => reveal(location.hash, true));
  reveal(location.hash, true);
}

function initActiveSection() {
  if (!('IntersectionObserver' in window)) return;
  const sections = new Map();
  // Un enlace marca como propia la sección de su destino y lo que declare pertenecerle con data-nav.
  document.querySelectorAll('.topnav a[href^="#"]').forEach(link => {
    const id = link.getAttribute('href').slice(1);
    for (const section of [document.getElementById(id), ...document.querySelectorAll(`[data-nav="${id}"]`)]) {
      if (!section) continue;
      if (!sections.has(section)) sections.set(section, []);
      sections.get(section).push(link);
    }
  });
  if (!sections.size) return;
  const visible = new Set();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) visible.add(entry.target);
      else visible.delete(entry.target);
    }
    // Gana la última sección visible en el orden del documento.
    let current = null;
    for (const section of sections.keys()) if (visible.has(section)) current = section;
    for (const [section, links] of sections) {
      for (const link of links) {
        if (section === current) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      }
    }
  }, { rootMargin: '-35% 0px -55% 0px' });
  sections.forEach((_, section) => observer.observe(section));
}

function initTopbarShadow() {
  const topbar = document.querySelector('.topbar');
  if (!topbar || !('IntersectionObserver' in window)) return;
  const sentinel = document.createElement('div');
  sentinel.setAttribute('aria-hidden', 'true');
  sentinel.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px;pointer-events:none';
  document.body.prepend(sentinel);
  new IntersectionObserver(([entry]) => topbar.classList.toggle('is-scrolled', !entry.isIntersecting)).observe(sentinel);
}
