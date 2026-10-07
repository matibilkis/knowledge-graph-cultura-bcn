import { GraphStore, GraphAgent, isPlanned } from './graph-engine.js?v=20261006-agent2';
import { GraphView } from './graph-view.js?v=20261007-caso1';
import { initMotion, watchScenes } from './motion.js?v=20261007-caso1';
import { GraphSAGERuntime } from './gnn-runtime.js?v=20261006';
const ASSET_VERSION='20261006';

const byId = id => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const unique = values => [...new Set(values)];
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const icon = name => { const node = el('span', `icon icon-${name}`); node.setAttribute('aria-hidden', 'true'); return node; };
const scoreBadge=(name,value)=>{const badge=el('span','score');badge.append(el('small','',`Puntuación ${name}`),el('b','',value.toFixed(3)));return badge;};

const TYPE_NAME = { project: 'Proyecto', actor: 'Equipo', capability: 'Capacidad', resource: 'Recurso' };
// Cómo se nombra cada relación en la ficha: [desde el nodo que la origina, desde el nodo que la recibe].
const RELATION_NAMES = {
  'requiere': ['Requiere', 'La requieren'],
  'colaboró': ['Colaboró en', 'Colaboraron'],
  'participó': ['Participó en', 'Participaron'],
  'aporta': ['Aporta', 'La aportan'],
  'produjo': ['Produjo', 'Producido en'],
  'reutilizó': ['Reutilizó', 'Reutilizado en'],
  'documenta': ['Documenta', 'La documentan'],
};
const RELATION_ORDER = ['requires', 'participated', 'has_capability', 'produced', 'reused', 'documents'];

let store, agent, storyAgent, view;
let filterType = 'all';
let querying = false;
let predictionsAvailable = false;
let gnnRuntime;
let selectedNodeId = null;
let egoId = null;          // nodo cuyo vecindario completo está en el mapa
let caseId = null;         // proyecto del caso guiado
let activeScene = null;    // paso del caso que está a la vista
let appliedScene = null;   // paso que el mapa mostró por última vez
let detourFrom = null;     // paso del que se salió al abrir un nodo o un resultado
let mapOwner = 'story';    // 'story': el mapa muestra un paso del caso · 'free': lo movió quien explora
let labShown = false;      // el laboratorio lista candidatos recién cuando se piden
let fichaReturn = null;    // adónde vuelve el foco al cerrar la ficha
const sceneStates = {};

function status(id, text, isError = false) { const node = byId(id); if (!node) return; node.textContent = text; node.classList.toggle('is-error', isError); }
async function fetchJSON(path) {
  const response = await fetch(`${path}?v=${ASSET_VERSION}`);
  if (!response.ok) throw new Error(`No se pudo cargar ${path}: HTTP ${response.status}`);
  const text = await response.text();
  const value = JSON.parse(text);
  if(path==='data/graph.json' && globalThis.crypto?.subtle) {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
    Object.defineProperty(value,'sourceHash',{value:[...bytes].map(byte=>byte.toString(16).padStart(2,'0')).join('')});
  }
  return value;
}

// ---------- el mapa ----------

