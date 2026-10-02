const nodes = [
  { id: 'project', name: 'Encuentro cultural piloto', label: ['Encuentro', 'cultural'], type: 'project', typeLabel: 'Proyecto cultural', x: 430, y: 278, radius: 49, description: 'Un proyecto cultural de prueba. Este caso reúne los roles y recursos necesarios para producir un encuentro piloto.', contributions: ['Convoca una programación artística', 'Articula un espacio, permisos y producción', 'Deja acuerdos y aprendizajes reutilizables'] },
  { id: 'coordinator', name: 'Coordinación general', label: ['Coordinación', 'general'], type: 'person', typeLabel: 'Rol · coordinación', x: 176, y: 134, radius: 31, description: 'Rol de gestión que coordina el proyecto y mantiene el contacto entre sus participantes.', contributions: ['Coordina el cronograma', 'Conecta a los equipos', 'Registra decisiones y responsables'] },
  { id: 'producer', name: 'Equipo de producción', label: ['Equipo de', 'producción'], type: 'organization', typeLabel: 'Rol · producción', x: 156, y: 402, radius: 33, description: 'Equipo de prueba que convierte la idea del encuentro en una producción concreta.', contributions: ['Produce el evento', 'Contrata artistas', 'Organiza tareas de montaje'] },
  { id: 'venue', name: 'Espacio anfitrión', label: ['Espacio', 'anfitrión'], type: 'organization', typeLabel: 'Rol · espacio cultural', x: 406, y: 94, radius: 31, description: 'Rol de espacio cultural que aporta una sala y acompaña la preparación técnica.', contributions: ['Aporta el espacio', 'Comparte inventario técnico', 'Acuerda fechas y condiciones de uso'] },
  { id: 'public_area', name: 'Área pública', label: ['Área', 'pública'], type: 'organization', typeLabel: 'Rol · institución pública', x: 691, y: 156, radius: 32, description: 'Rol institucional que orienta al equipo sobre permisos y requisitos para el encuentro.', contributions: ['Orienta sobre permisos', 'Indica plazos y responsables', 'Revisa los requisitos de uso del espacio'] },
  { id: 'documentation', name: 'Equipo de documentación', label: ['Equipo de', 'documentación'], type: 'organization', typeLabel: 'Rol · documentación', x: 702, y: 384, radius: 32, description: 'Rol que documenta el proceso para que otras personas puedan entenderlo y repetirlo.', contributions: ['Entrevista a los participantes', 'Documenta acuerdos', 'Elabora la guía de producción'] },
  { id: 'artists', name: 'Grupo artístico', label: ['Grupo', 'artístico'], type: 'organization', typeLabel: 'Rol · proyecto artístico', x: 363, y: 466, radius: 30, description: 'Rol artístico que participa en la programación del encuentro.', contributions: ['Propone una presentación', 'Comparte requerimientos técnicos', 'Participa de las actividades de encuentro'] },
  { id: 'guide', name: 'Guía de producción', label: ['Guía de', 'producción'], type: 'resource', typeLabel: 'Recurso reutilizable', x: 605, y: 497, radius: 29, description: 'Recurso de prueba que reúne permisos, funciones, tareas y decisiones útiles para otra edición.', contributions: ['Lista de permisos y plazos', 'Funciones de contacto en el proyecto', 'Decisiones y recomendaciones para otra edición'] }
];

const edges = [
  { from: 'coordinator', to: 'project', label: 'coordina' },
  { from: 'producer', to: 'project', label: 'produce' },
  { from: 'venue', to: 'project', label: 'aporta espacio' },
  { from: 'public_area', to: 'project', label: 'orienta permisos' },
  { from: 'documentation', to: 'project', label: 'documenta' },
  { from: 'artists', to: 'project', label: 'presenta una obra' },
  { from: 'guide', to: 'project', label: 'conserva aprendizajes' },
  { from: 'documentation', to: 'guide', label: 'elabora' },
  { from: 'coordinator', to: 'public_area', label: 'consulta requisitos' },
  { from: 'producer', to: 'artists', label: 'articula participación' }
];

