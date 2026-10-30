/**
 * OPERATOR ONLY — reference HTTP adapter for CALIBRATING the independent
 * evaluator. This file is NEVER copied into Muse candidate workspaces.
 * It uses the existing certified inventory domain module, so it is a
 * known-good API adapter, not a new AI-generated participant entry.
 */
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import {isAbsolute} from 'node:path';
if(!process.env.INV_BENCH_INVENTORY_MODULE||
  !isAbsolute(process.env.INV_BENCH_INVENTORY_MODULE)){
  throw Error('Calibration only: absolute certified inventory module path required');
}
const {
  initializeInventory,seedStock,availableStock,
  reserveStock,releaseStock,
}=await import(pathToFileURL(process.env.INV_BENCH_INVENTORY_MODULE).href);
if(!process.env.INVENTORY_DB_PATH||!isAbsolute(process.env.INVENTORY_DB_PATH))throw Error('DB path required');
const db=new DatabaseSync(process.env.INVENTORY_DB_PATH);
initializeInventory(db);
const reply=(res,status,body)=>{
  res.writeHead(status,{'Content-Type':'application/json'});
  res.end(JSON.stringify(body));
};
function raise(code,message){
  const error=new Error(message);
  error.code=code;throw error;
}
async function readRequest(req){
  const mime=String(req.headers['content-type']??'').split(';')[0].trim().toLowerCase();
  if(mime!=='application/json')raise('UNSUPPORTED_MEDIA_TYPE','JSON only');
  let chunks=[],total=0;
  for await(const chunk of req){
    total+=chunk.length;
    if(total>65536)raise('PAYLOAD_TOO_LARGE','Body > 64KiB');
    chunks.push(chunk);
  }
  try{
    const json=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!json||Array.isArray(json)||typeof json!=='object')raise('INVALID_INPUT','Object required');
    return json;
  }catch(error){
    if(error?.code)throw error;
    raise('INVALID_JSON','Malformed JSON');
  }
}
function fieldSku(value){
  if(typeof value!=='string'||value.length<1||value.length>128||!(/^[\x20-\x7E]+$/).test(value)){
    raise('INVALID_INPUT','Bad SKU');
  }
  return value;
}
const errors=new Map([
  ['INVALID_INPUT',400],['INVALID_JSON',400],['UNSUPPORTED_MEDIA_TYPE',415],
  ['PAYLOAD_TOO_LARGE',413],['STOCK_NOT_FOUND',404],
  ['RESERVATION_NOT_FOUND',404],['STOCK_EXISTS',409],
  ['INSUFFICIENT_STOCK',409],['IDEMPOTENCY_CONFLICT',409],
]);
const server=createServer(async(req,res)=>{
  try{
    const method=req.method??'GET';
    const pathname=new URL(req.url??'/','http://localhost').pathname;
    if(method==='GET'&&pathname==='/health'){
      return reply(res,200,{ok:true,service:'inventory-api'});
    }
    if(method==='POST'&&pathname==='/v1/stock'){
      const {sku,available}=await readRequest(req);
      seedStock(db,sku,available);
      return reply(res,201,{sku,available});
    }
    if(method==='GET'&&pathname==='/v1/stock'){
      const items=db.prepare('SELECT sku,available FROM stock ORDER BY sku ASC').all()
        .map(x=>({sku:x.sku,available:x.available}));
      return reply(res,200,{items});
    }
    if(method==='GET'&&pathname.startsWith('/v1/stock/')){
      const sku=fieldSku(decodeURIComponent(pathname.slice('/v1/stock/'.length)));
      return reply(res,200,{sku,available:availableStock(db,sku)});
    }
    if(method==='POST'&&pathname==='/v1/reservations'){
      const input=await readRequest(req);
      const reservation=reserveStock(db,input);
      return reply(res,reservation.replayed?200:201,reservation);
    }
    const release=method==='POST'&&pathname.match(/^\/v1\/reservations\/([^/]+)\/release$/);
    if(release){
      const id=Number(release[1]);
      if(!Number.isSafeInteger(id)||id<=0)raise('INVALID_INPUT','Bad reservation ID');
      return reply(res,200,releaseStock(db,id));
    }
    return reply(res,404,{error:{code:'NOT_FOUND'}});
  }catch(error){
    const code=errors.has(error?.code)?error.code:'INTERNAL_ERROR';
    return reply(res,errors.get(code)??500,{error:{code}});
  }
});
const port=Number(process.env.PORT??'0');
server.listen(port,'127.0.0.1',()=>{
  const assigned=server.address();
  process.stdout.write('SILKWEB_READY '+JSON.stringify({port:assigned.port})+'\n');
});
process.on('SIGTERM',()=>server.close(()=>{db.close();}));