// Rótulo del mapa: qué se está viendo y cuánto.
function caption(title, nodes, edges) {
  status('graph-title', title);
  status('graph-subtitle', `${plural(nodes, 'nodo', 'nodos')} · ${plural(edges, 'vínculo', 'vínculos')}`);
}
function resetFilterControls() {
  byId('graph-search').value=''; byId('project-filter').value=''; byId('year-filter').value=''; filterType='all'; setTypeButtons();
  byId('graph-empty').hidden = true; status('filter-status', '');
}
// Si el mapa no quedó fijo a la vista (pantallas muy bajas), lo trae.
function revealMap() {
  const dock = document.querySelector('.dock');
  if (!dock || getComputedStyle(dock).position === 'sticky') return;
  dock.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
}
function focusEvidence(nodeIds, edgeIds = [], { title = 'Vínculos seleccionados', highlightIds, highlightEdgeIds, emphasisIds = [], proposals = [], owner = 'free' } = {}) {
  resetFilterControls();
  const evidence = store.evidence(nodeIds, edgeIds);
  const shownEdgeIds = evidence.edgeIds.length ? evidence.edgeIds : store.data.edges.filter(edge => evidence.nodeIds.includes(edge.source) && evidence.nodeIds.includes(edge.target)).map(edge => edge.id);
  closeFicha({ restore: false });
  egoId = null;
  if (owner === 'story') detourFrom = null;
  else if (mapOwner === 'story') detourFrom = appliedScene;
  view.update({ nodeIds: evidence.nodeIds, edgeIds: shownEdgeIds, selectedId:null, highlightIds: highlightIds ?? evidence.nodeIds, highlightEdgeIds: highlightEdgeIds ?? evidence.edgeIds, emphasisIds, proposals });
  view.fit();
  caption(title, evidence.nodeIds.length, shownEdgeIds.length);
  mapOwner = owner;
}
// Si una respuesta habla de un proyecto y no lo incluye, el proyecto y lo que requiere también van al mapa.
function withProject(nodeIds, edgeIds, projectId) {
  if (!projectId || !store.nodes.has(projectId) || nodeIds.includes(projectId)) return { nodeIds, edgeIds };
  const shown = new Set(nodeIds);
  const links = store.links(projectId).filter(edge => edge.type === 'requires' || shown.has(store.other(edge, projectId).id));
  return { nodeIds: [projectId, ...nodeIds], edgeIds: unique([...edgeIds, ...links.map(edge => edge.id)]) };
}
function showAnswerOnMap(result, owner = 'free') {
  const context = withProject(result.highlightNodeIds, result.highlightEdgeIds, result.resolvedProjectId);
  const subjects = result.sections.flatMap(section => section.items.map(item => item.nodeIds?.[0])).filter(Boolean);
  focusEvidence(context.nodeIds, context.edgeIds, { title: 'Lo que usa la respuesta', emphasisIds: unique([result.resolvedProjectId, ...subjects].filter(Boolean)), owner });
}
// Centra el mapa en un nodo: él y todos sus vínculos registrados, con nombre.
function openNode(id) {
  const node = store.nodes.get(id);
  if (!node) return;
  focusEvidence([id], store.links(id).map(edge => edge.id), { title: node.name, emphasisIds: [id] });
  egoId = id;
  showNode(id);
  revealMap();
}
function evidenceButton(label, nodeIds, edgeIds = [], type = null, title) {
  const button = el('button', 'evidence-link chip chip--small has-glyph', label);
  if(type || store.nodes.get(nodeIds[0]))button.dataset.type=type || store.nodes.get(nodeIds[0]).type;
  button.type = 'button';
  button.addEventListener('click', () => { focusEvidence(nodeIds, edgeIds, { title: title || store.nodes.get(nodeIds[0])?.name, emphasisIds: nodeIds.slice(0, 1) }); if (nodeIds[0]) showNode(nodeIds[0]); revealMap(); });
  return button;
}

// ---------- ficha ----------

