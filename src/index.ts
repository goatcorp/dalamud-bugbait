/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npx wrangler dev src/index.js` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npx wrangler publish src/index.js --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { Env, Feedback } from "./types";
import { APIEmbed, RESTPostAPIWebhookWithTokenJSONBody } from 'discord-api-types/v10';

import { OpenAIApi, Configuration } from "openai";
import fetchAdapter from "@vespaiach/axios-fetch-adapter";

async function readRequestBody(request: Request) {
  const { headers } = request
  const contentType = headers.get("content-type") || ""

  if (contentType.includes("application/json")) {
    return request.json();
  }
  else {
    return null;
  }
}

function checkForbidden(input: string) {
  return input.includes("@everyone") || input.includes("@here") || input.includes("<@");
}

async function hashText(content: string, algorithm = "SHA-256") {
  const dataArr = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest({ name: algorithm }, dataArr);

  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function getHashedIp(request: Request, env: Env) {
  var ipAddr = request.headers.get('cf-connecting-ip');
  if (ipAddr == null) {
    return null;
  }

  const secret = env.AVATAR_PEPPER || "A_Really_Bad_Pepper_95CCD5A2A352";
  const hexDigest = await hashText(`BUGBAIT{user=${ipAddr},secret=${secret}}`);
  return hexDigest.slice(-8);
}

function getAvatarUrl(seed: string) {
  return `https://api.dicebear.com/9.x/identicon/png?size=64&backgroundType=gradientLinear&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf&seed=${seed}`;
}

// Each element in this array is a "test set", consisting of one or more tests to run again the received feedback.
// If ANY test set passes, the feedback is silently dropped. A success response is returned to the client,
// but the feedback in question is not actually sent out.
// Test sets may be either a single value, or an array of one or more values.
// - RegExp objects will be tested against the feedback sender string AS-IS (not forcibly made case-insensitive)
// - Functions will be invoked with the ENTIRE feedback object, and should return TRUTHY to block the feedback
// - Plain strings will be case-insensitively substring matched against the sender (and pass if they are found)
// - Other values will be silently ignored, so as to not break everything
// As an example, the following test sets are equivalent:
// - "just feedback"
// - /just feedback/ui
// - (feedbackObject) => feedbackObject.reporter.toLowerCase().includes("just feedback")
// - [ "just feedback" ]
// - [ /just feedback/ui ]
// - [ (feedbackObject) => feedbackObject.reporter.toLowerCase().includes("just feedback") ]
// The test set `[ "just", "feedback" ]` is NOT equivalent, since it would also match sender names such as
// "this is just some feedback", but it WOULD also match any sender name that the above examples match.
// For complex test functions, the feedback object contains these properties:
// - content (message body)
// - name (plugin name)
// - version (plugin version)
// - reporter (contact details)
// - exception (C# stack trace) [optional]
// - dhash (dalamud version hash)
const SILENT_FEEDBACK_BLOCK_TESTS = [
  ["just", "feedback"],
  /^\s*feedback\s*$/ui,
  /^\s*\.+\s*$/u, // ".", "...", etc
  /^\s*-?n\/?a-?\s*$/ui, // "na", "-na", "n/a", "-n/a", etc
];
function isFeedbackSilentlyIgnored(feedbackObject: Feedback) {
  const runSingleTest = (fb: Feedback, test: ((fb: Feedback) => boolean) | string | RegExp) => {
    if (typeof test == "function")
      return test(fb);
    if (typeof test == "string")
      return fb.reporter && fb.reporter.toLowerCase().includes(test);
    if (RegExp.prototype.isPrototypeOf(test))
      return fb.reporter && test.test(fb.reporter);
    return false; // invalid test types are silently ignored and do not "pass"
  };
  return SILENT_FEEDBACK_BLOCK_TESTS.some(testSet => {
    if (Array.isArray(testSet))
      return testSet.every(t => runSingleTest(feedbackObject, t));
    return runSingleTest(feedbackObject, testSet);
  });
}

