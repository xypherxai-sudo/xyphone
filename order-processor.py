#!/usr/bin/env python3
"""
Xyphone Order Processor
- Liest neue Auftrags-Emails aus Gmail
- Generiert personalisierte Demo-Seite
- Deployt auf Netlify
- Schickt Demo-Link an Kunden
"""

import subprocess
import json
import os
import re
import requests
import zipfile
import io
import smtplib
import ssl
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime

# ── Config ────────────────────────────────────────────────────────────────────
NETLIFY_SITE_ID  = "874fd886-b9fc-43a3-9a15-64e89d78c8d4"
NETLIFY_TOKEN    = "nfc_N87FzWRJNQ211DbC7RhRcCnwHGvytJa937a7"
GMAIL_USER       = "xypherxai@gmail.com"
GMAIL_APP_PASS   = "wybkjorclbssypml"
PROCESSED_FILE   = os.path.join(os.path.dirname(__file__), "processed-orders.json")
DEMO_BASE_URL    = "https://xyphone-de.netlify.app"
ELEVENLABS_AGENT = "agent_2401kn1xe7p0e5trn6bpdjqca9qd"
# ──────────────────────────────────────────────────────────────────────────────

def load_processed():
    if os.path.exists(PROCESSED_FILE):
        with open(PROCESSED_FILE) as f:
            return json.load(f)
    return []

def save_processed(ids):
    with open(PROCESSED_FILE, "w") as f:
        json.dump(ids, f)

