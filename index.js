// pooped

/**
 * readRequestBody reads in the incoming request body
 * Use await readRequestBody(..) in an async function to get the string
 * @param {Request} request the incoming request to read from
 */
async function readRequestBody(request) {
  const { headers } = request
  const contentType = headers.get("content-type") || ""

  if (contentType.includes("application/json")) {
    return await request.json();
  }
  else
  {
    return null;
  }
}

function checkForbidden(input) {
  return input.includes("@everyone") || input.includes("@here") || input.includes("<@");
}

async function handleRequest(request) {
  const reqBody = await readRequestBody(request)

  if (!reqBody)
  {
    return new Response(`no body`, {status: 400});
  }

  if (!reqBody.content || !reqBody.version || !reqBody.name || !reqBody.dhash )
  {
    return new Response(`no content`, {status: 400});
  }

  if (checkForbidden(reqBody.content) || checkForbidden(reqBody.name) || checkForbidden(reqBody.version) || checkForbidden(reqBody.dhash))
  {
    return new Response(`You are in violation of the following internatiÿÿÿÿ`, {status: 451});
  }

  let res = await sendWebHook(reqBody.content, reqBody.name, reqBody.version, reqBody.reporter, reqBody.exception, reqBody.dhash);
  console.log(res);
  if (res == true)
  {
    return new Response();
  }
  else
  {
    return new Response(`dispatch failed`, {status: 400});
  }
}

async function sendWebHook(content, name, version, reporter, exception, dhash) {
  let body = {
    "content": "User feedback: " + name,
    "embeds": [
      {
        "title": "Feedback for " + name,
        "description": content,
        "color": 11289400,
        "timestamp": new Date().toISOString(),
        "footer": {
          "text": version,
        },
        "thumbnail": {
          "url": "https://raw.githubusercontent.com/goatcorp/DalamudPlugins/api5/plugins/" + name + "/images/icon.png"
        },
        "fields": [
          {
            "name": "Dalamud commit#",
            "value": dhash
          }
        ]
      }
    ]
  };

  if (reporter && !checkForbidden(reporter))
  {
      body.embeds[0].author = {
          "name": reporter
      };
  }

  if (exception && !checkForbidden(exception))
  {
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
  const response = await fetch(DEFAULT_WEBHOOK, init)

  console.log(response);

  return response.status === 204;
}

addEventListener("fetch", event => {
  const { request } = event
  const { url } = request

  if (request.method === "POST") {
    return event.respondWith(handleRequest(request))
  }
  else if (request.method === "GET") {
    return event.respondWith(new Response(`unsupported`, {status: 400}))
  }
})
