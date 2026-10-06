function linear(input, layer, activation = false) {
  if (!Array.isArray(layer.weight) || !Array.isArray(layer.bias) || layer.weight.length !== layer.bias.length) throw new Error('Capa del modelo inválida.');
  return layer.weight.map((row, i) => {
    if (row.length !== input.length) throw new Error('Dimensiones del modelo incompatibles.');
    let value = layer.bias[i];
    for (let j = 0; j < input.length; j++) value += row[j] * input[j];
    return activation ? Math.max(0, value) : value;
  });
}
function aggregate(features, neighbors) {
  return features.map((feature, i) => {
    const mean = new Array(feature.length).fill(0);
    for (const neighbor of neighbors[i]) for (let j = 0; j < mean.length; j++) mean[j] += features[neighbor][j];
    if (neighbors[i].length) for (let j = 0; j < mean.length; j++) mean[j] /= neighbors[i].length;
    return [...feature, ...mean];
  });
}
const sigmoid = value => value >= 0 ? 1 / (1 + Math.exp(-value)) : Math.exp(value) / (1 + Math.exp(value));

export class GraphSAGERuntime {
  constructor(model, input) {
    this.models = model.models;
    this.input = input;
    if(model.meta?.graphSha256 && input.meta?.graphSha256 && model.meta.graphSha256!==input.meta.graphSha256) throw new Error('Los pesos y los datos pertenecen a grafos distintos.');
    if (!this.models?.actor || !this.models?.resource || !Array.isArray(input.nodeIds) || input.nodeIds.length !== input.features.length || input.nodeIds.length !== input.neighbors.length) throw new Error('Exportación de GNN incompleta.');
    this.indices = new Map(input.nodeIds.map((id, index) => [id, index]));
    if (this.indices.size !== input.nodeIds.length || input.features.some(row => !row.every(Number.isFinite)) || input.neighbors.some(row => row.some(index => !Number.isInteger(index) || index < 0 || index >= input.nodeIds.length))) throw new Error('Datos de inferencia inválidos.');
    this.embeddings = new Map();
  }
  encode(task) {
    if (!this.embeddings.has(task)) {
      const model = this.models[task];
      if (!model) throw new Error('Tarea desconocida.');
      const hidden = aggregate(this.input.features, this.input.neighbors).map(row => linear(row, model.sage1, true));
      const embedding = aggregate(hidden, this.input.neighbors).map(row => linear(row, model.sage2, true));
      this.embeddings.set(task, embedding);
    }
    return this.embeddings.get(task);
  }
  score(task, candidateId, projectId) {
    const candidateIndex = this.indices.get(candidateId);
    const projectIndex = this.indices.get(projectId);
    if (candidateIndex === undefined || projectIndex === undefined) throw new Error('Nodo ausente en los datos del modelo.');
    const model = this.models[task];
    const embedding = this.encode(task);
    const a = embedding[candidateIndex], b = embedding[projectIndex];
    const pair = [...a, ...b, ...a.map((value, i) => value * b[i]), ...a.map((value, i) => Math.abs(value - b[i]))];
    const hidden = linear(pair, model.decoder1, true);
    return sigmoid(linear(hidden, model.decoder2)[0]);
  }
  rank(task, projectId, candidateIds) {
    return candidateIds.map(candidateId => ({ candidateId, score: this.score(task, candidateId, projectId) })).sort((a,b)=>b.score-a.score);
  }
  receptiveField(nodeIds, hops = 2) {
    let frontier = nodeIds.map(id=>this.indices.get(id)).filter(index=>index!==undefined);
    const visited = new Set(frontier);
    for(let depth=0;depth<hops;depth++) {
      const next = new Set(frontier.flatMap(index=>this.input.neighbors[index]));
      frontier = [...next].filter(index=>!visited.has(index));
      frontier.forEach(index=>visited.add(index));
    }
    return [...visited].map(index=>this.input.nodeIds[index]);
  }
}
