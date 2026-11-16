import {test,afterEach} from "node:test";
import assert from "node:assert/strict";
import {render,screen,fireEvent,cleanup,waitFor} from "@testing-library/react";
import {XCampaignSettings} from "./XCampaignSettings";
import {validateSetting} from "@/lib/admin/settings";
const original=globalThis.fetch;
afterEach(()=>{cleanup();globalThis.fetch=original;});
test("admin loads and saves independent reply/repost links through the controlled settings API",async()=>{
  const posted:Array<Record<string,unknown>>=[];
  globalThis.fetch=async(_url,init)=>{if(init?.method==="POST"){posted.push(JSON.parse(String(init.body)));return Response.json({status:"ok"});}return Response.json({settings:[{key:"earn_x_reply_campaign_url",value:{text:"https://x.com/HeadsTailsFun/status/1"}},{key:"earn_x_repost_campaign_url",value:{text:"https://x.com/HeadsTailsFun/status/2"}}]});};
  render(<XCampaignSettings/>);
  await waitFor(()=>assert.equal((screen.getByLabelText("Reply campaign post URL") as HTMLInputElement).value,"https://x.com/HeadsTailsFun/status/1"));
  fireEvent.change(screen.getByLabelText("Reply campaign post URL"),{target:{value:"https://x.com/HeadsTailsFun/status/3"}});
  fireEvent.click(screen.getByRole("button",{name:"Save reply post"}));
  await screen.findByText(/Reply post saved/);
  assert.deepEqual(posted,[{key:"earn_x_reply_campaign_url",value:"https://x.com/HeadsTailsFun/status/3"}]);
  assert.equal((screen.getByLabelText("Repost campaign post URL") as HTMLInputElement).value,"https://x.com/HeadsTailsFun/status/2");
});
test("campaign settings accept pause and reject profile links, spoofed hosts and unauthorized setting keys",()=>{
  assert.deepEqual(validateSetting("earn_x_reply_campaign_url",""),{ok:true,kind:"text",value:""});
  assert.equal(validateSetting("earn_x_repost_campaign_url","https://x.com/HeadsTailsFun").ok,false);
  assert.equal(validateSetting("earn_x_reply_campaign_url","https://x.com.evil.invalid/HeadsTailsFun/status/1").ok,false);
  assert.equal(validateSetting("HEADSTAILS_WEBSITE_API_KEY","x").ok,false);
});
