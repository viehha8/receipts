# Setup guide

Total time: about 45 minutes for everything below. You need Node.js 18 or newer (`node -v` to check; install the LTS from nodejs.org if needed).

## 1. Run the dashboard locally (10 min)

1. Unzip the project and open a terminal in the `receipts` folder.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create your settings file:
   ```bash
   cp .env.example .env        # Windows PowerShell: copy .env.example .env
   ```
4. Open `.env` and paste your key after `GEMINI_API_KEY=`. (Get one at https://aistudio.google.com/apikey if needed.)
5. Check everything works offline:
   ```bash
   npm test                    # should say: pass 21, fail 0
   ```
6. Start it:
   ```bash
   npm start
   ```
7. Open http://localhost:3000, click the **Group Project Roles** sample, then **Find the receipts**.

If you see `Gemini model "gemini-flash-latest" was not found`, set `GEMINI_MODEL=gemini-2.5-flash` in `.env` and restart.

## 2. Telegram bot (15 min, optional but impressive)

1. In Telegram, message **@BotFather** → `/newbot` → pick a name and a username ending in `bot`. Copy the token.
2. Still in BotFather: `/setprivacy` → choose your bot → **Disable**. (Without this the bot only sees commands, not normal messages.)
3. Paste the token into `.env` after `TELEGRAM_BOT_TOKEN=`. Keep `BOT_MODE=polling`.
4. Restart: `Ctrl+C`, then `npm start`. You should see `🤖 @yourbot running with polling`.
5. Create a test group, add the bot (and a friend or a second account). The bot posts a consent notice.
   If you changed privacy mode *after* adding the bot, remove and re-add it, or make it an admin.
6. Chat a little, e.g. "I can probably do the slides", "maybe Sarah do instead?", "dinner $60 I paid, split 3?", "ok", "can".
7. Type `/receipts all`. Tap a **📣 Ask** button to post a follow-up. Type `/dashboard` for the full page.

The bot only works while `npm start` is running on your laptop. That is fine for the demo.

## 3. Evaluate (10 min)

```bash
npm run eval
```
This runs 12 labelled chats through Gemini and writes `eval/RESULTS.md`. Put the score in your Devpost write-up. If a case fails, read why in the table; you can tweak the Singlish guide or status rules in `systemPrompt()` in `src/analyze.js` and re-run.

## 4. Push to GitHub (5 min)

```bash
git init
git add .
git commit -m "Receipts: AI Lodge Hackathon"
```
Create an empty repo on github.com, then:
```bash
git remote add origin https://github.com/YOUR_NAME/receipts.git
git branch -M main
git push -u origin main
```
`.env` is in `.gitignore`, so your keys are never uploaded. Double-check on GitHub that no `.env` file appears.

## 5. Deploy the dashboard on Render (15 min)

1. Go to https://render.com → sign in with GitHub → **New** → **Web Service** → pick your repo.
2. Settings:
   - Runtime: **Node**
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: **Free**
3. **Environment** → add:
   - `GEMINI_API_KEY` = your key
   - `GEMINI_MODEL` = the same model that worked locally
   - Leave `TELEGRAM_BOT_TOKEN` **unset** here (see note below).
4. Deploy. When it says *Live*, open the `https://….onrender.com` link and test a sample. That URL is your “deployed project” link for Devpost.

Free Render services sleep after 15 minutes idle, so the first load can take about 50 seconds. Open it a minute before judging.

**Why no bot on Render?** Render’s free disk is wiped whenever the service sleeps, so the bot would forget the group’s messages. Also, one bot token can only run in one place: if Render runs it in webhook mode, your laptop’s polling copy will fight it. For the demo, run the bot from your laptop. If you still want it on Render: set `TELEGRAM_BOT_TOKEN`, `BOT_MODE=webhook` and `PUBLIC_URL=https://your-app.onrender.com` there, and stop your local copy.

## Troubleshooting

| Problem | Fix |
|---|---|
| `GEMINI_API_KEY is not set` | `.env` must be in the project root, named exactly `.env`, then restart. |
| `Gemini API error 429` | Free-tier rate limit. Wait a minute; untick “Compare with a plain AI summary” to halve calls. |
| Bot replies “I only have 0 saved messages” | Privacy mode is still on. `/setprivacy` → Disable, then remove and re-add the bot (or make it admin). |
| `409 Conflict: terminated by other getUpdates request` | The bot is running twice. Close the other terminal or remove the token from Render. |
| WhatsApp upload finds no messages | Export with **Without media**. Then paste the .txt contents if upload still fails. |
| Port 3000 in use | Set `PORT=3001` in `.env`. |
