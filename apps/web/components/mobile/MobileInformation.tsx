"use client";
import type { MouseEvent } from "react";
import { TokenomicsContent, RoadmapContent, TermsPageContent, PrivacyPageContent } from "@/components/brand/InformationContent";
import type { InformationPage } from "@/lib/mobile/navigation";
import {HowToContent} from "@/components/fairness/HowToContent";
const CONTENT={tokenomics:TokenomicsContent,roadmap:RoadmapContent,terms:TermsPageContent,privacy:PrivacyPageContent,"how-to":HowToContent};
export default function MobileInformation({page,onBack,onNavigate}:{page:InformationPage;onBack:()=>void;onNavigate:(page:InformationPage)=>void}) {
  const Content=CONTENT[page];
  const intercept=(e:MouseEvent<HTMLElement>)=>{
    if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;
    const link=(e.target as Element).closest('a'),href=link?.getAttribute('href');
    if(href==='/'){e.preventDefault();onBack();return;}
    const match=href?.match(/^\/(tokenomics|roadmap|terms|privacy|how-to)$/);
    if(match){e.preventDefault();onNavigate(match[1] as InformationPage);}
  };
  return <section aria-label={`${page} information`} className="mobile-information-screen" onClickCapture={intercept}>
    <button type="button" onClick={onBack} className="mb-3 min-h-[44px] rounded-2xl border border-white/15 px-4 text-sm font-bold text-white">← Back to Profile</button>
    <div className="mobile-information-content"><Content/></div>
  </section>;
}
