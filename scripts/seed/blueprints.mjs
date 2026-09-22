/**
 * The seeded workspace.
 *
 * One fictional company (Cadence, a product-analytics SaaS) seen through the
 * account of Alex Rivera, Head of Growth -- so the same cast recurs across
 * meetings and cross-meeting search and Ask-AI have something real to join on.
 *
 * Each blueprint is an outline, not a script. scripts/seed/generate.mjs expands
 * the beats into dialogue; timings come later from the actual TTS audio.
 */

export const OWNER = {
  name: "Alex Rivera",
  email: "alex@cadence.io",
  company: "Cadence",
  role: "Head of Growth",
};

// Voices are assigned per meeting from this pool so a given person keeps the
// same voice across every recording they appear in.
export const VOICES = {
  "Alex Rivera": "en-US-AndrewNeural",
  "Sarah Chen": "en-US-AriaNeural",
  "Marcus Webb": "en-US-GuyNeural",
  "Priya Raman": "en-IN-NeerjaNeural",
  "Daniel Okonkwo": "en-NG-AbeoNeural",
  "Elena Vasquez": "en-US-JennyNeural",
  "Tom Bradley": "en-GB-RyanNeural",
  "Yuki Tanaka": "en-US-MichelleNeural",
  "Rachel Goldstein": "en-US-EmmaNeural",
  "James Mbeki": "en-ZA-LukeNeural",
  "Nadia Hassan": "en-US-AvaNeural",
  "Chris Lindqvist": "en-US-BrianNeural",
};

