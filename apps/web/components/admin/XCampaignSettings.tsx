"use client";
import { useEffect, useState } from "react";
import { CAMPAIGN_SETTING_KEYS } from "@/lib/airdrop/campaign";

export function XCampaignSettings() {
  const [urls, setUrls] = useState({ reply: "", repost: "" }), [busy, setBusy] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false), [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    void fetch("/api/admin/settings", {cache:"no-store", signal:abort.signal}).then(async r => { if(!r.ok)throw Error("Campaign settings could not load.");return r.json(); })
      .then(b => { if(abort.signal.aborted)return;
        const read=(key:string)=>b.settings?.find((r:{key:string})=>r.key===key)?.value?.text??"";
        setUrls({reply:read(CAMPAIGN_SETTING_KEYS[0]),repost:read(CAMPAIGN_SETTING_KEYS[1])});setLoaded(true);
      }).catch(e=>{if(!abort.signal.aborted)setNote(e.message);});
    return()=>abort.abort();
  },[]);
  const save = async (task:"reply"|"repost") => {
    if(busy)return;setBusy(task);setNote(null);
    try {
      const r=await fetch("/api/admin/settings",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:CAMPAIGN_SETTING_KEYS[task==="reply"?0:1],value:urls[task].trim()})});
      const b=await r.json();if(!r.ok)throw Error(b.error??"Could not save campaign post.");
      setNote(`${task === "reply" ? "Reply" : "Repost"} post saved. New submissions use this link immediately; existing submissions retain their original post.`);
    }catch(e){setNote(e instanceof Error?e.message:"Could not save.");}finally{setBusy(null);}
  };
  return <section className="glass rounded-3xl p-4" aria-label="X campaign posts"><h3 className="font-display text-lg font-semibold">X campaign posts</h3>
    <p className="mt-2 text-xs text-white/60">Change the official post for each quest without deploying. Leave a link empty to pause new submissions for that task. Previously saved evidence keeps its original post.</p>
    {(["reply","repost"] as const).map(task=><form key={task} className="mt-4 grid gap-2" onSubmit={e=>{e.preventDefault();void save(task);}}>
      <label htmlFor={`admin-x-${task}`} className="text-sm font-semibold">{task==="reply"?"Reply campaign post URL":"Repost campaign post URL"}</label>
      <input id={`admin-x-${task}`} type="url" value={urls[task]} disabled={!loaded||!!busy} onChange={e=>setUrls(v=>({...v,[task]:e.target.value}))} placeholder="https://x.com/HeadsTailsFun/status/…" className="min-w-0 w-full rounded-xl border border-white/10 bg-black/20 p-3 text-base" />
      <button className="earn-secondary justify-self-start" disabled={!loaded||!!busy} type="submit">{busy===task?"Saving…":`Save ${task} post`}</button>
    </form>)}
    {note&&<p role="status" className="mt-3 text-sm text-white/70">{note}</p>}
  </section>;
}
