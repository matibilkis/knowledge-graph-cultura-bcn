// Respuestas acotadas a las funciones y límites de esta demo pública.
// Los conteos y métricas se leen de los datos cargados, no de este texto.
const source = (label, href) => ({ label, href });
const topics = {
  overview: {
    text: 'SINC explora cómo conservar la memoria de los proyectos culturales: quién participó, qué capacidades tiene cada equipo y qué recursos pueden servir a otra iniciativa. Esta página permite recorrer esa información como una red, consultarla y explorar posibles equipos y recursos para proyectos nuevos. Es una demostración con datos ficticios, no un directorio de comunidades reales de Barcelona.',
    sources: [source('Propósito de SINC', '#inicio')],
    suggestions: ['¿Cómo uso esta página?', '¿Qué información contiene la base?', '¿Qué podés responder?']
  },
  usage: {
    text: 'Podés empezar por un proyecto en la lista o buscar un nombre en La red. Filtrá por proyecto, año o tipo de nodo; seleccioná un nodo para abrir su ficha. En Consultas, preguntá por participantes, capacidades, recursos o conexiones y usá «Ver vínculos» para revisar la evidencia. En Sugerencias, elegí un proyecto planificado y compará GraphSAGE con Reglas. En Datos podés descargar la red.',
    sources: [source('Explorar la red', '#espacio'), source('Consultas', '#consultas'), source('Sugerencias', '#sugerencias'), source('Datos', '#datos')],
    suggestions: ['¿Cómo leo los nodos y las líneas?', '¿Quién puede ayudar con accesibilidad?']
  },
  graph: {
    text: 'En esta herramienta, el grafo de conocimiento es una red de entidades y relaciones. Los nodos son proyectos, actores o equipos, capacidades y recursos. Las líneas registran participación, capacidades de un equipo, necesidades de un proyecto, producción o reutilización de un recurso y capacidades documentadas por ese recurso. Un camino conecta registros, pero no prueba colaboración directa ni confianza entre todos sus integrantes. Las líneas punteadas del laboratorio comparan candidatos del modelo; no son relaciones registradas.',
    sources: [source('Mapa y leyenda de relaciones', '#espacio'), source('Registrado y sugerido', '#sugerencias')],
    suggestions: ['¿Qué información contiene la base?', '¿Cómo se conectan Festival Cauce y Ronda de Oficios?']
  },
  data: {
    text: store => `La base cargada contiene ${store.ofType('project').length} proyectos, ${store.ofType('actor').length} equipos, ${store.ofType('capability').length} capacidades y ${store.ofType('resource').length} recursos: ${store.nodes.size} nodos y ${store.edges.size} relaciones. Todos son ficticios. Los territorios de la demo son ${store.data.meta.territories.join(', ')}; no son barrios reales de Barcelona. La base registra historia y necesidades de proyectos, capacidades de equipos y producción, documentación y reutilización de recursos. No contiene contactos reales, presupuestos ni financiadores.`,
    sources: [source('Red cargada (JSON)', 'data/graph.json'), source('Descargas de la base', '#datos')],
    suggestions: ['¿Qué capacidades hay en la red?', '¿Qué proyectos hay?', '¿Puedo descargar la base?']
  },
  agent: {
    text: 'Puedo explicar SINC y cómo usar esta página, y consultar los datos de esta red: proyectos, participantes, capacidades, recursos, reutilizaciones, caminos y pendientes. También puedo mostrar sugerencias experimentales para proyectos planificados. Este agente funciona con reglas locales en tu navegador; no es un modelo de lenguaje. Las respuestas sobre la herramienta usan información definida para esta demo; las consultas al grafo muestran sus registros. Si falta un dato, una entidad no está en la base o la pregunta sale de este alcance, lo indico. No consulto Internet ni otras bases.',
    sources: [source('Alcance del agente', '#consultas'), source('Datos de la demo', '#datos')],
    suggestions: ['¿De qué se trata SINC?', '¿Qué datos son ficticios?', '¿Qué límites tienen las sugerencias?']
  },
  model: {
    text: 'La GNN de esta demo es GraphSAGE: un modelo de dos capas que agrega información de los vecinos de cada nodo para puntuar posibles equipos y recursos de un proyecto planificado. El agente conversacional consulta el grafo por reglas; la GNN se usa en el laboratorio de Sugerencias. Fue entrenada en mundos sintéticos y sus resultados son hipótesis. El puntaje ordena candidatos, no es una probabilidad ni confirma una colaboración. La animación ilustra las dos rondas de agregación, sin explicar causalmente la decisión del modelo.',
    sources: [source('Método y límites del modelo', '#gnn-method-title'), source('Laboratorio de sugerencias', '#sugerencias')],
    suggestions: ['¿Cómo uso las sugerencias?', '¿El modelo es mejor que las reglas?']
  },
  suggestions: {
    text: 'En Sugerencias, elegí si buscás equipos o recursos y seleccioná un proyecto planificado. «Ordenar candidatos con» permite comparar GraphSAGE y Reglas; «Ver sugerencias» muestra el ranking. «Animar en el mapa» ilustra la agregación de GraphSAGE cuando sus pesos están disponibles. Revisá el contexto de cada candidato: la sugerencia no demuestra una participación previa ni garantiza disponibilidad o permiso de reutilización.',
    sources: [source('Controles de sugerencias', '#sugerencias')],
    suggestions: ['¿Qué es una GNN?', '¿Qué límites tienen las sugerencias?']
  },
  limits: {
    text: 'La demo usa únicamente datos ficticios. Los vínculos registrados describen esa base, no personas ni proyectos reales. Una ausencia de información no demuestra que una actividad no haya ocurrido. Las propuestas por capacidades y las sugerencias de la GNN necesitan revisión; no asignan equipos ni confirman disponibilidad, autoría individual o condiciones reales de reutilización. El experimento sintético no valida recomendaciones para comunidades reales.',
    sources: [source('Datos de demostración', '#datos'), source('Límites del experimento', '#gnn-method-title')],
    suggestions: ['¿El modelo es mejor que las reglas?', '¿Qué podés responder?']
  },
  downloads: {
    text: 'Podés descargar la red de la demo. En Datos, «Red completa» descarga los nodos y vínculos en JSON y «Base de datos» descarga las tablas en SQLite. Son datos ficticios. Los recursos del grafo son fichas de ejemplo: no hay guías reales ni archivos de esos recursos para descargar.',
    sources: [source('Descargar JSON o SQLite', '#datos')],
    suggestions: ['¿Qué información contiene la base?']
  },
  editing: {
    text: 'Esta página permite explorar y descargar la demo. No tiene formularios para agregar o editar proyectos, importar archivos, conectar otras bases ni contactar equipos. El chat tampoco modifica los datos. No hay un registro de comunidades reales de Barcelona en esta base.',
    sources: [source('Explorador de la demo', '#espacio'), source('Datos disponibles', '#datos')],
    suggestions: ['¿Cómo uso esta página?', '¿Puedo descargar la base?']
  }
};

