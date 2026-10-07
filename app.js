import { GraphStore, GraphAgent, isPlanned } from './graph-engine.js?v=20261006-agent2';
import { GraphView } from './graph-view.js?v=20261006';
import { initMotion } from './motion.js?v=20261006';
import { GraphSAGERuntime } from './gnn-runtime.js?v=20261006';
const ASSET_VERSION='20261006';

const byId = id => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const scoreBadge=(name,value)=>{const badge=el('span','score');badge.append(el('small','',`Puntuación ${name}`),el('b','',value.toFixed(3)));return badge;};
let store, agent, view;
let filterType = 'all';
let querying = false;
let predictionsAvailable = false;
let gnnRuntime;
let selectedNodeId = null;

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
function focusEvidence(nodeIds, edgeIds = []) {
  byId('graph-search').value=''; byId('project-filter').value=''; byId('year-filter').value=''; filterType='all'; setTypeButtons();
  const evidence = store.evidence(nodeIds, edgeIds);
  selectedNodeId=null;
  view.update({ nodeIds: evidence.nodeIds, edgeIds: evidence.edgeIds.length ? evidence.edgeIds : store.data.edges.filter(edge => evidence.nodeIds.includes(edge.source) && evidence.nodeIds.includes(edge.target)).map(edge => edge.id), selectedId:null, highlightIds: evidence.nodeIds, highlightEdgeIds: evidence.edgeIds });
  byId('node-detail').replaceChildren(el('p','empty-state','Seleccioná un nodo de este contexto para abrir su ficha.'));
  view.fit();
  status('graph-title','Contexto seleccionado');
  status('graph-subtitle', `${evidence.nodeIds.length} nodos vinculados con el resultado seleccionado`);
}
function evidenceButton(label, nodeIds, edgeIds = [], type = null) {
  const button = el('button', 'evidence-link chip chip--small has-glyph', label);
  if(type || store.nodes.get(nodeIds[0]))button.dataset.type=type || store.nodes.get(nodeIds[0]).type;
  button.type = 'button';
  button.addEventListener('click', () => { focusEvidence(nodeIds, edgeIds); if (nodeIds[0]) showNode(nodeIds[0]); });
  return button;
}
function showNode(id) {
  const node = store.nodes.get(id);
  if (!node) return;
  selectedNodeId=id;
  const panel = byId('node-detail');
  panel.replaceChildren();
  const typeTag = el('p', 'detail-type tag tag--plain has-glyph', { project: 'Proyecto', actor: 'Equipo', capability: 'Capacidad', resource: 'Recurso' }[node.type]);
  typeTag.dataset.type = node.type;
  panel.append(typeTag, el('h3', '', node.name), el('p', '', node.description));
  if (node.territory || node.year || node.status) panel.append(el('p', 'detail-meta', [node.territory, node.year, isPlanned(node) ? 'Planificado' : null].filter(Boolean).join(' · ')));
  if (node.facts?.length) {
    const facts = el('ul', 'detail-list');
    node.facts.forEach(fact => facts.append(el('li', '', fact)));
    panel.append(facts);
  }
  const links = store.links(id);
  panel.append(el('h4', '', `Vínculos registrados (${links.length})`));
  const list = el('ul', 'connection-list');
  for (const edge of links) {
    const other = store.other(edge, id);
    const item = el('li');
    const button = el('button', '', `${store.nodes.get(edge.source).name} → ${edge.label} → ${store.nodes.get(edge.target).name} · ${edge.year}`);
    button.type = 'button';
    button.addEventListener('click', () => { focusEvidence([id, other.id], [edge.id]); showNode(other.id); });
    item.append(button); list.append(item);
  }
  panel.append(list);
  if (node.type === 'project') {
    const button = el('button', 'evidence-link chip chip--small', 'Consultar este proyecto');
    button.type = 'button';
    button.addEventListener('click', () => runAgent(`Mostrá el contexto de ${node.name}`));
    panel.append(button);
  }
  view.update({ selectedId: id });
}
function applyFilters() {
  const visible = store.visible({ type: filterType, query: byId('graph-search').value, projectId: byId('project-filter').value, year: byId('year-filter').value });
  if(selectedNodeId && !visible.nodeIds.includes(selectedNodeId)) {
    selectedNodeId=null;
    byId('node-detail').replaceChildren(el('p','empty-state','Seleccioná un nodo visible para abrir su ficha.'));
  }
  view.update({ ...visible, selectedId:selectedNodeId, highlightIds: [], highlightEdgeIds: [] });
  status('graph-title', byId('project-filter').value ? store.nodes.get(byId('project-filter').value).name : 'Explorar la red');
  status('graph-subtitle', `${visible.nodeIds.length} nodos · ${visible.edgeIds.length} vínculos en esta vista`);
  view.fit();
}
function fillOverview() {
  const summary = byId('dataset-stats');
  summary.replaceChildren();
  for (const [type, label] of [['project','proyectos'], ['actor','equipos'], ['capability','capacidades'], ['resource','recursos']]) {
    const cell = el('div', 'metric-cell');
    cell.append(el('strong', '', String(store.ofType(type).length)), el('span', '', label));
    summary.append(cell);
  }
  status('graph-count', `${store.nodes.size} nodos · ${store.edges.size} vínculos`);
  const cards = byId('project-list');
  cards.replaceChildren();
  for (const project of store.ofType('project')) {
    const card = el('button', 'project-card card card--compact card--action');
    card.dataset.status=project.status || '';
    card.type = 'button';
    card.append(el('span', 'project-card-meta', [project.year, project.territory, isPlanned(project) ? 'Planificado' : 'Realizado'].filter(Boolean).join(' · ')), el('strong', '', project.name), el('span', '', project.description));
    card.addEventListener('click', () => { byId('project-filter').value = project.id; byId('graph-search').value = ''; filterType = 'all'; setTypeButtons(); applyFilters(); showNode(project.id); byId('network').closest('section')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }); });
    cards.append(card);
    byId('project-filter').append(new Option(project.name, project.id));
    if (isPlanned(project)) byId('gnn-project').append(new Option(project.name, project.id));
  }
  for (const year of [...new Set(store.data.edges.map(edge => edge.year))].sort((a,b)=>a-b)) byId('year-filter').append(new Option(String(year), String(year)));
}
function setTypeButtons() {
  byId('type-filters').querySelectorAll('button').forEach(button => { const selected = button.dataset.type === filterType; button.classList.toggle('active', selected); button.setAttribute('aria-pressed', String(selected)); });
}
function addAgentMessage(role, text) {
  const container = byId('agent-chat');
  const message = el('article', `agent-message ${role}`);
  message.append(el('span', 'message-role', role === 'user' ? 'Vos' : 'Agente SINC'), el('p', 'agent-answer', text));
  container.append(message);
  while (container.children.length > 24) container.firstElementChild.remove();
  return message;
}
async function runAgent(query) {
  if (querying || !query.trim()) return;
  querying = true;
  const submit = byId('agent-submit');
  submit.disabled = true;
  byId('agent-form').setAttribute('aria-busy', 'true');
  status('agent-status', 'Revisando la pregunta…');
  addAgentMessage('user', query.trim().slice(0,500));
  byId('agent-input').value = '';
  try {
    await new Promise(resolve => requestAnimationFrame(resolve));
    const result = agent.query(query);
    const message = addAgentMessage('assistant', result.text);
    for (const section of result.sections) {
      const group = el('div', 'agent-evidence');
      group.append(el('h4', '', section.title));
      for (const item of section.items) {
        const card = el('div', 'recommendation-card card card--compact card--proposed');
        if(!Number.isFinite(item.score))card.classList.add('is-known');
        card.append(el('strong', '', item.label), el('p', '', item.description));
        if (Number.isFinite(item.score)) card.append(scoreBadge('GNN',item.score));
        if (item.nodeIds?.length) card.append(evidenceButton('Ver vínculos', item.nodeIds, item.edgeIds));
        group.append(card);
      }
      message.append(group);
    }
    if (result.sources?.length) {
      const sources = el('div', 'agent-evidence');
      sources.append(el('h4', '', 'Información de referencia'));
      for (const source of result.sources) {
        const link = el('a', 'evidence-link chip chip--small', source.label);
        link.href = source.href; sources.append(link);
      }
      message.append(sources);
    }
    if (result.trace.length) {
      const trace = el('details', 'agent-trace disclosure');
      trace.append(el('summary', '', `${result.trace.length} pasos de consulta · ver recorrido`));
      const list = el('ol');
      for (const step of result.trace) {
        const item = el('li');
        item.append(el('strong', '', step.tool.replaceAll('_', ' ')), el('span', '', ` — ${step.summary}`));
        list.append(item);
      }
      trace.append(list); message.append(trace);
    }
    for (const suggestion of result.suggestions) {
      const button = el('button', 'evidence-link chip chip--small', suggestion);
      button.type = 'button'; button.addEventListener('click',()=>runAgent(suggestion)); message.append(button);
    }
    if (result.highlightNodeIds.length) focusEvidence(result.highlightNodeIds, result.highlightEdgeIds);
    status('agent-status', { project: 'Respuesta basada en información de la herramienta', missing: 'Información no registrada en esta base', scope: 'Pregunta fuera de alcance o sin una consulta reconocida' }[result.kind] || 'Consulta resuelta con registros del grafo ficticio');
    message.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  } catch (error) {
    addAgentMessage('assistant', 'No pude completar esta consulta. Probá con una capacidad o un proyecto de la red.');
    status('agent-status', 'La consulta no se completó', true);
    console.error(error);
  } finally {
    querying = false; submit.disabled = false; byId('agent-form').removeAttribute('aria-busy');
  }
}
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
  status('gnn-status', results.length ? `${results.length} candidatos para ${project.name}, ordenados por ${ranking==='baseline'?'reglas':'GraphSAGE'}. Sugerencias pendientes de validación.` : 'No hay resultados del modelo para este proyecto.');
  for (const item of results.slice(0,6)) {
    const card = el('article', 'recommendation-card card card--compact card--proposed');
    card.append(el('h4', '', item.node.name), scoreBadge(ranking==='baseline'?'reglas':'GNN',ranking==='baseline'?item.baselineScore:item.score), el('p', '', item.reason || item.node.description));
    if (Number.isFinite(item.baselineScore)) card.append(el('p', 'baseline-score', `Puntuación ${ranking==='baseline'?'GNN':'reglas'} ${(ranking==='baseline'?item.score:item.baselineScore).toFixed(3)} · escala propia de cada método`));
    card.append(evidenceButton('Explorar contexto', item.nodeIds, item.edgeIds,item.node.type));
    panel.append(card);
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
function runGNN() {
  if (!gnnRuntime) { renderGNN(); if(predictionsAvailable)status('gnn-status','Mostrando resultados almacenados del experimento; la inferencia local no está disponible.'); return; }
  const task = byId('gnn-task').value;
  const projectId = byId('gnn-project').value;
  if (!projectId) return;
  const start = performance.now();
  const candidates = store.ofType(task).map(node=>node.id);
  try {
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
    renderGNN();
    status('gnn-status',`Inferencia local: ${ranking.length} candidatos evaluados en ${(performance.now()-start).toFixed(0)} ms. Sugerencias pendientes de validación.`);
  } catch(error) {
    status('gnn-status','No se pudo ejecutar la inferencia local.', true);
    console.error(error);
  }
}
function bind() {
  byId('graph-search').addEventListener('input', applyFilters);
  byId('project-filter').addEventListener('change', ()=>{applyFilters();if(byId('project-filter').value)showNode(byId('project-filter').value);});
  byId('year-filter').addEventListener('change', applyFilters);
  byId('type-filters').addEventListener('click', event => { const button = event.target.closest('[data-type]'); if (!button) return; filterType=button.dataset.type; setTypeButtons(); applyFilters(); });
  byId('reset-view').addEventListener('click',()=> { byId('graph-search').value=''; byId('project-filter').value=''; byId('year-filter').value=''; filterType='all'; selectedNodeId=null; byId('node-detail').replaceChildren(el('p','empty-state','Seleccioná un nodo para abrir su ficha.')); setTypeButtons(); applyFilters(); });
  byId('zoom-in').addEventListener('click',()=>view.zoom(1.25));
  byId('zoom-out').addEventListener('click',()=>view.zoom(0.8));
  byId('fit-view').addEventListener('click',()=>view.fit());
  byId('agent-form').addEventListener('submit',event=> {event.preventDefault(); runAgent(byId('agent-input').value);});
  document.querySelectorAll('.agent-suggestion[data-prompt]').forEach(button=>button.addEventListener('click',()=>runAgent(button.dataset.prompt)));
  byId('agent-reset').addEventListener('click',()=> { if(querying)return; agent.reset(); byId('agent-chat').replaceChildren(); addAgentMessage('assistant',agent.greeting); status('agent-status','Listo para consultar'); });
  byId('gnn-run').addEventListener('click', runGNN);
  const changeExperiment=()=>{view.update({});renderGNN();};
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
      focusEvidence(ids,edges);
      view.pulseMessagePassing(roots);
      status('gnn-status','Dos rondas de agregación sobre vínculos observados. La animación ilustra el vecindario usado, no el peso de cada vínculo.');
    }
  });
}
const unique = values => [...new Set(values)];

