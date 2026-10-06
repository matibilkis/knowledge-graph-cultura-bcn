// Vista SVG de la red: layout determinista, pan/zoom, selección y animación de mensajes.
// Sin dependencias. Nunca inserta HTML a partir de datos: solo textContent y atributos.

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW = { w: 1000, h: 700 };
const TYPE_LABEL = { project: 'Proyecto', actor: 'Actor', capability: 'Capacidad', resource: 'Recurso' };
const RADIUS = { project: 15, actor: 10, capability: 10, resource: 10 };
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 6;
const LABEL_PX = 12.5;
const MAX_FOCUS_EDGE_LABELS = 6;
const MAX_PULSE_SOURCES = 7;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const safeToken = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9_-]/g, '');

function svgEl(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

// Fruchterman-Reingold con semillas derivadas del id: mismo grafo, mismo dibujo.
function computeLayout(nodes, edges, width, height) {
  const n = nodes.length;
  const result = new Map();
  if (!n) return result;
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const links = [];
  for (const edge of edges) {
    const a = index.get(edge.source);
    const b = index.get(edge.target);
    if (a !== undefined && b !== undefined && a !== b) links.push([a, b]);
  }
  const degree = new Float64Array(n);
  const adjacency = nodes.map(() => []);
  for (const [a, b] of links) {
    degree[a] += 1;
    degree[b] += 1;
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const placed = new Uint8Array(n);
  const order = nodes.map((_, i) => i).sort((a, b) => (nodes[a].id < nodes[b].id ? -1 : nodes[a].id > nodes[b].id ? 1 : 0));
  const hubs = order.filter(i => nodes[i].type === 'project');
  hubs.forEach((i, j) => {
    const angle = (Math.PI * 2 * j) / hubs.length - Math.PI / 2;
    px[i] = Math.cos(angle) * width * 0.26;
    py[i] = Math.sin(angle) * height * 0.26;
    placed[i] = 1;
  });
  for (const i of order) {
    if (placed[i]) continue;
    const anchors = adjacency[i].filter(j => placed[j]);
    const jitter = hash(nodes[i].id) * Math.PI * 2;
    if (anchors.length) {
      let sx = 0;
      let sy = 0;
      for (const j of anchors) {
        sx += px[j];
        sy += py[j];
      }
      px[i] = (sx / anchors.length) * 1.3 + Math.cos(jitter) * 40;
      py[i] = (sy / anchors.length) * 1.3 + Math.sin(jitter) * 40;
    } else {
      px[i] = Math.cos(jitter) * width * 0.42;
      py[i] = Math.sin(jitter) * height * 0.42;
    }
    placed[i] = 1;
  }

  const k = 0.9 * Math.sqrt((width * height) / n);
  const iterations = 340;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  const gx = (0.5 * k) / width;
  const gy = (0.5 * k) / height;
  for (let step = 0; step < iterations; step += 1) {
    const temperature = (width / 10) * Math.pow(1 - step / iterations, 1.5) + 0.4;
    dx.fill(0);
    dy.fill(0);
    for (let a = 0; a < n; a += 1) {
      for (let b = a + 1; b < n; b += 1) {
        let ox = px[a] - px[b];
        let oy = py[a] - py[b];
        let d2 = ox * ox + oy * oy;
        if (d2 < 1) {
          ox = hash(nodes[a].id + nodes[b].id) - 0.5;
          oy = hash(nodes[b].id + nodes[a].id) - 0.5;
          d2 = 1;
        }
        const force = (k * k) / d2;
        dx[a] += ox * force;
        dy[a] += oy * force;
        dx[b] -= ox * force;
        dy[b] -= oy * force;
      }
    }
    for (const [a, b] of links) {
      const ox = px[a] - px[b];
      const oy = py[a] - py[b];
      const distance = Math.sqrt(ox * ox + oy * oy) || 1;
      const weight = 0.6 / (1 + Math.sqrt(Math.min(degree[a], degree[b])));
      const force = (distance / k) * weight;
      dx[a] -= ox * force;
      dy[a] -= oy * force;
      dx[b] += ox * force;
      dy[b] += oy * force;
    }
    for (let i = 0; i < n; i += 1) {
      dx[i] -= px[i] * gx * (1 + degree[i] * 0.04);
      dy[i] -= py[i] * gy * (1 + degree[i] * 0.04);
      const length = Math.sqrt(dx[i] * dx[i] + dy[i] * dy[i]) || 1;
      const move = Math.min(length, temperature);
      px[i] += (dx[i] / length) * move;
      py[i] += (dy[i] / length) * move;
    }
  }

  // Encajar en la caja pedida y separar solapamientos.
  const pad = 70;
  const fitBox = () => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i += 1) {
      minX = Math.min(minX, px[i]);
      maxX = Math.max(maxX, px[i]);
      minY = Math.min(minY, py[i]);
      maxY = Math.max(maxY, py[i]);
    }
    let sx = (width - pad * 2) / Math.max(maxX - minX, 1);
    let sy = (height - pad * 2) / Math.max(maxY - minY, 1);
    const ratio = sx / sy;
    if (ratio > 1.45) sx = sy * 1.45;
    if (ratio < 0.69) sy = sx / 0.69;
    const mx = (minX + maxX) / 2;
    const my = (minY + maxY) / 2;
    for (let i = 0; i < n; i += 1) {
      px[i] = (px[i] - mx) * sx;
      py[i] = (py[i] - my) * sy;
    }
  };
  fitBox();
  // El núcleo denso queda apretado y los nodos sueltos se van lejos: se comprime el radio
  // para repartir mejor el espacio sin cambiar el orden angular ni los vecindarios.
  const spread = 0.62;
  for (let i = 0; i < n; i += 1) {
    const u = px[i] / (width / 2 - pad);
    const v = py[i] / (height / 2 - pad);
    const rho = Math.sqrt(u * u + v * v);
    if (rho < 1e-6) continue;
    const factor = Math.pow(rho, spread - 1);
    px[i] *= factor;
    py[i] *= factor;
  }
  fitBox();
  const gap = clamp(Math.sqrt((width * height) / n) * 0.6, 34, 76);
  for (let pass = 0; pass < 40; pass += 1) {
    for (let a = 0; a < n; a += 1) {
      for (let b = a + 1; b < n; b += 1) {
        const ox = px[a] - px[b];
        const oy = (py[a] - py[b]) * 1.25; // las etiquetas van debajo: más aire vertical
        const distance = Math.sqrt(ox * ox + oy * oy) || 0.01;
        if (distance >= gap) continue;
        const push = (gap - distance) / 2 / distance;
        px[a] += ox * push;
        py[a] += (oy * push) / 1.25;
        px[b] -= ox * push;
        py[b] -= (oy * push) / 1.25;
      }
    }
  }
  fitBox();
  nodes.forEach((node, i) => {
    result.set(node.id, { x: VIEW.w / 2 + px[i], y: VIEW.h / 2 + py[i] });
  });
  return result;
}