function metrics(store) {
  const tasks = store.predictions?.tasks;
  const values = ['actor', 'resource'].map(task => [tasks?.[task]?.metrics?.gnn?.ndcgAt3, tasks?.[task]?.metrics?.baseline?.ndcgAt3]);
  if (values.some(pair => pair.some(value => !Number.isFinite(value)))) return 'No tengo métricas del experimento cargadas para comparar GraphSAGE y Reglas. Podés revisar el laboratorio de Sugerencias; no puedo afirmar qué modelo rinde mejor sin esos resultados.';
  const [actor, resource] = values;
  const conclusion = values.every(([gnn, baseline]) => gnn <= baseline) ? 'En esta evaluación, GraphSAGE no supera a las reglas en ninguno de los dos rankings.' : 'La comparación depende de la tarea; estos resultados sólo describen el experimento sintético.';
  return `NDCG@3 evalúa el orden de los tres primeros candidatos; un valor mayor indica un mejor ranking según las etiquetas del experimento. Equipos: GraphSAGE ${actor[0].toFixed(4)}, Reglas ${actor[1].toFixed(4)}. Recursos: GraphSAGE ${resource[0].toFixed(4)}, Reglas ${resource[1].toFixed(4)}. ${conclusion} Las cifras de GraphSAGE son medias de tres inicializaciones, no una garantía de calidad para redes reales.`;
}
topics.metrics = { text: metrics, sources: [source('Métricas de evaluación', '#gnn-metrics-title'), source('Resultados del experimento (JSON)', 'data/gnn-results.json')], suggestions: ['¿Qué límites tienen las sugerencias?'] };

export const agentGreeting = 'Puedo contarte de qué se trata SINC, ayudarte a usar la página y consultar proyectos, equipos, capacidades y recursos de esta red ficticia. Mis respuestas se limitan a esta herramienta y a sus datos.';

