
import { createFileRegistry, fromBinary, create } from '@bufbuild/protobuf';
import { 
  file_google_protobuf_empty, 
  file_google_protobuf_timestamp,
  FileDescriptorProtoSchema, 
  FileDescriptorSetSchema 
} from '@bufbuild/protobuf/wkt';

console.log('Testing full flow simulation...');

// Simulate a downloaded FileDescriptorProto (empty, just for testing structure)
const emptyBytes = new Uint8Array(0); 
const downloadedProto = fromBinary(FileDescriptorProtoSchema, emptyBytes);
downloadedProto.name = "test/downloaded.proto";
downloadedProto.syntax = "proto3";

// Collect all protos
const allProtos = [downloadedProto];

// Add WKT protos
const WKT_FILES = new Map([
  ['google/protobuf/empty.proto', file_google_protobuf_empty],
  ['google/protobuf/timestamp.proto', file_google_protobuf_timestamp],
]);

for (const [name, wktFile] of WKT_FILES.entries()) {
  console.log(`Processing WKT: ${name}`);
  console.log(`  wktFile.proto exists: ${!!wktFile.proto}`);
  if (wktFile.proto) {
    console.log(`  wktFile.proto.name: ${wktFile.proto.name}`);
    allProtos.push(wktFile.proto);
  }
}

console.log(`\nTotal protos: ${allProtos.length}`);

try {
  console.log('Creating FileDescriptorSet...');
  const descriptorSet = create(FileDescriptorSetSchema, { file: allProtos });
  console.log(`  descriptorSet.file.length: ${descriptorSet.file.length}`);
  
  console.log('Creating FileRegistry...');
  const registry = createFileRegistry(descriptorSet);
  console.log('Success! Registry created.');
  
  // Verify
  const testFile = registry.getFile("test/downloaded.proto");
  console.log(`Found downloaded.proto: ${!!testFile}`);
} catch (e) {
  console.error('Failed:', e.message);
  console.error(e.stack);
}
