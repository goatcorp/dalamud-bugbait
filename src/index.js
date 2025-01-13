/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npx wrangler dev src/index.js` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npx wrangler publish src/index.js --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { OpenAIApi, Configuration } from "openai";
import fetchAdapter from "@vespaiach/axios-fetch-adapter";

async function readRequestBody(request) {
    const { headers } = request
    const contentType = headers.get("content-type") || ""

    if (contentType.includes("application/json")) {
        return await request.json();
    }
    else {
        return null;
    }
}

async function getPluginMetadata(name) {
    let response = await fetch(`https://kamori.goats.dev/Plugin/Plugin/${name}`);

    if (response.status !== 200) {
        return null;
    }

    return await response.json();
}

function checkForbidden(input) {
    return input.includes("@everyone") || input.includes("@here") || input.includes("<@");
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
function isFeedbackSilentlyIgnored(feedbackObject) {
    const runSingleTest = (fb, test) => {
        if (typeof test == "function")
            return test(fb);
        if (typeof test == "string")
            return fb.reporter.toLowerCase().includes(test);
        if (RegExp.prototype.isPrototypeOf(test))
            return test.test(fb.reporter);
        return false; // invalid test types are silently ignored and do not "pass"
    };
    return SILENT_FEEDBACK_BLOCK_TESTS.some(testSet => {
        if (Array.isArray(testSet))
            return testSet.every(t => runSingleTest(feedbackObject, t));
        return runSingleTest(feedbackObject, testSet);
    });
}

async function handleRequest(request, env) {
    const reqBody = await readRequestBody(request)

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

    let pluginMetadata = await getPluginMetadata(reqBody.name);
    if (pluginMetadata == null) {
        return new Response(`plugin not found`, { status: 404 });
    }

    if (!pluginMetadata.AcceptsFeedback) {
        return new Response(`plugin does not accept feedback`, { status: 403 });
    }

    let res = await sendWebHook(reqBody, pluginMetadata, env);

    if (res === true) {
        return new Response();
    }
    else {
        return new Response(`dispatch failed`, { status: 400 });
    }
}

async function condenseText(body, token) {
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
    return compl.data.choices[0].message.content;

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
async function sendWebHook(request, manifest, env) {
    let { content, name, version, reporter, exception, dhash } = request;

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

    let body = {
        "content": `${name}: ${condensed}`,
        "allowed_mentions": {
            "parse": []
        },
        "embeds": [
            {
                "title": "Feedback for " + name,
                "description": content,
                "color": 0xAC4338,
                "timestamp": new Date().toISOString(),
                "thumbnail": {
                    "url": manifest.IconUrl || "https://raw.githubusercontent.com/goatcorp/DalamudPluginsD17/main/stable/" + name + "/images/icon.png"
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
            }
        ]
    };

    if (reporter) {
        body.embeds[0].author = {
            "name": reporter
        };
    }

    if (exception) {
        body.embeds[0].fields[1] = {
            "name": "Exception",
            "value": "```" + exception.substring(0, 950) + "```"
        };
    }

    const init = {
        body: JSON.stringify(body),
        method: "POST",
        headers: {
            "content-type": "application/json;charset=UTF-8",
        },
    }

    const feedbackUrl = manifest.FeedbackUrl || env.DEFAULT_WEBHOOK;

    const response = await fetch(feedbackUrl, init)
    return response.status === 204;
}

export default {
    async fetch(request, env) {
        if (request.method === "POST") {
            return handleRequest(request, env);
        }
        else if (request.method === "GET") {
            return new Response(`unsupported`, { status: 400 });
        }
    },
};
