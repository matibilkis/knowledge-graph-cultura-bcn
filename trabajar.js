import { MAX_BYTES, MAX_COPY_BYTES, FIELDS, parseCSV, suggestMapping, buildWorkspace, serializeWorkspace, restoreWorkspace, summarize, scopeRows, guidance, answer, report, TEMPLATE, EXAMPLE } from './local-data.js?v=20261007-local1';

const $ = id => document.getElementById(id);
const STORAGE_KEY = 'sinc.local-workspace.v1';
const DEFAULT_QUERY = 'Mostrá los antecedentes';
const initialGuide = $('guide-content').cloneNode(true);
let workspace = null, pending = null, result = null, lastQuery = DEFAULT_QUERY, loadVersion = 0, persisted = false;
const element = (tag, text = '', className = '') => {
  const node = document.createElement(tag); node.textContent = text;
  if (className) node.className = className;
  return node;
};
const distinct = values => [...new Set(values.filter(Boolean))];
const glyph = kind => { const node = element('span', '', `glyph glyph-${kind}`); node.setAttribute('aria-hidden', 'true'); return node; };
function clearError() { $('work-error').hidden = true; $('work-error-text').textContent = ''; }
function showError(error) { $('work-error-text').textContent = error.message || String(error); $('work-error').hidden = false; $('work-error').scrollIntoView({ block: 'nearest' }); }
function showStage(number, message = '', focus = true) {
  clearError();
  ['load-step', 'map-step', 'query-step'].forEach((id, index) => { $(id).hidden = index + 1 !== number; });
  document.querySelectorAll('[data-step]').forEach(node => { if (Number(node.dataset.step) === number) node.setAttribute('aria-current', 'step'); else node.removeAttribute('aria-current'); });
  $('work-status').textContent = message;
  $('return-workspace').hidden = !workspace;
  if (number !== 3) {
    $('guide-title').textContent = 'Una planilla. Nuevas preguntas.';
    $('guide-content').replaceChildren(...[...initialGuide.childNodes].map(node => node.cloneNode(true)));
  }
  if (focus) $({ 1: 'load-title', 2: 'map-title', 3: 'query-title' }[number]).focus();
}
function fillSelect(select, entries, emptyLabel) {
  select.replaceChildren(new Option(emptyLabel, ''), ...entries.map(([value, label]) => new Option(label, value)));
}
function renderMapping() {
  $('mapping-main').replaceChildren(); $('mapping-extra').replaceChildren();
  for (const field of FIELDS) {
    const wrapper = element('div', '', 'field');
    const label = element('label', `${field.label}${field.required ? ' (obligatorio)' : ''}`); label.htmlFor = `map-${field.id}`;
    const select = element('select'); select.id = `map-${field.id}`; select.name = field.id;
    select.required = Boolean(field.required);
    fillSelect(select, pending.parsed.headers.map((header, index) => [String(index), header]), field.required ? 'Elegí una columna' : 'Sin registrar en este archivo');
    select.value = pending.mapping[field.id] == null ? '' : String(pending.mapping[field.id]);
    const help = element('p', field.hint, 'field-help'); help.id = `help-${field.id}`;
    select.setAttribute('aria-describedby', help.id);
    select.addEventListener('change', updateMappingNote);
    wrapper.append(label, select, help);
    (['project', 'team', 'capability', 'resource'].includes(field.id) ? $('mapping-main') : $('mapping-extra')).append(wrapper);
  }
  $('map-description').textContent = `${pending.filename}${pending.fictional ? ' · Ejemplo ficticio' : ''} · ${pending.parsed.records.length} filas. Las coincidencias por nombre son sugerencias: revisalas antes de continuar.`;
  const table = element('table'); table.append(element('caption', 'Primeras tres filas. El archivo original se conserva en la copia.'));
  const head = element('thead'), heading = element('tr');
  const numberHeader = element('th', 'Fila'); numberHeader.scope = 'col'; heading.append(numberHeader);
  for (const header of pending.parsed.headers) { const th = element('th', header); th.scope = 'col'; heading.append(th); }
  head.append(heading); table.append(head);
  const body = element('tbody');
  for (const record of pending.parsed.records.slice(0, 3)) {
    const tr = element('tr'), rowHeader = element('th', String(record.row)); rowHeader.scope = 'row'; tr.append(rowHeader);
    for (const cell of record.cells) tr.append(element('td', cell.length > 200 ? `${cell.slice(0, 200)}…` : cell));
    body.append(tr);
  }
  table.append(body); $('preview').replaceChildren(table);
  updateMappingNote();
}
function readMapping() { return Object.fromEntries(FIELDS.map(field => [field.id, $(`map-${field.id}`).value === '' ? null : Number($(`map-${field.id}`).value)])); }
function updateMappingNote() {
  if (!pending) return;
  const mapping = readMapping(), counts = new Map();
  for (const index of Object.values(mapping)) if (index !== null) counts.set(index, (counts.get(index) || 0) + 1);
  for (const field of FIELDS) $(`map-${field.id}`).setAttribute('aria-invalid', String(mapping[field.id] !== null && counts.get(mapping[field.id]) > 1));
  const emptyProjects = mapping.project == null ? 0 : pending.parsed.records.filter(row => !row.cells[mapping.project].trim()).length;
  $('mapping-note').textContent = emptyProjects ? `${emptyProjects} filas no tienen nombre de proyecto y se omitirán. Completá esos nombres en tu planilla si querés incluirlas.` : 'Sólo Proyecto es obligatorio. Una columna puede usarse para un único campo. La información sin asignar sigue disponible en las filas de origen.';
}
function saveWorkspace() {
  persisted = false;
  try { localStorage.setItem(STORAGE_KEY, serializeWorkspace(workspace)); persisted = true; }
  catch { try { localStorage.removeItem(STORAGE_KEY); } catch { /* El navegador puede bloquear el almacenamiento por completo. */ } }
  $('save-notice').hidden = false;
  $('save-notice-text').textContent = persisted ? 'Datos guardados en este navegador. No se envían a un servidor. Descargá una copia si querés conservarlos fuera de este equipo.' : 'El navegador no permitió guardar estos datos. Podés trabajar durante esta sesión; descargá una copia antes de cerrar.';
}
function activateWorkspace(next, message) {
  workspace = next; pending = null; lastQuery = DEFAULT_QUERY;
  $('next-project').value = '';
  const counts = summarize(workspace);
  $('current-file').textContent = `${workspace.filename}${workspace.fictional ? ' · Ejemplo ficticio: nombres y proyectos inventados' : ''} · ${workspace.rows.length} filas con proyecto${workspace.skipped.length ? ` · ${workspace.skipped.length} filas sin proyecto omitidas` : ''}`;
  $('dataset-overview').replaceChildren();
  for (const [key, label, kind] of [['projects', 'proyectos', 'project'], ['teams', 'equipos', 'actor'], ['capabilities', 'capacidades', 'capability'], ['resources', 'recursos', 'resource']]) {
    const li = element('li'); li.append(glyph(kind), element('b', String(counts[key])), document.createTextNode(` ${label}`)); $('dataset-overview').append(li);
  }
  fillSelect($('project-scope'), workspace.projects.map(project => [project.id, `${project.name}${project.year ? ` · ${project.year}` : ' · año sin registrar'}`]), 'Todos los proyectos');
  const capabilities = distinct(workspace.rows.flatMap(row => row.capabilities)).sort((a, b) => a.localeCompare(b, 'es'));
  fillSelect($('capability-scope'), capabilities.map(name => [name, name]), 'Todas las capacidades registradas');
  $('capability-scope').disabled = !capabilities.length;
  $('capability-help').textContent = capabilities.length ? 'Filtra capacidades de las filas del proyecto; no atribuye habilidades a todo su equipo.' : 'Añadí una columna de capacidades para explorar antecedentes por necesidad.';
  saveWorkspace(); showStage(3, message); runQuery(DEFAULT_QUERY);
}
async function loadFile(file) {
  const version = ++loadVersion;
  clearError(); $('work-status').textContent = 'Leyendo el archivo en este navegador…';
  $('choose-file').disabled = true; $('try-example').disabled = true;
  try {
    const extension = file.name.split('.').pop().toLowerCase();
    if (!['csv', 'json'].includes(extension)) throw new Error('Elegí un archivo CSV o una copia JSON exportada desde SINC.');
    if (file.size > (extension === 'json' ? MAX_COPY_BYTES : MAX_BYTES)) throw new Error(`El archivo supera ${extension === 'json' ? '40' : '5'} MB. Dividilo en archivos más pequeños.`);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
    catch { throw new Error('No pude leer el archivo como UTF-8. Volvé a exportarlo como CSV UTF-8.'); }
    if (version !== loadVersion) return;
    if (extension === 'json') activateWorkspace(restoreWorkspace(text), 'Copia recuperada. Podés seguir con tus consultas.');
    else {
      const parsed = parseCSV(text);
      pending = { parsed, mapping: suggestMapping(parsed.headers), filename: file.name, fictional: false };
      renderMapping(); showStage(2, 'Archivo leído. Confirmá qué significa cada columna.');
    }
  } catch (error) { if (version === loadVersion) { $('work-status').textContent = 'No se reemplazaron tus datos actuales.'; showError(error); } }
  finally { if (version === loadVersion) { $('choose-file').disabled = false; $('try-example').disabled = false; $('data-file').value = ''; } }
}
function currentScope() { return { projectId: $('project-scope').value, capability: $('capability-scope').value }; }
function renderGuidance(items, container, headingTag = 'h3') {
  container.replaceChildren();
  for (const item of items) {
    const article = element('article', '', 'guidance-item'); article.append(element(headingTag, item.title), element('p', item.text));
    if (item.columns.length) article.append(element('p', `Columnas: ${item.columns.join(' · ')}`, 'field-help'));
    container.append(article);
  }
}
function evidence(group) {
  const details = element('details'); details.className = 'source-details';
  details.append(element('summary', `Ver ${group.rows.length} ${group.rows.length === 1 ? 'fila de origen' : 'filas de origen'}`));
  const list = element('ol', '', 'source-list');
  let count = 0;
  function appendRows() {
    const limit = Math.min(count + 6, group.rows.length);
    for (; count < limit; count++) {
      const row = group.rows[count], li = element('li');
      li.append(element('strong', `Fila ${row.sourceRow} · línea de inicio ${row.sourceLine}`));
      const dl = element('dl');
      workspace.headers.forEach((header, index) => { dl.append(element('dt', header), element('dd', row.original[index] || 'Sin registrar')); });
      li.append(dl); list.append(li);
    }
    more.hidden = count >= group.rows.length;
    more.textContent = `Mostrar más filas (${group.rows.length - count} restantes)`;
  }
  const more = element('button', '', 'button-quiet more-results'); more.type = 'button'; more.addEventListener('click', appendRows);
  details.append(list, more);
  // Las celdas se montan al abrir la evidencia, para no inflar el DOM de un CSV grande.
  details.addEventListener('toggle', () => { if (details.open && !count) appendRows(); });
  return details;
}
function renderGroup(group) {
  const article = element('article', '', 'result-item'), title = element('h4');
  title.append(glyph({ projects: 'project', teams: 'actor', resources: 'resource' }[result.kind]), document.createTextNode(group.label)); article.append(title);
  const context = distinct(group.rows.map(row => `${row.project}${row.year ? ` (${row.year})` : ' (año sin registrar)'}`));
  if (result.kind === 'projects') {
    const first = group.rows[0];
    const teamCount = distinct(group.rows.map(row => row.team)).length;
    article.append(element('p', `${first.year || 'Año sin registrar'} · ${teamCount} ${teamCount === 1 ? 'equipo' : 'equipos'} en las filas seleccionadas`));
    const capabilities = distinct(group.rows.flatMap(row => row.capabilities));
    if (capabilities.length) article.append(element('p', `Capacidades registradas: ${capabilities.join(' · ')}`));
  } else article.append(element('p', `Relacionado con: ${context.join(' · ')}`));
  if (result.kind === 'teams') {
    const roles = distinct(group.rows.map(row => row.role));
    if (roles.length) article.append(element('p', `Funciones registradas: ${roles.join(' · ')}`));
  }
  const note = group.rows.find(row => row.notes);
  if (note) article.append(element('p', `Nota de ${note.project}, fila ${note.sourceRow}: ${note.notes}`, 'result-notes'));
  article.append(evidence(group)); return article;
}
function renderAnswer() {
  const titles = { projects: 'Antecedentes registrados', teams: 'Equipos participantes', resources: 'Recursos relacionados', guide: 'Qué datos podés añadir', summary: 'Resumen de esta selección', missing: 'Esto queda por confirmar', help: 'Cómo trabajar con SINC' };
  $('answer-title').textContent = titles[result.kind]; $('answer-text').textContent = result.text; $('answer-items').replaceChildren();
  if (result.kind === 'guide') renderGuidance(result.guidance, $('answer-items'), 'h4');
  else if (result.groups.length) {
    let count = 0;
    const more = element('button', '', 'button button-outline more-results'); more.type = 'button';
    const appendGroups = () => {
      const limit = Math.min(count + 6, result.groups.length);
      for (; count < limit; count++) $('answer-items').insertBefore(renderGroup(result.groups[count]), more);
      more.hidden = count >= result.groups.length; more.textContent = `Mostrar más resultados (${result.groups.length - count} restantes)`;
    };
    more.addEventListener('click', appendGroups); $('answer-items').append(more); appendGroups();
  }
  if (['summary', 'guide'].includes(result.kind) && result.rows.length) $('answer-items').append(evidence({ rows: result.rows }));
  $('guide-title').textContent = 'Tu siguiente dato útil';
  const guidanceRows = ['missing', 'help'].includes(result.kind) ? scopeRows(workspace, currentScope()) : result.rows;
  renderGuidance(guidance(workspace, guidanceRows), $('guide-content'));
}
function runQuery(query) {
  if (!workspace) return;
  clearError(); lastQuery = query.trim() || DEFAULT_QUERY; $('local-question').value = lastQuery;
  document.querySelectorAll('[data-query]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.query === lastQuery)));
  result = answer(workspace, lastQuery, currentScope());
  if (result.scope) { $('project-scope').value = result.scope.projectId || ''; $('capability-scope').value = result.scope.capability || ''; }
  renderAnswer();
  $('work-status').textContent = `${workspace.fictional ? 'Ejemplo ficticio. ' : ''}Consulta resuelta con los datos cargados.`;
  if (result.kind === 'missing') $('work-status').textContent = 'La pregunta queda por confirmar. Podés reformularla o usar los filtros.';
}
function download(content, name, type) {
  const url = URL.createObjectURL(new Blob([content], { type })), anchor = element('a');
  anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('work-status').textContent = `Descarga preparada: ${name}`;
}
$('choose-file').addEventListener('click', () => $('data-file').click());
$('data-file').addEventListener('change', () => { if ($('data-file').files[0]) loadFile($('data-file').files[0]); });
let dragDepth = 0;
$('upload-zone').addEventListener('dragenter', event => { event.preventDefault(); dragDepth++; $('upload-zone').classList.add('is-dragging'); });
$('upload-zone').addEventListener('dragover', event => event.preventDefault());
$('upload-zone').addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('upload-zone').classList.remove('is-dragging'); } });
$('upload-zone').addEventListener('drop', event => {
  event.preventDefault(); dragDepth = 0; $('upload-zone').classList.remove('is-dragging');
  if (event.dataTransfer.files.length !== 1) showError(new Error('Arrastrá un único archivo CSV o una copia JSON.'));
  else loadFile(event.dataTransfer.files[0]);
});
$('try-example').addEventListener('click', () => {
  const parsed = parseCSV(EXAMPLE); pending = { parsed, mapping: suggestMapping(parsed.headers), filename: 'ejemplo-ficticio.csv', fictional: true };
  renderMapping(); showStage(2, 'Ejemplo ficticio. Confirmá sus columnas para probar el recorrido.');
});
$('download-template').addEventListener('click', () => download(`\uFEFF${TEMPLATE}`, 'sinc-plantilla.csv', 'text/csv;charset=utf-8'));
$('mapping-form').addEventListener('submit', event => {
  event.preventDefault(); clearError();
  if (!pending) return;
  try { activateWorkspace(buildWorkspace(pending.parsed, readMapping(), pending), 'Columnas confirmadas. Ya podés consultar tus antecedentes.'); }
  catch (error) {
    showError(error); const invalid = $('mapping-form').querySelector('[aria-invalid="true"]');
    if (invalid) { invalid.closest('details')?.setAttribute('open', ''); invalid.focus(); }
    else if (!$('map-project').value) { $('map-project').setAttribute('aria-invalid', 'true'); $('map-project').focus(); }
  }
});
function startOver() { loadVersion++; pending = null; $('data-file').value = ''; $('choose-file').disabled = false; $('try-example').disabled = false; showStage(1); }
$('map-back').addEventListener('click', startOver); $('change-file').addEventListener('click', startOver);
$('return-workspace').addEventListener('click', () => { showStage(3); runQuery(lastQuery); });
$('question-form').addEventListener('submit', event => { event.preventDefault(); if ($('local-question').value.trim()) runQuery($('local-question').value); });
for (const button of document.querySelectorAll('[data-query]')) button.addEventListener('click', () => runQuery(button.dataset.query));
$('scope-form').addEventListener('submit', event => event.preventDefault());
function refineSelection() {
  // Una selección explícita conserva el tipo de consulta, sin reintroducir
  // nombres de la pregunta anterior que anularían el nuevo filtro.
  const query = { projects: DEFAULT_QUERY, teams: '¿Qué equipos participaron?', resources: '¿Qué recursos hay?', guide: '¿Qué datos puedo añadir?', summary: 'Resumen' }[result?.kind] || DEFAULT_QUERY;
  runQuery(query);
}
$('project-scope').addEventListener('change', refineSelection); $('capability-scope').addEventListener('change', refineSelection);
$('download-report').addEventListener('click', () => { if (workspace && result) download(report(workspace, result, $('next-project').value.trim()), 'sinc-informe.txt', 'text/plain;charset=utf-8'); });
$('download-copy').addEventListener('click', () => { if (workspace) download(serializeWorkspace(workspace), 'sinc-datos.json', 'application/json;charset=utf-8'); });
$('forget-data').addEventListener('click', () => {
  if (!window.confirm('¿Olvidar los datos guardados en este navegador? Las copias que descargaste se conservan.')) return;
  try { localStorage.removeItem(STORAGE_KEY); } catch { showError(new Error('El navegador no permitió quitar la copia. Borrá los datos de este sitio desde su configuración.')); return; }
  workspace = null; pending = null; result = null; persisted = false; startOver(); $('work-status').textContent = 'Datos olvidados en este navegador. Podés cargar otra planilla.';
});
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) activateWorkspace(restoreWorkspace(saved), 'Recuperamos tu última planilla de este navegador.');
} catch { showStage(1, 'No se pudo recuperar la copia local. Podés cargar el CSV o una copia descargada.', false); }