export function projectAnswer(text, store, context, hasSpecificEntity, isQuestion = false) {
  // Una entidad concreta se resuelve en el grafo, salvo preguntas explícitas
  // sobre el uso de la interfaz (por ejemplo, cómo abrir su ficha).
  const tool = /\b(sinc|herramienta|pagina|web|webpage|sitio|demo|plataforma|knowledge graph cultura bcn|cultura bcn)\b/.test(text);
  const model = /\b(gnn|graphsage|graph sage|modelo|predicciones|sugerencias)\b/.test(text);
  const asks = isQuestion || /\b(que|como|cual|cuales|por que|para que|explica|explicame|conta|contame|cuenta|cuentame|hablame|sirve|significa|funciona|puedo|puede|pueden|podes|puedes|es|son|hay|tiene|ayuda|consulta)\b/.test(text);
  let topic;
  if (/^(hola|buenas|buen dia|buenos dias|buenas tardes|buenas noches|hey)$/.test(text)) topic = 'agent';
  else if (/^(y )?(que (podes|puedes) (hacer|responder)|que puedo (preguntar|hacer)|en que (me )?(podes|puedes) ayudar|ayuda)$/.test(text)) topic = 'agent';
  else if (/^(gracias|muchas gracias|genial|perfecto|ok|vale)$/.test(text)) return { text: 'Podés seguir con otra pregunta sobre SINC o los datos de esta red.', sources: [], suggestions: ['¿Qué podés responder?'], topic: context.topic || 'agent' };
  else if (asks && /\b(descarg|export)/.test(text)) topic = 'downloads';
  else if (asks && /\b(agregar|anadir|cargar|editar|modificar|importar|conectar mi|registrar|contactar|contacto|correo|telefono)\b/.test(text) && (!hasSpecificEntity || tool)) topic = 'editing';
  else if (asks && /\b(datos|base|territorios|barrios)\b/.test(text) && /\b(real|reales|fictici\w*|sintetic\w*|barcelona|bcn|fuente|origen|provienen|contiene|hay|tiene|incluye|actualiz\w*)\b/.test(text) && !hasSpecificEntity) topic = 'data';
  else if (asks && /\b(real|reales|fictici\w*|sintetic\w*)\b/.test(text) && (tool || hasSpecificEntity || /\b(esto|datos|red|grafo)\b/.test(text))) topic = 'data';
  else if (asks && /\b(metrica\w*|ndcg\w*|auc|precision|evaluacion|benchmark)\b/.test(text) && !hasSpecificEntity) topic = 'metrics';
  else if (asks && model && /\b(mejor|peor|supera|rinde|rendimiento|compara\w*|reglas|fiable\w*|confiable\w*)\b/.test(text) && !hasSpecificEntity) topic = 'metrics';
  else if (asks && /\b(limit\w*|riesgo\w*|garanti\w*|probabilidad|segur\w*|confiar|invent\w*|alucin\w*|halucin\w*)\b/.test(text) && (tool || model || /agente|chat|puntaje|score/.test(text) || (context.topic && /^y (que limites tiene|tiene limites|es confiable|es fiable|puedo confiar)$/.test(text)))) topic = 'limits';
  else if (asks && /\b(agente|chat|asistente|responder|preguntar|preguntas|alcance|internet|llm)\b/.test(text) && !hasSpecificEntity && !/equipos?|recursos?|capacidades/.test(text)) topic = 'agent';
  else if (asks && /\b(grafo|nodos?|lineas?|aristas?|vinculos?|relaciones|colores|grafo de conocimiento|knowledge graph)\b/.test(text) && !hasSpecificEntity && /\b(que es|que son|signific\w*|represent\w*|funcion\w*|leer|leo|interpre\w*|explica\w*|sirve)\b/.test(text)) topic = 'graph';
  else if (asks && model && (!hasSpecificEntity || /\b(que es|como funciona|como se entrena|que significa)\b/.test(text))) topic = /\b(usar|uso|utiliz\w*|animar|anima\w*|donde|empezar|empiezo)\b/.test(text) ? 'suggestions' : 'model';
  else if (asks && /\b(usar|uso|utiliz\w*|naveg\w*|empez\w*|empiezo|filtr\w*|zoom|buscador|abrir|ficha|boton\w*)\b/.test(text) && (tool || /\b(mapa|red|ficha|filtro\w*|zoom|buscador|boton\w*)\b/.test(text) || /^(como empiezo|por donde empiezo)/.test(text))) topic = 'usage';
  else if (asks && !hasSpecificEntity && ((tool && /\b(que es|de que|para que|para quien|por que|objetivo|proposito|que hace|que ofrece|que puedo hacer|explica\w*|conta\w*|hablame)\b/.test(text)) || /\b(de que (se )?trata (todo )?esto|para que sirve (todo )?esto|que es (todo )?esto|memoria de (los )?proyectos|que puedo hacer con (esta|la) red|objetivo|proposito)\b/.test(text) || (/\b(este proyecto|el proyecto)\b/.test(text) && !context.projectId))) topic = 'overview';
  else if (/^(y )?(como funciona|que hace|para que sirve|como lo uso)$/.test(text)) topic = context.topic === 'model' || context.topic === 'metrics' ? 'model' : 'usage';
  if (!topic) return null;
  const entry = topics[topic];
  return { text: typeof entry.text === 'function' ? entry.text(store) : entry.text, sources: entry.sources, suggestions: entry.suggestions, topic };
}
