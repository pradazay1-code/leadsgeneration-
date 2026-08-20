import type { NicheId } from "../types";
import type { SequenceChannel } from "./types";

/**
 * Out-of-the-box CRM configuration, seeded once on first run so the app is
 * usable immediately instead of demanding setup before it does anything.
 * These are starting points — everything is editable.
 */

export interface StageSeed {
  name: string;
  probability: number;
  isWon?: boolean;
  isLost?: boolean;
}

export interface PipelineSeed {
  name: string;
  niche: NicheId | null;
  isDefault: boolean;
  stages: StageSeed[];
}

/**
 * One pipeline per niche. The stages follow the actual motion for selling
 * websites/CRM to a local operator: you find them, you reach them, you get a
 * conversation, you show them the gap, you quote, you close.
 */
export const DEFAULT_PIPELINES: PipelineSeed[] = [
  {
    name: "Junk Removal Outreach",
    niche: "junk_removal",
    isDefault: true,
    stages: [
      { name: "New Lead", probability: 5 },
      { name: "Attempting Contact", probability: 10 },
      { name: "Conversation Started", probability: 25 },
      { name: "Audit Sent", probability: 40 },
      { name: "Proposal Sent", probability: 60 },
      { name: "Verbal Yes", probability: 85 },
      { name: "Won", probability: 100, isWon: true },
      { name: "Lost", probability: 0, isLost: true },
    ],
  },
  {
    name: "Real Estate Outreach",
    niche: "real_estate",
    isDefault: false,
    stages: [
      { name: "New Lead", probability: 5 },
      { name: "Attempting Contact", probability: 10 },
      { name: "Conversation Started", probability: 25 },
      { name: "Audit Sent", probability: 40 },
      { name: "Proposal Sent", probability: 60 },
      { name: "Verbal Yes", probability: 85 },
      { name: "Won", probability: 100, isWon: true },
      { name: "Lost", probability: 0, isLost: true },
    ],
  },
];

export interface SequenceStepSeed {
  dayOffset: number;
  channel: SequenceChannel;
  subject: string;
  body: string;
}

export interface SequenceSeed {
  name: string;
  description: string;
  niche: NicheId | null;
  steps: SequenceStepSeed[];
}

/**
 * Merge fields available in every subject/body:
 *   {{business}} {{city}} {{state}} {{phone}} {{niche}} {{gap}} {{score}}
 * {{gap}} renders the lead's highest-scoring weakness in plain English, which
 * is what makes these openers land instead of reading as spam.
 */
export const DEFAULT_SEQUENCES: SequenceSeed[] = [
  {
    name: "Local Operator — 5 Touch",
    description:
      "Phone-led cadence for owner-operators. Two calls before any email, because these owners answer their phones and ignore inboxes.",
    niche: null,
    steps: [
      {
        dayOffset: 0,
        channel: "call",
        subject: "Call {{business}} — first attempt",
        body:
          "Opener: “Hi, I was looking for {{niche}} in {{city}} and found you — but {{gap}}. Are you taking on more work right now?”\n\nIf voicemail, leave a 15-second message and log the outcome.",
      },
      {
        dayOffset: 2,
        channel: "call",
        subject: "Call {{business}} — second attempt",
        body: "Try a different time of day than the first attempt. Mornings before 9 and after 4pm work best for {{niche}}.",
      },
      {
        dayOffset: 4,
        channel: "email",
        subject: "Quick question about {{business}}",
        body:
          "Hi — I came across {{business}} while searching {{niche}} in {{city}}, and noticed {{gap}}.\n\nI build sites and follow-up systems for {{niche}} businesses so calls stop slipping through. Happy to send over a short audit of what I'd change — no charge, no pitch.\n\nWorth a look?",
      },
      {
        dayOffset: 8,
        channel: "call",
        subject: "Call {{business}} — third attempt",
        body: "Reference the email you sent on day 4. If you reach voicemail again, this is the last call before the break-up message.",
      },
      {
        dayOffset: 12,
        channel: "email",
        subject: "Closing the loop — {{business}}",
        body:
          "I'll stop reaching out after this one.\n\nIf {{gap}} ever becomes a priority, I'm around — it's usually a week of work and it pays for itself in a couple of jobs.\n\nEither way, good luck with the business.",
      },
    ],
  },
  {
    name: "No Website — Fast Track",
    description:
      "Short, aggressive cadence for leads with no website at all. Highest-intent gap, so move quickly before a competitor gets there.",
    niche: null,
    steps: [
      {
        dayOffset: 0,
        channel: "call",
        subject: "Call {{business}} — no website angle",
        body:
          "“I was looking for {{niche}} in {{city}} and couldn't find a website for you anywhere. Are you still taking jobs?” — then listen. Most will say they've been meaning to sort it out.",
      },
      {
        dayOffset: 1,
        channel: "sms",
        subject: "Text {{business}}",
        body:
          "Hi — tried calling earlier. I build websites for {{niche}} businesses around {{city}}. Couldn't find one for you — want me to put together a quick mockup? No cost.",
      },
      {
        dayOffset: 3,
        channel: "call",
        subject: "Call {{business}} — follow up on text",
        body: "Reference the text. If no answer by now, drop to the standard 5-touch cadence.",
      },
    ],
  },
];

export interface TemplateSeed {
  name: string;
  channel: SequenceChannel;
  subject: string;
  body: string;
}

export const DEFAULT_TEMPLATES: TemplateSeed[] = [
  {
    name: "Free audit offer",
    channel: "email",
    subject: "Found {{business}} — one thing worth fixing",
    body:
      "Hi,\n\nI was searching {{niche}} in {{city}} and came across {{business}}. Noticed {{gap}}.\n\nI put together short audits for {{niche}} businesses showing exactly what's costing them calls. Takes me 20 minutes, costs you nothing, and you can ignore everything I say.\n\nWant me to send it over?",
  },
  {
    name: "Missed-call text-back pitch",
    channel: "email",
    subject: "How many calls does {{business}} miss in a week?",
    body:
      "Hi,\n\nMost {{niche}} operators I talk to miss 3–8 calls a week — on a truck, on a job, phone in a pocket. Every one of those goes to the next name on Google.\n\nI set up a system that texts anyone you miss within 30 seconds, so the job stays yours. Usually pays for itself in one booking.\n\nWorth 10 minutes?",
  },
  {
    name: "Voicemail script",
    channel: "call",
    subject: "Voicemail — 15 seconds",
    body:
      "Hi, this is [your name]. I was looking for {{niche}} in {{city}} and found {{business}} — I noticed {{gap}} and had one idea for you. My number is [your number]. If it's useful, call me back; if not, no worries at all.",
  },
  {
    name: "Review-building pitch",
    channel: "sms",
    subject: "Reviews",
    body:
      "Hi — noticed {{business}} is running with very few reviews. That's usually the single biggest thing holding new {{niche}} businesses back on Google. I automate review requests after each job. Want the details?",
  },
];
