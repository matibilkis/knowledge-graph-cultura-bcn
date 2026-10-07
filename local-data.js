// Importación y consultas locales. Cada respuesta conserva las filas de origen.
export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_COPY_BYTES = MAX_BYTES * 8;
export const MAX_ROWS = 5000;
export const FIELDS = [
  { id: 'project', label: 'Proyecto', hint: 'El proyecto al que pertenece la fila.', aliases: ['proyecto', 'nombre proyecto', 'nombre del proyecto', 'project', 'evento', 'actividad'], required: true },
  { id: 'year', label: 'Año', hint: 'Año del proyecto. Ayuda a distinguir ediciones.', aliases: ['ano', 'año', 'year', 'fecha', 'fecha proyecto'] },
  { id: 'team', label: 'Equipo participante', hint: 'Equipo o colectivo que figura en ese proyecto.', aliases: ['equipo', 'colectivo', 'participante', 'organizacion', 'actor', 'team'] },
  { id: 'role', label: 'Función del equipo', hint: 'Qué hizo ese equipo en el proyecto.', aliases: ['funcion', 'rol', 'tarea', 'role'] },
  { id: 'capability', label: 'Capacidad del proyecto', hint: 'Capacidad registrada en el proyecto. Separá varias con |.', aliases: ['capacidad', 'capacidades', 'especialidad', 'capability'] },
  { id: 'resource', label: 'Recurso relacionado', hint: 'Material o documento vinculado al proyecto. Separá varios con |.', aliases: ['recurso', 'recursos', 'material', 'documento', 'resource'] },
  { id: 'territory', label: 'Territorio', hint: 'Barrio, ciudad o lugar registrado.', aliases: ['territorio', 'barrio', 'ciudad', 'lugar', 'territory'] },
  { id: 'notes', label: 'Notas', hint: 'Información adicional que querés poder consultar.', aliases: ['notas', 'observaciones', 'descripcion', 'notes'] }
];
export const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const identity = value => String(value).normalize('NFKC').toLocaleLowerCase('es').replace(/\s+/g, ' ').trim();
const unique = items => [...new Set(items)];
const list = value => unique(String(value || '').split('|').map(item => item.trim()).filter(Boolean));
const cleanCell = value => String(value ?? '').trim();

export function parseCSV(text, separator = null) {
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('El archivo supera 5 MB. Dividilo en archivos más pequeños.');
  text = String(text).replace(/^\uFEFF/, '');
  if (!text.trim()) throw new Error('El archivo está vacío. Elegí un CSV con encabezados y datos.');
  if (!separator) {
    let quoted = false, header = '';
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') { if (quoted && text[i + 1] === '"') i++; else quoted = !quoted; }
      else if (!quoted && /[\r\n]/.test(char)) { if (header.trim()) break; }
      else if (!quoted) header += char;
    }
    separator = [',', ';', '\t'].sort((a, b) => header.split(b).length - header.split(a).length)[0];
  }
  const records = [];
  let cells = [], cell = '', quoted = false, closed = false, line = 1, startLine = 1;
  const finishCell = () => { cells.push(cell); cell = ''; closed = false; };
  const finishRow = () => {
    finishCell(); records.push({ cells, line: startLine, row: records.length + 1 }); cells = [];
    if (records.length > MAX_ROWS + 1) throw new Error('El CSV supera 5.000 filas. Dividilo en archivos más pequeños.');
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; }
      } else { cell += char; if (char === '\n' || (char === '\r' && text[i + 1] !== '\n')) line++; }
    } else if (char === '"') {
      if (cell.length || closed) throw new Error(`Comillas inesperadas en la línea ${line}. Revisá esa fila o exportá de nuevo como CSV.`);
      quoted = true;
    } else if (char === separator) finishCell();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      finishRow(); line++; startLine = line;
    } else {
      if (closed && !/\s/.test(char)) throw new Error(`Texto después de una celda entre comillas en la línea ${line}. Revisá el CSV.`);
      if (!closed) cell += char;
    }
    if (cell.length > 16000) throw new Error(`Una celda de la línea ${line} supera 16.000 caracteres. Acortá su contenido.`);
    if (cells.length > 64) throw new Error('El CSV tiene más de 64 columnas. Elegí sólo las que necesitás.');
  }
  if (quoted) throw new Error(`Hay comillas sin cerrar desde la línea ${startLine}. Revisá el archivo.`);
  if (cell.length || cells.length || closed) finishRow();
  const nonempty = records.filter(record => record.cells.some(value => value.trim()));
  const first = nonempty.shift();
  if (!first) throw new Error('El archivo no contiene encabezados ni datos. Elegí un CSV con nombres de columnas.');
  const headers = first.cells.map(cleanCell);
  if (headers.length > 64) throw new Error('El CSV tiene más de 64 columnas. Elegí sólo las que necesitás.');
  if (headers.some(value => !value)) throw new Error('Hay columnas sin nombre. Completá los encabezados de la primera fila.');
  if (new Set(headers.map(identity)).size !== headers.length) throw new Error('Hay encabezados repetidos. Poné un nombre distinto a cada columna.');
  if (!nonempty.length) throw new Error('Encontré encabezados, pero ninguna fila con datos.');
  for (const record of nonempty) if (record.cells.length !== headers.length) throw new Error(`La fila ${record.row} tiene ${record.cells.length} columnas; se esperaban ${headers.length}. Revisá el separador y las comillas.`);
  return { headers, records: nonempty, separator };
}

