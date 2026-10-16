import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {SqliteCatalog} from './sqlite-database.ts';
import {ProjectCatalog} from '../../services/catalog/projects.ts';

test('0013 adds only the retained fence schema and leaves all prior rows unchanged',async()=>{
 const db=new SqliteCatalog(':memory:',false),dir=new URL('../../services/catalog/migrations/',import.meta.url);
 try{
  for(const file of readdirSync(dir).filter(n=>/^00(?:0[1-9]|1[0-2])_/.test(n)).sort())db.sqlite.exec(readFileSync(new URL(file,dir),'utf8'));
  db.seed('ordinary');db.seed('operator');
  await new ProjectCatalog(db,new Set(['blank-v1'])).create({userId:'ordinary',authVersion:1},'tenant-ordinary','retained-project',{title:'Retained',starterVersion:'blank-v1'});
  db.sqlite.exec("INSERT INTO auth_user VALUES('offline-auth','Offline owner','offline@example.test',1,NULL,1000,1000); INSERT INTO auth_session VALUES('offline-session',9000,'offline-fixture-token',1000,1000,NULL,NULL,'offline-auth',1);");
  const tables=(db.sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT GLOB 'sqlite_*' ORDER BY name").all() as Array<{name:string}>).map(x=>x.name);
  const snapshot=()=>Object.fromEntries(tables.map(name=>[name,db.sqlite.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()]));
  const before=snapshot(),schemaBefore=db.sqlite.prepare("SELECT name,type,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY name").all();
  const migration=readFileSync(new URL('0013_manual_save_fence.sql',dir),'utf8');
  db.sqlite.exec('BEGIN IMMEDIATE');db.sqlite.exec(migration);db.sqlite.exec('COMMIT');
  assert.deepEqual(snapshot(),before);assert.equal(db.count('catalog_manual_save_fences'),0);
  const added=db.sqlite.prepare("SELECT name,type FROM sqlite_schema WHERE name LIKE 'catalog_manual_save_%' ORDER BY name").all();
  assert.equal(added.filter(x=>x.type==='table').length,1);assert.equal(added.filter(x=>x.type==='index').length,2);assert.equal(added.filter(x=>x.type==='trigger').length,3);
  for(const prior of schemaBefore)assert.deepEqual(db.sqlite.prepare('SELECT name,type,sql FROM sqlite_schema WHERE name=?').get(prior.name as string),prior);
  assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.throws(()=>db.sqlite.exec(migration),/already exists/);assert.deepEqual(snapshot(),before);
 }finally{db.sqlite.close();}
});
