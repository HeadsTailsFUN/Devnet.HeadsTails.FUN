import type {Metadata} from "next";
import {HowToContent} from "@/components/fairness/HowToContent";
export const metadata:Metadata={title:"How To Verify Fairness — HeadsTails.fun",description:"Independently calculate a HeadsTails Devnet result from ORAO randomness, inspect the match and verify its full HTS payout."};
export default function HowToPage(){return <HowToContent/>;}