export function suggestMapping(headers) {
  const mapping = {};
  for (const field of FIELDS) {
    const found = headers.map((name, index) => ({ index, name: normalize(name) })).filter(item => field.aliases.some(alias => normalize(alias) === item.name));
    mapping[field.id] = found.length === 1 ? found[0].index : null;
  }
  return mapping;
}

export function buildWorkspace(parsed, mapping, meta = {}) {
  if (!parsed?.headers?.length || !Array.isArray(parsed.records) || !parsed.records.length) throw new Error('No hay datos para confirmar. Cargá un archivo de nuevo.');
  const used = FIELDS.map(field => mapping[field.id]).filter(index => index !== null && index !== undefined);
  if (mapping.project === null || mapping.project === undefined) throw new Error('Elegí la columna que contiene el nombre del proyecto.');
  if (used.some(index => !Number.isInteger(index) || index < 0 || index >= parsed.headers.length)) throw new Error('La asignación de columnas no es válida. Revisala antes de continuar.');
  if (new Set(used).size !== used.length) throw new Error('Una columna está asignada a más de un campo. Usala una sola vez.');
  const rows = [], skipped = [];
  for (const record of parsed.records) {
    const values = Object.fromEntries(FIELDS.map(field => [field.id, cleanCell(mapping[field.id] == null ? '' : record.cells[mapping[field.id]])]));
    if (!values.project) { skipped.push(record.row); continue; }
    let year = '';
    if (values.year) {
      const match = values.year.match(/^(\d{4})(?:[-/]\d{1,2}[-/]\d{1,2})?$/) || values.year.match(/^\d{1,2}[-/]\d{1,2}[-/](\d{4})$/);
      if (!match || Number(match[1]) < 1900 || Number(match[1]) > 2100) throw new Error(`La fila ${record.row} tiene un año o fecha no reconocido: «${values.year}». Usá un año de cuatro dígitos o una fecha día/mes/año.`);
      year = match[1];
    }
    rows.push({ ...values, year, capabilities: list(values.capability), resources: list(values.resource), sourceRow: record.row, sourceLine: record.line, original: record.cells.map(String) });
  }
  if (!rows.length) throw new Error('Ninguna fila tiene un proyecto. Revisá la columna elegida.');
  const projects = new Map();
  for (const row of rows) {
    const key = `${identity(row.project)}\u0000${row.year}`;
    if (!projects.has(key)) projects.set(key, { id: `p${projects.size + 1}`, name: row.project, year: row.year, rows: [] });
    const project = projects.get(key); project.rows.push(row); row.projectId = project.id;
  }
  return { version: 1, filename: String(meta.filename || 'datos.csv').slice(0, 200), fictional: meta.fictional === true, headers: [...parsed.headers], mapping: Object.fromEntries(FIELDS.map(field => [field.id, mapping[field.id] ?? null])), records: parsed.records, rows, projects: [...projects.values()], skipped };
}

