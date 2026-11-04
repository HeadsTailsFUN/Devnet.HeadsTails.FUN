import {createRpc,verifyMatch,DEFAULT_RPC} from "../../apps/web/lib/fairness/verifier";
async function main(){const result=await verifyMatch(createRpc(process.argv[3]||DEFAULT_RPC),process.argv[2]||"74");console.log(JSON.stringify(result,null,2));if(result.status!=="VERIFIED")process.exitCode=result.status==="PENDING"?2:1;}
void main().catch(()=>{console.error("Verification unavailable");process.exitCode=1;});
