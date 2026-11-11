const form = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const messagesElement = document.querySelector("#messages");
const welcome = document.querySelector("#welcome");
const conversation = document.querySelector("#conversation");
const newChatButton = document.querySelector("#new-chat");
const mobileNewChatButton = document.querySelector("#mobile-new-chat");
const clearChatButton = document.querySelector("#clear-chat");

const history = [];
let isSending = false;

function scrollToLatest() {
  conversation.scrollTop = conversation.scrollHeight;
}

function makeAvatar(isUser) {
  const avatar = document.createElement("span");
  avatar.className = "message-avatar";
  if (isUser) {
    avatar.textContent = "Y";
  } else {
    avatar.innerHTML = '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><circle cx="16" cy="16" r="11.25" stroke="currentColor" stroke-width="1.6"/><ellipse cx="16" cy="16" rx="14" ry="5.5" transform="rotate(-35 16 16)" stroke="currentColor" stroke-width="1.6"/><circle cx="23.5" cy="9.75" r="2.25" fill="currentColor"/></svg>';
  }
  return avatar;
}

function appendMessage(role, content, options = {}) {
  welcome.classList.add("hidden");
  messagesElement.classList.add("visible");

  const message = document.createElement("article");
  message.className = `message ${role === "user" ? "user" : "assistant"}`;
  message.append(makeAvatar(role === "user"));

  const body = document.createElement("div");
  body.className = "message-content";
  if (options.typing) {
    body.innerHTML = '<span class="typing-dots" aria-label="Orbit is thinking"><i></i><i></i><i></i></span>';
    message.setAttribute("aria-label", "Orbit is thinking");
  } else {
    body.textContent = content;
    if (options.error) body.classList.add("error-message");
  }
  message.append(body);
  messagesElement.append(message);
  scrollToLatest();
  return { message, body };
}

function setSending(sending) {
  isSending = sending;
  sendButton.disabled = sending || input.value.trim().length === 0;
  input.disabled = sending;
}

async function sendMessage(text) {
  const content = text.trim();
  if (!content || isSending) return;

  history.push({ role: "user", content });
  appendMessage("user", content);
  input.value = "";
  input.style.height = "auto";
  setSending(true);

  const pending = appendMessage("assistant", "", { typing: true });

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: history.slice(-19) }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");

    pending.message.remove();
    history.push({ role: "assistant", content: result.reply });
    appendMessage("assistant", result.reply);
  } catch (error) {
    pending.message.remove();
    history.pop();
    appendMessage("assistant", error.message || "Couldn't connect. Please try again.", { error: true });
  } finally {
    setSending(false);
    input.focus();
  }
}

function startNewChat() {
  if (isSending) return;
  history.length = 0;
  messagesElement.replaceChildren();
  messagesElement.classList.remove("visible");
  welcome.classList.remove("hidden");
  input.value = "";
  input.style.height = "auto";
  sendButton.disabled = true;
  input.focus();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  sendButton.disabled = isSending || input.value.trim().length === 0;
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

for (const button of document.querySelectorAll(".suggestion")) {
  button.addEventListener("click", () => {
    const prompts = [
      "Help me brainstorm a side project. Ask me a couple of questions to find an idea that fits.",
      "Explain a tricky idea in simple terms. Start by asking what topic I want to learn.",
      "Help me find the right words. Ask what I am writing and who it is for.",
    ];
    const index = Array.from(document.querySelectorAll(".suggestion")).indexOf(button);
    input.value = prompts[index];
    input.dispatchEvent(new Event("input"));
    input.focus();
  });
}

newChatButton.addEventListener("click", startNewChat);
mobileNewChatButton.addEventListener("click", startNewChat);
clearChatButton.addEventListener("click", startNewChat);

document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    startNewChat();
  }
});
