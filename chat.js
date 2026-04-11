// Echter KI-Chatbot via Claude API
const SYSTEM_PROMPT = `Du bist der freundliche KI-Assistent der Pizzeria Latina in Frankfurt.

Infos über Pizzeria Latina:
- Öffnungszeiten: Mo–Sa 11:00–22:00, So 12:00–21:00
- Adresse: Berger Straße 42, 60316 Frankfurt
- Telefon: 069 987654
- Speisekarte (Auszug):
  - Margherita: 9,90€
  - Salami: 11,50€
  - Tonno: 12,90€
  - 4 Stagioni: 13,50€
  - Vegetarische Pizza: ab 10,90€
  - Pasta Carbonara: 11,90€
  - Pasta Bolognese: 10,90€
  - Tiramisu: 4,90€
- Lieferservice: ja, Mindestbestellwert 15€, Lieferzeit ca. 35 Min
- Tischreservierung: per Telefon oder vor Ort
- Parkplätze: Straßenparkplätze in der Nähe

Antworte immer freundlich und kurz auf Deutsch. Du bist ein Chatbot — kein Mensch.
Wenn du etwas nicht weißt, verweise ans Telefon: 069 987654.`;

let messages = [];

async function callClaude(userMessage) {
  messages.push({ role: 'user', content: userMessage });

  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const API_URL = isLocal ? 'http://localhost:3131/api' : (window.location.origin + '/api');
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: messages.slice(-10) // max 10 Nachrichten Kontext
    })
  });

  const data = await response.json();
  const reply = data.content?.[0]?.text || 'Entschuldigung, kurzer Fehler. Ruf uns an: 069 123456';

  messages.push({ role: 'assistant', content: reply });
  return reply;
}

function addMessage(text, role) {
  const container = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = `msg ${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  bubble.innerHTML = text.replace(/\n/g, '<br>');
  div.appendChild(bubble);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function showTyping() {
  const container = document.getElementById('messages');
  const div = document.createElement('div');
  div.className = 'msg bot';
  div.id = 'typing-indicator';
  div.innerHTML = '<div class="msg-bubble"><div class="typing"><span></span><span></span><span></span></div></div>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function removeTyping() {
  const el = document.getElementById('typing-indicator');
  if (el) el.remove();
}

async function sendMessage() {
  const input = document.getElementById('userInput');
  const text = input.value.trim();
  if (!text) return;

  addMessage(text, 'user');
  input.value = '';
  input.disabled = true;

  showTyping();

  try {
    const reply = await callClaude(text);
    removeTyping();
    addMessage(reply, 'bot');
  } catch (e) {
    removeTyping();
    addMessage('Kurzer Fehler — ruf uns an: 📞 069 123456', 'bot');
  }

  input.disabled = false;
  input.focus();
}

document.getElementById('userInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendMessage();
});

document.querySelectorAll('.demo-hints li').forEach(li => {
  li.addEventListener('click', () => {
    const text = li.textContent.replace('👉 ', '').replace(/"/g, '');
    document.getElementById('userInput').value = text;
    sendMessage();
  });
});

function submitForm(e) {
  e.preventDefault();
  e.target.style.display = 'none';
  document.getElementById('form-success').style.display = 'block';
}