def get_emails():
    result = subprocess.run(
        ["himalaya", "envelope", "list", "--output", "json", "--page-size", "20"],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        print("Fehler beim Email-Abruf:", result.stderr)
        return []
    try:
        return json.loads(result.stdout)
    except:
        return []

def read_email(email_id):
    result = subprocess.run(
        ["himalaya", "message", "read", str(email_id)],
        capture_output=True, text=True
    )
    return result.stdout

def parse_order(body):
    """Extrahiert Felder aus Formular-Email"""
    fields = {}
    patterns = {
        "branche":      r"branche\s*:\s*(.+)",
        "bizName":      r"bizName\s*:\s*(.+)",
        "bizCity":      r"bizCity\s*:\s*(.+)",
        "bizHours":     r"bizHours\s*:\s*(.+)",
        "services":     r"services\s*:\s*(.+)",
        "faq":          r"faq\s*:\s*(.+)",
        "contactName":  r"contactName\s*:\s*(.+)",
        "contactEmail": r"contactEmail\s*:\s*(.+)",
        "contactPhone": r"contactPhone\s*:\s*(.+)",
    }
    for key, pattern in patterns.items():
        m = re.search(pattern, body, re.IGNORECASE)
        fields[key] = m.group(1).strip() if m else ""
    return fields

def slugify(text):
    text = text.lower().strip()
    text = re.sub(r'[^a-z0-9]+', '-', text)
    text = re.sub(r'-+', '-', text).strip('-')
    return text[:30]

def get_branche_emoji(branche):
    mapping = {
        "arztpraxis": "🏥", "arzt": "🏥", "zahnarzt": "🦷",
        "restaurant": "🍽️", "pizzeria": "🍕", "cafe": "☕",
        "friseur": "💇", "friseursalon": "💇",
        "handwerker": "🔧", "elektriker": "⚡", "klempner": "🔧",
        "fitnessstudio": "🏋️", "gym": "🏋️",
        "autowerkstatt": "🚗", "kfz": "🚗",
        "immobilien": "🏠",
        "anwalt": "⚖️", "kanzlei": "⚖️",
        "kosmetik": "💄", "kosmetikstudio": "💄",
        "physiotherapie": "🩺", "therapie": "🩺",
    }
    b = branche.lower()
    for key, emoji in mapping.items():
        if key in b:
            return emoji
    return "🏢"

def generate_demo_html(order, agent_id=None):
    agent_id = agent_id or ELEVENLABS_AGENT
    biz_name    = order.get("bizName", "Ihr Unternehmen")
    biz_city    = order.get("bizCity", "")
    biz_hours   = order.get("bizHours", "Mo–Fr 9–18 Uhr")
    services    = order.get("services", "")
    faq_text    = order.get("faq", "")
    branche     = order.get("branche", "Unternehmen")
    emoji       = get_branche_emoji(branche)

    # FAQ als Liste
    faq_items = ""
    if faq_text:
        for line in faq_text.split(","):
            line = line.strip()
            if line:
                faq_items += f'<li>👉 "{line}"</li>\n'
    if not faq_items:
        faq_items = f'<li>👉 "Wann haben Sie geöffnet?"</li>\n<li>👉 "Welche Leistungen bieten Sie an?"</li>\n'

    return f"""<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{biz_name} — KI-Telefon-Bot Demo</title>
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=Syne+Mono&display=swap" rel="stylesheet">
<style>
*, *::before, *::after {{ box-sizing: border-box; margin: 0; padding: 0; }}
:root {{
  --bg: #0a0a14; --white: #0f0f1e; --border: rgba(124,58,237,0.2);
  --acc: #7c3aed; --acc-soft: rgba(124,58,237,0.15); --text: #f0f0ff;
  --text2: rgba(240,240,255,0.55); --green: #00b87a;
}}
body {{ font-family: 'Syne', sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }}
nav {{ background: var(--white); border-bottom: 1px solid var(--border); padding: 0 24px; height: 58px;
  display: flex; align-items: center; gap: 16px; position: sticky; top: 0; z-index: 100; }}
.logo {{ font-size: 17px; font-weight: 800; letter-spacing: .18em; color: var(--text); display: flex; align-items: center; gap: 9px; }}
.logo-hex {{ width: 24px; height: 24px; background: var(--acc);
  clip-path: polygon(50% 0%,100% 25%,100% 75%,50% 100%,0% 75%,0% 25%);
  animation: spin 14s linear infinite; flex-shrink: 0; }}
@keyframes spin {{ to {{ transform: rotate(360deg); }} }}
.hero {{ max-width: 860px; margin: 0 auto; padding: 60px 24px 40px; text-align: center; }}
.hero-tag {{ display: inline-flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 700;
  text-transform: uppercase; color: var(--acc); background: var(--acc-soft); padding: 5px 14px;
  border-radius: 20px; margin-bottom: 20px; }}
.hero h1 {{ font-size: clamp(26px,5vw,42px); font-weight: 800; margin-bottom: 16px; }}
.hero h1 span {{ color: var(--acc); }}
.hero p {{ font-size: 16px; color: var(--text2); max-width: 560px; margin: 0 auto; line-height: 1.6; }}
.main {{ max-width: 860px; margin: 0 auto 60px; padding: 0 24px;
  display: grid; grid-template-columns: 1fr 300px; gap: 32px; align-items: start; }}
.info-col {{ display: flex; flex-direction: column; gap: 16px; }}
.card {{ background: var(--white); border: 1px solid var(--border); border-radius: 14px; padding: 22px; }}
.card h3 {{ font-size: 14px; font-weight: 700; margin-bottom: 12px; }}
.card p, .card li {{ font-size: 13px; color: var(--text2); line-height: 1.6; }}
.card ul {{ padding-left: 0; list-style: none; }}
.phone-col {{ display: flex; flex-direction: column; align-items: center; gap: 16px; }}
.phone {{ width: 240px; background: #1a1a2e; border-radius: 44px; padding: 10px;
  box-shadow: 0 20px 60px rgba(0,0,0,.4), 0 0 0 1px rgba(255,255,255,.06); }}
.phone-inner {{ background: #0d0d1a; border-radius: 36px; overflow: hidden; }}
.phone-screen {{ padding: 14px; height: 400px; display: flex; flex-direction: column; overflow: hidden; }}
.call-idle {{ flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:12px; text-align:center; }}
.call-avatar {{ width:70px; height:70px; background:linear-gradient(135deg,var(--acc),#8b7cf8);
  border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:32px;
  box-shadow:0 0 30px rgba(91,78,240,.4); }}
.call-btn {{ width:52px; height:52px; border-radius:50%; border:none; cursor:pointer;
  display:flex; align-items:center; justify-content:center; font-size:22px; transition:transform .2s; }}
.call-btn:hover {{ transform: scale(1.1); }}
.call-btn.green {{ background:#00b87a; box-shadow:0 4px 20px rgba(0,184,122,.4); animation:pulse-green 2s ease-in-out infinite; }}
.call-btn.red {{ background:#e84545; box-shadow:0 4px 20px rgba(232,69,69,.4); }}
@keyframes pulse-green {{ 0%,100% {{ box-shadow:0 4px 20px rgba(0,184,122,.4); }} 50% {{ box-shadow:0 4px 30px rgba(0,184,122,.7); }} }}
.call-active {{ display:none; flex-direction:column; flex:1; overflow:hidden; }}
.call-header {{ display:flex; align-items:center; gap:10px; padding-bottom:10px;
  border-bottom:1px solid rgba(255,255,255,.08); margin-bottom:10px; flex-shrink:0; }}
.call-avatar-sm {{ width:32px; height:32px; background:linear-gradient(135deg,var(--acc),#8b7cf8);
  border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:15px; }}
.call-msgs {{ flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:8px; min-height:0; }}
.call-msgs::-webkit-scrollbar {{ display:none; }}
.bubble {{ padding:7px 10px; border-radius:10px; font-size:11px; line-height:1.5; max-width:85%; animation:fadeIn .3s ease; }}
@keyframes fadeIn {{ from {{ opacity:0; transform:translateY(4px); }} to {{ opacity:1; transform:translateY(0); }} }}
.bubble.bot {{ background:rgba(91,78,240,.25); color:rgba(255,255,255,.9); border-bottom-left-radius:3px; align-self:flex-start; }}
.bubble.user {{ background:rgba(255,255,255,.12); color:rgba(255,255,255,.75); border-bottom-right-radius:3px; align-self:flex-end; }}
.bubble-label {{ font-size:8px; font-weight:700; text-transform:uppercase; margin-bottom:2px; opacity:.6; }}
.wave {{ display:flex; align-items:center; gap:2px; padding:7px 12px; background:rgba(91,78,240,.2);
  border-radius:10px; align-self:flex-start; width:50px; }}
.wave span {{ width:3px; background:var(--acc); border-radius:2px; animation:wave .8s ease-in-out infinite; }}
.wave span:nth-child(1) {{ animation-delay:0s; }} .wave span:nth-child(2) {{ animation-delay:.1s; }}
.wave span:nth-child(3) {{ animation-delay:.2s; }} .wave span:nth-child(4) {{ animation-delay:.3s; }}
@keyframes wave {{ 0%,100% {{ height:3px; }} 50% {{ height:14px; }} }}
.call-controls {{ display:flex; justify-content:center; align-items:center; gap:16px; padding-top:8px; flex-shrink:0; }}
.mic-ind {{ display:none; justify-content:center; align-items:center; gap:4px; padding:4px 0; flex-shrink:0; }}
.mic-dot {{ width:6px; height:6px; border-radius:50%; background:#a78bfa; animation:micPulse .8s ease-in-out infinite; }}
@keyframes micPulse {{ 0%,100% {{ opacity:1; transform:scale(1); }} 50% {{ opacity:.3; transform:scale(1.5); }} }}
.status-bar {{ display:flex; justify-content:space-between; padding:4px 8px 6px; font-size:9px; color:rgba(255,255,255,.4); font-family:monospace; }}
.hint-box {{ display:inline-flex; align-items:center; gap:6px; background:rgba(0,184,122,0.12);
  border:1px solid rgba(0,184,122,0.3); border-radius:10px; padding:10px 16px; }}
#callStatus {{ font-size:12px; color:rgba(240,240,255,.4); margin-top:4px; text-align:center; }}
#micHint {{ display:none; font-size:12px; font-weight:700; color:var(--acc); text-align:center; margin-top:4px; }}
footer {{ text-align:center; padding:24px; border-top:1px solid var(--border);
  background:var(--white); font-size:12px; color:var(--text2); }}
footer a {{ color:var(--acc); font-weight:700; text-decoration:none; }}
@media(max-width:680px) {{ .main {{ grid-template-columns:1fr; }} .phone-col {{ order:-1; }} }}
</style>
</head>
<body>
<div style="position:fixed;inset:0;background-image:linear-gradient(rgba(124,58,237,0.04) 1px,transparent 1px),linear-gradient(90deg,rgba(124,58,237,0.04) 1px,transparent 1px);background-size:60px 60px;pointer-events:none;z-index:0;"></div>

<nav>
  <div class="logo"><div class="logo-hex"></div>XYPHONE</div>
  <div style="margin-left:auto;font-size:12px;color:var(--text2);">KI-Demo für <strong style="color:var(--text);">{biz_name}</strong></div>
</nav>

<section class="hero">
  <div class="hero-tag">{emoji} {branche}</div>
  <h1>KI-Telefon-Bot für<br><span>{biz_name}</span></h1>
  <p>So klingt Ihr persönlicher KI-Assistent — nimmt Anrufe entgegen, bucht Termine und beantwortet Fragen. 24/7, ohne Wartezeit.</p>
</section>

<section class="main">
  <div class="info-col">
    <div class="card">
      <h3>📍 Ihr Betrieb</h3>
      <p><strong>{biz_name}</strong>{f' — {biz_city}' if biz_city else ''}</p>
      <p style="margin-top:6px;"><strong>Öffnungszeiten:</strong> {biz_hours}</p>
      {f'<p style="margin-top:6px;"><strong>Leistungen:</strong> {services}</p>' if services else ''}
    </div>
    <div class="card">
      <h3>🎯 Was der Bot kann</h3>
      <ul>
        {faq_items}
      </ul>
    </div>
    <div class="card">
      <h3>📞 So funktioniert's</h3>
      <p style="margin-bottom:8px;">1. Grünen Hörer drücken</p>
      <p style="margin-bottom:8px;">2. Mikrofon erlauben</p>
      <p>3. Einfach lossprechen — die KI antwortet sofort!</p>
    </div>
  </div>

  <div class="phone-col">
    <div class="phone">
      <div class="phone-inner">
        <div class="status-bar"><span>9:41</span><span>LTE</span></div>
        <div style="width:70px;height:14px;background:#1a1a2e;border-radius:0 0 10px 10px;margin:0 auto;"></div>
        <div class="phone-screen">
          <div class="call-idle" id="callIdle">
            <div class="call-avatar">{emoji}</div>
            <div>
              <div style="color:white;font-size:14px;font-weight:700;">{biz_name}</div>
              <div style="color:rgba(255,255,255,.4);font-size:10px;">KI-Assistent · bereit</div>
            </div>
            <div style="color:rgba(255,255,255,.3);font-size:10px;">Eingehender Anruf...</div>
            <div style="display:flex;gap:36px;margin-top:12px;">
              <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
                <button class="call-btn red" onclick="declineCall()">📵</button>
                <span style="color:rgba(255,255,255,.35);font-size:9px;">Ablehnen</span>
              </div>
              <div style="display:flex;flex-direction:column;align-items:center;gap:6px;">
                <button class="call-btn green" onclick="startCall()">📞</button>
                <span style="color:rgba(255,255,255,.8);font-size:9px;">Annehmen</span>
              </div>
            </div>
          </div>
          <div class="call-active" id="callActive">
            <div class="call-header">
              <div class="call-avatar-sm">{emoji}</div>
              <div>
                <div style="font-size:11px;font-weight:700;color:white;">KI-Assistent</div>
                <div style="font-size:8px;color:rgba(255,255,255,.4);">{biz_name}</div>
              </div>
              <div id="callTimer" style="margin-left:auto;font-family:monospace;font-size:9px;color:var(--green);">00:00</div>
            </div>
            <div class="call-msgs" id="callMsgs"></div>
            <div class="mic-ind" id="micInd">
              <span style="font-size:11px;">🎙️</span>
              <span style="font-size:8px;font-weight:700;color:#a78bfa;letter-spacing:.05em;">SPRICH JETZT</span>
              <span class="mic-dot"></span>
            </div>
            <div class="call-controls">
              <button class="call-btn red" onclick="stopCall()">📵</button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div id="callHint" class="hint-box">
      <span>☝️</span><span style="font-size:13px;font-weight:700;color:#00c48c;">Grünen Hörer drücken!</span>
    </div>
    <div id="callStatus"></div>
    <div id="micHint">🎙️ Einfach lossprechen!</div>
    <div style="font-size:11px;color:rgba(240,240,255,.25);margin-top:4px;">Mikrofon-Zugriff erforderlich</div>
  </div>
</section>

<footer>
  Demo erstellt von <a href="https://xyphone.de">Xyphone</a> — KI-Telefon-Bots für lokale Unternehmen
</footer>

<script>
let conv = null, timerInt = null, timerSecs = 0;

function declineCall() {{
  const idle = document.getElementById('callIdle');
  idle.style.opacity = '.4';
  setTimeout(() => idle.style.opacity = '1', 500);
}}

async function startCall() {{
  document.getElementById('callIdle').style.display = 'none';
  document.getElementById('callActive').style.display = 'flex';
  document.getElementById('callHint').style.display = 'none';
  document.getElementById('callStatus').textContent = '🎙️ Mikrofon wird aktiviert...';
  timerSecs = 0;
  clearInterval(timerInt);
  timerInt = setInterval(() => {{
    timerSecs++;
    const m = String(Math.floor(timerSecs/60)).padStart(2,'0');
    const s = String(timerSecs%60).padStart(2,'0');
    document.getElementById('callTimer').textContent = m+':'+s;
  }}, 1000);

  try {{
    await navigator.mediaDevices.getUserMedia({{audio: true}});
    const mod = await import('https://cdn.jsdelivr.net/npm/@11labs/client@latest/+esm');
    conv = await mod.Conversation.startSession({{
      agentId: '{agent_id}',
      conversationConfigOverride: {{
        agent: {{
          prompt: {{
            prompt: `Du bist der freundliche KI-Telefonassistent von {biz_name} in {biz_city}. Stelle dich immer als Assistent von {biz_name} vor. \n\nÖffnungszeiten: {biz_hours}\n\nLeistungen: {services}\n\nBeantworte alle Fragen auf Deutsch, kurz und freundlich. Wenn du etwas nicht weißt, sag dass du die Information notierst und jemand zurückruft.`
          }},
          firstMessage: `Guten Tag! Sie sind verbunden mit dem KI-Assistenten von {biz_name}. Wie kann ich Ihnen helfen?`
        }}
      }},
      onConnect: () => {{
        document.getElementById('callStatus').textContent = '🎙️ Verbunden — lossprechen!';
        document.getElementById('micHint').style.display = 'block';
        document.getElementById('micInd').style.display = 'flex';
      }},
      onDisconnect: () => stopCall(),
      onError: () => {{
        document.getElementById('callStatus').textContent = '🔄 Demo-Modus';
        document.getElementById('micHint').style.display = 'none';
      }},
      onModeChange: (m) => {{
        const ind = document.getElementById('micInd');
        if (m.mode === 'speaking') {{
          document.getElementById('callStatus').textContent = '🤖 Bot spricht...';
          document.getElementById('micHint').style.display = 'none';
          ind.style.display = 'none';
        }} else if (m.mode === 'listening') {{
          document.getElementById('callStatus').textContent = '🎙️ Jetzt sprechen!';
          document.getElementById('micHint').style.display = 'block';
          ind.style.display = 'flex';
        }}
      }},
      onMessage: (msg) => addBubble(msg.source === 'ai' ? 'bot' : 'user', msg.message)
    }});
  }} catch(e) {{
    document.getElementById('callStatus').textContent = '🔄 Kein Mikrofon — Demo-Modus';
    document.getElementById('micHint').style.display = 'none';
  }}
}}

function stopCall() {{
  if (conv) {{ conv.endSession(); conv = null; }}
  clearInterval(timerInt);
  document.getElementById('callActive').style.display = 'none';
  document.getElementById('callIdle').style.display = 'flex';
  document.getElementById('callHint').style.display = 'inline-flex';
  document.getElementById('callHint').innerHTML = '<span>🔄</span><span style="font-size:13px;font-weight:700;color:#00c48c;">Nochmal starten!</span>';
  document.getElementById('callStatus').textContent = '';
  document.getElementById('micHint').style.display = 'none';
  document.getElementById('callTimer').textContent = '00:00';
  document.getElementById('callMsgs').innerHTML = '';
  document.getElementById('micInd').style.display = 'none';
}}

function addBubble(role, text) {{
  const c = document.getElementById('callMsgs');
  const d = document.createElement('div');
  d.className = 'bubble ' + role;
  d.innerHTML = `<div class="bubble-label">${{role === 'bot' ? '🤖 KI-Assistent' : '👤 Kunde'}}</div>${{text}}`;
  c.appendChild(d);
  c.scrollTop = c.scrollHeight;
}}
</script>
</body>
</html>"""

def deploy_demo(html_content, slug):
    """Deployt eine einzelne HTML-Datei auf Netlify neben den anderen"""
    # Aktuellen Stand abrufen + neue Datei hinzufügen
    zip_buf = io.BytesIO()
    xypher_dir = os.path.join(os.path.dirname(__file__))

    with zipfile.ZipFile(zip_buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        # Alle bestehenden Dateien einpacken
        for fname in os.listdir(xypher_dir):
            fpath = os.path.join(xypher_dir, fname)
            if os.path.isfile(fpath) and not fname.endswith(('.log', '.py', '.sql', '.md', '.json')) \
               and 'node_modules' not in fpath and fname != 'processed-orders.json':
                zf.write(fpath, fname)
        # Neue Demo-Datei
        filename = f"demo-{slug}.html"
        zf.writestr(filename, html_content)

    zip_buf.seek(0)
    resp = requests.post(
        f"https://api.netlify.com/api/v1/sites/{NETLIFY_SITE_ID}/deploys",
        headers={
            "Authorization": f"Bearer {NETLIFY_TOKEN}",
            "Content-Type": "application/zip"
        },
        data=zip_buf.read()
    )
    if resp.status_code in (200, 201):
        deploy_id = resp.json().get("id")
        return f"{DEMO_BASE_URL}/demo-{slug}.html", deploy_id
    else:
        raise Exception(f"Netlify Deploy Fehler: {resp.status_code} {resp.text[:200]}")

def send_demo_email(to_email, to_name, biz_name, demo_url):
    subject = f"Ihre persönliche Demo ist fertig — {biz_name} 🎉"
    body = f"""Hallo {to_name},

Ihre personalisierte KI-Telefon-Bot Demo ist fertig!

🔗 Demo-Link: {demo_url}

Drücken Sie den grünen Hörer und sprechen Sie direkt mit Ihrem KI-Assistenten — genau so würde er bei echten Kundenanrufen klingen.

Was der Bot bereits kann:
✅ Anrufe sofort entgegennehmen (< 1 Sekunde)
✅ Öffnungszeiten & Infos zu Ihrem Betrieb beantworten
✅ Termine buchen & weiterleiten
✅ 24/7 erreichbar — auch wenn Sie beschäftigt sind

Interesse an einer echten Integration? Antworten Sie einfach auf diese Email — wir richten alles in 48h ein.

Mit freundlichen Grüßen,
Xyphone Team
https://xyphone.de
"""
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"]    = f"Xyphone <{GMAIL_USER}>"
    msg["To"]      = to_email
    msg.attach(MIMEText(body, "plain", "utf-8"))

    ctx = ssl.create_default_context()
    with smtplib.SMTP("smtp.gmail.com", 587) as s:
        s.ehlo()
        s.starttls(context=ctx)
        s.login(GMAIL_USER, GMAIL_APP_PASS)
        s.sendmail(GMAIL_USER, to_email, msg.as_string())

ELEVENLABS_API_KEY = "sk_f1b4983a56f7e00aae4b879f3be08ad3a41aff94f843b1d7"

# Bekannte Test-Adressen & Muster
TEST_EMAILS = {"maxmustermann@gmail.com", "test@test.com", "test@example.com"}
TEST_DOMAINS = {"example.com", "test.com", "login.com", "mailinator.com", "guerrillamail.com", "tempmail.com"}
# Typische Spam/Nonsense-Muster
SPAM_PATTERNS = re.compile(r'^([a-z]{2,6})\1+$|^(.{1,4})\2{2,}$|^[a-z]{1,3}[0-9]{3,}$', re.I)

def looks_like_spam(text):
    """Erkennt Nonsense-Text wie 'ergerg', 'asdfasdf', 'erererer'"""
    if not text or len(text.strip()) < 2:
        return True
    t = text.strip().lower().replace(' ', '')
    # Kaum verschiedene Zeichen
    if len(set(t)) < 3:
        return True
    # Wiederholendes Muster
    if SPAM_PATTERNS.match(t):
        return True
    # Erste Hälfte == zweite Hälfte (z.B. "ergerg")
    half = len(t) // 2
    if half > 1 and t[:half] == t[half:half*2]:
        return True
    return False

def is_serious_order(order):
    """True = echter Kunde, False = Spam/Test"""
    biz_name = order.get("bizName", "").strip()
    biz_hours = order.get("bizHours", "").strip()
    services  = order.get("services", "").strip()
    email     = order.get("contactEmail", "").strip().lower()
    phone     = order.get("contactPhone", "").strip()
    branche   = order.get("branche", "").strip()

    # Pflichtfelder leer?
    if not biz_name or not email or not branche:
        print("  ⚠️  Pflichtfelder fehlen")
        return False

    # Email-Domain blocklist
    domain = email.split('@')[-1] if '@' in email else ''
    if domain in TEST_DOMAINS or email in TEST_EMAILS:
        print(f"  🚫  Test/Wegwerf-Email: {email}")
        return False

    # Nonsense-Erkennung in Pflichtfeldern
    for field, val in [("bizName", biz_name), ("branche", branche)]:
        if looks_like_spam(val):
            print(f"  🧠  Nonsense in '{field}': {val!r}")
            return False

    # Mindestens 2 von 3 Infos müssen vernünftig ausgefüllt sein
    filled = sum([
        bool(biz_hours) and not looks_like_spam(biz_hours),
        bool(services)  and not looks_like_spam(services),
        bool(phone)     and len(re.sub(r'\D', '', phone)) >= 6
    ])
    if filled < 1:
        print(f"  📋  Zu wenig echte Infos ausgefüllt (hours={biz_hours!r}, services={services!r})")
        return False

    return True

def create_elevenlabs_agent(order):
    """Erstellt einen eigenen ElevenLabs-Agent für den Kunden"""
    biz_name  = order.get("bizName", "Unbekannt")
    biz_city  = order.get("bizCity", "")
    biz_hours = order.get("bizHours", "")
    services  = order.get("services", "")
    branche   = order.get("branche", "")

    system_prompt = f"""Du bist der freundliche KI-Telefonassistent von {biz_name}{f' in {biz_city}' if biz_city else ''}.
Stelle dich immer als Assistent von {biz_name} vor, nie als allgemeiner Bot.
Branche: {branche}
Öffnungszeiten: {biz_hours if biz_hours else 'Auf Anfrage'}
Leistungen: {services if services else 'Auf Anfrage'}

Regeln:
- Immer auf Deutsch antworten
- Kurz und freundlich bleiben (max. 2-3 Sätze pro Antwort)
- Bei unbekannten Fragen: 'Das notiere ich und jemand ruft Sie zurück.'
- Keine falschen Versprechen machen"""

    payload = {
        "name": f"Xyphone Demo — {biz_name}",
        "conversation_config": {
            "agent": {
                "prompt": {"prompt": system_prompt, "llm": "gpt-4o-mini"},
                "first_message": f"Guten Tag! Sie sind verbunden mit dem KI-Assistenten von {biz_name}. Wie kann ich Ihnen helfen?",
                "language": "de"
            },
            "tts": {"model_id": "eleven_turbo_v2_5"}  # Pflicht für nicht-englische Agents
        }
    }

    resp = requests.post(
        "https://api.elevenlabs.io/v1/convai/agents/create",
        headers={"xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json"},
        json=payload
    )
    if resp.status_code in (200, 201):
        agent_id = resp.json().get("agent_id")
        print(f"  🤖 ElevenLabs-Agent erstellt: {agent_id}")
        return agent_id
    else:
        print(f"  ⚠️  ElevenLabs Agent-Erstellung fehlgeschlagen: {resp.status_code} — Fallback auf Standard-Agent")
        return ELEVENLABS_AGENT  # Fallback

def process_new_orders():
    processed = load_processed()
    emails = get_emails()
    new_count = 0

    for email in emails:
        eid = str(email.get("id", ""))
        subject = email.get("subject", "")

        # Nur Xyphone-Anfragen
        if "Xyphone Bot-Anfrage" not in subject and "Xyphone Bot" not in subject:
            continue
        if eid in processed:
            continue

        print(f"[{datetime.now().strftime('%H:%M:%S')}] Neuer Auftrag: {subject} (ID {eid})")

        body = read_email(eid)
        order = parse_order(body)

        biz_name = order.get("bizName", "").strip()
        contact_email = order.get("contactEmail", "").strip()
        contact_name = order.get("contactName", "Demo-Kunde").strip()

        if not is_serious_order(order):
            print(f"  ⏭️  Kein ernsthafter Auftrag, überspringe ({biz_name!r} / {contact_email!r})")
            processed.append(eid)
            save_processed(processed)
            continue

        slug = slugify(biz_name)
        print(f"  → Echter Auftrag! Verarbeite: {biz_name} (slug: {slug})")

        try:
            # Eigenen ElevenLabs-Agent erstellen
            agent_id = create_elevenlabs_agent(order)
            html = generate_demo_html(order, agent_id=agent_id)
            demo_url, deploy_id = deploy_demo(html, slug)
            print(f"  → Deployt: {demo_url} (deploy_id: {deploy_id})")

            # Demo deployt — Email NICHT automatisch senden, auf Freigabe warten
            import time; time.sleep(5)

            # Auftrag in pending-orders.json speichern
            pending_file = os.path.join(os.path.dirname(__file__), 'pending-orders.json')
            pending = json.load(open(pending_file)) if os.path.exists(pending_file) else []
            pending.append({
                'id': eid,
                'bizName': biz_name,
                'contactName': contact_name,
                'contactEmail': contact_email,
                'contactPhone': order.get('contactPhone', ''),
                'branche': order.get('branche', ''),
                'bizCity': order.get('bizCity', ''),
                'demo_url': demo_url,
                'received': datetime.now().strftime('%Y-%m-%d %H:%M')
            })
            with open(pending_file, 'w') as f:
                json.dump(pending, f, indent=2, ensure_ascii=False)

            print(f"  ⏳ Warte auf Freigabe — gespeichert in pending-orders.json")
            print(f"  📧 AUFTRAG_PENDING|{biz_name}|{order.get('branche','')}|{order.get('bizCity','')}|{contact_email}|{demo_url}")

            processed.append(eid)
            save_processed(processed)
            new_count += 1

        except Exception as e:
            print(f"  ❌ Fehler: {e}")

    if new_count == 0:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Keine neuen Aufträge.")
    else:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] {new_count} Auftrag/Aufträge verarbeitet.")

if __name__ == "__main__":
    process_new_orders()