export function serializeWorkspace(workspace) {
  return JSON.stringify({ format: 'sinc-local', version: 1, filename: workspace.filename, fictional: workspace.fictional, headers: workspace.headers, mapping: workspace.mapping, records: workspace.records });
}

export function restoreWorkspace(text) {
  if (new TextEncoder().encode(text).length > MAX_COPY_BYTES) throw new Error('La copia supera 40 MB. Elegí una copia más pequeña.');
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('La copia no es un JSON válido. Elegí una copia exportada desde SINC.'); }
  if (data?.format !== 'sinc-local' || data.version !== 1 || !Array.isArray(data.headers) || !data.headers.length || data.headers.length > 64 || data.headers.some(value => typeof value !== 'string' || !value.trim() || value.length > 16000) || new Set(data.headers.map(identity)).size !== data.headers.length || !Array.isArray(data.records) || !data.records.length || data.records.length > MAX_ROWS || !data.mapping || typeof data.mapping !== 'object') throw new Error('La copia no tiene el formato esperado. Elegí una copia exportada desde SINC.');
  let cellBytes = new TextEncoder().encode(data.headers.join('')).length;
  for (const record of data.records) {
    if (!Array.isArray(record?.cells) || record.cells.length !== data.headers.length || record.cells.some(value => typeof value !== 'string' || value.length > 16000) || !Number.isInteger(record.row) || record.row < 2 || record.row > MAX_ROWS + 1 || !Number.isInteger(record.line) || record.line < 1) throw new Error('La copia contiene filas no válidas. Volvé a exportarla desde el archivo original.');
    cellBytes += new TextEncoder().encode(record.cells.join('')).length;
  }
  if (cellBytes > MAX_BYTES) throw new Error('Las celdas de la copia superan los 5 MB de datos admitidos. Dividí la planilla original.');
  if (new Set(data.records.map(record => record.row)).size !== data.records.length) throw new Error('La copia contiene números de fila repetidos.');
  return buildWorkspace(data, data.mapping, data);
}

export function scopeRows(workspace, { projectId = '', capability = '', term = '' } = {}) {
  const words = normalize(term).split(' ').filter(Boolean);
  return workspace.rows.filter(row => (!projectId || row.projectId === projectId) && (!capability || row.capabilities.some(value => identity(value) === identity(capability))) && (!words.length || words.every(word => normalize([row.project, row.team, row.role, row.notes, row.resource, row.territory, row.capability].join(' ')).includes(word))));
}

export function summarize(workspace, rows = workspace.rows) {
  return { projects: unique(rows.map(row => row.projectId)).length, teams: unique(rows.map(row => row.team).filter(Boolean).map(identity)).length, capabilities: unique(rows.flatMap(row => row.capabilities).map(identity)).length, resources: unique(rows.flatMap(row => row.resources).map(identity)).length, rows: rows.length };
}

export function guidance(workspace, rows = workspace.rows) {
  if (!rows.length) return [{ field: 'scope', title: 'Ampliá la selección', text: 'Esta combinación no tiene filas. Probá con todos los proyectos o con otra capacidad antes de decidir qué datos faltan.', columns: [] }];
  const missing = field => rows.filter(row => field === 'resource' ? !row.resources.length : field === 'capability' ? !row.capabilities.length : !row[field]).length;
  const coverage = field => `${missing(field)} de ${rows.length} filas sin ${field === 'team' ? 'equipo' : field === 'capability' ? 'capacidades registradas' : field === 'resource' ? 'recurso' : 'año'}${field === 'capability' ? '' : ' registrado'}.`;
  const items = [];
  if (missing('team')) items.push({ field: 'team', title: '¿Quién estuvo detrás?', text: `${coverage('team')} Si describen una participación, añadí quién trabajó en ese proyecto.`, columns: ['Proyecto', 'Año', 'Equipo'] });
  if (missing('capability')) items.push({ field: 'capability', title: 'Buscá por lo que necesitás hacer', text: `${coverage('capability')} Añadí las capacidades que correspondan a cada fila, como accesibilidad o mediación, para buscar antecedentes por necesidad.`, columns: ['Proyecto', 'Año', 'Capacidad'] });
  if (missing('resource')) items.push({ field: 'resource', title: 'Recuperá lo que quedó', text: `${coverage('resource')} Cuando corresponda, añadí guías, plantillas o materiales vinculados. El registro no confirma permisos de reutilización.`, columns: ['Proyecto', 'Año', 'Recurso'] });
  const missingRoles = rows.filter(row => row.team && !row.role).length;
  if (missingRoles) items.push({ field: 'role', title: 'Una participación no cuenta toda la historia', text: `${missingRoles} filas con equipo no tienen función registrada. Añadí qué hizo cada equipo; su participación no demuestra todas las capacidades del proyecto.`, columns: ['Proyecto', 'Año', 'Equipo', 'Función'] });
  if (missing('year')) items.push({ field: 'year', title: 'Distinguí las ediciones', text: `${coverage('year')} Añadí el año para distinguir ediciones del mismo nombre y revisar la antigüedad de los antecedentes.`, columns: ['Proyecto', 'Año'] });
  if (!items.length) items.push({ field: 'notes', title: 'El próximo dato útil es un aprendizaje', text: 'En Notas, registrá decisiones, dificultades y qué conviene repetir. Estos datos describen lo registrado; la disponibilidad y las condiciones actuales deben confirmarse.', columns: ['Proyecto', 'Año', 'Notas'] });
  return items;
}

