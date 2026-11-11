const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.env.PORT) || 3000;
const publicDirectory = path.join(__dirname, "public");
const maxRequestBytes = 64 * 1024;
const maxMessages = 20;
const maxMessageLength = 6000;

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let overLimit = false;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      if (overLimit) return;
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > maxRequestBytes) {
        overLimit = true;
        body = "";
        reject(Object.assign(new Error("Request is too large."), { statusCode: 413 }));
      }
    });
    request.on("end", () => {
      if (overLimit) return;
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > maxMessages) {
    return "Send between 1 and 20 messages.";
  }

  for (const message of messages) {
    if (
      !message ||
      !["user", "assistant"].includes(message.role) ||
      typeof message.content !== "string" ||
      message.content.trim().length === 0 ||
      message.content.length > maxMessageLength
    ) {
      return "Each message must have a valid role and contain 1 to 6000 characters.";
    }
  }

  if (messages[messages.length - 1].role !== "user") {
    return "The last message must be from the user.";
  }

  return null;
}

async function handleChat(request, response) {
  if (!process.env.GROQ_API_KEY) {
    sendJson(response, 503, { error: "Add your Groq API key to the .env file to start chatting." });
    return;
  }

  let payload;
  try {
    payload = await readJson(request);
  } catch (error) {
    if (!response.destroyed) {
      sendJson(response, error.statusCode || 400, { error: error.message || "Unable to read request." });
    }
    return;
  }

  const validationError = validateMessages(payload?.messages);
  if (validationError) {
    sendJson(response, 400, { error: validationError });
    return;
  }

  try {
    const groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
        messages: [
          {
            role: "system",
            content: "You are a helpful, thoughtful assistant. Be clear, accurate, and concise.",
          },
          ...payload.messages.map(({ role, content }) => ({ role, content: content.trim() })),
        ],
        temperature: 0.7,
        max_tokens: 2048,
      }),
      signal: AbortSignal.timeout(60000),
    });

    const result = await groqResponse.json().catch(() => ({}));
    if (!groqResponse.ok) {
      console.error("Groq API request failed:", groqResponse.status, result.error?.message || "Unknown error");
      sendJson(response, groqResponse.status === 429 ? 429 : 502, {
        error:
          groqResponse.status === 429
            ? "Groq is receiving too many requests right now. Please try again shortly."
            : "Groq couldn't complete that reply. Please try again.",
      });
      return;
    }

    const reply = result.choices?.[0]?.message?.content;
    if (typeof reply !== "string" || !reply.trim()) {
      console.error("Groq API returned no assistant message.");
      sendJson(response, 502, { error: "Groq returned an empty reply. Please try again." });
      return;
    }

    sendJson(response, 200, { reply: reply.trim() });
  } catch (error) {
    console.error("Unable to reach Groq:", error.message);
    sendJson(response, 502, {
      error: error.name === "TimeoutError" ? "Groq took too long to respond. Please try again." : "Couldn't reach Groq. Check your connection and try again.",
    });
  }
}

function serveStatic(request, response) {
  let pathname;
  try {
    pathname = new URL(request.url, `http://${request.headers.host || "localhost"}`).pathname;
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad request");
    return;
  }

  let requestedPath;
  try {
    requestedPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad request");
    return;
  }

  const filePath = path.resolve(publicDirectory, `.${requestedPath}`);

  if (!filePath.startsWith(`${publicDirectory}${path.sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, contents) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(contents);
  });
}

const server = http.createServer((request, response) => {
  if (request.method === "POST" && request.url === "/api/chat") {
    handleChat(request, response);
    return;
  }

  if (request.method === "GET") {
    serveStatic(request, response);
    return;
  }

  sendJson(response, 405, { error: "Method not allowed." });
});

server.listen(port, () => {
  console.log(`Groq chatbot running at http://localhost:${port}`);
});
