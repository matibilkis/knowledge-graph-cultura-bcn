const svg = document.getElementById('network');
const graphScroll = document.querySelector('.graph-scroll');
const detail = document.getElementById('node-detail');
const answer = document.getElementById('query-answer');
const buttons = document.getElementById('query-buttons');
const graphTitle = document.getElementById('graph-title');
const graphCount = document.getElementById('graph-count');
const svgNS = 'http://www.w3.org/2000/svg';

let graph;
let nodesById;
let edgesById;
let selectedId = 'p_cauce';
let activeScenario = 'all';

function svgElement(tag, attributes = {}) {
  const element = document.createElementNS(svgNS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function renderDetail(node) {
  detail.replaceChildren();
  const type = document.createElement('p');
  type.className = 'detail-type';
  type.textContent = { project: 'Proyecto', actor: 'Equipo', capability: 'Capacidad', resource: 'Recurso reutilizable' }[node.type];
  const title = document.createElement('h3');
  title.textContent = node.name;
  const description = document.createElement('p');
  description.textContent = node.description;
  const heading = document.createElement('h4');
  heading.textContent = 'En esta red';
  const list = document.createElement('ul');
  list.className = 'detail-list';
  node.facts.forEach(fact => {
    const item = document.createElement('li');
    item.textContent = fact;
    list.append(item);
  });
  const connections = graph.edges.filter(edge => edge.source === node.id || edge.target === node.id);
  const connectionsTitle = document.createElement('h4');
  connectionsTitle.textContent = `Vínculos (${connections.length})`;
  const connectionsList = document.createElement('ul');
  connectionsList.className = 'connection-list';
  connections.forEach(edge => {
    const other = nodesById[edge.source === node.id ? edge.target : edge.source];
    const item = document.createElement('li');
    const link = document.createElement('button');
    link.type = 'button';
    link.textContent = `${other.name} · ${edge.label} (${edge.year})`;
    link.addEventListener('click', () => selectNode(other.id));
    item.append(link);
    connectionsList.append(item);
  });
  const note = document.createElement('p');
  note.className = 'detail-note';
  note.textContent = 'Ficha y vínculos inventados para esta demostración.';
  detail.append(type, title, description, heading, list, connectionsTitle, connectionsList, note);
}

function renderGraph() {
  svg.replaceChildren();
  const scenario = graph.scenarios.find(item => item.id === activeScenario);
  const highlightedEdges = new Set(scenario.edge_ids);
  const highlightedNodes = new Set(scenario.edge_ids.flatMap(id => [edgesById[id].source, edgesById[id].target]));
  const focused = activeScenario !== 'all';
  const edgeLayer = svgElement('g');
  graph.edges.forEach(edge => {
    const from = nodesById[edge.source];
    const to = nodesById[edge.target];
    const line = svgElement('line', {
      x1: from.x, y1: from.y, x2: to.x, y2: to.y,
      class: `graph-edge${focused && highlightedEdges.has(edge.id) ? ' is-highlighted' : ''}${focused && !highlightedEdges.has(edge.id) ? ' is-muted' : ''}`
    });
    const title = svgElement('title');
    title.textContent = `${from.name} → ${to.name}: ${edge.label} (${edge.year})`;
    line.append(title);
    edgeLayer.append(line);
  });
  svg.append(edgeLayer);

  const colors = { project: '#285b4b', actor: '#ce8b63', capability: '#8c94b6', resource: '#d1b66f' };
  const radius = { project: 25, actor: 18, capability: 16, resource: 17 };
  const nodeLayer = svgElement('g');
  graph.nodes.forEach(node => {
    const group = svgElement('g', {
      class: `graph-node${node.id === selectedId ? ' is-selected' : ''}${focused && !highlightedNodes.has(node.id) ? ' is-muted' : ''}`,
      role: 'button', tabindex: '0', 'aria-label': `Ver ficha de ${node.name}`
    });
    const circle = svgElement('circle', { cx: node.x, cy: node.y, r: radius[node.type], fill: colors[node.type] });
    const label = svgElement('text', { x: node.x, y: node.y + radius[node.type] + 17, 'text-anchor': 'middle' });
    label.textContent = node.name;
    group.append(circle, label);
    group.addEventListener('click', () => selectNode(node.id));
    group.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectNode(node.id);
      }
    });
    nodeLayer.append(group);
  });
  svg.append(nodeLayer);
}

function selectNode(id) {
  selectedId = id;
  renderDetail(nodesById[id]);
  renderGraph();
  [...svg.querySelectorAll('.graph-node')].find(group => group.getAttribute('aria-label') === `Ver ficha de ${nodesById[id].name}`)?.focus();
}

function selectScenario(id) {
  const scenario = graph.scenarios.find(item => item.id === id);
  activeScenario = id;
  graphTitle.textContent = scenario.question;
  answer.textContent = scenario.answer;
  buttons.querySelectorAll('button').forEach(button => {
    const active = button.dataset.scenario === id;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  renderGraph();
  if (scenario.edge_ids.length) {
    const ids = new Set(scenario.edge_ids.flatMap(edgeId => [edgesById[edgeId].source, edgesById[edgeId].target]));
    const centerX = [...ids].reduce((sum, nodeId) => sum + nodesById[nodeId].x, 0) / ids.size;
    graphScroll.scrollLeft = centerX / 860 * graphScroll.scrollWidth - graphScroll.clientWidth / 2;
  }
}

async function init() {
  try {
    const response = await fetch('data/graph.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    graph = await response.json();
    nodesById = Object.fromEntries(graph.nodes.map(node => [node.id, node]));
    edgesById = Object.fromEntries(graph.edges.map(edge => [edge.id, edge]));
    graphCount.textContent = `${graph.nodes.length} nodos · ${graph.edges.length} vínculos · ${graph.nodes.filter(node => node.type === 'project').length} proyectos`;
    graph.scenarios.forEach(scenario => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.scenario = scenario.id;
      button.textContent = scenario.label;
      button.title = scenario.question;
      button.addEventListener('click', () => selectScenario(scenario.id));
      buttons.append(button);
    });
    renderDetail(nodesById[selectedId]);
    selectScenario('access');
  } catch (error) {
    graphCount.textContent = 'No se pudo cargar la red';
    answer.textContent = 'Abrí esta página desde un servidor web para cargar los datos de prueba.';
    console.error(error);
  }
}

init();
