
import { createFileRegistry, fromBinary, create } from '@bufbuild/protobuf';
import { 
  file_google_protobuf_empty, 
  file_google_protobuf_timestamp,
  file_google_protobuf_descriptor,
  FileDescriptorProtoSchema, 
  FileDescriptorSetSchema 
} from '@bufbuild/protobuf/wkt';

console.log('Testing WKT proto names...');

const WKT_FILES = new Map([
  ['google/protobuf/timestamp.proto', file_google_protobuf_timestamp],
  ['google/protobuf/empty.proto', file_google_protobuf_empty],
  ['google/protobuf/descriptor.proto', file_google_protobuf_descriptor],
]);

for (const [mapKey, wktFile] of WKT_FILES.entries()) {
  const protoName = wktFile.proto?.name;
  const match = mapKey === protoName;
  console.log(`Key: ${mapKey}`);
  console.log(`  proto.name: ${protoName}`);
  console.log(`  Match: ${match}`);
  if (!match) {
    console.log('  *** MISMATCH ***');
  }
}
