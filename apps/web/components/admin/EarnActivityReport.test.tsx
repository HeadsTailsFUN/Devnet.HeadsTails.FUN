import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { render, screen, fireEvent, cleanup, waitFor, within } from "@testing-library/react";
import { EarnActivityReport, activityEvidenceHref } from "./EarnActivityReport";
import { EarnVerificationQueue } from "./EarnVerificationQueue";
const originalFetch=globalThis.fetch;
afterEach(()=>{cleanup();globalThis.fetch=originalFetch;});
const user={wallet:'11111111111111111111111111111111',username:'Alpha',xHandle:'alpha',events:1050,verified:1050,pending:0,rejected:0,points:3150,lastActivity:'2026-11-16T00:00:00Z',excluded:false,activities:{win:{events:350,verified:350,pending:0,points:1750},loss:{events:700,verified:700,pending:0,points:1400}}};
test('admin report submits activity/sort/date filters, follows server pagination, and opens complete user history',async()=>{
 const calls:string[]=[];let reviewWallet='';
 globalThis.fetch=async input=>{const url=new URL(String(input),'https://fixture.invalid');calls.push(url.search);
  return Response.json(url.searchParams.get('mode')==='events'?{rows:[{id:'event-1',activity:'win',status:'verified',occurred_at:'2026-11-16T00:00:00Z',points:5,verified_points:5,source_type:'ledger',source_key:'round-123',details:{}}],total:1050,page:1,pageSize:25,activities:{win:{events:350}}}:{rows:[user],total:145,page:Number(url.searchParams.get('page')??1),pageSize:25,season:'QA',summary:{users:145,events:5621,pending:4,points:18000}});
 };
 render(<EarnActivityReport onReviewWallet={w=>{reviewWallet=w;}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'View activity for Alpha'}));await screen.findByText('Reference: round-123');
 fireEvent.click(screen.getByRole('button',{name:'Review this user’s X requests'}));assert.equal(reviewWallet,user.wallet);
 fireEvent.change(screen.getByRole('combobox',{name:'Activity type'}),{target:{value:'win'}});
 fireEvent.change(screen.getByRole('combobox',{name:'Sort activity users'}),{target:{value:'verified'}});
 fireEvent.change(screen.getByLabelText('Activity from date'),{target:{value:'2026-11-01'}});
 fireEvent.click(screen.getByRole('button',{name:'Apply filters'}));await waitFor(()=>assert(calls.some(c=>c.includes('activity=win')&&c.includes('sort=verified')&&c.includes('from=2026-11-01'))));
 await screen.findByRole('button',{name:'View activity for Alpha'});fireEvent.click(within(screen.getByRole('navigation',{name:'Activity users pages'})).getByRole('button',{name:'Next'}));await waitFor(()=>assert(calls.some(c=>c.includes('page=2'))));
});
test('failed admin reads do not masquerade as zero users and unsafe evidence URLs are never links',async()=>{
 globalThis.fetch=async()=>Response.json({message:'Report unavailable'},{status:503});render(<EarnActivityReport onReviewWallet={()=>{}}/>);assert.match((await screen.findByRole('alert')).textContent??'',/Report unavailable/);assert.equal(screen.queryByText('No users match these filters.'),null);
 for(const raw of ['javascript:alert(1)','https://x.com.evil.invalid/a','https://u:p@x.com/a','http://x.com/a'])assert.equal(activityEvidenceHref(raw),null);assert.equal(activityEvidenceHref('https://x.com/alpha/status/123'),'https://x.com/alpha/status/123');
});
const row=(id:string,handle:string)=>({id,wallet:user.wallet,task_type:'connect_x',x_handle:handle,x_profile_url:`https://x.com/${handle}`,evidence_url:null,campaign_url:null,reviewState:'pending',created_at:'2026-11-16T00:00:00Z',review_note:null,challenge:null,rewards:[],history:[],reviews:[]});
test('switching review requests clears the previous reason and evidence confirmation, and revocation needs a reason',async()=>{
 const posts:Array<Record<string,unknown>>=[];
 globalThis.fetch=async(_input,init)=>{if(init?.method==='POST'){posts.push(JSON.parse(String(init.body)));return Response.json({status:'rejected'});}return Response.json({rows:[row('first','alpha'),row('second','beta')],active:true,newSubmissionsActive:false,total:2,page:1,pageSize:25});};
 render(<EarnVerificationQueue canReview/>);
 fireEvent.click(await screen.findByRole('button',{name:'Review X account ownership for @alpha'}));fireEvent.change(screen.getByRole('textbox',{name:'Verification review reason'}),{target:{value:'Ownership evidence checked'}});fireEvent.click(screen.getByRole('checkbox'));assert.equal((screen.getByRole('button',{name:'Approve'}) as HTMLButtonElement).disabled,false);
 fireEvent.click(screen.getByRole('button',{name:'Review X account ownership for @beta'}));assert.equal((screen.getByRole('textbox',{name:'Verification review reason'}) as HTMLInputElement).value,'');assert.equal((screen.getByRole('checkbox') as HTMLInputElement).checked,false);assert((screen.getByRole('button',{name:'Approve'}) as HTMLButtonElement).disabled);
 fireEvent.change(screen.getByRole('textbox',{name:'Verification review reason'}),{target:{value:'Evidence was not provided'}});fireEvent.click(screen.getByRole('button',{name:'Reject / revoke'}));await waitFor(()=>assert.equal(posts.length,1));assert.equal(posts[0].claimId,'second');assert.equal(posts[0].decision,'rejected');
});
test('read-only staff see requests and history without approval controls',async()=>{
 globalThis.fetch=async()=>Response.json({rows:[row('first','alpha')],active:true,total:1,page:1,pageSize:25});render(<EarnVerificationQueue canReview={false}/>);await screen.findByText('X account ownership · @alpha');assert.equal(screen.queryByRole('button',{name:/Review X account ownership/}),null);
});
