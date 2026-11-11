const maxMessages = 20;
const maxMessageLength = 6000;

function sendJson(response, statusCode, data) {
  response.status(statusCode).setHeader("Cache-Control", "no-store");
  response.json(data);
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

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }

  if (!process.env.GROQ_API_KEY) {
    sendJson(response, 503, { error: "Add GROQ_API_KEY to the Vercel project environment variables." });
    return;
  }

  if (Number(request.headers["content-length"]) > 64 * 1024) {
    sendJson(response, 413, { error: "Request is too large." });
    return;
  }

  let payload = request.body;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      sendJson(response, 400, { error: "Request body must be valid JSON." });
      return;
    }
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

      if (groqResponse.status === 429) {
        sendJson(response, 429, {
          error: "Groq's free-tier rate limit was reached. Please wait a moment and try again.",
        });
        return;
      }

      if (groqResponse.status === 401) {
        sendJson(response, 502, { error: "Groq rejected the API key. Check GROQ_API_KEY in your Vercel environment variables." });
        return;
      }

      if (groqResponse.status === 404) {
        sendJson(response, 502, { error: "Groq couldn't find this model. Set GROQ_MODEL to a chat model available to your account." });
        return;
      }

      sendJson(response, 502, { error: "Groq couldn't complete that reply. Please try again." });
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
};
