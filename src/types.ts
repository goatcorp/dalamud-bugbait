export interface Env {
  OPENAI_TOKEN: string;
  AVATAR_PEPPER: string;
  DEFAULT_WEBHOOK: string;
  PACBOT_URL: string;
  PACBOT_TOKEN: string;
}

// Based on FeedbackModel from
// https://github.com/goatcorp/Dalamud/blob/master/Dalamud/Support/BugBait.cs#L55
export type Feedback = {
  content: string | null;
  name: string | null;
  dhash: string | null;
  version: string | null;
  platform: string | null;
  reporter: string | null;
  exception: string | null;
};
