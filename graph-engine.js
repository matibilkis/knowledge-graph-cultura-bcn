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
    const positions = node => [node.name, ...(node.aliases || [])].flatMap(name => {
      const phrase = clean(name);
      const fullName = phrase === clean(node.name);
      const specificAlias = !['actor','resource'].includes(node.type) || phrase.split(' ').length > 1;
      return phrase.length > 2 && (fullName || (specificAlias && this.aliasOwners.get(phrase)?.size === 1 && !(node.type === 'project' && phrase === clean(node.format)))) && text.includes(` ${phrase} `) ? [text.indexOf(` ${phrase} `)] : [];
    });
    return this.data.nodes.filter(node => (!type || node.type === type) && positions(node).length).sort((a,b)=>Math.min(...positions(a))-Math.min(...positions(b)));
  }
  search(query, type, limit = 8) {
    const text = clean(query);
    const ignored = new Set(['quien','quienes','puede','pueden','ayudar','para','con','como','que','busca','buscar','mostra','mostrar','proyecto','proyectos','equipo','equipos','recurso','recursos','necesito','quiero','el','la','los','las','una','un','de','del','en','y','me','tenemos']);
    const tokens = text.split(' ').filter(token => token.length > 2 && !ignored.has(token));
    if (!tokens.length) return [];
    return this.data.nodes.filter(node => !type || node.type === type).map(node => {
      const name = clean([node.name, ...(node.aliases || [])].join(' '));
      const body = clean([node.description, ...(node.facts || []), node.territory].join(' '));
      const score = tokens.reduce((sum, token) => sum + (name.includes(token) ? 3 : body.includes(token) ? 1 : 0), 0);
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
      const matched = new Set(this.search(query, null, this.nodes.size).map(item => item.node.id));
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
  reset() { this.context = { projectId: null, capabilities: [] }; }
  query(input) {
    const query = String(input).trim().slice(0, 500);
    if (!query) return this.empty('Escribí una pregunta sobre proyectos, equipos, capacidades o recursos.');
    const text = clean(query);
    const entities = this.store.mentioned(query);
    const projects = entities.filter(node => node.type === 'project');
    const territory = (this.store.data.meta.territories || []).find(name=>` ${text} `.includes(` ${clean(name)} `));
    let capabilities = entities.filter(node => node.type === 'capability').map(node => node.id);
    if (!capabilities.length) capabilities = this.store.search(query, 'capability', 3).filter(item => item.score >= 3).map(item => item.node.id);
    const follows = /^(y |tambien |lo mismo|esos|esas|estos|estas|alli|ahi)|\b(este proyecto|ese proyecto)\b/.test(text);
    const projectId = projects[0]?.id || (follows ? this.context.projectId : null);
    if (projects.length) this.context.projectId = projects[0].id;
    if (capabilities.length) this.context.capabilities = capabilities;
    if (!capabilities.length && follows) capabilities = this.context.capabilities;
    const result = { text: '', sections: [], trace: [], highlightNodeIds: [], highlightEdgeIds: [], suggestions: [], resolvedProjectId: projectId };
    const record = (tool, summary, args = {}) => result.trace.push({ tool, summary, args });
    const add = (title, items) => {
      result.sections.push({ title, items });
      result.highlightNodeIds.push(...items.flatMap(item => item.nodeIds || []));
      result.highlightEdgeIds.push(...items.flatMap(item => item.edgeIds || []));
    };
    record('resolver_entidades', `${entities.length} entidades identificadas; ${capabilities.length} capacidades reconocidas.`, { query, projectId, capabilities });

    if(/^(quien es|quienes son|que es) /.test(text)) {
      const node=entities[0];
      result.text=node?`${node.name}: ${node.description}`:'No encontré esa entidad en la base. Podés buscar por el nombre de un proyecto, equipo, capacidad o recurso de esta red.';
      if(node)add('Ficha registrada',[{label:node.name,description:node.description,...this.store.evidence([node.id],this.store.links(node.id).map(edge=>edge.id))}]);
      return result;
    }
    if(/ayudar con|ayuda con|capacidad de/.test(text) && !capabilities.length) {
      result.text='No reconocí esa necesidad como una capacidad de esta base. Podés consultar permisos, accesibilidad, logística, documentación, mediación, sonido, comunicación o producción sostenible.';
      return result;
    }

    if (/cuant|resumen|estadistic|tamano/.test(text)) {
      const type=/equip|actor/.test(text)?'actor':/recurso/.test(text)?'resource':/capacidad/.test(text)?'capability':/proyecto/.test(text)?'project':null;
      const explicitProject=projects[0];
      let counted=type?this.store.ofType(type):[];
      if(type && explicitProject && type!=='project')counted=unique(this.store.links(explicitProject.id).map(edge=>this.store.other(edge,explicitProject.id).id)).map(id=>this.store.nodes.get(id)).filter(node=>node.type===type);
      if(type==='project' && /planific|futuro/.test(text))counted=counted.filter(planned);
      const labels={actor:'equipos',resource:'recursos',capability:'capacidades',project:'proyectos'};
      result.text=type?`Hay ${counted.length} ${labels[type]} registrados${explicitProject && type!=='project'?` vinculados con ${explicitProject.name}`:' en esta consulta'}.`:`La base ficticia tiene ${this.store.ofType('project').length} proyectos, ${this.store.ofType('actor').length} equipos, ${this.store.ofType('capability').length} capacidades y ${this.store.ofType('resource').length} recursos, conectados mediante ${this.store.edges.size} vínculos.`;
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
    } else if (projects.length && /quien|quienes|equipo/.test(text) && /trabajo|trabajaron|participo|participaron|hizo posible|ayudo|aporto/.test(text)) {
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
    } else if (entities.some(node=>node.type==='actor') && /recurso|guia|kit|plantilla|manual|bitacora/.test(text) && /produjo|creo|uso|reutilizo|aportar/.test(text)) {
      const actor=entities.find(node=>node.type==='actor');
      const resources=this.store.findResources(this.store.capabilities(actor.id),null,6);
      record('buscar_recursos_por_capacidades',`${resources.length} recursos priorizados por coincidencia de capacidades.`,{actorId:actor.id});
      result.text=`La base registra producción y reutilización por proyecto, no por equipo. Estos recursos documentan capacidades que también tiene ${actor.name}; esa coincidencia no prueba que los haya usado o creado.`;
      add('Recursos relacionados con sus capacidades',resources.map(item=>({label:item.node.name,description:item.node.description,nodeIds:item.nodeIds,edgeIds:item.edgeIds})));
    } else if (entities.some(node=>node.type==='actor') && /proyectos/.test(text) && /participo|particip|trabajo|trabajaron|en que/.test(text)) {
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
    } else if (/que capacidades|cuales capacidades|lista de capacidades/.test(text)) {
      const actor = entities.find(node => node.type === 'actor');
      const ids = actor ? this.store.capabilities(actor.id) : projectId ? this.store.requirements(projectId) : this.store.ofType('capability').map(node=>node.id);
      record('listar_capacidades', `${ids.length} capacidades registradas.`, { projectId, actorId: actor?.id });
      result.text = `Estas son las capacidades${actor ? ` de ${actor.name}` : projectId ? ` requeridas por ${this.store.nodes.get(projectId).name}` : ' disponibles en la red'}.`;
      add('Capacidades', ids.map(id=>({label:this.store.nodes.get(id).name,description:this.store.nodes.get(id).description,...this.store.evidence([id,actor?.id || projectId].filter(Boolean),this.store.links(id).filter(edge=>edge.source===(actor?.id || projectId)).map(edge=>edge.id))})));
    } else if (/que proyectos|cuales proyectos|proyectos con|proyectos necesitan|proyectos requieren|proyectos comparten|proyectos planificados/.test(text)) {
      const matches = this.store.ofType('project').filter(node=> (!capabilities.length || capabilities.some(id=>this.store.requirements(node.id).includes(id))) && (!/planific|futuro/.test(text) || planned(node)));
      record('buscar_proyectos', `${matches.length} proyectos encontrados.`, {capabilities,plannedOnly:/planific|futuro/.test(text)});
      result.text = `Encontré ${matches.length} proyectos${capabilities.length ? ' con esas necesidades registradas' : ' en la base'}.`;
      add('Proyectos',matches.slice(0,8).map(node=>({label:node.name,description:`${node.description} ${node.year || ''}`, ...this.store.evidence([node.id],this.store.links(node.id,'requires').map(edge=>edge.id))})));
    } else if (/quien|quienes|equipo|ayud|capacidad|hacer|necesito|organizar/.test(text) || capabilities.length) {
      const fromProject=!capabilities.length && projectId;
      if (!capabilities.length && projectId) capabilities = this.store.requirements(projectId);
      const composition = /arma|forma|equipo para/.test(text) && capabilities.length > 1 ? this.store.assembleTeam(capabilities, projectId) : null;
      const allCandidates = this.store.findActors(capabilities, projectId,this.store.nodes.size);
      const candidates = composition?.team || allCandidates.slice(0,6);
      record('buscar_capacidades', `${allCandidates.length} equipos compatibles; ${candidates.length} en la ${composition?'combinación propuesta':'respuesta'}.`, { capabilities, projectId });
      result.text = candidates.length ? `${composition ? 'Esta combinación de equipos cubre' : 'Estos equipos tienen'} capacidades registradas${fromProject ? ` requeridas por ${this.store.nodes.get(projectId).name}` : ` en ${capabilities.map(id => this.store.nodes.get(id).name).join(', ')}`}.${!composition && allCandidates.length>candidates.length?` Muestro ${candidates.length} de ${allCandidates.length} equipos compatibles.`:''} La disponibilidad debe confirmarse; esta consulta verifica experiencia, no asigna personas.${composition?.missing.length ? ` Quedan sin cubrir: ${composition.missing.map(id => this.store.nodes.get(id).name).join(', ')}.` : ''}` : 'Para buscar un equipo necesito una capacidad o un proyecto. Podés pedir accesibilidad, permisos, logística, mediación o documentación.';
      add('Equipos con experiencia registrada', candidates.map(item => ({ label: item.node.name, description: `${item.matched.map(id => this.store.nodes.get(id).name).join(' · ')}. Participaciones previas: ${item.history.length}. Cubre ${item.matched.length} de ${capabilities.length} capacidades consultadas.`, nodeIds: item.nodeIds, edgeIds: item.edgeIds })));
      if (candidates.length) result.suggestions.push(projectId ? `¿Qué recursos sirven para ${this.store.nodes.get(projectId).name}?` : `¿Qué recursos hay para ${capabilities.map(id => this.store.nodes.get(id).name).join(' y ')}?`);
    } else if (projects.length) {
      const context = this.store.projectContext(projects[0].id);
      record('abrir_proyecto', `${context.participants.length} equipos y ${context.resources.length} recursos relacionados.`, { projectId });
      result.text = `${context.project.name}: ${context.project.description}`;
      add('Contexto del proyecto', [{ label: context.project.name, description: `Capacidades requeridas: ${context.required.map(node => node.name).join(', ') || 'sin registro'}. Equipos: ${context.participants.length}. Recursos: ${context.resources.length}.`, nodeIds: context.nodeIds, edgeIds: context.edgeIds }]);
      result.suggestions.push(`Buscá un equipo para ${context.project.name}`, `¿Qué recursos podemos reutilizar para ${context.project.name}?`);
    } else {
      const matches = this.store.search(query);
      record('buscar_entidades', `${matches.length} coincidencias de nombres, capacidades y descripciones.`, { query });
      result.text = matches.length ? 'Encontré estas entidades. Podés abrir su ficha o preguntar por sus equipos, recursos y conexiones.' : 'No encontré esa información en el grafo. Probá con un nombre de proyecto o una necesidad concreta; puedo consultar capacidades, recursos, caminos y pendientes.';
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