// Los vínculos de un nodo, agrupados por relación y sentido.
function linkGroups(id) {
  const groups = new Map();
  for (const edge of store.links(id)) {
    const outgoing = edge.source === id;
    const key = `${edge.type}|${edge.label}|${outgoing}`;
    if (!groups.has(key)) groups.set(key, { type: edge.type, label: edge.label, outgoing, links: [] });
    groups.get(key).links.push({ edge, other: store.other(edge, id) });
  }
  const order = group => { const index = RELATION_ORDER.indexOf(group.type); return index < 0 ? RELATION_ORDER.length : index; };
  return [...groups.values()].sort((a, b) => order(a) - order(b) || a.label.localeCompare(b.label, 'es'));
}
function relationName(group) {
  const names = RELATION_NAMES[group.label];
  if (names) return names[group.outgoing ? 0 : 1];
  const label = group.label.charAt(0).toUpperCase() + group.label.slice(1);
  return group.outgoing ? label : `${label} (desde)`;
}
// La ficha de un nodo. `embedded` es la versión que cuenta el caso; la del mapa suma hechos, acciones y cierre.
function ficha(node, { embedded = false } = {}) {
  const root = el('div', `ficha${embedded ? ' ficha--embedded' : ''}`);
  const head = el('header', 'ficha-head');
  const type = el('p', 'ficha-type has-glyph', TYPE_NAME[node.type] ?? 'Nodo');
  type.dataset.type = node.type;
  const meta = el('p', 'ficha-meta', [node.year, node.territory].filter(Boolean).join(' · '));
  if (isPlanned(node)) meta.append(el('span', 'tag tag--proposed', 'Planificado'));
  head.append(type, el(embedded ? 'h4' : 'h2', 'ficha-name', node.name));
  if (meta.childNodes.length) head.append(meta);
  if (!embedded) {
    const close = el('button', 'icon-button ficha-close');
    close.type = 'button'; close.setAttribute('aria-label', 'Cerrar ficha'); close.title = 'Cerrar ficha'; close.append(icon('close'));
    close.addEventListener('click', () => closeFicha());
    head.append(close);
  }
  // Dos bloques: qué es el nodo y con qué se vincula. Con ancho suficiente van lado a lado.
  const about = el('div', 'ficha-about'), relations = el('div', 'ficha-relations');
  about.append(head, el('p', 'ficha-description', node.description));
  if (!embedded && node.facts?.length) {
    const facts = el('ul', 'ficha-facts');
    node.facts.forEach(fact => facts.append(el('li', '', fact)));
    about.append(facts);
  }
  root.append(about, relations);
  const groups = linkGroups(node.id);
  if (!groups.length) relations.append(el('p', 'empty-state', 'Todavía no tiene vínculos registrados.'));
  for (const group of groups) {
    const section = el('section', 'ficha-group');
    const title = el(embedded ? 'h5' : 'h3', 'ficha-group-title', relationName(group));
    title.append(' ', el('span', 'ficha-count', String(group.links.length)));
    const list = el('ul', 'ficha-links');
    for (const { edge, other } of group.links.sort((a, b) => b.edge.year - a.edge.year || a.other.name.localeCompare(b.other.name, 'es'))) {
      const item = el('li');
      const button = el('button', 'ficha-link has-glyph');
      button.type = 'button'; button.dataset.type = other.type;
      button.append(el('span', 'ficha-link-name', other.name), el('span', 'ficha-link-year', String(edge.year)));
      button.addEventListener('click', () => openNode(other.id));
      item.append(button); list.append(item);
    }
    section.append(title, list); relations.append(section);
  }
  if (!embedded) {
    const actions = el('div', 'ficha-actions');
    if (egoId !== node.id) {
      const center = el('button', 'evidence-link chip chip--small', 'Ver todos sus vínculos');
      center.type = 'button'; center.addEventListener('click', () => openNode(node.id));
      actions.append(center);
    }
    if (node.type === 'project') {
      const ask = el('button', 'evidence-link chip chip--small', 'Consultar este proyecto');
      ask.type = 'button'; ask.addEventListener('click', () => runAgent(`Mostrá el contexto de ${node.name}`));
      actions.append(ask);
    }
    if (actions.childNodes.length) about.append(actions);
  }
  return root;
}
function showNode(id) {
  const node = store.nodes.get(id);
  if (!node) return;
  const panel = byId('node-detail');
  const active = document.activeElement;
  const fromFicha = panel.contains(active);
  // Si la ficha se abre con el teclado desde fuera del mapa, el foco va a la ficha y después vuelve a su origen.
  const fromOutside = active instanceof HTMLElement && active !== document.body && !active.closest('.dock') && active.matches(':focus-visible');
  if (fromOutside) fichaReturn = active;
  selectedNodeId=id;
  panel.replaceChildren(ficha(node));
  panel.hidden = false;
  panel.scrollTop = 0;
  view.update({ selectedId: id });
  status('map-status', `Ficha abierta: ${node.name}.`);
  if (fromFicha || fromOutside) panel.focus({ preventScroll: true });
}
function closeFicha({ restore = true } = {}) {
  const panel = byId('node-detail');
  if (panel.hidden && !selectedNodeId) return;
  const hadFocus = panel === document.activeElement || panel.contains(document.activeElement);
  selectedNodeId=null;
  panel.hidden = true;
  panel.replaceChildren();
  if (!restore) return;
  status('map-status', 'Ficha cerrada.');
  const origin = fichaReturn; fichaReturn = null;
  view.update({ selectedId: null });
  // Cerrar la ficha durante el caso devuelve el mapa al paso que se está leyendo
  // (o, si todavía no hay ninguno en la franja de lectura, al paso del que se salió).
  const back = sceneStates[activeScene] ? activeScene : activeScene ? null : detourFrom;
  if (mapOwner === 'free' && back) applyScene(back, true);
  if (hadFocus) (origin?.isConnected ? origin : byId('network').querySelector('.graph-node[tabindex="0"]'))?.focus({ preventScroll: true });
}

// ---------- exploración libre ----------