export function answer(workspace, input, scope = {}) {
  const text = normalize(input);
  const missing = message => ({ kind: 'missing', text: message, groups: [], rows: [] });
  if (/^(que es sinc|que hace sinc|de que se trata sinc|como funciona sinc|que es esta herramienta)$/.test(text)) return { kind: 'help', text: 'SINC recupera antecedentes de tu planilla para preparar proyectos culturales: proyectos, equipos participantes, capacidades y recursos relacionados. Esta pantalla procesa el archivo en tu navegador. Las consultas usan reglas y las filas cargadas; no hay un modelo de IA generativa.', groups: [], rows: [] };
  if (/^(como (cargo|cargar|subo|subir|importo|importar)( mis)? (datos|un csv|mi archivo|una planilla)|como preparo (el csv|mi archivo|la planilla))$/.test(text)) return { kind: 'help', text: 'Exportá tu planilla como CSV en UTF-8, con encabezados y un proyecto por fila. Podés repetir el proyecto para registrar varios equipos o recursos. Luego confirmá qué significa cada columna. Separá varias capacidades o recursos con |. Si hay distintas ediciones, añadí el año.', groups: [], rows: [] };
  if (/\b(presupuesto|financia\w*|contacto|telefono|email|disponibilidad|contrato|mejor|garant\w*|autoria|autor|autores|creo|crearon|produjo|produjeron|licencia|licencias)\b/.test(text)) return missing('Esta versión consulta antecedentes, participantes, capacidades y recursos. No verifica presupuestos, contactos, disponibilidad, autoría ni permisos de uso.');
  const genericNames = new Set('a al de del el la las los un una que quien proyecto proyectos equipo equipos recurso recursos capacidad capacidades material materiales guia guias'.split(' '));
  const mentionsName = value => {
    const name = normalize(value), query = ` ${text} `;
    if (!name || !query.includes(` ${name} `)) return false;
    // Un nombre como «Equipo» no convierte toda consulta genérica en un filtro.
    return !genericNames.has(name) || ['de', 'del', 'en', 'proyecto', 'equipo', 'recurso'].some(prefix => query.includes(` ${prefix} ${name} `));
  };
  const projectMentions = workspace.projects.filter(project => mentionsName(project.name));
  const resolved = { ...scope };
  if (projectMentions.length === 1) resolved.projectId = projectMentions[0].id;
  else if (projectMentions.length > 1) {
    const editions = projectMentions.filter(project => project.year && text.split(' ').includes(project.year));
    if (editions.length === 1) resolved.projectId = editions[0].id;
    else if (!projectMentions.some(project => project.id === scope.projectId)) return missing('Ese nombre aparece en varias ediciones. Elegí el proyecto y año en el selector para precisar la consulta.');
  }
  const namedRequest = text.match(/\b(?:del proyecto|sobre el proyecto|para el proyecto|proyecto llamado) (.+)$/)?.[1];
  if (namedRequest && !projectMentions.length) return missing('No encontré ese proyecto. Elegí uno registrado en el selector; no voy a sustituirlo por otro.');
  const mentioned = values => unique(values).filter(mentionsName);
  const capabilities = mentioned(workspace.rows.flatMap(row => row.capabilities));
  if (capabilities.length === 1 && !scope.capability) resolved.capability = capabilities[0];
  const teams = mentioned(workspace.rows.map(row => row.team).filter(Boolean));
  const resources = mentioned(workspace.rows.flatMap(row => row.resources));
  const territories = mentioned(workspace.rows.map(row => row.territory).filter(Boolean));
  // Sólo nombres registrados y un vocabulario acotado: una palabra clave no
  // basta para contestar preguntas desconocidas con resultados genéricos.
  let remainder = ` ${text} `;
  const names = unique([...projectMentions.map(project => project.name), ...capabilities, ...teams, ...resources, ...territories]).sort((a, b) => b.length - a.length);
  for (const name of names) remainder = remainder.split(` ${normalize(name)} `).join(' ');
  const vocabulary = new Set('a al algo alguna algunos anadir agregar ano anos antecedentes antecedente archivo archivos buscar busca busco capacidades capacidad cargar como completar con contiene cuantos cuantas cuanto cual cuales dato datos de debo deberia del desde el en equipo equipos es esas esos esta este estos experiencias experiencia faltan falta faltantes funciones funcion guia guias hay historial informacion la las lo los mas materiales material mostrar mostra muestra mostrarme necesito necesitamos necesidad necesidades nos notas o para participantes participaron participa participan participo participacion participar planilla plantilla plantillas poner proyecto proyectos puedo pueden que quedaron quien quienes quiero recursos recurso registrados registrado registradas registrada relacionadas relacionados relacionado resumen reutilizar reutilizables roles rol se sobre son sus tengo tiene tienen territorio todos todas tu tus un una usar ver y'.split(' '));
  const unknown = remainder.trim().split(/\s+/).filter(word => word && !vocabulary.has(word) && !workspace.rows.some(row => row.year === word));
  if (unknown.length) return missing('No puedo resolver esa pregunta con seguridad a partir del archivo. Elegí un proyecto o una capacidad en los filtros y usá una consulta de ejemplo.');
  const years = unique(workspace.rows.map(row => row.year).filter(year => year && text.split(' ').includes(year)));
  const rows = scopeRows(workspace, resolved).filter(row => (!years.length || years.includes(row.year)) && (!capabilities.length || row.capabilities.some(value => capabilities.some(name => identity(name) === identity(value)))) && (!teams.length || teams.some(name => identity(name) === identity(row.team))) && (!resources.length || row.resources.some(value => resources.some(name => identity(name) === identity(value)))) && (!territories.length || territories.some(name => identity(name) === identity(row.territory))));
  if (/\b(falta\w*|anadir|agregar|cargar|completar|poner|datos necesito)\b/.test(text)) return { kind: 'guide', text: 'Estos datos adicionales permitirían resolver más consultas. Que falten en el archivo no significa que el trabajo no se haya realizado.', groups: [], rows, scope: resolved, guidance: guidance(workspace, rows) };
  if (/\b(cuant\w*|resumen|contiene|estadistica\w*)\b/.test(text)) {
    const counts = summarize(workspace, rows);
    return { kind: 'summary', text: `En esta selección hay ${counts.projects} proyectos, ${counts.teams} equipos, ${counts.capabilities} capacidades y ${counts.resources} recursos, respaldados por ${counts.rows} filas.`, groups: [], rows, scope: resolved };
  }
  let kind;
  if (/\b(quien|quienes|equipos?|particip\w*|funciones|roles)\b/.test(text)) kind = 'teams';
  else if (/\b(recursos?|guias?|plantillas?|material(?:es)?|reutiliz\w*)\b/.test(text)) kind = 'resources';
  else if (/\b(antecedentes?|proyectos?|contexto|experiencias?|necesidad|capacidades|buscar)\b/.test(text)) kind = 'projects';
  else return { kind: 'missing', text: 'No reconocí una consulta respaldada por este archivo. Usá una pregunta de ejemplo o consultá antecedentes, participantes, recursos y datos faltantes.', groups: [], rows: [] };
  const grouped = new Map();
  const push = (key, label, row) => {
    if (!grouped.has(key)) grouped.set(key, { key, label, rows: [] });
    if (!grouped.get(key).rows.includes(row)) grouped.get(key).rows.push(row);
  };
  for (const row of rows) {
    if (kind === 'teams' && row.team) push(identity(row.team), row.team, row);
    else if (kind === 'resources') for (const resource of row.resources) push(identity(resource), resource, row);
    else if (kind === 'projects') push(row.projectId, row.project, row);
  }
  const groups = [...grouped.values()].sort((a, b) => Math.max(...b.rows.map(row => Number(row.year) || 0)) - Math.max(...a.rows.map(row => Number(row.year) || 0)) || a.label.localeCompare(b.label, 'es'));
  const label = { projects: 'antecedentes', teams: 'equipos participantes', resources: 'recursos relacionados' }[kind];
  const caveat = kind === 'teams' ? 'La participación registrada no confirma disponibilidad ni dominio de todas las capacidades del proyecto.' : kind === 'resources' ? 'Un recurso relacionado no tiene necesariamente una licencia o archivo disponible. Revisá su origen y condiciones.' : 'Cada antecedente conserva sus filas de origen. Los registros no prueban que las mismas condiciones sigan vigentes.';
  return { kind, text: groups.length ? `Encontré ${groups.length} ${label} en esta selección. ${caveat}` : `No hay ${label} registrados para esta selección. Podés ampliar los filtros o añadir esos datos.`, groups, rows, scope: resolved };
}

