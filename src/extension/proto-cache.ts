export function createProtoServiceCacheEntry(captured: {
  service?: { typeName?: string; methods?: Array<Record<string, unknown>> };
  schema?: Record<string, unknown>;
  requestType?: string;
  responseType?: string;
}) {
  const methods: Record<string, Record<string, unknown>> = {};
  const serviceName = captured.service?.typeName;
  if (!serviceName) return null;

  for (const definition of captured.service?.methods ?? []) {
    const name = String(definition.name ?? '');
    if (!name) continue;
    methods[`/${serviceName}/${name}`] = {
      method: {
        name,
        localName: definition.localName ?? name,
        clientStreaming: Boolean(definition.clientStreaming),
        serverStreaming: Boolean(definition.serverStreaming),
      },
      requestType: definition.inputType ?? captured.requestType,
      responseType: definition.outputType ?? captured.responseType,
    };
  }

  return {
    service: captured.service,
    schema: captured.schema ?? { messages: {}, enums: {} },
    methods,
    updatedAt: new Date().toISOString(),
  };
}

export function findCachedProtoMetadata(cache: Record<string, any> | null, endpoint: string) {
  if (!cache || !endpoint) return null;

  for (const entry of Object.values(cache)) {
    const methodMetadata = entry?.methods?.[endpoint]
      ?? Object.entries(entry?.methods ?? {}).find(([path]) => endpoint.endsWith(path))?.[1];
    if (!methodMetadata) continue;
    return {
      service: entry.service,
      schema: entry.schema,
      ...methodMetadata,
    };
  }

  return null;
}