export class GraphView {
  constructor(svgElement, { onSelect } = {}) {
    this.svg = svgElement;
    this.onSelect = typeof onSelect === 'function' ? onSelect : () => {};
    this.nodes = [];
    this.edges = [];
    this.nodeById = new Map();
    this.edgeById = new Map();
    this.neighbors = new Map();
    this.state = { nodeIds: null, edgeIds: null, selectedId: null, highlightIds: [], highlightEdgeIds: [] };
    this.transform = { x: 0, y: 0, k: 1 };
    this.base = 1;
    this.region = { x: 0, y: 0, w: VIEW.w, h: VIEW.h };
    this.portrait = false;
    this.pointers = new Map();
    this.drag = null;
    this.pinch = null;
    this.engaged = false;
    this.userMoved = false;
    this.rovingId = null;
    this.hoverId = null;
    this.pulseToken = 0;
    this.frames = new Set();
    this.reduced = window.matchMedia('(prefers-reduced-motion: reduce)');

    this.svg.querySelector(':scope > .gv-viewport')?.remove();
    this.viewport = svgEl('g', { class: 'gv-viewport' });
    this.edgeLayer = svgEl('g', { class: 'gv-edges', 'aria-hidden': 'true' });
    this.suggestLayer = svgEl('g', { class: 'gv-suggestions', 'aria-hidden': 'true' });
    this.pulseLayer = svgEl('g', { class: 'gv-pulses', 'aria-hidden': 'true' });
    this.nodeLayer = svgEl('g', { class: 'gv-nodes' });
    this.edgeLabelLayer = svgEl('g', { class: 'gv-edge-labels', 'aria-hidden': 'true' });
    this.viewport.append(this.edgeLayer, this.suggestLayer, this.pulseLayer, this.nodeLayer, this.edgeLabelLayer);
    this.svg.append(this.viewport);
    this.svg.classList.add('gv');

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'graph-tooltip';
    this.tooltip.hidden = true;
    this.tooltip.setAttribute('role', 'presentation');
    this.tooltipName = document.createElement('strong');
    this.tooltipMeta = document.createElement('span');
    this.tooltip.append(this.tooltipName, this.tooltipMeta);
    (this.svg.parentElement || document.body).append(this.tooltip);

    this.handlers = {
      pointerdown: event => this.onPointerDown(event),
      pointermove: event => this.onPointerMove(event),
      pointerup: event => this.onPointerUp(event),
      pointercancel: event => this.onPointerUp(event, true),
      pointerleave: event => this.onPointerLeave(event),
      wheel: event => this.onWheel(event),
      keydown: event => this.onKeyDown(event),
      focusin: event => this.onFocusIn(event),
      focusout: () => this.hideTooltip(),
      pointerover: event => this.onPointerOver(event),
      pointerout: event => this.onPointerOut(event),
    };
    for (const [type, handler] of Object.entries(this.handlers)) {
      this.svg.addEventListener(type, handler, type === 'wheel' ? { passive: false } : undefined);
    }
    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(() => this.onResize());
      this.resizeObserver.observe(this.svg);
    }
    this.measure();
  }

  // ---------- datos ----------

  setData(nodes = [], edges = []) {
    this.stopFrames();
    this.pulseToken += 1;
    const previous = new Map(this.nodes.map(node => [node.id, { x: node.x, y: node.y }]));
    this.nodeById = new Map();
    this.edgeById = new Map();
    this.neighbors = new Map();
    this.nodes = nodes
      .filter(node => node && node.id != null)
      .map(node => ({ id: String(node.id), type: safeToken(node.type) || 'actor', name: String(node.name ?? node.id), x: 0, y: 0, degree: 0, el: null }));
    for (const node of this.nodes) {
      this.nodeById.set(node.id, node);
      this.neighbors.set(node.id, new Map());
    }
    this.edges = [];
    edges.forEach((edge, i) => {
      const source = this.nodeById.get(String(edge?.source));
      const target = this.nodeById.get(String(edge?.target));
      if (!source || !target) return;
      const record = {
        id: String(edge.id ?? `${source.id}__${target.id}__${i}`),
        source,
        target,
        type: safeToken(edge.type),
        label: edge.label == null ? '' : String(edge.label),
        year: edge.year == null ? '' : String(edge.year),
        el: null,
      };
      this.edges.push(record);
      this.edgeById.set(record.id, record);
      source.degree += 1;
      target.degree += 1;
      this.neighbors.get(source.id).set(target.id, record);
      this.neighbors.get(target.id).set(source.id, record);
    });

    this.measure();
    const layout = this.layoutFor(this.portrait);
    for (const node of this.nodes) {
      const point = layout.get(node.id);
      const from = previous.get(node.id);
      node.tx = point.x;
      node.ty = point.y;
      node.x = from ? from.x : point.x;
      node.y = from ? from.y : point.y;
    }

    this.edgeLayer.replaceChildren();
    this.nodeLayer.replaceChildren();
    this.suggestLayer.replaceChildren();
    this.pulseLayer.replaceChildren();
    this.edgeLabelLayer.replaceChildren();
    for (const edge of this.edges) {
      edge.el = svgEl('line', { class: `graph-edge${edge.type ? ` edge--${edge.type}` : ''}` });
      this.edgeLayer.append(edge.el);
    }
    const drawOrder = [...this.nodes].sort((a, b) => (a.type === 'project') - (b.type === 'project'));
    for (const node of drawOrder) this.nodeLayer.append(this.buildNode(node));

    this.state = { nodeIds: null, edgeIds: null, selectedId: null, highlightIds: [], highlightEdgeIds: [] };
    this.rovingId = null;
    this.userMoved = false;
    this.positionAll();
    if (previous.size) this.tweenNodes();
    else for (const node of this.nodes) { node.x = node.tx; node.y = node.ty; }
    this.positionAll();
    this.render();
    this.fit({ animate: false });
  }

  layoutFor(portrait) {
    const [w, h] = portrait ? [660, 1000] : [VIEW.w, VIEW.h];
    return computeLayout(this.nodes, this.edges.map(edge => ({ source: edge.source.id, target: edge.target.id })), w, h);
  }

  buildNode(node) {
    const radius = RADIUS[node.type] ?? 10;
    const group = svgEl('g', {
      class: `graph-node type-${node.type}`,
      role: 'button',
      tabindex: '-1',
      'aria-label': `${node.name}, ${TYPE_LABEL[node.type] ?? 'Nodo'}, ${node.degree} ${node.degree === 1 ? 'vínculo' : 'vínculos'}`,
      'aria-pressed': 'false',
    });
    group.dataset.id = node.id;
    group.style.setProperty('--r', radius);
    group.append(svgEl('circle', { class: 'node-hit', r: 20 }));
    const glyph = svgEl('g', { class: 'node-glyph' });
    glyph.append(svgEl('circle', { class: 'node-halo', r: radius + 9 }));
    glyph.append(svgEl('circle', { class: 'node-ring', r: radius + 5 }));
    if (node.type === 'capability') {
      const side = radius * 1.5;
      glyph.append(svgEl('rect', { class: 'node-shape', x: -side / 2, y: -side / 2, width: side, height: side, rx: 2, transform: 'rotate(45)' }));
    } else if (node.type === 'resource') {
      const side = radius * 1.7;
      glyph.append(svgEl('rect', { class: 'node-shape', x: -side / 2, y: -side / 2, width: side, height: side, rx: 4 }));
    } else {
      glyph.append(svgEl('circle', { class: 'node-shape', r: radius }));
      if (node.type === 'project') glyph.append(svgEl('circle', { class: 'node-core', r: 3.5 }));
    }
    const label = svgEl('text', { class: 'node-label', 'text-anchor': 'middle' });
    label.textContent = node.name;
    group.append(glyph, label);
    node.el = group;
    return group;
  }

  // ---------- estado visible ----------

  update(next = {}) {
    const state = this.state;
    const before = this.visibleKey();
    if ('nodeIds' in next) state.nodeIds = next.nodeIds == null ? null : new Set([...next.nodeIds].map(String));
    if ('edgeIds' in next) state.edgeIds = next.edgeIds == null ? null : new Set([...next.edgeIds].map(String));
    if ('selectedId' in next) state.selectedId = next.selectedId == null ? null : String(next.selectedId);
    if ('highlightIds' in next) state.highlightIds = [...(next.highlightIds ?? [])].map(String);
    if ('highlightEdgeIds' in next) state.highlightEdgeIds = [...(next.highlightEdgeIds ?? [])].map(String);
    this.pulseToken += 1;
    this.clearPulse();
    this.suggestLayer.replaceChildren();
    this.render();
    if (before !== this.visibleKey()) {
      this.userMoved = false;
      this.fit();
    } else if ('selectedId' in next && state.selectedId) {
      this.reveal(state.selectedId);
    }
  }

  visibleKey() {
    const ids = this.state.nodeIds;
    return ids ? [...ids].sort().join('|') : '*';
  }

  isVisible(node) {
    return !this.state.nodeIds || this.state.nodeIds.has(node.id);
  }

  isEdgeVisible(edge) {
    if (!this.isVisible(edge.source) || !this.isVisible(edge.target)) return false;
    return !this.state.edgeIds || this.state.edgeIds.has(edge.id);
  }

  render() {
    const { selectedId, highlightIds, highlightEdgeIds } = this.state;
    const selected = selectedId ? this.nodeById.get(selectedId) : null;
    const highlightNodes = new Set(highlightIds);
    const highlightEdges = new Set(highlightEdgeIds);
    const focusEdges = new Set();
    const focusNodes = new Set(highlightNodes);
    for (const id of highlightEdges) {
      const edge = this.edgeById.get(id);
      if (!edge || !this.isEdgeVisible(edge)) continue;
      focusEdges.add(edge);
      focusNodes.add(edge.source.id);
      focusNodes.add(edge.target.id);
    }
    const neighborIds = new Set();
    if (selected && this.isVisible(selected)) {
      focusNodes.add(selected.id);
      for (const [otherId, edge] of this.neighbors.get(selected.id)) {
        if (!this.isEdgeVisible(edge)) continue;
        neighborIds.add(otherId);
        focusNodes.add(otherId);
      }
      for (const edge of this.edges) {
        if ((edge.source === selected || edge.target === selected) && this.isEdgeVisible(edge)) focusEdges.add(edge);
      }
    }
    const focused = focusNodes.size > 0;
    let visibleCount = 0;

    for (const node of this.nodes) {
      const visible = this.isVisible(node);
      if (visible) visibleCount += 1;
      const el = node.el;
      const isSelected = selected === node && visible;
      el.classList.toggle('is-hidden', !visible);
      el.classList.toggle('is-selected', isSelected);
      el.classList.toggle('is-highlight', visible && highlightNodes.has(node.id));
      el.classList.toggle('is-neighbor', visible && neighborIds.has(node.id));
      el.classList.toggle('is-dim', visible && focused && !focusNodes.has(node.id));
      el.classList.toggle('show-label', visible && focused && focusNodes.has(node.id));
      el.setAttribute('aria-pressed', String(isSelected));
      if (visible) el.removeAttribute('aria-hidden');
      else el.setAttribute('aria-hidden', 'true');
    }
    for (const edge of this.edges) {
      const visible = this.isEdgeVisible(edge);
      edge.el.classList.toggle('is-hidden', !visible);
      edge.el.classList.toggle('is-focus', visible && focusEdges.has(edge));
      edge.el.classList.toggle('is-highlight', visible && highlightEdges.has(edge.id));
      edge.el.classList.toggle('is-dim', visible && focused && !focusEdges.has(edge));
    }
    // Lo enfocado se dibuja arriba.
    for (const edge of focusEdges) this.edgeLayer.append(edge.el);

    this.visibleCount = visibleCount;
    this.svg.classList.toggle('has-focus', focused);
    this.renderEdgeLabels(focusEdges, highlightEdges);
    this.updateRoving();
    this.applyTransform();
  }

  renderEdgeLabels(focusEdges, highlightEdges) {
    this.edgeLabelLayer.replaceChildren();
    this.labelledEdges = [];
    let chosen = [...focusEdges].filter(edge => edge.label);
    if (chosen.length > MAX_FOCUS_EDGE_LABELS) chosen = chosen.filter(edge => highlightEdges.has(edge.id)).slice(0, MAX_FOCUS_EDGE_LABELS * 2);
    for (const edge of chosen) {
      const text = svgEl('text', { class: 'edge-label', 'text-anchor': 'middle' });
      text.textContent = edge.year ? `${edge.label} · ${edge.year}` : edge.label;
      this.edgeLabelLayer.append(text);
      this.labelledEdges.push({ edge, text });
    }
    this.positionEdgeLabels();
  }

  positionEdgeLabels() {
    for (const { edge, text } of this.labelledEdges ?? []) {
      text.setAttribute('x', ((edge.source.x + edge.target.x) / 2).toFixed(1));
      text.setAttribute('y', ((edge.source.y + edge.target.y) / 2).toFixed(1));
    }
  }

  positionAll() {
    for (const node of this.nodes) node.el?.setAttribute('transform', `translate(${node.x.toFixed(1)} ${node.y.toFixed(1)})`);
    for (const edge of this.edges) {
      if (!edge.el) continue;
      edge.el.setAttribute('x1', edge.source.x.toFixed(1));
      edge.el.setAttribute('y1', edge.source.y.toFixed(1));
      edge.el.setAttribute('x2', edge.target.x.toFixed(1));
      edge.el.setAttribute('y2', edge.target.y.toFixed(1));
    }
    this.positionEdgeLabels();
  }

  tweenNodes() {
    if (this.reduced.matches) {
      for (const node of this.nodes) { node.x = node.tx; node.y = node.ty; }
      this.positionAll();
      return;
    }
    const start = this.nodes.map(node => ({ x: node.x, y: node.y }));
    this.animate(520, t => {
      const e = ease(t);
      this.nodes.forEach((node, i) => {
        node.x = start[i].x + (node.tx - start[i].x) * e;
        node.y = start[i].y + (node.ty - start[i].y) * e;
      });
      this.positionAll();
    }, 'nodes');
  }

  // ---------- cámara ----------

  measure() {
    const rect = this.svg.getBoundingClientRect();
    this.rect = rect;
    if (rect.width < 2 || rect.height < 2) {
      this.base = 1;
      this.region = { x: 0, y: 0, w: VIEW.w, h: VIEW.h };
      return false;
    }
    this.base = Math.min(rect.width / VIEW.w, rect.height / VIEW.h);
    const w = rect.width / this.base;
    const h = rect.height / this.base;
    this.region = { x: VIEW.w / 2 - w / 2, y: VIEW.h / 2 - h / 2, w, h };
    this.portrait = rect.width / rect.height < 0.9;
    return true;
  }

  onResize() {
    const wasPortrait = this.portrait;
    if (!this.measure()) return;
    if (this.nodes.length && wasPortrait !== this.portrait) {
      const layout = this.layoutFor(this.portrait);
      for (const node of this.nodes) {
        const point = layout.get(node.id);
        node.tx = point.x;
        node.ty = point.y;
      }
      this.tweenNodes();
      this.userMoved = false;
    }
    if (!this.userMoved) this.fit({ animate: false, target: true });
    else this.applyTransform();
  }

  toUser(clientX, clientY) {
    return {
      x: (clientX - this.rect.left) / this.base + this.region.x,
      y: (clientY - this.rect.top) / this.base + this.region.y,
    };
  }

  applyTransform() {
    const { x, y, k } = this.transform;
    this.viewport.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${k.toFixed(4)})`);
    const scale = this.base * k;
    const style = this.svg.style;
    style.setProperty('--ls', (LABEL_PX / scale).toFixed(3));
    style.setProperty('--ns', clamp(0.62 / scale, 1, 2.4).toFixed(3));
    style.setProperty('--hs', Math.max(1, 1.1 / scale).toFixed(3));
    const count = this.visibleCount ?? this.nodes.length;
    const lod = scale >= 0.98 || count <= 16 ? 'near' : scale >= 0.42 ? 'mid' : 'far';
    if (this.svg.dataset.lod !== lod) this.svg.dataset.lod = lod;
  }

  setTransform(target, animate = true) {
    const goal = { x: target.x, y: target.y, k: clamp(target.k, ZOOM_MIN, ZOOM_MAX) };
    if (!animate || this.reduced.matches) {
      this.cancel('camera');
      this.transform = goal;
      this.applyTransform();
      return;
    }
    const from = { ...this.transform };
    this.animate(340, t => {
      const e = ease(t);
      this.transform = { x: from.x + (goal.x - from.x) * e, y: from.y + (goal.y - from.y) * e, k: from.k + (goal.k - from.k) * e };
      this.applyTransform();
    }, 'camera');
  }

  fit({ animate = true, target = false } = {}) {
    this.measure();
    const visible = this.nodes.filter(node => this.isVisible(node));
    const pool = visible.length ? visible : this.nodes;
    if (!pool.length) return;
    const useTarget = target || this.frames.has('nodes');
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const node of pool) {
      const x = useTarget && node.tx != null ? node.tx : node.x;
      const y = useTarget && node.ty != null ? node.ty : node.y;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const region = this.region;
    const padX = Math.min(54, this.rect.width * 0.09) / this.base;
    const padTop = 58 / this.base;
    const padBottom = 58 / this.base;
    const k = clamp(Math.min((region.w - padX * 2) / Math.max(maxX - minX, 1), (region.h - padTop - padBottom) / Math.max(maxY - minY, 1)), ZOOM_MIN, 1.8);
    const cx = region.x + region.w / 2;
    const cy = region.y + padTop + (region.h - padTop - padBottom) / 2;
    this.userMoved = false;
    this.setTransform({ k, x: cx - ((minX + maxX) / 2) * k, y: cy - ((minY + maxY) / 2) * k }, animate);
  }

  zoom(factor = 1.25, anchor = null, animate = true) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const { x, y, k } = this.transform;
    const nextK = clamp(k * factor, ZOOM_MIN, ZOOM_MAX);
    const point = anchor ?? { x: this.region.x + this.region.w / 2, y: this.region.y + this.region.h / 2 };
    const ratio = nextK / k;
    this.userMoved = true;
    this.setTransform({ k: nextK, x: point.x - (point.x - x) * ratio, y: point.y - (point.y - y) * ratio }, animate);
  }

  // Trae un nodo al encuadre solo si quedó fuera.
  reveal(id) {
    const node = this.nodeById.get(id);
    if (!node || !this.isVisible(node)) return;
    const { x, y, k } = this.transform;
    const sx = node.x * k + x;
    const sy = node.y * k + y;
    const region = this.region;
    const margin = 40 / this.base;
    const inside = sx > region.x + margin && sx < region.x + region.w - margin && sy > region.y + margin && sy < region.y + region.h - margin * 1.6;
    if (inside) return;
    this.setTransform({ k, x: region.x + region.w / 2 - node.x * k, y: region.y + region.h / 2 - node.y * k });
  }

  // ---------- interacción ----------

  nodeFromEvent(event) {
    const el = event.target instanceof Element ? event.target.closest('.graph-node') : null;
    return el && this.svg.contains(el) ? this.nodeById.get(el.dataset.id) : null;
  }

  onPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    this.measure();
    this.engaged = true;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 1) {
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, tx: this.transform.x, ty: this.transform.y, moved: false, node: this.nodeFromEvent(event) };
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.drag = null;
      this.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, start: { ...this.transform } };
      this.cancel('camera');
      this.hideTooltip();
    }
  }

  onPointerMove(event) {
    if (!this.pointers.has(event.pointerId)) {
      if (event.pointerType === 'mouse' && this.hoverId) this.placeTooltip(event.clientX, event.clientY);
      return;
    }
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const start = this.pinch.start;
      const k = clamp(start.k * (distance / this.pinch.distance), ZOOM_MIN, ZOOM_MAX);
      const origin = this.toUser(this.pinch.cx, this.pinch.cy);
      const now = this.toUser(cx, cy);
      const ratio = k / start.k;
      this.transform = { k, x: now.x - (origin.x - start.x) * ratio, y: now.y - (origin.y - start.y) * ratio };
      this.userMoved = true;
      this.applyTransform();
      event.preventDefault();
      return;
    }
    const drag = this.drag;
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      this.cancel('camera');
      this.hideTooltip();
      this.svg.classList.add('is-dragging');
      try { this.svg.setPointerCapture(event.pointerId); } catch { /* el puntero ya no existe */ }
    }
    this.transform = { k: this.transform.k, x: drag.tx + dx / this.base, y: drag.ty + dy / this.base };
    this.userMoved = true;
    this.applyTransform();
  }

  onPointerUp(event, cancelled = false) {
    const drag = this.drag;
    this.pointers.delete(event.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (drag && drag.id === event.pointerId) {
      this.drag = null;
      this.svg.classList.remove('is-dragging');
      if (!cancelled && !drag.moved && drag.node && this.isVisible(drag.node)) this.select(drag.node);
    }
    if (event.pointerType !== 'mouse') this.engaged = false;
  }

  onPointerLeave(event) {
    if (event.pointerType === 'mouse' && !this.drag) this.engaged = false;
  }

  onWheel(event) {
    // La rueda sola desplaza la página; hace zoom con Ctrl/⌘ (o pellizco de trackpad) o tras hacer clic en el mapa.
    if (!(event.ctrlKey || event.metaKey || this.engaged)) return;
    event.preventDefault();
    this.measure();
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaY;
    // El pellizco de trackpad llega como Ctrl + deltas chicos; la rueda, como saltos grandes.
    const factor = Math.exp(-clamp(delta, -120, 120) * (event.ctrlKey && Math.abs(delta) < 40 ? 0.011 : 0.0022));
    this.zoom(factor, this.toUser(event.clientX, event.clientY), false);
  }

  onKeyDown(event) {
    const node = this.nodeFromEvent(event);
    if (node && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      this.select(node);
      return;
    }
    if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      if (node) this.moveFocus(node, event.key);
      else this.focusNode(this.rovingId);
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === '+' || event.key === '=') this.zoom(1.3);
    else if (event.key === '-' || event.key === '_') this.zoom(1 / 1.3);
    else if (event.key === '0') this.fit();
  }

  moveFocus(from, key) {
    const dir = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[key];
    if (!dir) return;
    let best = null;
    let bestScore = Infinity;
    for (const node of this.nodes) {
      if (node === from || !this.isVisible(node)) continue;
      const dx = node.x - from.x;
      const dy = node.y - from.y;
      const along = dx * dir[0] + dy * dir[1];
      if (along <= 4) continue;
      const across = Math.abs(dx * dir[1] - dy * dir[0]);
      if (across > along * 2.2) continue;
      const score = along + across * 2;
      if (score < bestScore) {
        bestScore = score;
        best = node;
      }
    }
    if (best) this.focusNode(best.id);
  }

  focusNode(id) {
    const node = this.nodeById.get(id);
    if (!node || !this.isVisible(node)) return;
    node.el.focus({ preventScroll: true });
  }

  onFocusIn(event) {
    const node = this.nodeFromEvent(event);
    if (!node) return;
    this.setRoving(node.id);
    let keyboard = false;
    try { keyboard = node.el.matches(':focus-visible'); } catch { keyboard = true; }
    if (!keyboard) return;
    this.reveal(node.id);
    this.showTooltip(node);
  }

  onPointerOver(event) {
    if (event.pointerType !== 'mouse' || this.drag?.moved) return;
    const node = this.nodeFromEvent(event);
    if (!node) return;
    this.showTooltip(node, event.clientX, event.clientY);
  }

  onPointerOut(event) {
    if (event.pointerType !== 'mouse') return;
    const node = this.nodeFromEvent(event);
    if (!node) return;
    const to = event.relatedTarget instanceof Element ? event.relatedTarget.closest('.graph-node') : null;
    if (to !== node.el) this.hideTooltip();
  }

  select(node) {
    this.setRoving(node.id);
    this.onSelect(node.id);
  }

  setRoving(id) {
    if (this.rovingId === id) return;
    this.nodeById.get(this.rovingId)?.el.setAttribute('tabindex', '-1');
    this.rovingId = id;
    this.nodeById.get(id)?.el.setAttribute('tabindex', '0');
  }

  // Un solo nodo entra en el orden de tabulación; las flechas recorren el resto.
  updateRoving() {
    const current = this.nodeById.get(this.rovingId);
    const selected = this.nodeById.get(this.state.selectedId);
    let next = current && this.isVisible(current) ? current : null;
    if (selected && this.isVisible(selected) && !this.svg.contains(document.activeElement)) next = selected;
    if (!next) {
      const visible = this.nodes.filter(node => this.isVisible(node));
      next = visible.find(node => node.type === 'project') ?? visible[0] ?? null;
    }
    for (const node of this.nodes) node.el.setAttribute('tabindex', node === next ? '0' : '-1');
    this.rovingId = next ? next.id : null;
  }

  showTooltip(node, clientX, clientY) {
    this.hoverId = node.id;
    node.el.classList.add('is-hover');
    this.tooltipName.textContent = node.name;
    const parts = [TYPE_LABEL[node.type] ?? 'Nodo'];
    const selectedId = this.state.selectedId;
    const relation = selectedId && selectedId !== node.id ? this.neighbors.get(selectedId)?.get(node.id) : null;
    if (relation && this.isEdgeVisible(relation) && relation.label) {
      parts.push(relation.year ? `${relation.label} (${relation.year})` : relation.label);
    } else {
      parts.push(`${node.degree} ${node.degree === 1 ? 'vínculo' : 'vínculos'}`);
    }
    this.tooltipMeta.textContent = parts.join(' · ');
    this.tooltip.hidden = false;
    if (clientX == null) {
      const box = node.el.getBoundingClientRect();
      this.placeTooltip(box.left + box.width / 2, box.top);
    } else {
      this.placeTooltip(clientX, clientY);
    }
  }

  placeTooltip(clientX, clientY) {
    const host = this.tooltip.offsetParent ?? this.tooltip.parentElement;
    if (!host) return;
    const frame = host.getBoundingClientRect();
    const width = this.tooltip.offsetWidth;
    const height = this.tooltip.offsetHeight;
    const left = clamp(clientX - frame.left - width / 2, 6, Math.max(6, frame.width - width - 6));
    let top = clientY - frame.top - height - 14;
    if (top < 4) top = clientY - frame.top + 20;
    this.tooltip.style.left = `${left}px`;
    this.tooltip.style.top = `${top}px`;
  }

  hideTooltip() {
    if (this.hoverId) this.nodeById.get(this.hoverId)?.el.classList.remove('is-hover');
    this.hoverId = null;
    this.tooltip.hidden = true;
  }

  // ---------- paso de mensajes ----------

  // ids[0] es el nodo destino (por ejemplo, el proyecto planificado); el resto, candidatos o contexto.
  // 1) cada nodo recibe mensajes de sus vecinos observados; 2) los candidatos sin vínculo
  // observado con el destino quedan unidos por una línea punteada: sugerencia, no dato.
  pulseMessagePassing(ids = []) {
    const token = (this.pulseToken += 1);
    this.clearPulse();
    this.suggestLayer.replaceChildren();
    let focus = [...new Set((ids ?? []).map(String))].map(id => this.nodeById.get(id)).filter(node => node && this.isVisible(node));
    if (!focus.length && this.state.selectedId) {
      const selected = this.nodeById.get(this.state.selectedId);
      if (selected && this.isVisible(selected)) focus = [selected];
    }
    if (!focus.length) return Promise.resolve();

    const target = focus[0];
    const focusSet = new Set(focus);
    const involved = new Set(focus);
    const messages = [];
    for (const node of focus) {
      const sources = [...this.neighbors.get(node.id)]
        .map(([otherId, edge]) => ({ other: this.nodeById.get(otherId), edge }))
        .filter(({ other, edge }) => this.isEdgeVisible(edge))
        .sort((a, b) => focusSet.has(b.other) - focusSet.has(a.other) || b.other.degree - a.other.degree || (a.other.id < b.other.id ? -1 : 1))
        .slice(0, MAX_PULSE_SOURCES);
      for (const { other, edge } of sources) {
        involved.add(other);
        messages.push({ from: other, to: node, edge });
      }
    }
    const candidates = focus.slice(1).filter(node => !this.neighbors.get(target.id).has(node.id));

    this.svg.classList.add('is-pulsing');
    for (const node of involved) node.el.classList.add('in-pulse');
    for (const { edge } of messages) edge.el.classList.add('in-pulse');
    this.pulseCleanup = () => {
      this.svg.classList.remove('is-pulsing');
      for (const node of this.nodes) node.el.classList.remove('in-pulse', 'is-receiving');
      for (const edge of this.edges) edge.el.classList.remove('in-pulse');
      this.pulseLayer.replaceChildren();
    };
    const alive = () => token === this.pulseToken;
    const drawSuggestion = node => {
      const line = svgEl('line', { class: 'graph-suggestion', x1: node.x, y1: node.y, x2: target.x, y2: target.y });
      this.suggestLayer.append(line);
      return line;
    };

    if (this.reduced.matches) {
      candidates.forEach(drawSuggestion);
      return wait(1100).then(() => { if (alive()) this.clearPulse(); });
    }

    const travel = (list, duration, stagger, className) => new Promise(resolve => {
      if (!list.length) { resolve(); return; }
      const dots = list.map(() => {
        const dot = svgEl('circle', { class: className, r: 4 });
        dot.style.opacity = '0';
        this.pulseLayer.append(dot);
        return dot;
      });
      const total = duration + stagger * (list.length - 1);
      this.animate(total, t => {
        const elapsed = t * total;
        list.forEach((message, i) => {
          const local = clamp((elapsed - i * stagger) / duration, 0, 1);
          const e = ease(local);
          dots[i].setAttribute('cx', message.from.x + (message.to.x - message.from.x) * e);
          dots[i].setAttribute('cy', message.from.y + (message.to.y - message.from.y) * e);
          dots[i].style.opacity = local <= 0 || local >= 1 ? '0' : '1';
          if (message.line) {
            message.line.setAttribute('x2', message.from.x + (message.to.x - message.from.x) * e);
            message.line.setAttribute('y2', message.from.y + (message.to.y - message.from.y) * e);
          }
        });
      }, `pulse-${className}`, () => { dots.forEach(dot => dot.remove()); resolve(); });
    });
    const receive = async nodes => {
      for (const node of nodes) node.el.classList.add('is-receiving');
      await wait(520);
      for (const node of nodes) node.el.classList.remove('is-receiving');
    };

    return (async () => {
      await travel(messages, 760, Math.min(45, 900 / Math.max(messages.length, 1)), 'graph-message');
      if (!alive()) return;
      await receive(focus);
      if (!alive()) return;
      const links = candidates.map(node => {
        const line = drawSuggestion(node);
        line.setAttribute('x2', node.x);
        line.setAttribute('y2', node.y);
        return { from: node, to: target, line };
      });
      await travel(links, 680, 90, 'graph-message graph-message--suggested');
      if (!alive()) return;
      await receive([target]);
      if (alive()) this.clearPulse();
    })();
  }

  clearPulse() {
    this.cancel('pulse-graph-message');
    this.cancel('pulse-graph-message graph-message--suggested');
    this.pulseCleanup?.();
    this.pulseCleanup = null;
  }

  // ---------- animación ----------

  animate(duration, step, key, done) {
    this.cancel(key);
    const start = performance.now();
    const record = { key, id: 0 };
    const tick = now => {
      const t = clamp((now - start) / duration, 0, 1);
      step(t);
      if (t < 1) {
        record.id = requestAnimationFrame(tick);
      } else {
        this.running.delete(key);
        this.frames.delete(key);
        done?.();
      }
    };
    this.running ??= new Map();
    this.running.set(key, { record, done });
    this.frames.add(key);
    record.id = requestAnimationFrame(tick);
  }

  cancel(key) {
    const entry = this.running?.get(key);
    if (!entry) return;
    cancelAnimationFrame(entry.record.id);
    this.running.delete(key);
    this.frames.delete(key);
    entry.done?.();
  }

  stopFrames() {
    for (const key of [...(this.running?.keys() ?? [])]) this.cancel(key);
  }

  destroy() {
    this.pulseToken += 1;
    this.stopFrames();
    this.resizeObserver?.disconnect();
    for (const [type, handler] of Object.entries(this.handlers)) this.svg.removeEventListener(type, handler);
    this.viewport.remove();
    this.tooltip.remove();
    this.svg.classList.remove('gv', 'has-focus', 'is-pulsing', 'is-dragging');
    delete this.svg.dataset.lod;
  }
}
