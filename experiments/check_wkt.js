
import { file_google_protobuf_empty, file_google_protobuf_timestamp } from '@bufbuild/protobuf/wkt';

console.log('Investigating WKT DescFile structure...');

console.log('file_google_protobuf_empty:');
console.log('  kind:', file_google_protobuf_empty.kind);
console.log('  name:', file_google_protobuf_empty.name);
console.log('  has .proto:', 'proto' in file_google_protobuf_empty);
console.log('  keys:', Object.keys(file_google_protobuf_empty).slice(0, 10));

if (file_google_protobuf_empty.proto) {
  console.log('  proto.$typeName:', file_google_protobuf_empty.proto.$typeName);
}

console.log('\nfile_google_protobuf_timestamp:');
console.log('  kind:', file_google_protobuf_timestamp.kind);
console.log('  name:', file_google_protobuf_timestamp.name);
console.log('  has .proto:', 'proto' in file_google_protobuf_timestamp);
