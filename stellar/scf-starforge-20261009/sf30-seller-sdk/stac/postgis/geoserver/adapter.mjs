// MIT. Host-selected original PostGIS connection and original native verifier.
import { resolve } from 'node:path';
import { readPrivate, digest } from '../../../postgres/publisher/files.mjs';
import { resolvePostgresConnection } from '../../../postgres/config.mjs';
import { verifyReceiving as verifyPostgisReceiving } from '../verify.mjs';
import { openGeoServerPublisher } from './controller.mjs';
import { need, absolute, hash, normalizeProfile, publicProfile } from './contract.mjs';
import { verifyFile } from './journal.mjs';

export async function readGeoServerConfiguration({profileFile,readerFile,expectedProfileSha256,expectedReaderSha256,signal}={}){
  profileFile=absolute(profileFile);readerFile=absolute(readerFile);
  const [profileObserved,readerObserved]=await Promise.all([
    verifyFile(profileFile,{maximum:262144,signal}),verifyFile(readerFile,{maximum:262144,signal})]);
  if(expectedProfileSha256)need(profileObserved.sha256===hash(expectedProfileSha256),'GEOSERVER_PROFILE_FILE_CHANGED');
  if(expectedReaderSha256)need(readerObserved.sha256===hash(expectedReaderSha256),'GEOSERVER_READER_FILE_CHANGED');
  // Credentials remain references; neither file contains an actual password/header.
  const [profileBytes,readerBytes]=await Promise.all([readPrivate(profileFile,262144),readPrivate(readerFile,262144)]);
  need(digest(profileBytes)===profileObserved.sha256&&digest(readerBytes)===readerObserved.sha256,'GEOSERVER_CONFIGURATION_CHANGED');
  const profile=normalizeProfile(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(profileBytes)));
  const reader=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(readerBytes));
  need(reader?.schema==='stellar-forge.postgres-source.v1','GEOSERVER_POSTGRES_SOURCE_PROFILE');
  const nativeBinding={schema:'starforge.geoserver-native-reader-binding.v1',
    profileSha256:profileObserved.sha256,readerSha256:readerObserved.sha256};
  return {profile,reader,profileFile,readerFile,nativeBinding,
    hostSources:[{name:'geoserver-profile.json',bytes:profileBytes},{name:'postgis-reader.json',bytes:readerBytes}]};
}
export async function openGeoServerOperator({directory,profileFile,readerFile,expectedProfileSha256,expectedReaderSha256,
  environment=process.env,signal,fetchImpl}={}){
  const selected=await readGeoServerConfiguration({profileFile,readerFile,expectedProfileSha256,expectedReaderSha256,signal});
  // The original resolver owns TLS, environment references and authentication.
  // Resolving before acquiring the publisher never creates a database connection.
  async function readerConnection(operationSignal=signal){
    const current=await verifyFile(selected.readerFile,{maximum:262144,signal:operationSignal});
    need(current.sha256===selected.nativeBinding.readerSha256,'GEOSERVER_READER_FILE_CHANGED');
    const connection=await resolvePostgresConnection({config:selected.reader,path:selected.readerFile},environment);
    const expected=selected.profile.database;
    need(connection.host===expected.host&&connection.port===expected.port&&connection.database===expected.name&&connection.user===expected.role,
      'GEOSERVER_NATIVE_READER_BINDING','Use the actual selected GeoServer database reader connection.');
    return connection;
  }
  await readerConnection();
  const verifier=async options=>{
    options.signal?.throwIfAborted();
    const connection=await readerConnection(options.signal);
    return verifyPostgisReceiving({...options,connection,role:selected.profile.database.role,requireUnchangedRows:true});
  };
  const publisher=await openGeoServerPublisher({directory:absolute(directory),profile:selected.profile,
    verifyReceiving:verifier,environment,fetchImpl,hostSources:selected.hostSources,nativeBinding:selected.nativeBinding});
  return {...publisher,configuration:{profileFile:selected.profileFile,readerFile:selected.readerFile,
    ...selected.nativeBinding,profile:publicProfile(selected.profile)}};
}