function applyFilters() {
  const query = byId('graph-search').value, projectId = byId('project-filter').value, year = byId('year-filter').value;
  const visible = store.visible({ type: filterType, query, projectId, year });
  if(selectedNodeId && !visible.nodeIds.includes(selectedNodeId)) closeFicha({ restore: false });
  egoId = null;
  view.update({ ...visible, selectedId:selectedNodeId, highlightIds: [], highlightEdgeIds: [], emphasisIds: [], proposals: [] });
  const filtered = Boolean(query.trim() || projectId || year || filterType !== 'all');
  const empty = !visible.nodeIds.length;
  caption(projectId ? store.nodes.get(projectId).name : filtered ? 'Vista filtrada' : 'Toda la red', visible.nodeIds.length, visible.edgeIds.length);
  byId('graph-empty').hidden = !empty;
  status('filter-status', empty ? 'Ningún nodo coincide con estos filtros.' : filtered ? `${plural(visible.nodeIds.length, 'nodo coincide', 'nodos coinciden')} con estos filtros.` : '');
  view.fit();
  mapOwner = 'free';
  detourFrom = null;
}
function showAll() { resetFilterControls(); closeFicha({ restore: false }); applyFilters(); }
function fillOverview() {
  const summary = byId('dataset-stats');
  summary.replaceChildren();
  for (const [type, label] of [['project','proyectos'], ['actor','equipos'], ['capability','capacidades'], ['resource','recursos']]) {
    const cell = el('div', 'metric-cell');
    cell.append(el('strong', '', String(store.ofType(type).length)), el('span', '', label));
    summary.append(cell);
  }
  const cards = byId('project-list');
  cards.replaceChildren();
  for (const project of store.ofType('project')) {
    const card = el('button', 'project-card card card--compact card--action');
    card.dataset.status=project.status || '';
    card.type = 'button';
    card.append(el('strong', '', project.name), el('span', 'project-card-meta', [project.year, project.territory, project.format].filter(Boolean).join(' · ')));
    if (isPlanned(project)) card.append(el('span', 'tag tag--proposed', 'Planificado'));
    card.addEventListener('click', () => openNode(project.id));
    cards.append(card);
    byId('project-filter').append(new Option(project.name, project.id));
    if (isPlanned(project)) byId('gnn-project').append(new Option(project.name, project.id));
  }
  for (const year of [...new Set(store.data.edges.map(edge => edge.year))].sort((a,b)=>a-b)) byId('year-filter').append(new Option(String(year), String(year)));
}
function setTypeButtons() {
  byId('type-filters').querySelectorAll('button').forEach(button => { const selected = button.dataset.type === filterType; button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected)); });
}

// ---------- consultas ----------

function addAgentMessage(container, role, text) {
  const message = el('article', `agent-message ${role}`);
  message.append(el('span', 'message-role', role === 'user' ? 'Vos' : 'Agente SINC'), el('p', 'agent-answer', text));
  container.append(message);
  while (container.children.length > 24) container.firstElementChild.remove();
  return message;
}
// Un resultado: renglón continuo si el vínculo está registrado, tarjeta punteada si es una propuesta del modelo.
function resultItem({ name, type, rank, description, score, extra, action }) {
  const item = el('div', `result${(score || rank) ? ' result--proposed' : ''}`);
  const title = el('strong', 'result-name has-glyph', name);
  if (type) title.dataset.type = type;
  if (rank) { const order = el('span', 'result-rank', `${rank}.`); item.append(order); }
  item.append(title);
  if (score) item.append(score);
  if (description) item.append(el('p', 'result-description', description));
  if (extra) item.append(extra);
  if (action) item.append(action);
  return item;
}
function fillAnswer(message, result, { scene = false } = {}) {
  for (const section of result.sections) {
    const group = el('div', 'agent-evidence');
    group.append(el(scene ? 'h4' : 'h3', 'agent-evidence-title', section.title));
    for (const item of section.items) {
      group.append(resultItem({
        name: item.label, type: store.nodes.get(item.nodeIds?.[0])?.type, description: item.description,
        score: Number.isFinite(item.score) ? scoreBadge('GNN', item.score) : null,
        action: item.nodeIds?.length ? evidenceButton('Ver vínculos', item.nodeIds, item.edgeIds, null, item.label) : null,
      }));
    }
    message.append(group);
  }
  if (result.sources?.length) {
    const sources = el('div', 'agent-evidence agent-sources');
    sources.append(el(scene ? 'h4' : 'h3', 'agent-evidence-title', 'Información de referencia'));
    for (const source of result.sources) {
      const link = el('a', 'evidence-link chip chip--small', source.label);
      link.href = source.href; sources.append(link);
    }
    message.append(sources);
  }
  if (result.trace.length) {
    const trace = el('details', 'agent-trace disclosure');
    trace.append(el('summary', '', `${plural(result.trace.length, 'paso', 'pasos')} de consulta · ver recorrido`));
    const list = el('ol');
    for (const step of result.trace) {
      const item = el('li');
      item.append(el('strong', '', step.tool.replaceAll('_', ' ')), el('span', '', ` — ${step.summary}`));
      list.append(item);
    }
    trace.append(list); message.append(trace);
  }
  // En el caso guiado las preguntas siguientes se hacen en «Consultas»; ahí se ofrecen como atajos.
  if (!scene && result.suggestions.length) {
    const next = el('div', 'agent-evidence agent-next');
    for (const suggestion of result.suggestions) {
      const button = el('button', 'evidence-link chip chip--small', suggestion);
      button.type = 'button'; button.addEventListener('click',()=>runAgent(suggestion)); next.append(button);
    }
    message.append(next);
  }
}
async function runAgent(query) {
  if (querying || !query.trim()) return;
  querying = true;
  const submit = byId('agent-submit');
  const chat = byId('agent-chat');
  submit.disabled = true;
  byId('agent-form').setAttribute('aria-busy', 'true');
  status('agent-status', 'Revisando la pregunta…');
  const question = addAgentMessage(chat, 'user', query.trim().slice(0,500));
  byId('agent-input').value = '';
  try {
    await new Promise(resolve => requestAnimationFrame(resolve));
    const result = agent.query(query);
    const message = addAgentMessage(chat, 'assistant', result.text);
    fillAnswer(message, result);
    if (result.highlightNodeIds.length) showAnswerOnMap(result);
    status('agent-status', { project: 'Respuesta basada en información de la herramienta', missing: 'Información no registrada en esta base', scope: 'Pregunta fuera de alcance o sin una consulta reconocida' }[result.kind] || 'Consulta resuelta con registros del grafo ficticio');
  } catch (error) {
    addAgentMessage(chat, 'assistant', 'No pude completar esta consulta. Probá con una capacidad o un proyecto de la red.');
    status('agent-status', 'La consulta no se completó', true);
    console.error(error);
  } finally {
    querying = false; submit.disabled = false; byId('agent-form').removeAttribute('aria-busy');
    // La pregunta queda arriba, con la respuesta debajo y el mapa a la vista.
    if (question.isConnected) question.scrollIntoView({ block: 'start', behavior: 'instant' });
  }
}

