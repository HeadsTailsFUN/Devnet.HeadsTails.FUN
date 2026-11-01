import { InfoPage } from "@/components/brand/InfoPage";
export const metadata = { title: "Roadmap — HeadsTails.fun" };
const stages = [
  {
    name: "DEVNET BETA",
    tag: "Live · improving",
    items: [
      "HTS gameplay",
      "Real matchmaking and settlement",
      "Community testing",
      "Reliability improvements",
    ],
  },
  {
    name: "COMMUNITY & GROWTH",
    tag: "Building on existing features",
    items: [
      "Points and referrals",
      "Leaderboards",
      "Community competition",
      "Gameplay improvements",
    ],
  },
  {
    name: "EXPANSION",
    tag: "Planned",
    items: [
      "Additional rooms",
      "Better UX and infrastructure",
      "Community campaigns",
      "Future product opportunities",
    ],
  },
];
export default function Roadmap() {
  return (
    <InfoPage title="The next flips." eyebrow="HEADSTAILS / ROADMAP">
      <div className="grid gap-4 md:grid-cols-3">
        {stages.map((stage, i) => (
          <section key={stage.name} className="glass rounded-3xl p-5">
            <span className="font-display text-4xl text-white/15">
              0{i + 1}
            </span>
            <h2 className="font-display mt-3 text-xl text-white">
              {stage.name}
            </h2>
            <p
              className={`my-3 text-xs font-bold ${i === 1 ? "text-[var(--tails)]" : "text-[var(--heads)]"}`}
            >
              {stage.tag}
            </p>
            <ul className="space-y-2">
              {stage.items.map((item) => (
                <li key={item}>· {item}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <p>
        HTS matches and payouts have been verified on Devnet. Points, referrals
        and leaderboards are implemented; community programs and further
        expansion remain plans. No dates, listings, financial returns or future
        airdrops are guaranteed.
      </p>
    </InfoPage>
  );
}