export const BLUEPRINTS = [
  {
    slug: "meridian-discovery",
    title: "Cadence × Meridian Logistics — Discovery",
    platform: "zoom",
    source: "bot",
    template: "sales_discovery",
    accent: "indigo",
    daysAgo: 2,
    startHour: 10,
    targetMinutes: 31,
    participants: [
      { name: "Alex Rivera", company: "Cadence", role: "Head of Growth", host: true },
      { name: "Sarah Chen", company: "Cadence", role: "Solutions Engineer" },
      { name: "Marcus Webb", company: "Meridian Logistics", role: "VP Engineering" },
      { name: "Elena Vasquez", company: "Meridian Logistics", role: "Director of Product" },
    ],
    context:
      "First discovery call. Meridian runs freight-tracking software for mid-market shippers, " +
      "about 140 engineers, 60k monthly active users. They currently use a homegrown events " +
      "pipeline into Redshift plus Looker dashboards nobody trusts. Alex is qualifying; Sarah " +
      "handles technical depth. Marcus is skeptical about yet another vendor; Elena is the " +
      "champion who brought Cadence in.",
    beats: [
      "Brief small talk, Alex sets an agenda and asks permission to record",
      "Elena explains why she reached out: product team cannot answer basic retention questions without filing a ticket to data eng",
      "Marcus pushes back that they already have Redshift and Looker, asks what is actually different",
      "Alex asks about the homegrown pipeline: how long a new event takes to land in a dashboard (answer: three weeks, sometimes six)",
      "Sarah digs into schema: they have roughly 400 event types, no consistent naming, two failed attempts at a taxonomy",
      "Discussion of a specific painful incident last quarter where a pricing experiment ran for five weeks before anyone noticed the instrumentation was wrong",
      "Marcus asks hard questions about data residency, SOC 2, and whether Cadence can run in their VPC",
      "Sarah walks through the ingest model and answers the VPC question honestly (available on enterprise tier, adds four to six weeks)",
      "Alex asks about timeline and what is driving it: board asked for a retention number by end of quarter",
      "Budget conversation, deliberately vague from Elena, Marcus admits they spend roughly 200k a year on the current stack",
      "Objection about migration effort and who does the work",
      "Alex proposes a scoped technical evaluation on one product surface rather than a full migration",
      "Agreement on next steps: Sarah sends architecture doc, Elena pulls the event catalogue, follow-up scheduled for the following Tuesday",
    ],
  },

  {
    slug: "fielder-customer-interview",
    title: "Customer interview — Priya Raman, Fielder",
    platform: "meet",
    source: "bot",
    template: "customer_interview",
    accent: "emerald",
    daysAgo: 5,
    startHour: 15,
    targetMinutes: 26,
    participants: [
      { name: "Alex Rivera", company: "Cadence", role: "Head of Growth", host: true },
      { name: "Priya Raman", company: "Fielder", role: "Head of Data" },
    ],
    context:
      "Fielder is an existing Cadence customer, eleven months in, on the growth tier. Alex is " +
      "running a research interview ahead of a pricing change, not a renewal call. Priya is " +
      "candid and detailed, generally happy but has two sharp complaints: the cohort builder " +
      "is slow past 2 million users, and alerting has too many false positives. She also " +
      "mentions offhand that her team exports to CSV constantly, which is the interesting signal.",
    beats: [
      "Alex frames the call as research, not sales, and asks to record",
      "Priya describes how her team actually uses Cadence day to day",
      "The moment she realised it was working: a churn investigation that took an afternoon instead of two weeks",
      "Complaint one: cohort builder gets unusable past two million users, she has workarounds",
      "Complaint two: alerting fires too often, her team has started ignoring it, which defeats the point",
      "Offhand mention that four people on her team export to CSV every week to do things in a spreadsheet",
      "Alex digs into the CSV habit, which turns out to be about sharing with non-technical stakeholders",
      "Discussion of who else in the company would use Cadence if it were easier to share out of",
      "Priya on what she would tell a peer considering Cadence",
      "What would make her churn, asked directly",
      "Reaction to a hypothetical per-seat pricing change, which she dislikes and explains why",
      "Wrap up, Alex asks to follow up in a month",
    ],
  },

  {
    slug: "eng-standup",
    title: "Engineering standup",
    platform: "meet",
    source: "bot",
    template: "standup",
    accent: "amber",
    daysAgo: 1,
    startHour: 9,
    targetMinutes: 13,
    participants: [
      { name: "Daniel Okonkwo", company: "Cadence", role: "Engineering Manager", host: true },
      { name: "Yuki Tanaka", company: "Cadence", role: "Staff Engineer" },
      { name: "Tom Bradley", company: "Cadence", role: "Backend Engineer" },
      { name: "Rachel Goldstein", company: "Cadence", role: "Frontend Engineer" },
      { name: "Chris Lindqvist", company: "Cadence", role: "Infrastructure" },
    ],
    context:
      "Daily standup, fast and clipped, people talking over each other slightly. The team is " +
      "mid-sprint on the query engine rewrite. One real blocker surfaces: the migration script " +
      "for the events table is going to need a maintenance window nobody has scheduled.",
    beats: [
      "Daniel opens and notes that Maya and Sam, who are not on this call, are out sick this week",
      "Yuki on the query planner rewrite, ahead of schedule, one surprise about nested aggregations",
      "Tom on the events table migration, hits the blocker: needs a maintenance window",
      "Short debate about whether the migration can be done online instead",
      "Chris on infrastructure cost spike, traced to a runaway backfill job",
      "Rachel on the cohort builder performance work, references the Fielder complaint directly",
      "Daniel assigns the maintenance window question to himself to resolve with support",
      "Quick mention of the on-call rotation change",
      "Daniel closes",
    ],
  },

  {
    slug: "q3-all-hands",
    title: "Q3 All-Hands",
    platform: "zoom",
    source: "bot",
    template: "all_hands",
    accent: "violet",
    daysAgo: 9,
    startHour: 16,
    targetMinutes: 38,
    participants: [
      { name: "Nadia Hassan", company: "Cadence", role: "CEO", host: true },
      { name: "Alex Rivera", company: "Cadence", role: "Head of Growth" },
      { name: "Daniel Okonkwo", company: "Cadence", role: "Engineering Manager" },
      { name: "James Mbeki", company: "Cadence", role: "CFO" },
      { name: "Sarah Chen", company: "Cadence", role: "Solutions Engineer" },
      { name: "Rachel Goldstein", company: "Cadence", role: "Frontend Engineer" },
    ],
    context:
      "Company all-hands. Mostly Nadia presenting with function leads taking segments, then a " +
      "Q&A where an uncomfortable question about hiring freeze comes up and Nadia answers it " +
      "straight. Numbers should be specific and consistent: ARR 8.4M, up from 6.1M, net revenue " +
      "retention 118%, 62 employees, runway 26 months.",
    beats: [
      "Nadia opens with the quarter's headline numbers",
      "Where the growth came from, and the one segment that underperformed",
      "James on burn, runway, and why the board conversation went well",
      "Alex on pipeline and the two enterprise deals in flight",
      "Daniel on the query engine rewrite and what it unlocks",
      "The one thing that went badly this quarter: a four-hour outage in August, honest post-mortem",
      "Q4 priorities, named explicitly, three of them",
      "Q&A: Rachel asks whether there is a hiring freeze",
      "Nadia answers directly, no freeze but slower hiring in go-to-market",
      "Q&A: Sarah asks about the enterprise tier and VPC deployments",
      "Closing, recognition for two people",
    ],
  },

  {
    slug: "helix-qbr",
    title: "Cadence × Helix Health — Quarterly Business Review",
    platform: "teams",
    source: "bot",
    template: "general",
    accent: "rose",
    daysAgo: 4,
    startHour: 13,
    targetMinutes: 58,
    participants: [
      { name: "Alex Rivera", company: "Cadence", role: "Head of Growth", host: true },
      { name: "Sarah Chen", company: "Cadence", role: "Solutions Engineer" },
      { name: "Nadia Hassan", company: "Cadence", role: "CEO" },
      { name: "Elena Vasquez", company: "Helix Health", role: "VP Product" },
      { name: "Marcus Webb", company: "Helix Health", role: "VP Engineering" },
      { name: "Priya Raman", company: "Helix Health", role: "Director of Analytics" },
      { name: "James Mbeki", company: "Cadence", role: "CFO" },
      { name: "Tom Bradley", company: "Cadence", role: "Backend Engineer" },
    ],
    context:
      "The long one: eight people, just under an hour, a quarterly business review with the " +
      "largest account. Tone starts cordial and gets tense in the middle over the August " +
      "outage and a missed integration commitment, then resolves into a concrete plan. " +
      "Multiple threads run at once and people interrupt. This is deliberately the hardest " +
      "case: long, many speakers, mixed agenda, and the summary has to stay useful anyway.",
    beats: [
      "Introductions and agenda, eight people so this takes a minute",
      "Alex walks through adoption numbers: seats up, weekly active down slightly",
      "Elena challenges the weekly active number and asks how it is defined",
      "Sarah clarifies the definition, admits the previous QBR used a different one",
      "Awkward moment about inconsistent reporting, Alex owns it",
      "Priya presents what her analytics team has actually shipped on Cadence this quarter",
      "A genuinely positive stretch: the readmission-risk dashboard and what it changed clinically",
      "Marcus raises the August outage, four hours, during their month-end close",
      "Nadia takes the outage question personally and gives the post-mortem",
      "Marcus is not fully satisfied, asks for contractual SLA credits",
      "James on what the contract actually says and what Cadence will do beyond it",
      "Second issue: the Epic integration was committed for Q3 and slipped",
      "Tom explains the technical reason for the slip without excuses",
      "Elena is frustrated, says this affects her own roadmap commitments",
      "Negotiation of a revised date and what confidence level it carries",
      "Priya redirects to the cohort builder performance problem at their scale",
      "Discussion of the query engine rewrite and whether they can get early access",
      "Renewal conversation opens, twelve months out, Elena signals it will be scrutinised",
      "Nadia makes a direct ask about expanding into the clinical operations team",
      "Elena non-committal but opens a door",
      "Concrete next steps enumerated with owners and dates",
      "Closing pleasantries, one light moment about the next QBR being in person",
    ],
  },
];