// ---------- sugerencias del modelo ----------

function renderMetrics(task) {
  const panel = byId('gnn-metrics'); panel.replaceChildren();
  const grid=el('div','metric-grid');
  panel.append(el('p','metrics-note','GNN y MLP: media de tres entrenamientos; dispersión entre inicializaciones. Las reglas se evaluaron sobre las mismas consultas.'));
  const metrics = task.metrics || {};
  for (const name of ['gnn','baseline','mlp']) {
    const values=metrics[name];if(!values)continue;
    const cell = el('div', 'metric-cell');
    cell.append(el('strong', '', { gnn: 'GraphSAGE', baseline: 'Reglas', mlp: 'MLP sin grafo' }[name] || name));
    for (const metric of ['ndcgAt3','ap','rocAuc']) {
      const value=values[metric];if(Number.isFinite(value))cell.append(el('span','',`${{ap:'Precisión media',rocAuc:'AUC',ndcgAt3:'NDCG@3'}[metric]}: ${value.toFixed(3)}${metric==='ndcgAt3' && values.std?.[metric]!==undefined?` ± ${values.std[metric].toFixed(3)}`:''}`));
    }
    grid.append(cell);
  }
  panel.append(grid);
  if(task.selectedModel?.test)panel.append(el('p','metrics-note',`Las sugerencias usan la inicialización ${task.selectedModel.seed}, seleccionada por validación. Su NDCG@3 en evaluación es ${task.selectedModel.test.ndcgAt3.toFixed(3)}.`));
}
// La línea que queda siempre a la vista: qué tan bien rinden las sugerencias frente a las reglas, con las cifras del experimento.
function renderLimits() {
  const line = byId('model-limits');
  const tasks = store.predictions?.tasks;
  const pair = task => [tasks?.[task]?.metrics?.gnn?.ndcgAt3, tasks?.[task]?.metrics?.baseline?.ndcgAt3];
  const actor = pair('actor'), resource = pair('resource');
  if ([...actor, ...resource].some(value => !Number.isFinite(value))) { line.hidden = true; return; }
  const worse = [actor, resource].filter(([gnn, baseline]) => gnn <= baseline).length;
  const verdict = worse === 2 ? 'el modelo no ordenó mejor que las reglas' : worse === 0 ? 'el modelo ordenó mejor que las reglas' : 'el modelo no superó a las reglas en las dos tareas';
  const text = el('span');
  text.append(el('strong', '', 'Las sugerencias son experimentales.'), ` En la evaluación con datos ficticios, ${verdict}: ${actor[0].toFixed(3)} frente a ${actor[1].toFixed(3)} en equipos y ${resource[0].toFixed(3)} frente a ${resource[1].toFixed(3)} en recursos (NDCG@3, que mide el orden de los tres primeros candidatos).`);
  line.replaceChildren(icon('info'), text);
  line.hidden = false;
}
function renderGNN() {
  const panel = byId('gnn-results'); panel.replaceChildren();
  if (!predictionsAvailable) { status('gnn-status', 'El experimento no está disponible. Las consultas al grafo siguen funcionando.'); return; }
  const taskId = byId('gnn-task').value;
  const ranking=byId('gnn-ranking')?.value || 'gnn';
  const projectId = byId('gnn-project').value;
  const task = store.predictions.tasks[taskId];
  const project = store.nodes.get(projectId);
  const results = store.recommend(projectId, taskId);
  if(ranking==='baseline')results.sort((a,b)=>(b.baselineScore || 0)-(a.baselineScore || 0));
  byId('gnn-animate').disabled=ranking==='baseline' || !gnnRuntime;
  renderMetrics(task);
  status('gnn-status', !labShown ? '' : results.length ? `${results.length} candidatos para ${project.name}, ordenados por ${ranking==='baseline'?'reglas':'GraphSAGE'}. Sugerencias pendientes de validación.` : 'No hay resultados del modelo para este proyecto.');
  if (labShown) for (const item of results.slice(0,6)) {
    panel.append(resultItem({
      name: item.node.name, type: item.node.type, description: item.reason || item.node.description,
      score: scoreBadge(ranking==='baseline'?'reglas':'GNN',ranking==='baseline'?item.baselineScore:item.score),
      extra: Number.isFinite(item.baselineScore) ? el('p', 'baseline-score', `Puntuación ${ranking==='baseline'?'GNN':'reglas'} ${(ranking==='baseline'?item.score:item.baselineScore).toFixed(3)} · escala propia de cada método`) : null,
      action: evidenceButton('Explorar contexto', item.nodeIds, item.edgeIds, item.node.type, item.node.name),
    }));
  }
  const meta = store.predictions.meta;
  const method = byId('gnn-method'); method.replaceChildren();
  const gnnNdcg = task.metrics?.gnn?.ndcgAt3, baselineNdcg = task.metrics?.baseline?.ndcgAt3;
  if(Number.isFinite(gnnNdcg) && Number.isFinite(baselineNdcg)) method.append(el('p','benchmark-conclusion',gnnNdcg < baselineNdcg ? 'En este experimento las reglas obtuvieron mayor NDCG@3 que la GNN. Podés comparar ambos ordenamientos; estos resultados describen el generador ficticio.' : `NDCG@3: GNN ${gnnNdcg.toFixed(3)}, reglas ${baselineNdcg.toFixed(3)} y MLP ${task.metrics.mlp.ndcgAt3.toFixed(3)}. Estos resultados describen el generador ficticio y no establecen una ventaja en redes reales.`));
  const details=el('details','disclosure');details.append(el('summary','','Cómo se entrenó y evaluó'));
  details.append(el('p', '', `${meta.model || 'GraphSAGE'} entrenado en CPU sobre grafos sintéticos. Los mundos de evaluación son distintos de los de entrenamiento; los vínculos a predecir se excluyen de la entrada del modelo.`));
  const limitations = Array.isArray(meta.limitations) ? meta.limitations : [meta.limitations || 'Los resultados describen el generador ficticio y requieren validación con datos reales.'];
  limitations.forEach(text => details.append(el('p','',text)));
  if (meta.split?.worlds) details.append(el('p','',`${meta.split.worlds.train} mundos de entrenamiento, ${meta.split.worlds.validation} de validación y ${meta.split.worlds.test} de evaluación. Métricas promediadas sobre ${meta.training?.initializations || 3} inicializaciones; NDCG@3 mide el orden de los tres primeros candidatos.`));
  const download = el('a', '', 'Ver resultados y metodología'); download.href=`data/gnn-results.json?v=${ASSET_VERSION}`; download.setAttribute('download',''); details.append(download);method.append(details);
}
// Inferencia local de GraphSAGE para un proyecto y una tarea. Deja el ranking en store.predictions, como antes.
function infer(task, projectId) {
  const candidates = store.ofType(task).map(node=>node.id);
  const previous = store.predictions.tasks[task].predictions;
  const ranking = gnnRuntime.rank(task,projectId,candidates);
  const updated = ranking.map(item=> {
    const stored = previous.find(row=>row.projectId===projectId && row.candidateId===item.candidateId);
    const candidate = store.nodes.get(item.candidateId);
    const matched = store.capabilities(item.candidateId).filter(id=>store.requirements(projectId).includes(id));
    const evidence = store.evidence([item.candidateId,projectId,...matched],store.links(item.candidateId).filter(edge=> ['has_capability','documents','participated','produced'].includes(edge.type)).slice(0,7).map(edge=>edge.id));
    return { ...stored, ...item, projectId, reason: stored?.reason || `${candidate.name}: ${matched.length} capacidades registradas coinciden con las necesidades del proyecto. Este contexto permite revisar la sugerencia, no explica por sí solo la decisión del modelo.`, evidenceNodeIds: stored?.evidenceNodeIds || evidence.nodeIds, evidenceEdgeIds: stored?.evidenceEdgeIds || evidence.edgeIds };
  });
  store.predictions.tasks[task].predictions = [...previous.filter(row=>row.projectId!==projectId),...updated];
  return ranking.length;
}
function runGNN() {
  labShown = true;
  if (!gnnRuntime) { renderGNN(); if(predictionsAvailable)status('gnn-status','Mostrando resultados almacenados del experimento; la inferencia local no está disponible.'); return; }
  const task = byId('gnn-task').value;
  const projectId = byId('gnn-project').value;
  if (!projectId) return;
  const start = performance.now();
  try {
    const count = infer(task, projectId);
    renderGNN();
    status('gnn-status',`Inferencia local: ${count} candidatos evaluados en ${(performance.now()-start).toFixed(0)} ms. Sugerencias pendientes de validación.`);
  } catch(error) {
    status('gnn-status','No se pudo ejecutar la inferencia local.', true);
    console.error(error);
  }
}

