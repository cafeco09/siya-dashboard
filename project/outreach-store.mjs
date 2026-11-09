import {readFile} from 'node:fs/promises';
import pg from 'pg';

export function postgresStore(connectionString){
 const pool=new pg.Pool({connectionString,max:3,connectionTimeoutMillis:7000,idleTimeoutMillis:10000});
 let initialising;
 async function ready(){
  if(!initialising)initialising=(async()=>{
   const sql=await readFile(new URL('./outreach-schema.sql',import.meta.url),'utf8'),client=await pool.connect();
   try{await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('her-education-outreach'))");await client.query(sql);await client.query('COMMIT')}
   catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
  })().catch(e=>{initialising=null;throw e});
  await initialising;
 }
 const view=client=>({
  async get(id){return (await client.query('SELECT data FROM outreach_records WHERE id=$1',[id])).rows[0]?.data||null},
  async put(id,kind,data){await client.query('INSERT INTO outreach_records(id,kind,data) VALUES($1,$2,$3::jsonb) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()',[id,kind,JSON.stringify(data)])},
  async list(kind,limit=200){return (await client.query('SELECT data FROM outreach_records WHERE kind=$1 ORDER BY updated_at DESC LIMIT $2',[kind,limit])).rows.map(r=>r.data)},
  async remove(id){await client.query('DELETE FROM outreach_records WHERE id=$1',[id])}
 });
 return {
  async read(fn){await ready();return fn(view(pool))},
  async transaction(fn){
   await ready();const client=await pool.connect();
   try{await client.query('BEGIN');await client.query("SELECT pg_advisory_xact_lock(hashtext('her-education-outreach'))");const result=await fn(view(client));await client.query('COMMIT');return result}
   catch(e){await client.query('ROLLBACK').catch(()=>{});throw e}finally{client.release()}
  },
  async close(){await pool.end()}
 };
}