export function report(workspace, result, goal = '') {
  const lines = ['SINC — Preparar el próximo proyecto', goal ? `Proyecto por preparar: ${goal}` : '', `Archivo: ${workspace.filename}${workspace.fictional ? ' (ejemplo ficticio)' : ''}`, '', result.text];
  for (const group of result.groups) {
    lines.push('', group.label);
    for (const row of group.rows) lines.push(`  ${row.project}${row.year ? ` (${row.year})` : ''} · ${row.team || 'Equipo sin registrar'}${row.role ? ` · ${row.role}` : ''}${row.resource ? ` · Recurso: ${row.resource}` : ''} · Fila ${row.sourceRow}`);
  }
  if (!result.groups.length && result.rows.length) {
    lines.push('', 'Filas consultadas');
    for (const row of result.rows) lines.push(`  ${row.project}${row.year ? ` (${row.year})` : ''} · Fila ${row.sourceRow}`);
  }
  if (!['help', 'missing'].includes(result.kind)) {
    lines.push('', 'Qué datos añadir');
    for (const item of guidance(workspace, result.rows)) lines.push(`- ${item.title}: ${item.text}`);
  }
  lines.push('', 'Las respuestas describen el archivo cargado. No confirman disponibilidad, autoría individual, permisos ni condiciones actuales.');
  return lines.filter(line => line !== undefined).join('\n');
}