// ---------- el caso guiado ----------

// Cada paso usa el mismo camino que la exploración libre: la ficha, el agente y el modelo.
function buildStory() {
  const opening = document.querySelector('[data-case]');
  const project = store.nodes.get(opening?.dataset.case)?.type === 'project' ? store.nodes.get(opening.dataset.case) : store.ofType('project').find(isPlanned);
  if (!project) { document.querySelectorAll('.band--case, .case').forEach(node => { node.hidden = true; }); return; }
  caseId = project.id;

  // 1 · Explorá: la ficha del proyecto y sus vínculos registrados.
  byId('scene-explore').replaceChildren(ficha(project, { embedded: true }));
  sceneStates.explore = () => focusEvidence([caseId], store.links(caseId).map(edge => edge.id), { title: project.name, emphasisIds: [caseId], owner: 'story' });

  // 2 · Preguntá: la consulta del paso, respondida por el agente.
  const prompt = byId('paso-preguntar').dataset.prompt;
  const log = byId('scene-ask');
  log.replaceChildren();
  addAgentMessage(log, 'user', prompt);
  try {
    const result = storyAgent.query(prompt);
    fillAnswer(addAgentMessage(log, 'assistant', result.text), result, { scene: true });
    if (result.highlightNodeIds.length) sceneStates.ask = () => showAnswerOnMap(result, 'story');
  } catch (error) {
    addAgentMessage(log, 'assistant', 'No pude completar esta consulta. Probá con una capacidad o un proyecto de la red.');
    console.error(error);
  }

  // 3 · Anticipá: los primeros candidatos del modelo para equipo y recursos.
  const body = byId('scene-suggest');
  body.replaceChildren();
  if (!predictionsAvailable) {
    body.append(el('p', 'empty-state', 'El experimento no está disponible. Las consultas al grafo siguen funcionando.'));
    return;
  }
  const picks = [];
  for (const [task, title] of [['actor', 'Equipos sugeridos'], ['resource', 'Recursos sugeridos']]) {
    if (gnnRuntime) { try { infer(task, caseId); } catch (error) { console.error(error); } }
    const top = store.recommend(caseId, task).slice(0, 3);
    if (!top.length) continue;
    const group = el('div', 'agent-evidence');
    group.append(el('h4', 'agent-evidence-title', title));
    top.forEach((item, index) => group.append(resultItem({
      name: item.node.name, type: item.node.type, rank: index + 1, description: item.reason || item.node.description,
      action: evidenceButton('Explorar contexto', item.nodeIds, item.edgeIds, item.node.type, item.node.name),
    })));
    body.append(group);
    picks.push(...top);
  }
  if (picks.length) sceneStates.suggest = () => focusEvidence(
    unique([caseId, ...picks.flatMap(item => item.nodeIds)]),
    unique([...store.links(caseId, 'requires').map(edge => edge.id), ...picks.flatMap(item => item.edgeIds)]),
    { title: 'Sugerencias del modelo', emphasisIds: [caseId, ...picks.map(item => item.candidateId)], proposals: picks.map(item => [item.candidateId, caseId]), owner: 'story' });
}
// El mapa sigue al paso que se está leyendo. Al llegar a la exploración libre, muestra la red completa.
function applyScene(name, force = false, fromScroll = false) {
  activeScene = name;
  if (!name) return; // ningún paso en la franja de lectura: el mapa queda como está
  // Si el foco del teclado está en el mapa o en la ficha, el scroll no cambia el mapa por debajo:
  // el nodo enfocado podría desaparecer. Al cerrar la ficha o cambiar de paso, el mapa se pone al día.
  if (fromScroll && document.querySelector('.dock')?.contains(document.activeElement)) return;
  document.querySelectorAll('.scene').forEach(node => node.classList.toggle('is-active', node.dataset.scene === name));
  if (name === 'network') { if (mapOwner === 'story') { showAll(); appliedScene = null; } return; }
  const apply = sceneStates[name];
  if (!apply || (!force && appliedScene === name && mapOwner === 'story')) return;
  apply();
  appliedScene = name;
}

