// Movimiento de la página: revelados al entrar en pantalla, dibujo inicial del motivo
// y sección activa en la navegación. Nada corre en bucle; todo cede ante "reducir movimiento".

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
  initMapShortcut();
}

function initMapShortcut() {
  const map=document.getElementById('network');
  if(!map || !('IntersectionObserver' in window))return;
  const narrow=window.matchMedia('(max-width:1079px)');
  const reduced=window.matchMedia('(prefers-reduced-motion:reduce)');
  const button=document.createElement('button');
  button.type='button';button.className='map-shortcut';button.textContent='Ver en el mapa';button.setAttribute('aria-controls','network');button.hidden=true;
  document.body.append(button);
  let visible=true,pending=false;
  const update=()=>{const typing=document.activeElement?.matches('input,textarea');button.hidden=!narrow.matches || visible || !pending || typing;};
  new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;if(visible)pending=false;update();},{threshold:0.1}).observe(map);
  const observer=new MutationObserver(()=>{pending=true;update();});
  for(const id of ['graph-title','graph-subtitle']){const element=document.getElementById(id);if(element)observer.observe(element,{childList:true,subtree:true,characterData:true});}
  button.addEventListener('click',()=>{
    pending=false;update();
    map.closest('section').scrollIntoView({behavior:reduced.matches?'instant':'smooth',block:'start'});
    map.setAttribute('tabindex','-1');map.focus({preventScroll:true});
  });
  narrow.addEventListener?.('change',update);
  document.addEventListener('focusin',update);document.addEventListener('focusout',()=>requestAnimationFrame(update));
}

function initActiveSection() {
  if (!('IntersectionObserver' in window)) return;
  const links = new Map();
  document.querySelectorAll('.topnav a[href^="#"]').forEach(link => {
    const section = document.getElementById(link.getAttribute('href').slice(1));
    if (section) links.set(section, link);
  });
  if (!links.size) return;
  const visible = new Set();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) visible.add(entry.target);
      else visible.delete(entry.target);
    }
    // Gana la última sección visible en el orden del documento.
    let current = null;
    for (const section of links.keys()) if (visible.has(section)) current = section;
    for (const [section, link] of links) {
      if (section === current) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
  }, { rootMargin: '-35% 0px -55% 0px' });
  links.forEach((_, section) => observer.observe(section));
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