async function init() {
  try {
    const [graphResult, predictionResult, modelResult, inputResult] = await Promise.allSettled([fetchJSON('data/graph.json'), fetchJSON('data/gnn-results.json'),fetchJSON('data/gnn-model.json'),fetchJSON('data/gnn-input.json')]);
    if(graphResult.status !== 'fulfilled') throw graphResult.reason;
    const graphHash = graphResult.value.sourceHash;
    const predictions = predictionResult.status === 'fulfilled' && predictionResult.value.meta?.synthetic && (!graphHash || graphHash===predictionResult.value.meta?.training?.graphSha256) ? predictionResult.value : null;
    store = new GraphStore(graphResult.value,predictions); agent = new GraphAgent(store);
    predictionsAvailable=Boolean(predictions?.tasks?.actor && predictions?.tasks?.resource);
    if(predictions && modelResult.status==='fulfilled' && inputResult.status==='fulfilled' && (!graphHash || inputResult.value.meta?.graphSha256===graphHash)) {
      try { gnnRuntime=new GraphSAGERuntime(modelResult.value,inputResult.value); } catch(error) { console.error(error); }
    }
    view=new GraphView(byId('network'),{onSelect:showNode});
    view.setData(store.data.nodes,store.data.edges);
    fillOverview(); bind(); applyFilters();
    showNode(store.ofType('project')[0].id);
    addAgentMessage('assistant',agent.greeting);
    status('agent-status','Listo · consultas locales sobre datos ficticios');
    renderGNN(); initMotion();
    document.documentElement.dataset.ready='true';
  } catch(error) {
    status('graph-count','No se pudieron cargar los datos', true);
    status('agent-status','No se pudo iniciar el agente. Recargá la página.', true);
    if(byId('agent-submit')) byId('agent-submit').disabled=true;
    console.error(error);
  }
}
init();