function bind() {
  byId('graph-search').addEventListener('input', applyFilters);
  byId('project-filter').addEventListener('change', ()=>{applyFilters();if(byId('project-filter').value)showNode(byId('project-filter').value);});
  byId('year-filter').addEventListener('change', applyFilters);
  byId('type-filters').addEventListener('click', event => { const button = event.target.closest('[data-type]'); if (!button) return; filterType=button.dataset.type; setTypeButtons(); applyFilters(); });
  byId('reset-view').addEventListener('click', () => { showAll(); revealMap(); });
  byId('empty-reset').addEventListener('click', () => { showAll(); byId('graph-search').focus({ preventScroll: true }); });
  byId('zoom-in').addEventListener('click',()=>view.zoom(1.25));
  byId('zoom-out').addEventListener('click',()=>view.zoom(0.8));
  byId('fit-view').addEventListener('click',()=>view.fit());
  byId('node-detail').addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); closeFicha(); } });
  byId('agent-form').addEventListener('submit',event=> {event.preventDefault(); runAgent(byId('agent-input').value);});
  document.querySelectorAll('.agent-suggestion[data-prompt]').forEach(button=>button.addEventListener('click',()=>runAgent(button.dataset.prompt)));
  byId('agent-reset').addEventListener('click',()=> { if(querying)return; agent.reset(); byId('agent-chat').replaceChildren(); addAgentMessage(byId('agent-chat'),'assistant',agent.greeting); status('agent-status','Listo para consultar'); });
  byId('gnn-run').addEventListener('click', runGNN);
  const changeExperiment=()=>{renderGNN();};
  byId('gnn-project').addEventListener('change', changeExperiment);
  byId('gnn-task').addEventListener('change', changeExperiment);
  byId('gnn-ranking')?.addEventListener('change',changeExperiment);
  byId('gnn-animate').addEventListener('click',()=> {
    const projectId = byId('gnn-project').value;
    const top = store.recommend(projectId,byId('gnn-task').value)[0];
    if(top) {
      const roots = [projectId,top.candidateId];
      const ids = gnnRuntime ? gnnRuntime.receptiveField(roots) : unique([...roots,...top.nodeIds]);
      const edges = store.data.edges.filter(edge=>ids.includes(edge.source) && ids.includes(edge.target)).map(edge=>edge.id);
      // El vecindario queda de contexto; lo que se destaca son los dos nodos que se comparan.
      focusEvidence(ids,edges,{ title: 'Vecindario que usa el modelo', highlightIds: roots, highlightEdgeIds: [], emphasisIds: roots });
      revealMap();
      view.pulseMessagePassing(roots);
      status('gnn-status','Dos rondas de agregación sobre vínculos observados. La animación ilustra el vecindario usado, no el peso de cada vínculo.');
    }
  });
}