export const TEMPLATE = 'Proyecto,Año,Equipo,Función,Capacidad,Recurso,Territorio,Notas\r\n';
export const EXAMPLE = `${TEMPLATE}Cine de Barrio,2023,Colectivo Trama,Mediación,Mediación comunitaria,Guía de bienvenida,Barrio del Río,La convocatoria en centros vecinales tuvo buena respuesta.\r\nCine de Barrio,2023,Taller Horizonte,Accesibilidad,Accesibilidad,Lista de revisión de accesibilidad,Barrio del Río,Revisar el recorrido antes de abrir las puertas.\r\nCine de Barrio,2023,Mesa de Producción,Coordinación,Logística,Plantilla de montaje,Barrio del Río,\r\nEncuentro de Oficios,2024,Colectivo Trama,Mediación,Mediación comunitaria,Guía de bienvenida,Colina Abierta,Se adaptó la guía a un público distinto.\r\nEncuentro de Oficios,2024,Red Móvil,Montaje,Logística,Plantilla de montaje,Colina Abierta,\r\nVoces del Patio,2025,Taller Horizonte,Accesibilidad,Accesibilidad,Lista de revisión de accesibilidad,Barrio del Río,\r\nVoces del Patio,2025,Archivo Vivo,Registro,Documentación,Bitácora del proyecto,Barrio del Río,Registrar acuerdos con las personas participantes.\r\nArchivo de Verano,2025,Archivo Vivo,Registro,Documentación,Bitácora del proyecto,Colina Abierta,\r\n`;