const queries = {
  all: { ids: null, answer: 'Elegí una pregunta para destacar los vínculos relevantes.' },
  permits: { ids: ['project', 'coordinator', 'public_area'], answer: 'La coordinación general consulta al área pública. El dato útil para otra edición sería conservar requisitos, plazos y responsable de cada permiso.' },
  space: { ids: ['project', 'venue'], answer: 'El espacio anfitrión aporta la sala. El acuerdo debería guardar fechas, condiciones de uso y equipamiento disponible.' },
  memory: { ids: ['project', 'documentation', 'guide'], answer: 'El equipo de documentación elabora una guía con permisos, funciones, tareas y decisiones que podrían reutilizarse.' }
};

const svg = document.getElementById('network');
const detail = document.getElementById('node-detail');
const answer = document.getElementById('query-answer');
const nodeById = Object.fromEntries(nodes.map(node => [node.id, node]));
const ns = 'http://www.w3.org/2000/svg';
let selectedId = 'project';
let activeQuery = 'all';

function svgElement(tag, attributes = {}) {
  const element = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function renderDetail(node) {
  detail.replaceChildren();
  const type = document.createElement('p');
  type.className = 'detail-type';
  type.textContent = node.typeLabel;
  const title = document.createElement('h3');
  title.textContent = node.name;
  const description = document.createElement('p');
  description.textContent = node.description;
  const heading = document.createElement('h4');
  heading.textContent = node.type === 'resource' ? 'Qué conserva' : 'Qué aporta';
  const list = document.createElement('ul');
  list.className = 'detail-list';
  node.contributions.forEach(item => {
    const li = document.createElement('li');
    li.textContent = item;
    list.append(li);
  });
  const note = document.createElement('p');
  note.className = 'detail-note';
  note.textContent = 'Ficha de prueba para explorar cómo podría funcionar SINC.';
  detail.append(type, title, description, heading, list, note);
}

function renderGraph() {
  svg.replaceChildren();
  const highlighted = queries[activeQuery].ids;
  const edgeLayer = svgElement('g');
  edges.forEach(edge => {
    const from = nodeById[edge.from];
    const to = nodeById[edge.to];
    const relevant = !highlighted || (highlighted.includes(edge.from) && highlighted.includes(edge.to));
    const line = svgElement('line', { x1: from.x, y1: from.y, x2: to.x, y2: to.y, class: `graph-edge${relevant && highlighted ? ' is-highlighted' : ''}${!relevant ? ' is-muted' : ''}` });
    const title = svgElement('title');
    title.textContent = `${from.name} → ${to.name}: ${edge.label}`;
    line.append(title);
    edgeLayer.append(line);
  });
  svg.append(edgeLayer);

  const colors = { project: '#285b4b', person: '#ce8b63', organization: '#84a79a', resource: '#d1b66f' };
  const nodeLayer = svgElement('g');
  nodes.forEach(node => {
    const group = svgElement('g', { class: `graph-node${node.id === selectedId ? ' is-selected' : ''}${highlighted && !highlighted.includes(node.id) ? ' is-muted' : ''}`, role: 'button', tabindex: '0', 'aria-label': `Ver ficha de ${node.name}` });
    const circle = svgElement('circle', { cx: node.x, cy: node.y, r: node.radius, fill: colors[node.type] });
    group.append(circle);
    const label = svgElement('text', { x: node.x, y: node.y + node.radius + 22, 'text-anchor': 'middle' });
    node.label.forEach((part, index) => {
      const tspan = svgElement('tspan', { x: node.x, dy: index === 0 ? 0 : 15 });
      tspan.textContent = part;
      label.append(tspan);
    });
    group.append(label);
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
  renderDetail(nodeById[id]);
  renderGraph();
  const selected = [...svg.querySelectorAll('.graph-node')].find(group => group.getAttribute('aria-label') === `Ver ficha de ${nodeById[id].name}`);
  selected?.focus();
}

document.querySelectorAll('[data-query]').forEach(button => {
  button.addEventListener('click', () => {
    activeQuery = button.dataset.query;
    document.querySelectorAll('[data-query]').forEach(other => other.classList.toggle('active', other === button));
    answer.textContent = queries[activeQuery].answer;
    renderGraph();
  });
});

renderDetail(nodeById[selectedId]);
renderGraph();