async function init() {
  byId('load-retry').addEventListener('click', () => location.reload());
  try {
    const [graphResult, predictionResult, modelResult, inputResult] = await Promise.allSettled([fetchJSON('data/graph.json'), fetchJSON('data/gnn-results.json'),fetchJSON('data/gnn-model.json'),fetchJSON('data/gnn-input.json')]);
    if(graphResult.status !== 'fulfilled') throw graphResult.reason;
    const graphHash = graphResult.value.sourceHash;
    const predictions = predictionResult.status === 'fulfilled' && predictionResult.value.meta?.synthetic && (!graphHash || graphHash===predictionResult.value.meta?.training?.graphSha256) ? predictionResult.value : null;
    store = new GraphStore(graphResult.value,predictions); agent = new GraphAgent(store); storyAgent = new GraphAgent(store);
    predictionsAvailable=Boolean(predictions?.tasks?.actor && predictions?.tasks?.resource);
    if(predictions && modelResult.status==='fulfilled' && inputResult.status==='fulfilled' && (!graphHash || inputResult.value.meta?.graphSha256===graphHash)) {
      try { gnnRuntime=new GraphSAGERuntime(modelResult.value,inputResult.value); } catch(error) { console.error(error); }
    }
    view=new GraphView(byId('network'),{onSelect:showNode,captionHost:document.querySelector('.map-foot')});
    view.setData(store.data.nodes,store.data.edges);
    fillOverview(); bind();
    addAgentMessage(byId('agent-chat'),'assistant',agent.greeting);
    status('agent-status','Listo · consultas locales sobre datos ficticios');
    renderGNN(); renderLimits();
    buildStory();
    if (sceneStates.explore) applyScene('explore', true); else showAll();
    initMotion(); watchScenes(name => applyScene(name, false, true));
    document.documentElement.dataset.ready='true';
  } catch(error) {
    // Sin datos no hay red que mostrar: se retiran los «Cargando…» y queda un aviso con salida.
    document.documentElement.dataset.ready='error';
    document.querySelectorAll('.placeholder').forEach(node => node.remove());
    byId('load-error').hidden = false;
    initMotion();
    console.error(error);
  }
}
init();
