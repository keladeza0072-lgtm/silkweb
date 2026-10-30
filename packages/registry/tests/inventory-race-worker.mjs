import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [modulePath,dbPath,gate,key]=process.argv.slice(2);
if(!modulePath||!dbPath||!gate||!key)process.exit(2);
for(let i=0;i<250&&!existsSync(gate);i++)await new Promise(resolve=>setTimeout(resolve,20));
if(!existsSync(gate)){process.stderr.write('gate timeout\n');process.exit(2);}
const {reserveStock}=await import(pathToFileURL(modulePath).href);
const db=new DatabaseSync(dbPath);
try{
  const result=reserveStock(db,{key,sku:'RACE',quantity:1});
  process.stdout.write(JSON.stringify({status:'reserved',reservationId:result.reservationId})+'\n');
}catch(error){
  process.stdout.write(JSON.stringify({status:'rejected',errorCode:error?.code??'UNKNOWN'})+'\n');
}finally{db.close();}