async function handleRequest(request: Request, env: Env) {
  const reqBody = await readRequestBody(request) as Feedback;

  if (!reqBody) {
    return new Response(`no body`, { status: 400 });
  }

  if (!reqBody.content || !reqBody.version || !reqBody.name || !reqBody.dhash) {
    return new Response(`no content`, { status: 400 });
  }

  if (checkForbidden(reqBody.content) || checkForbidden(reqBody.name) || checkForbidden(reqBody.version) || checkForbidden(reqBody.dhash)) {
    return new Response(`You are in violation of the following internatiÿÿÿÿ`, { status: 451 });
  }

  if (isFeedbackSilentlyIgnored(reqBody)) {
    return new Response();
  }

  let reporterId = await getHashedIp(request, env);

  let res = await sendWebHook(
    reqBody.content,
    reqBody.name,
    reqBody.version,
    reqBody.reporter,
    reporterId,
    reqBody.exception,
    reqBody.dhash,
    env
  );

  if (res == true) {
    return new Response();
  }
  else {
    return new Response(`dispatch failed`, { status: 400 });
  }
}

async function condenseText(body: string, token: string) {
  const configuration = new Configuration({
    apiKey: token,
  });
  const openai = new OpenAIApi(configuration);

  //const prompt = `The following is user feedback:\n\n${body}\n\nPlease summarise it as one line.\n`

  let prompt = "You are a chat bot dedicated to summarizing user feedback for software. Please summarize it in one line. If the feedback is in a language other than English, please translate it beforehand. Don't output anything but the summarized content and don't prefix the output with terms like \"Summary\" or \"Feedback\".";

  const compl = await openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content: prompt
      },
      {
        role: "user",
        content: body
      }
    ]
  },
  {
    adapter: fetchAdapter,
  });

  //console.log(compl);

  // We *want* this method to throw if we can't access this so suppress the null check with !
  return compl.data.choices[0].message!.content;

  /*
  const completion = await openai.createCompletion({
    model: "text-davinci-002",
    prompt: prompt,
    temperature: 0.7,
    max_tokens: 256,
  },
  {
    adapter: fetchAdapter,
  });

    return completion.data.choices[0].text;
  */
}

// This can be turned off if the account has run out of money or if some other issue has come up
const AI_SUMMARY_ENABLED = false;
async function sendWebHook(
  content: string,
  name: string,
  version: string,
  reporter: string | null,
  reporterId: string | null,
  exception: string | null,
  dhash: string,
  env: Env
) {
  var condensed = "User Feedback";
  if (AI_SUMMARY_ENABLED && content.length > 10 && content.length < 1200) {
    try
    {
      const aiCondensed = await condenseText(content, env.OPENAI_TOKEN);
      if (!checkForbidden(aiCondensed))
      {
        condensed = aiCondensed; //.replace(/(\r\n|\n|\r)/gm, "");
      }
    }
    catch(e)
    {
      console.log("Couldn't condense text");
      console.log(e);
      condensed = "Couldn't condense";
    }
  }

  const embed: APIEmbed = {
    "title": "Feedback for " + name,
    "description": content,
    "author": {
      "name": "Unknown Reporter"
    },
    "color": 11289400,
    "timestamp": new Date().toISOString(),
    "thumbnail": {
      "url": "https://raw.githubusercontent.com/goatcorp/DalamudPluginsD17/main/stable/" + name + "/images/icon.png"
    },
    "fields": [
      {
        "name": "Plugin Version",
        "value": version,
        "inline": true
      },
      {
        "name": "Dalamud Version",
        "value": dhash,
        "inline": true
      }
    ]
  };
  const body: RESTPostAPIWebhookWithTokenJSONBody = {
    "content": `${name}: ${condensed}`,
    "allowed_mentions": {
      "parse": []
    },
    "embeds": [embed]
  };

  if (reporter && !checkForbidden(reporter)) {
    embed.author!.name = reporter;
  } else if (reporterId != null) {
    embed.author!.name = `Anonymous Reporter ${reporterId}`;
  }

  if (reporterId != null) {
    embed.author!.icon_url = getAvatarUrl(reporterId);
  }

  if (exception && !checkForbidden(exception)) {
    embed.fields!.push({
      "name": "Exception",
      "value": "```" + exception.substring(0, 950) + "```"
    });
  }

  const init = {
    body: JSON.stringify(body),
    method: "POST",
    headers: {
      "content-type": "application/json;charset=UTF-8",
    },
  }
  const response = await fetch(env.DEFAULT_WEBHOOK, init)
  return response.status === 204;
}

export default {
  async fetch(request: Request, env: Env) {
    if (request.method === "POST") {
      return handleRequest(request, env);
    }
    else if (request.method === "GET") {
      return new Response(`unsupported`, { status: 400 });
    }
  },
};
