const textDecoder = new TextDecoder();

export function decodeCachedProtoMessage(schema, typeName, buffer) {
  const message = schema?.messages?.[cleanTypeName(typeName)];
  if (!message?.fields || !buffer?.length) return null;

  try {
    return decodeMessage(schema, message, new Uint8Array(buffer));
  } catch {
    return null;
  }
}

function decodeMessage(schema, message, bytes) {
  const result = { $typeName: message.typeName };
  const fields = new Map(message.fields.map((field) => [field.number, field]));
  let offset = 0;

  while (offset < bytes.length) {
    const tag = readVarint(bytes, offset);
    offset = tag.offset;
    const field = fields.get(Number(tag.value >> 3n));
    const wireType = Number(tag.value & 7n);
    if (!field) {
      offset = skipField(bytes, offset, wireType);
      continue;
    }

    const decoded = readField(schema, field, bytes, offset, wireType);
    offset = decoded.offset;
    if (decoded.value === undefined) continue;

    if (field.repeated) {
      result[field.name] = [...(result[field.name] ?? []), ...(Array.isArray(decoded.value) ? decoded.value : [decoded.value])];
    } else {
      result[field.name] = decoded.value;
    }
  }

  return result;
}

function readField(schema, field, bytes, offset, wireType) {
  if (wireType === 2) {
    const length = readVarint(bytes, offset);
    const start = length.offset;
    const end = start + Number(length.value);
    if (end > bytes.length) throw new Error('Invalid length-delimited field');
    const value = bytes.slice(start, end);

    if (field.kind === 'message') {
      return { offset: end, value: decodeCachedProtoMessage(schema, field.typeName, value) ?? bytesToBase64(value) };
    }
    if (field.kind === 'map') {
      return { offset: end, value: bytesToBase64(value) };
    }
    if (field.kind === 'scalar' && field.type === 'bytes') {
      return { offset: end, value: bytesToBase64(value) };
    }
    if (field.kind === 'scalar' && field.type === 'string') {
      return { offset: end, value: textDecoder.decode(value) };
    }
    if (field.repeated && isPackable(field)) {
      return { offset: end, value: decodePacked(field, value) };
    }
    return { offset: end, value: textDecoder.decode(value) };
  }

  if (wireType === 0) {
    const decoded = readVarint(bytes, offset);
    return { offset: decoded.offset, value: decodeVarintValue(schema, field, decoded.value) };
  }

  if (wireType === 1) {
    const end = offset + 8;
    if (end > bytes.length) throw new Error('Invalid fixed64 field');
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
    return {
      offset: end,
      value: field.type === 'double' ? view.getFloat64(0, true) : bigintToValue(view.getBigUint64(0, true)),
    };
  }

  if (wireType === 5) {
    const end = offset + 4;
    if (end > bytes.length) throw new Error('Invalid fixed32 field');
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 4);
    return {
      offset: end,
      value: field.type === 'float' ? view.getFloat32(0, true) : view.getUint32(0, true),
    };
  }

  return { offset: skipField(bytes, offset, wireType), value: undefined };
}

function decodePacked(field, bytes) {
  const values = [];
  let offset = 0;
  const wireType = packedWireType(field.type);
  while (offset < bytes.length) {
    const decoded = readField(null, { ...field, repeated: false }, bytes, offset, wireType);
    values.push(decoded.value);
    offset = decoded.offset;
  }
  return values;
}

function decodeVarintValue(schema, field, value) {
  if (field.kind === 'enum') {
    return schema?.enums?.[field.typeName]?.values?.find((item) => item.number === Number(value))?.name ?? Number(value);
  }
  if (field.type === 'bool') return value !== 0n;
  if (field.type === 'sint32' || field.type === 'sint64') value = (value >> 1n) ^ (-(value & 1n));
  return bigintToValue(value, field.type);
}

function bigintToValue(value, type = '') {
  if (/64/.test(type) || value > BigInt(Number.MAX_SAFE_INTEGER)) return value.toString();
  return Number(value);
}

function isPackable(field) {
  return field.kind === 'enum' || (field.kind === 'scalar' && !['string', 'bytes'].includes(field.type));
}

function packedWireType(type) {
  if (['double', 'fixed64', 'sfixed64'].includes(type)) return 1;
  if (['float', 'fixed32', 'sfixed32'].includes(type)) return 5;
  return 0;
}

function readVarint(bytes, offset) {
  let value = 0n;
  let shift = 0n;
  while (offset < bytes.length) {
    const byte = bytes[offset++];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, offset };
    shift += 7n;
    if (shift > 70n) break;
  }
  throw new Error('Invalid varint');
}

function skipField(bytes, offset, wireType) {
  if (wireType === 0) return readVarint(bytes, offset).offset;
  if (wireType === 1) return offset + 8;
  if (wireType === 2) {
    const length = readVarint(bytes, offset);
    return length.offset + Number(length.value);
  }
  if (wireType === 5) return offset + 4;
  throw new Error('Unsupported wire type');
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function cleanTypeName(typeName) {
  return String(typeName ?? '').replace(/^\.+/, '');
}
