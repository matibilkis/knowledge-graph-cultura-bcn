import { agentGreeting, projectAnswer } from './project-knowledge.js?v=20261006-agent2';

const clean = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const unique = values => [...new Set(values)];
const planned = node => ['planned', 'planificado'].includes(node.status);

export class GraphStore {
  constructor(data, predictions = null) {
    if (!data.meta?.fictional || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new Error('La base debe estar marcada como ficticia.');
    this.data = data;
    this.predictions = predictions;
    this.nodes = new Map(data.nodes.map(node => [node.id, node]));
    this.edges = new Map(data.edges.map(edge => [edge.id, edge]));
    if (this.nodes.size !== data.nodes.length || this.edges.size !== data.edges.length) throw new Error('Hay identificadores duplicados.');
    this.adjacency = new Map(data.nodes.map(node => [node.id, []]));
    this.aliasOwners = new Map();
    for (const node of data.nodes) for (const name of [node.name, ...(node.aliases || [])]) {
      const key = clean(name);
      if (!this.aliasOwners.has(key)) this.aliasOwners.set(key, new Set());
      this.aliasOwners.get(key).add(node.id);
    }
    for (const edge of data.edges) {
      if (!this.nodes.has(edge.source) || !this.nodes.has(edge.target)) throw new Error('Hay un vínculo sin sus dos nodos.');
      this.adjacency.get(edge.source).push(edge);
      this.adjacency.get(edge.target).push(edge);
    }
  }

  ofType(type) { return this.data.nodes.filter(node => node.type === type); }
  links(id, type) { return (this.adjacency.get(id) || []).filter(edge => !type || edge.type === type); }
  other(edge, id) { return this.nodes.get(edge.source === id ? edge.target : edge.source); }
  capabilities(id) {
    return unique(this.links(id).filter(edge => ['has_capability', 'documents', 'requires'].includes(edge.type)).map(edge => this.other(edge, id)).filter(node => node.type === 'capability').map(node => node.id));
  }
  requirements(projectId) {
    const project = this.nodes.get(projectId);
    return unique([...(project?.requiredCapabilities || project?.capabilities || []), ...this.capabilities(projectId)]).filter(id => this.nodes.get(id)?.type === 'capability');
  }
  evidence(ids = [], edgeIds = []) {
    const validEdges = unique(edgeIds).filter(id => this.edges.has(id));
    return { nodeIds: unique([...ids, ...validEdges.flatMap(id => { const edge = this.edges.get(id); return [edge.source, edge.target]; })]).filter(id => this.nodes.has(id)), edgeIds: validEdges };
  }
  mentioned(query, type) {
    const text = ` ${clean(query)} `;
    const spans = node => [node.name, ...(node.aliases || [])].flatMap(name => {
      const phrase = clean(name);
      const fullName = phrase === clean(node.name);
      const specificAlias = !['actor','resource'].includes(node.type) || phrase.split(' ').length > 1;
      if (phrase.length <= 2 || !(fullName || (specificAlias && this.aliasOwners.get(phrase)?.size === 1 && !(node.type === 'project' && phrase === clean(node.format))))) return [];
      const found = [];
      for (let start = text.indexOf(` ${phrase} `); start >= 0; start = text.indexOf(` ${phrase} `, start + 1)) found.push({start, end: start + phrase.length + 1});
      return found;
    });
    const matches = this.data.nodes.map(node=>({node,spans:spans(node)})).filter(item=>item.spans.length);
    // «Mapa de permisos» es un recurso, no una petición independiente de permisos.
    const specific = matches.filter(item=>item.node.type!=='capability').flatMap(item=>item.spans);
    return matches.filter(item=>(!type || item.node.type===type) && (item.node.type!=='capability' || item.spans.some(span=>!specific.some(other=>other.start<=span.start && other.end>=span.end)))).sort((a,b)=>Math.min(...a.spans.map(span=>span.start))-Math.min(...b.spans.map(span=>span.start))).map(item=>item.node);
  }
  search(query, type, limit = 8, partial = false) {
    const text = clean(query);
    const ignored = new Set(['quien','quienes','puede','pueden','ayudar','para','con','como','que','busca','buscar','mostra','mostrar','proyecto','proyectos','equipo','equipos','recurso','recursos','necesito','quiero','el','la','los','las','una','un','de','del','en','y','me','tenemos','son','esto','todo','esta','este','esa','ese','hay','tiene','sobre','cual','cuales','informacion','saber','contame','explicame']);
    const tokens = text.split(' ').filter(token => token.length > 2 && (!ignored.has(token) || (partial && text === token)));
    if (!tokens.length) return [];
    return this.data.nodes.filter(node => !type || node.type === type).map(node => {
      const name = new Set(clean([node.name, ...(node.aliases || [])].join(' ')).split(' '));
      const body = new Set(clean([node.description, ...(node.facts || []), node.territory].join(' ')).split(' '));
      const matches = (words, token) => words.has(token) || (partial && [...words].some(word=>word.startsWith(token)));
      const score = tokens.reduce((sum, token) => sum + (matches(name,token) ? 3 : matches(body,token) ? 1 : 0), 0);
      return { node, score };
    }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.node.name.localeCompare(b.node.name, 'es')).slice(0, limit);
  }
  findActors(capabilityIds, projectId = null, limit = 6) {
    const required = capabilityIds.length ? capabilityIds : this.requirements(projectId);
    if (!required.length) return [];
    return this.ofType('actor').map(node => {
      const matched = this.capabilities(node.id).filter(id => required.includes(id));
      const evidenceEdges = this.links(node.id, 'has_capability').filter(edge => matched.includes(this.other(edge, node.id).id));
      const history = this.links(node.id, 'participated');
      const relevantHistory = history.filter(edge=>this.requirements(this.other(edge,node.id).id).some(id=>matched.includes(id))).sort((a,b)=>b.year-a.year);
      const evidence = this.evidence([node.id, ...matched], [...evidenceEdges, ...relevantHistory.slice(0, 2)].map(edge => edge.id));
      return { node, matched, history, coverage: matched.length / required.length, ...evidence };
    }).filter(item => item.matched.length).sort((a, b) => b.coverage - a.coverage || b.history.length - a.history.length || a.node.name.localeCompare(b.node.name, 'es')).slice(0, limit);
  }
  findResources(capabilityIds, projectId = null, limit = 6) {
    const required = capabilityIds.length ? capabilityIds : this.requirements(projectId);
    return this.ofType('resource').map(node => {
      const matched = this.capabilities(node.id).filter(id => required.includes(id));
      const links = this.links(node.id);
      const reused = links.filter(edge => edge.type === 'reused');
      return { node, matched, reused, ...this.evidence([node.id], links.filter(edge => ['documents','produced','reused'].includes(edge.type)).map(edge => edge.id)) };
    }).filter(item => !required.length || item.matched.length).sort((a, b) => b.matched.length - a.matched.length || b.reused.length - a.reused.length || a.node.name.localeCompare(b.node.name, 'es')).slice(0, limit);
  }
  assembleTeam(capabilityIds, projectId = null) {
    const required = capabilityIds.length ? capabilityIds : this.requirements(projectId);
    const remaining = new Set(required);
    const candidates = this.findActors(required, projectId, this.nodes.size);
    const team = [];
    while (remaining.size && team.length < 4) {
      const next = candidates.filter(item => !team.includes(item)).map(item => ({ item, gain: item.matched.filter(id => remaining.has(id)).length })).sort((a, b) => b.gain - a.gain || b.item.history.length - a.item.history.length)[0];
      if (!next?.gain) break;
      team.push(next.item);
      next.item.matched.forEach(id => remaining.delete(id));
    }
    return { team, missing: [...remaining] };
  }
  collaborators(actorId) {
    const sourceEdges = this.links(actorId,'participated');
    const projectIds = new Set(sourceEdges.map(edge=>this.other(edge,actorId).id));
    return this.ofType('actor').filter(node=>node.id!==actorId).map(node=> {
      const shared = this.links(node.id,'participated').filter(edge=>projectIds.has(this.other(edge,node.id).id));
      const projects = shared.map(edge=>this.other(edge,node.id));
      return {node,projects,...this.evidence([actorId,node.id], [...shared,...sourceEdges.filter(edge=>projects.some(project=>project.id===this.other(edge,actorId).id))].map(edge=>edge.id))};
    }).filter(item=>item.projects.length).sort((a,b)=>b.projects.length-a.projects.length || a.node.name.localeCompare(b.node.name,'es'));
  }
  shortestPath(source, target, maxDepth = 7, edgeTypes = null) {
    if (!this.nodes.has(source) || !this.nodes.has(target)) return null;
    const queue = [{ id: source, nodeIds: [source], edgeIds: [] }];
    const visited = new Set([source]);
    while (queue.length) {
      const current = queue.shift();
      if (current.id === target) return current;
      if (current.edgeIds.length >= maxDepth) continue;
      for (const edge of this.links(current.id)) {
        if(edgeTypes && !edgeTypes.includes(edge.type))continue;
        const next = this.other(edge, current.id).id;
        if (!visited.has(next)) {
          visited.add(next);
          queue.push({ id: next, nodeIds: [...current.nodeIds, next], edgeIds: [...current.edgeIds, edge.id] });
        }
      }
    }
    return null;
  }
  transfers(projectId = null) {
    const results = [];
    for (const resource of this.ofType('resource')) {
      const created = this.links(resource.id, 'produced');
      const reused = this.links(resource.id, 'reused');
      for (const origin of created) for (const destination of reused) {
        const from = this.other(origin, resource.id);
        const to = this.other(destination, resource.id);
        if (from.id !== to.id && (!projectId || [from.id, to.id].includes(projectId))) results.push({ resource, from, to, year: destination.year, ...this.evidence([from.id, resource.id, to.id], [origin.id, destination.id]) });
      }
    }
    return results.sort((a, b) => b.year - a.year);
  }
  gaps(projectId = null) {
    return this.ofType('project').filter(node => (!planned(node) || node.id === projectId) && (!projectId || node.id === projectId)).map(node => {
      const participants = this.links(node.id, 'participated').map(edge => this.other(edge, node.id));
      const covered = unique(participants.flatMap(actor => this.capabilities(actor.id)));
      const missing = this.requirements(node.id).filter(id => !covered.includes(id));
      const produced = this.links(node.id, 'produced');
      return { node, missing, noResource: produced.length === 0, ...this.evidence([node.id, ...missing], this.links(node.id).filter(edge => ['requires','participated'].includes(edge.type)).map(edge => edge.id)) };
    }).filter(item => item.noResource || item.missing.length);
  }
  projectContext(projectId) {
    const project = this.nodes.get(projectId);
    if (project?.type !== 'project') return null;
    const links = this.links(projectId);
    return { project, participants: links.filter(edge => edge.type === 'participated').map(edge => this.other(edge, projectId)), resources: links.filter(edge => ['produced','reused'].includes(edge.type)).map(edge => this.other(edge, projectId)), required: this.requirements(projectId).map(id => this.nodes.get(id)), ...this.evidence([projectId], links.map(edge => edge.id)) };
  }
  recommend(projectId, task = 'actor') {
    return (this.predictions?.tasks?.[task]?.predictions || []).filter(item => item.projectId === projectId && this.nodes.has(item.candidateId) && Number.isFinite(item.score)).sort((a, b) => b.score - a.score).map(item => ({ ...item, node: this.nodes.get(item.candidateId), ...this.evidence(item.evidenceNodeIds || [item.candidateId, projectId], item.evidenceEdgeIds || []) }));
  }
  visible({ type = 'all', query = '', projectId = '', year = '' } = {}) {
    let ids = new Set(this.data.nodes.map(node => node.id));
    if (projectId && this.nodes.has(projectId)) {
      const immediate = this.links(projectId).map(edge => this.other(edge, projectId).id);
      ids = new Set([projectId, ...immediate, ...immediate.flatMap(id => this.links(id).filter(edge => ['documents','has_capability','requires'].includes(edge.type)).map(edge => this.other(edge, id).id))]);
    }
    if (type !== 'all') ids = new Set([...ids].filter(id => this.nodes.get(id).type === type));
    if (query) {
      const matched = new Set(this.search(query, null, this.nodes.size, true).map(item => item.node.id));
      ids = new Set([...ids].filter(id => matched.has(id)));
    }
    const edges = this.data.edges.filter(edge => ids.has(edge.source) && ids.has(edge.target) && (!year || edge.year === Number(year)));
    if (year) {
      const connected = new Set(edges.flatMap(edge => [edge.source, edge.target]));
      ids = new Set([...ids].filter(id => connected.has(id) || this.nodes.get(id).year === Number(year)));
    }
    return { nodeIds: [...ids], edgeIds: edges.map(edge => edge.id) };
  }
}

export class GraphAgent {
  constructor(store) { this.store = store; this.reset(); }
  reset() { this.context = { projectId: null, entityId: null, capabilities: [], topic: null }; }
  get greeting() { return agentGreeting; }
  unavailable(text, kind = 'missing') {
    return { ...this.empty(text), kind, sources: [], suggestions: ['¿Qué podés responder?', '¿Qué información contiene la base?'] };
  }
  query(input) {
    const query = String(input).trim().slice(0, 500);
    if (!query) return this.empty('Escribí una pregunta sobre proyectos, equipos, capacidades o recursos.');
    const text = clean(query);
    const entities = this.store.mentioned(query);
    if (/\b(que significa sinc|significado de sinc|siglas de sinc)\b/.test(text)) return this.unavailable('La información de esta demo no define el significado de las siglas SINC. Sí puedo explicar el propósito de la herramienta.');
    if (/\b(quien|quienes)\b/.test(text) && /\b(creo|fundo|fundador|diseno)\b/.test(text) && /\b(sinc|herramienta|pagina|web|plataforma)\b/.test(text)) return this.unavailable('La información pública cargada en esta demo no registra quién creó la herramienta. No puedo atribuir una autoría sin ese dato.');
    if (/\b(ignora|ignore|olvida|olvidate|omite|omiti|revela|inventate|inventa)\b/.test(text) && /\b(instrucciones|reglas|limites|datos|respuesta|prompt|sistema|secreto\w*)\b/.test(text)) return this.unavailable('Mis respuestas se limitan a información de SINC y registros de esta base. No puedo inventar datos ni ampliar ese alcance por una instrucción en el chat.', 'scope');
    if (/\b(presupuesto\w*|financia\w*|financiador\w*|patrocin\w*|subvencion\w*|dinero|costo\w*|precio\w*|correo\w*|email|telefono\w*|contacto\w*|direccion postal|autor individual|autoria individual)\b/.test(text)) return this.unavailable('Esa información no está registrada en esta demo: no contiene presupuestos, financiación, contactos reales ni autoría individual. No puedo deducirla de la participación o de las capacidades de un equipo.');
    const info = projectAnswer(text, this.store, this.context, entities.some(node => node.type !== 'capability'), /[¿?]/.test(query));
    if (info) {
      this.context.topic = info.topic;
      return { ...this.empty(info.text), kind: 'project', sources: info.sources, suggestions: info.suggestions, trace: [{ tool: 'consultar_informacion_de_la_herramienta', summary: 'Respuesta basada en la información explícita de la demo y sus datos cargados.', args: { topic: info.topic } }] };
    }
    let projects = entities.filter(node => node.type === 'project');
    const territory = (this.store.data.meta.territories || []).find(name=>` ${text} `.includes(` ${clean(name)} `));
    let capabilities = entities.filter(node => node.type === 'capability').map(node => node.id);
    const follows = /^(y |tambien |lo mismo|esos|esas|estos|estas|alli|ahi)|\b(este proyecto|ese proyecto)\b/.test(text);
    const specific = entities.filter(node => node.type !== 'capability');
    const reference = /\b(ese equipo|este equipo|ese recurso|este recurso|sus capacidades|sus proyectos|sus recursos|su origen)\b/.test(text);
    if (!specific.length && reference && this.context.entityId) entities.unshift(this.store.nodes.get(this.context.entityId));
    if (reference && !entities.some(node=>node.type!=='capability')) return this.unavailable('Necesito saber a qué proyecto, equipo o recurso te referís. Indicá su nombre completo en la base.');
    projects = entities.filter(node=>node.type==='project');
    const projectId = projects[0]?.id || (follows ? this.context.projectId : null);
    if (!projects.length && projectId) projects = [this.store.nodes.get(projectId)];
    // Un destino desconocido nunca debe convertirse en una búsqueda global.
    const target = text.match(/\b(?:para|sobre|de|en)\s+((?:el |la |un |una )?(?:proyecto|festival|colectivo|equipo)\s+.+)$/)?.[1];
    const quoted = [...query.matchAll(/["“«]([^"”»]+)["”»]/g)].map(match => match[1]);
    if ((target && !this.store.mentioned(target).some(node => node.type !== 'capability') && !/^(?:(?:el|la|un|una) )?(?:proyecto|equipo)$/.test(target)) || quoted.some(name => !this.store.mentioned(name).length)) return this.unavailable('No pude identificar ese nombre en la base. Indicá el nombre completo de un proyecto, equipo o recurso de esta red; no voy a sustituirlo por otros resultados.');
    const need = text.match(/\b(?:para|con|sobre)\s+(.+)$/)?.[1];
    const genericContext = phrase => capabilities.length && /^(un|una|otro|otra|nuevo|nueva) (proyecto|encuentro|festival|sede)( nuevo| nueva)?$/.test(phrase || '');
    if (need && !this.store.mentioned(need).length && !genericContext(need) && !/^(reutilizar|empezar|comenzar|la red|esta red|la base|esta base|este proyecto|ese proyecto|ese equipo|este equipo)$/.test(need)) return this.unavailable('No reconocí una entidad o capacidad de esta base para esa necesidad. Podés consultar un proyecto de la lista o las capacidades disponibles.');
    if (need && this.store.mentioned(need,'capability').length && !this.store.mentioned(need).some(node=>node.type!=='capability')) {
      let remaining = ` ${need} `;
      const names = this.store.mentioned(need,'capability').flatMap(node=>[node.name,...(node.aliases || [])]).map(clean).sort((a,b)=>b.length-a.length);
      for (const name of names) remaining = remaining.replaceAll(` ${name} `,' ');
      remaining = remaining.replace(/\b(?:en|para) (?:un|una|otro|otra|nuevo|nueva) (?:proyecto|encuentro|festival|sede)(?: nuevo| nueva)?\s*$/,'');
      if (remaining.replace(/\b(y|e|o|de|la|el|los|las|un|una|con|para)\b/g,'').trim()) return this.unavailable('Reconocí sólo una parte de las necesidades mencionadas. No puedo afirmar cobertura de capacidades que no están en la base. Consultá las capacidades disponibles o reformulá la necesidad.');
    }
    const extraNeed = text.match(/\bcon\s+(.+)$/)?.[1];
    if (extraNeed && !this.store.mentioned(extraNeed).length && !genericContext(extraNeed) && !/^(ese equipo|este equipo|este proyecto|ese proyecto)$/.test(extraNeed)) return this.unavailable('No reconocí esa necesidad o entidad en la base. No puedo confirmar una propuesta para información que no está registrada.');
    const locationQuery = specific.reduce((value,node)=>value.replaceAll(` ${clean(node.name)} `,' entidad '),` ${text} `).trim();
    const location = locationQuery.match(/\b(?:en|del territorio|del barrio)\s+(.+?)(?=\s+(?:con|para|que)\b|$)/)?.[1];
    if (location && !territory && !this.store.mentioned(location).some(node => node.type !== 'capability') && !genericContext(location) && !/^(entidad|la red|esta red|la base|esta base|el grafo|este proyecto|ese proyecto|que proyectos.*)$/.test(location)) return this.unavailable('No identifiqué ese lugar o proyecto en esta base ficticia. La demo no contiene proyectos reales de Barcelona. Indicá un territorio o un proyecto registrado.');
    if (/\b(produjo|creo|elaboro|genero|reutilizo|uso|utilizo|participo|participaron|colaboro)\b/.test(text) && !entities.length && !projectId && !territory) return this.unavailable('Para consultar esa relación necesito el nombre de un proyecto, equipo o recurso registrado en esta base.');
    if (/cuant/.test(text) && !/\b(equipos?|actores?|recursos?|capacidades|proyectos?|nodos?|vinculos?|relaciones|aristas?)\b/.test(text)) return this.unavailable('Sólo puedo contar proyectos, equipos, capacidades, recursos y relaciones registrados en esta base.', 'scope');
    if (specific.length) {
      this.context.entityId = specific[0].id;
      this.context.projectId = specific[0].type === 'project' ? specific[0].id : null;
      this.context.capabilities = [];
      this.context.topic = null;
    }
    if (capabilities.length) this.context.capabilities = capabilities;
    if (!capabilities.length && follows) capabilities = this.context.capabilities;
    const result = { text: '', sections: [], trace: [], highlightNodeIds: [], highlightEdgeIds: [], suggestions: [], resolvedProjectId: projectId, kind: 'graph', sources: [] };
    const record = (tool, summary, args = {}) => result.trace.push({ tool, summary, args });
    const add = (title, items) => {
      result.sections.push({ title, items });
      result.highlightNodeIds.push(...items.flatMap(item => item.nodeIds || []));
      result.highlightEdgeIds.push(...items.flatMap(item => item.edgeIds || []));
    };
    record('resolver_entidades', `${entities.length} entidades identificadas; ${capabilities.length} capacidades reconocidas.`, { query, projectId, capabilities });

    if(/^(quien es|quienes son|que es|que sabes de|contame sobre|hablame de|mostra la ficha de|mostra el contexto de) /.test(text)) {
      const node=entities[0];
      result.text=node?`${node.name}: ${node.description}`:'No encontré esa entidad en la base. Podés buscar por el nombre de un proyecto, equipo, capacidad o recurso de esta red.';
      if(node)add('Ficha registrada',[{label:node.name,description:node.description,...this.store.evidence([node.id],this.store.links(node.id).map(edge=>edge.id))}]);
      if (!node) return this.unavailable('No encontré esa entidad en la base. Podés consultar SINC o el nombre completo de un proyecto, equipo, capacidad o recurso de esta red.');
      return result;
    }
    if(/ayudar con|ayuda con|capacidad de/.test(text) && !capabilities.length && !projectId) {
      return this.unavailable('No reconocí esa necesidad como una capacidad de esta base. Podés consultar permisos, accesibilidad, logística, documentación, mediación, sonido, comunicación o producción sostenible.');
    }

    const targetNode = entities.find(node => node.type !== 'capability') || (follows && this.context.entityId ? this.store.nodes.get(this.context.entityId) : null);
    if (targetNode && /\b(donde|territorio|barrio|ano|cuando|fecha|estado|version|formato|disponibilidad|completitud)\b/.test(text) && !/cuant|falta|brecha|pendiente|recurso|particip|transfer|conect|capacidad/.test(text.replace(/\b(ese recurso|este recurso)\b/g,''))) {
      const field = /donde|territorio|barrio/.test(text) ? 'territory' : /cuando|ano|fecha/.test(text) ? 'year' : /disponibilidad/.test(text) ? 'availability' : /completitud/.test(text) ? 'quality' : /version/.test(text) ? 'version' : /formato/.test(text) ? 'format' : 'status';
      if (targetNode[field] === undefined) return this.unavailable(`No hay un dato de ${ {territory:'territorio',year:'año',availability:'disponibilidad',quality:'completitud',version:'versión',format:'formato',status:'estado'}[field]} registrado para ${targetNode.name}.`);
      const value = ['availability','quality'].includes(field) ? `${Math.round(targetNode[field]*100)} / 100 (valor simulado; no garantiza condiciones reales)` : field === 'status' ? ({completed:'realizado',planned:'planificado',active:'activo',available:'disponible'}[targetNode[field]] || targetNode[field]) : targetNode[field];
      result.text = `${targetNode.name} — ${ {territory:'territorio',year:'año',availability:'disponibilidad simulada',quality:'completitud simulada',version:'versión',format:'formato',status:'estado'}[field]}: ${value}. Es un registro ficticio de la demo.`;
      record('consultar_atributo','Dato leído de la ficha registrada, sin inferir atributos ausentes.',{nodeId:targetNode.id,field});
      add('Ficha registrada',[{label:targetNode.name,description:targetNode.description,nodeIds:[targetNode.id],edgeIds:[]}]);
    } else if (/cuant|resumen|estadistic|tamano/.test(text)) {
      const noun=text.match(/\b(equipos?|actores?|recursos?|capacidades|proyectos?)\b/)?.[0];
      const type=noun?/equip|actor/.test(noun)?'actor':/recurso/.test(noun)?'resource':/capacidad/.test(noun)?'capability':'project':null;
      const explicitProject=projects[0];
      let counted=type?this.store.ofType(type):[];
      if(type && explicitProject && type!=='project')counted=unique(this.store.links(explicitProject.id).map(edge=>this.store.other(edge,explicitProject.id).id)).map(id=>this.store.nodes.get(id)).filter(node=>node.type===type);
      const actor = entities.find(node=>node.type==='actor');
      if(type && actor && type!=='actor')counted=unique(this.store.links(actor.id).map(edge=>this.store.other(edge,actor.id).id)).map(id=>this.store.nodes.get(id)).filter(node=>node.type===type);
      if (territory) counted=counted.filter(node=>node.territory===territory);
      if (capabilities.length && ['project','actor','resource'].includes(type)) counted=counted.filter(node=>capabilities.some(id=>this.store.capabilities(node.id).includes(id)));
      if(type==='project' && /planific|futuro/.test(text))counted=counted.filter(planned);
      const labels={actor:'equipos',resource:'recursos',capability:'capacidades',project:'proyectos'};
      result.text=type?`Hay ${counted.length} ${labels[type]} registrados${explicitProject && type!=='project'?` vinculados con ${explicitProject.name}`:actor && type!=='actor'?` vinculados con ${actor.name}`:territory?` con territorio ${territory}`:' en esta consulta'}${capabilities.length?` con ${capabilities.map(id=>this.store.nodes.get(id).name).join(' o ')}`:''}.`:/\b(nodos|vinculos|relaciones|aristas)\b/.test(text)?`La base ficticia contiene ${this.store.nodes.size} nodos y ${this.store.edges.size} relaciones registradas.`:`La base ficticia tiene ${this.store.ofType('project').length} proyectos, ${this.store.ofType('actor').length} equipos, ${this.store.ofType('capability').length} capacidades y ${this.store.ofType('resource').length} recursos, conectados mediante ${this.store.edges.size} vínculos.`;
      record('contar_entidades','Conteos calculados directamente sobre la base.',{type,projectId:explicitProject?.id,count:counted.length});
    } else if (/(conect|camino|relacion|ruta entre)/.test(text) && entities.filter(node => node.type !== 'capability').length >= 2) {
      const [from, to] = entities.filter(node => node.type !== 'capability');
      const path = this.store.shortestPath(from.id, to.id,7,/recurso/.test(text)?['produced','reused']:null);
      record('buscar_camino', path ? `${path.edgeIds.length} vínculos en el camino más corto.` : 'No hay un camino dentro de siete vínculos.', { source: from.id, target: to.id });
      result.text = path ? `${from.name} y ${to.name} se conectan a través de ${path.edgeIds.length} vínculos registrados. El recorrido incluye relaciones de distintos tipos; no implica que los equipos hayan colaborado directamente.` : 'No encontré un camino entre esas entidades en la base.';
      if (path) add('Camino en el grafo', [{ label: path.nodeIds.map(id => this.store.nodes.get(id).name).join(' → '), description: path.edgeIds.map(id => { const edge = this.store.edges.get(id); return `${this.store.nodes.get(edge.source).name} ${edge.label} ${this.store.nodes.get(edge.target).name} (${edge.year})`; }).join(' · '), ...path }]);
    } else if (projects.length>=2 && /recurso|memoria|aprendiz|transfer|reutiliz/.test(text)) {
      const paths=this.store.transfers().filter(item=>item.from.id===projects[0].id && item.to.id===projects[1].id);
      record('rastrear_transferencias',`${paths.length} reutilizaciones explícitas entre esos dos proyectos.`,{source:projects[0].id,target:projects[1].id});
      result.text=paths.length?`Estos recursos pasaron de ${projects[0].name} a ${projects[1].name} según los vínculos de producción y reutilización registrados.`:'No hay una reutilización explícita registrada en ese sentido entre los dos proyectos.';
      add('Transferencias registradas',paths.map(item=>({label:item.resource.name,description:`${item.from.name} → ${item.to.name} (${item.year})`,nodeIds:item.nodeIds,edgeIds:item.edgeIds})));
    } else if (projects.length && /quien|quienes|equipo|participantes/.test(text) && /trabajo|trabajaron|particip|hizo posible|ayudo|aporto/.test(text)) {
      const context=this.store.projectContext(projects[0].id);
      const edges=this.store.links(context.project.id,'participated');
      record('consultar_participacion',`${context.participants.length} equipos con participación registrada.`,{projectId:context.project.id});
      result.text=context.participants.length ? `Estos equipos tienen una participación registrada en ${context.project.name}.` : `No hay equipos participantes registrados todavía en ${context.project.name}.`;
      add('Participantes registrados',context.participants.map(node=>({label:node.name,description:node.description,...this.store.evidence([node.id,context.project.id],edges.filter(edge=>this.store.other(edge,context.project.id).id===node.id).map(edge=>edge.id))})));
    } else if (projects.length && /recurso|guia|kit|plantilla|manual|bitacora|documento/.test(text) && /produjo|creo|elaboro|genero|reutilizo|uso|utilizo/.test(text)) {
      const kind=/reutilizo|uso|utilizo/.test(text)?'reused':'produced';
      const edges=this.store.links(projects[0].id,kind);
      record('consultar_recursos_del_proyecto',`${edges.length} recursos con vínculo ${kind==='reused'?'de reutilización':'de producción'}.`,{projectId:projects[0].id,type:kind});
      result.text=`${projects[0].name} tiene ${edges.length} recursos ${kind==='reused'?'reutilizados':'producidos'} registrados.`;
      add('Recursos del proyecto',edges.map(edge=>{const node=this.store.other(edge,projects[0].id);return {label:node.name,description:node.description,...this.store.evidence([projects[0].id,node.id],[edge.id])};}));
    } else if (entities.some(node=>node.type==='resource') && /quien|origen|creo|produjo|procedencia/.test(text)) {
      const resource=entities.find(node=>node.type==='resource');
      const edges=this.store.links(resource.id,'produced');
      record('rastrear_origen',`${edges.length} proyectos de origen registrados.`,{resourceId:resource.id});
      result.text=`${resource.name} tiene su origen registrado por proyecto. La base no identifica una autoría individual.`;
      add('Proyecto de origen',edges.map(edge=>{const node=this.store.other(edge,resource.id);return {label:node.name,description:`${edge.label} ${resource.name} (${edge.year})`,...this.store.evidence([node.id,resource.id],[edge.id])};}));
    } else if (entities.some(node=>node.type==='actor') && /recurso|guia|kit|plantilla|manual|bitacora/.test(text) && /produjo|creo|uso|reutilizo|aportar|sus recursos|ese equipo|este equipo/.test(text)) {
      const actor=entities.find(node=>node.type==='actor');
      const resources=this.store.findResources(this.store.capabilities(actor.id),null,6);
      record('buscar_recursos_por_capacidades',`${resources.length} recursos priorizados por coincidencia de capacidades.`,{actorId:actor.id});
      result.text=`La base registra producción y reutilización por proyecto, no por equipo. Estos recursos documentan capacidades que también tiene ${actor.name}; esa coincidencia no prueba que los haya usado o creado.`;
      add('Recursos relacionados con sus capacidades',resources.map(item=>({label:item.node.name,description:item.node.description,nodeIds:item.nodeIds,edgeIds:item.edgeIds})));
    } else if (entities.some(node=>node.type==='actor') && /proyectos/.test(text) && /participo|particip|trabajo|trabajaron|en que|sus proyectos/.test(text)) {
      const actor=entities.find(node=>node.type==='actor');
      const edges=this.store.links(actor.id,'participated');
      record('consultar_historia',`${edges.length} proyectos con participación registrada.`,{actorId:actor.id});
      result.text=`${actor.name} tiene participación registrada en ${edges.length} proyectos.`;
      add('Historial de proyectos',edges.map(edge=>{const node=this.store.other(edge,actor.id);return {label:node.name,description:`Participación registrada en ${edge.year}.`,...this.store.evidence([actor.id,node.id],[edge.id])};}));
    } else if (territory && !projects.length && /quien|quienes|equipos/.test(text) && /trabajo|trabajaron|participaron|participo/.test(text)) {
      const localProjects=this.store.ofType('project').filter(node=>node.territory===territory);
      const edges=localProjects.flatMap(node=>this.store.links(node.id,'participated'));
      const actors=unique(edges.map(edge=>edge.source));
      record('consultar_participacion_territorial',`${actors.length} equipos con participación en proyectos de ${territory}.`,{territory});
      result.text=`${actors.length} equipos participaron en proyectos registrados en ${territory}. Muestro hasta seis equipos; su sede puede estar en otro territorio.`;
      add('Participación territorial',actors.slice(0,6).map(id=>({label:this.store.nodes.get(id).name,description:edges.filter(edge=>edge.source===id).map(edge=>this.store.nodes.get(edge.target).name).join(' · '),...this.store.evidence([id],edges.filter(edge=>edge.source===id).map(edge=>edge.id))})));
    } else if (entities.some(node=>node.type==='actor') && /colabor|trabajo con|trabajaron con|compartio|compartieron|comparte/.test(text) && !/recurso|capacidad|gnn|modelo/.test(text)) {
      const actor = entities.find(node=>node.type==='actor');
      const collaborators = this.store.collaborators(actor.id);
      record('buscar_coparticipaciones',`${collaborators.length} equipos compartieron proyectos con ${actor.name}.`,{actorId:actor.id});
      result.text = `${collaborators.length} equipos compartieron proyectos con ${actor.name}. Esto registra participación en una misma iniciativa; no permite afirmar una relación directa de confianza.`;
      add('Proyectos compartidos',collaborators.slice(0,6).map(item=>({label:item.node.name,description:item.projects.map(node=>node.name).join(' · '),nodeIds:item.nodeIds,edgeIds:item.edgeIds})));
    } else if (/gnn|graph neural|predic|modelo|sugerencia aprendida/.test(text) || (/recomenda|sugeri|sugerir/.test(text) && projects.some(planned))) {
      const task = /recurso|guia|document|kit/.test(text) ? 'resource' : 'actor';
      const chosen = projects[0] || this.store.ofType('project').find(planned);
      const recommendations = chosen ? this.store.recommend(chosen.id, task) : [];
      record('consultar_modelo', `${recommendations.length} candidatos calculados por la GNN para ${chosen?.name || 'ningún proyecto'}.`, { projectId: chosen?.id, task });
      result.text = recommendations.length ? `Estas son sugerencias del modelo para ${chosen.name}. Son puntuaciones relativas aprendidas en mundos sintéticos, no vínculos observados ni probabilidades validadas con datos reales.` : 'El modelo tiene resultados para los proyectos planificados. Elegí uno de ellos en el laboratorio GNN.';
      add('Sugerencias del modelo', recommendations.slice(0, 4).map(item => ({ label: item.node.name, description: item.reason || 'Puntuación obtenida por el modelo entrenado.', score: item.score, nodeIds: item.nodeIds, edgeIds: item.edgeIds })));
    } else if (/falta|faltan|hueco|brecha|sin document|pendiente/.test(text)) {
      const gaps = this.store.gaps(projects[0]?.id);
      record('auditar_cobertura', `${gaps.length} proyectos con información o cobertura pendiente en la base.`, { projectId: projects[0]?.id || null });
      result.text = gaps.length ? 'Encontré estos pendientes en lo que está registrado. La ausencia de un dato no demuestra que el trabajo no se haya realizado.' : 'En los proyectos consultados hay recursos y cobertura registrados para las capacidades requeridas.';
      add('Pendientes para verificar', gaps.slice(0, 6).map(item => ({ label: item.node.name, description: [item.noResource ? 'No tiene un recurso producido registrado.' : '', item.missing.length ? `Sin equipo registrado para: ${item.missing.map(id => this.store.nodes.get(id).name).join(', ')}.` : ''].filter(Boolean).join(' '), nodeIds: item.nodeIds, edgeIds: item.edgeIds })));
    } else if ((/aprendiz|transfer|paso de|quedo/.test(text) || (/reutiliz|memoria/.test(text) && !capabilities.length) || (/memoria/.test(text) && !/equipo|quien|capacidad|necesito/.test(text))) && !/equipo|quien/.test(text) && !(projects.some(planned) && /recurso|guia|kit|plantilla/.test(text))) {
      const paths = this.store.transfers(projects[0]?.id);
      record('rastrear_transferencias', `${paths.length} reutilizaciones explícitas encontradas.`, { projectId: projects[0]?.id || null });
      result.text = paths.length ? `Hay ${paths.length} casos de reutilización registrados${projects[0] ? ` vinculados con ${projects[0].name}` : ' entre proyectos'}. Cada resultado conserva el origen del recurso y dónde se usó después.` : 'No hay reutilizaciones explícitas registradas para ese proyecto.';
      add('De una experiencia a otra', paths.slice(0, 6).map(item => ({ label: item.resource.name, description: `${item.from.name} → ${item.to.name} (${item.year})`, nodeIds: item.nodeIds, edgeIds: item.edgeIds })));
    } else if (/equipos? y recursos?|equipos? con recursos?/.test(text) && (capabilities.length || projectId)) {
      const required=capabilities.length?capabilities:this.store.requirements(projectId);
      const composition=this.store.assembleTeam(required,projectId);
      const resources=this.store.findResources(required,projectId,4);
      record('componer_equipo',`${composition.team.length} equipos propuestos para cubrir ${required.length} capacidades.`,{capabilities:required,projectId});
      record('buscar_recursos',`${resources.length} recursos compatibles encontrados.`,{capabilities:required,projectId});
      result.text=`Esta combinación reúne ${composition.team.length} equipos y ${resources.length} recursos con experiencia o contenido compatible. Confirmá disponibilidad y condiciones de reutilización.${composition.missing.length?` Faltan capacidades: ${composition.missing.map(id=>this.store.nodes.get(id).name).join(', ')}.`:''}`;
      add('Combinación de equipos',composition.team.map(item=>({label:item.node.name,description:item.matched.map(id=>this.store.nodes.get(id).name).join(' · '),nodeIds:item.nodeIds,edgeIds:item.edgeIds})));
      add('Recursos para comenzar',resources.map(item=>({label:item.node.name,description:item.node.description,nodeIds:item.nodeIds,edgeIds:item.edgeIds})));
    } else if (/recurso|guia|kit|plantilla|manual|bitacora|documento/.test(text)) {
      const fromProject=!capabilities.length && projectId;
      const allResources = this.store.findResources(capabilities, projectId,this.store.nodes.size);
      const resources=allResources.slice(0,6);
      record('buscar_recursos', `${allResources.length} recursos compatibles; ${resources.length} priorizados en la respuesta.`, { capabilities, projectId });
      result.text = resources.length ? `Encontré ${allResources.length} recursos${fromProject ? ` relacionados con las necesidades de ${this.store.nodes.get(projectId).name}` : ' compatibles con la consulta'}${allResources.length>resources.length?`; muestro los ${resources.length} primeros`:''}. Revisá su contexto antes de reutilizarlos.` : 'No encontré recursos documentados para esas capacidades.';
      add('Recursos reutilizables', resources.map(item => ({ label: item.node.name, description: `${item.node.description} Reutilizaciones registradas: ${item.reused.length}.`, nodeIds: item.nodeIds, edgeIds: item.edgeIds })));
    } else if (/que capacidades|cuales capacidades|lista de capacidades|que sabe hacer|que puede hacer|sus capacidades|que necesita|que requiere|que necesidades/.test(text)) {
      const actor = entities.find(node => node.type === 'actor');
      const ids = actor ? this.store.capabilities(actor.id) : projectId ? this.store.requirements(projectId) : this.store.ofType('capability').map(node=>node.id);
      record('listar_capacidades', `${ids.length} capacidades registradas.`, { projectId, actorId: actor?.id });
      result.text = `Estas son las capacidades${actor ? ` de ${actor.name}` : projectId ? ` requeridas por ${this.store.nodes.get(projectId).name}` : ' disponibles en la red'}.`;
      add('Capacidades', ids.map(id=>({label:this.store.nodes.get(id).name,description:this.store.nodes.get(id).description,...this.store.evidence([id,actor?.id || projectId].filter(Boolean),this.store.links(id).filter(edge=>edge.source===(actor?.id || projectId)).map(edge=>edge.id))})));
    } else if (/que proyectos|cuales proyectos|proyectos con|proyectos necesitan|proyectos requieren|proyectos comparten|proyectos planificados|lista de proyectos/.test(text)) {
      const matches = this.store.ofType('project').filter(node=> (!territory || node.territory===territory) && (!capabilities.length || capabilities.some(id=>this.store.requirements(node.id).includes(id))) && (!/planific|futuro/.test(text) || planned(node)));
      record('buscar_proyectos', `${matches.length} proyectos encontrados.`, {capabilities,plannedOnly:/planific|futuro/.test(text)});
      result.text = `Encontré ${matches.length} proyectos${capabilities.length ? ' con esas necesidades registradas' : ' en la base'}.`;
      add('Proyectos',matches.slice(0,8).map(node=>({label:node.name,description:`${node.description} ${node.year || ''}`, ...this.store.evidence([node.id],this.store.links(node.id,'requires').map(edge=>edge.id))})));
    } else if (/\b(ayud\w*|equipos?|necesito|organizar|busca\w*|experiencia|capacidades|resolv\w*|coordinar)\b/.test(text) && (capabilities.length || projectId) && !/\b(invento|descubrio|fundador|fundo)\b/.test(text)) {
      const fromProject=!capabilities.length && projectId;
      if (!capabilities.length && projectId) capabilities = this.store.requirements(projectId);
      const composition = /arma|forma|equipo para/.test(text) && capabilities.length > 1 ? this.store.assembleTeam(capabilities, projectId) : null;
      const allCandidates = this.store.findActors(capabilities, projectId,this.store.nodes.size);
      const candidates = composition?.team || allCandidates.slice(0,6);
      record('buscar_capacidades', `${allCandidates.length} equipos compatibles; ${candidates.length} en la ${composition?'combinación propuesta':'respuesta'}.`, { capabilities, projectId });
      result.text = candidates.length ? `${composition ? 'Esta combinación de equipos cubre' : 'Estos equipos tienen'} capacidades registradas${fromProject ? ` requeridas por ${this.store.nodes.get(projectId).name}` : ` en ${capabilities.map(id => this.store.nodes.get(id).name).join(', ')}`}.${!composition && allCandidates.length>candidates.length?` Muestro ${candidates.length} de ${allCandidates.length} equipos compatibles.`:''} La disponibilidad debe confirmarse; esta consulta verifica experiencia, no asigna personas.${composition?.missing.length ? ` Quedan sin cubrir: ${composition.missing.map(id => this.store.nodes.get(id).name).join(', ')}.` : ''}` : 'Para buscar un equipo necesito una capacidad o un proyecto. Podés pedir accesibilidad, permisos, logística, mediación o documentación.';
      add('Equipos con experiencia registrada', candidates.map(item => ({ label: item.node.name, description: `${item.matched.map(id => this.store.nodes.get(id).name).join(' · ')}. Participaciones previas: ${item.history.length}. Cubre ${item.matched.length} de ${capabilities.length} capacidades consultadas.`, nodeIds: item.nodeIds, edgeIds: item.edgeIds })));
      if (candidates.length) result.suggestions.push(projectId ? `¿Qué recursos sirven para ${this.store.nodes.get(projectId).name}?` : `¿Qué recursos hay para ${capabilities.map(id => this.store.nodes.get(id).name).join(' y ')}?`);
    } else if (projects.length && /\b(contexto|ficha|descripcion|informacion|que es|de que|trata|mostra|mostrar|ver|contame|explica\w*)\b/.test(text)) {
      const context = this.store.projectContext(projects[0].id);
      record('abrir_proyecto', `${context.participants.length} equipos y ${context.resources.length} recursos relacionados.`, { projectId });
      result.text = `${context.project.name}: ${context.project.description}`;
      add('Contexto del proyecto', [{ label: context.project.name, description: `Capacidades requeridas: ${context.required.map(node => node.name).join(', ') || 'sin registro'}. Equipos: ${context.participants.length}. Recursos: ${context.resources.length}.`, nodeIds: context.nodeIds, edgeIds: context.edgeIds }]);
      result.suggestions.push(`Buscá un equipo para ${context.project.name}`, `¿Qué recursos podemos reutilizar para ${context.project.name}?`);
    } else {
      const searchRequest = /^(busca|buscar|buscame|mostra|mostrar|encontra|encontrar|lista)\b/.test(text) || entities.length || (!/\b(que|como|quien|cual|por|donde|cuando)\b/.test(text) && text.split(' ').length <= 5);
      const matches = searchRequest ? this.store.search(query) : [];
      record('buscar_entidades', `${matches.length} coincidencias de nombres, capacidades y descripciones.`, { query });
      if (!matches.length || (!/^(busca|buscar|buscame|mostra|mostrar|encontra|encontrar|lista)\b/.test(text) && /\b(que|como|quien|cual|por|donde|cuando)\b/.test(text))) return this.unavailable('No tengo una respuesta respaldada para esa pregunta. Mi alcance es SINC, el uso de esta página y los registros de su grafo ficticio. Podés reformularla con un nombre o una consulta concreta de la red.', 'scope');
      result.text = 'Encontré estas entidades por coincidencia de búsqueda. Esto no responde ni confirma otros datos de la pregunta: podés abrir una ficha o consultar sus capacidades, recursos y conexiones.';
      add('Coincidencias en la base', matches.map(item => ({ label: item.node.name, description: item.node.description, nodeIds: [item.node.id], edgeIds: [] })));
    }
    result.highlightNodeIds = unique(result.highlightNodeIds);
    result.highlightEdgeIds = unique(result.highlightEdgeIds);
    result.sections = result.sections.filter(section => section.items.length);
    return result;
  }
  empty(text) { return { text, sections: [], trace: [], highlightNodeIds: [], highlightEdgeIds: [], suggestions: [] }; }
}

export { clean as normalizeText, planned as isPlanned };
