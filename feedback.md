# Feedback on `freezr-context.md`

Notes for whoever maintains the freezr LLM context (the longText sources behind
`info.freezr.creator/modules/longTexts/genContext.js`). Everything below is
drawn from one real build: the Organic redesign of this app, a 17-turn Claude
Code session running 2026-08-12 → 2026-08-16 (1043 shell calls, 333 browser
calls, ~520 tests).

**Overall the file was sufficient.** The agent never opened `freezrApiV2.js` or
`freezr_core.css` once. It entered the freezr server tree 52 times, but 50 of
those were a single upstream bug hunt (§5) — only **two** were caused by a gap
in this document (§1). The four additions below are the ones that would have
changed what the agent did or said.

---

## 1. Document the Content-Security-Policy — it is undiscoverable

**What happened.** The design system called for two Google Fonts. The agent
needed to know whether `fonts.googleapis.com` was reachable from an app page,
and could not find out:

1. `rg "font-src|style-src|Content-Security-Policy"` over the whole freezr tree
   returned one irrelevant hit — a permission *description* in
   `middleware/permissions/permissionDefinitions.mjs:183`.
2. `rg "fontSrc|helmet|contentSecurityPolicy"` returned nothing.
3. `curl -sI .../apps/pro.ginko.houseChores/index` returned `302 Found` and no
   CSP header — because freezr ships the policy as a `<meta http-equiv>` tag on
   the rendered page, not as a response header. Header probing cannot find it.

The agent gave up on knowing, and routed around the question: it downloaded the
woff2 files and served them same-origin, reasoning that this "avoids any freezr
CSP question". That was the correct outcome reached by avoidance rather than by
knowledge. Three days later, incidentally, it captured the real policy from a
login-page body — and it confirms the guess was right, which nobody could have
known at decision time.

**What the document should say.** State the policy verbatim, say where it lives,
and name the consequence for the two directives app authors trip over:

> Every app page carries its policy in a `<meta http-equiv="Content-Security-Policy">`
> tag, not a response header — you cannot discover it with `curl -I`. The
> policy is:
>
> ```
> script-src 'self' 'nonce-…'; style-src 'self' 'unsafe-inline'; child-src 'none';
> frame-src 'none'; form-action 'self'; img-src * data:; default-src 'self';
> connect-src 'self'; object-src 'none';
> ```
>
> There is no `font-src`, so fonts fall back to `default-src 'self'`: **web fonts
> must be same-origin.** Vendor them into the app (e.g. `fonts/*.woff2` with your
> own `@font-face`) rather than importing from a font CDN — `@import` from
> `fonts.googleapis.com` will be blocked. `img-src` is the one permissive
> directive (`*` plus `data:`).

The existing scattered CSP asides — `external_scripts` relaxes `script-src`,
`external_fetch` relaxes `connect-src`, "freezr CSP blocks `<iframe>`,
`<embed>`, `<object>`" — should point at this one block rather than each
implying a different mental model of the policy.

## 2. Say what actually breaks without a re-install

**What the document says today.** "After changing `manifest.json` (new
collections, permissions, pages), the app must be re-installed for the server to
pick the changes up," then the `?devUpdateApp=` instructions.

**What the agent observed.** The literal reading is stricter than the server's
behaviour, and the agent obeyed it literally — asking the user to press
**Regenerate App from Files** on five separate occasions across the session.
Each was a hand-off that stopped the work. Meanwhile:

- Writes to the **undeclared** `settings` collection worked immediately against
  the live server. The agent's own report: *"Writes to it already work against
  your dev server, but to get the declaration registered properly…"*
- New `.js` files were served `200` before any re-install. The agent checked
  with curl and concluded *"The app runs correctly without it."*
- On disk, `users_freezr/<user>/db/` holds `pro_ginko_houseChores_settings.db`
  **and** a stray `pro_ginko_houseChores_notInManifestXyz.db` — collections are
  created on first write regardless of what the manifest declares.

**What the document should say.** Keep the instruction, add the consequence:

> Re-installing does not gate runtime behaviour. New files are served as soon as
> they exist on disk, and a write to a collection the manifest has not declared
> creates that collection anyway. What goes stale without a re-install is the
> *served* `manifest.json` — the declarations, schemas and file list other tools
> read. So: finish your work, then re-install once; you do not need to stop and
> re-install every time the manifest changes.

That one paragraph would have collapsed five interruptions into one.

## 3. Explain `data_object_id` and `upsert`

`freezr.create`'s options bag lists `data_object_id` and `upsert` and never
explains either. Together they are the idiom for "write a record under an id I
choose" — the whole basis of this app's singleton-settings and
idempotent-execution records:

```javascript
// one settings record, created or replaced
freezr.create('settings', fields, { data_object_id: 'app', upsert: true })
```

The agent did not learn this from the document. Writing `settingsData.js`, it
first read three existing data-layer files in the repo and copied the pattern.
That worked only because the app already had a data layer; on a greenfield app
it would have had to guess or read `freezrApiV2.js`. Two sentences and the
snippet above in the Core CRUD section closes this.

While there: `freezr.read(collection, id)` returning a falsy value for a
never-written record — versus throwing — is also unstated, and app code has to
choose a shape for that case.

## 4. Warn that plain HTTP works only on localhost

Nothing in the document tells an app author that "open it on your phone" is a
trap. It is: over plain HTTP to any host that is not `localhost`, **every**
authenticated freezr page returns `Internal server error`. See §5 for the
mechanism. Whatever happens to the bug upstream, the deployment note belongs in
this document:

> Browsers only send `Sec-Fetch-*` headers to a potentially-trustworthy origin —
> HTTPS, or `localhost`. freezr's page controllers depend on those headers, so
> reaching the server at `http://<some-host>:3000` from another device fails on
> every page. Test on `localhost`, or put the server behind HTTPS (on a tailnet:
> `tailscale serve --bg --https=443 http://127.0.0.1:3000`).

---

## 5. Upstream bug found while investigating the above (`hc-j2z`)

Not a documentation issue, but this is where 50 of the 52 source dives went, and
it is worth sending to the freezr maintainers.

Three page controllers gate on a raw header comparison:

```javascript
// features/account/controllers/accountPageController.mjs:81
const isPageRequestConfirmation = req.headers['sec-fetch-mode'] === 'navigate'
…
if (!isPageRequestConfirmation) throw new Error('Not a page request')
```

Same pattern at `features/apps/controllers/appPageController.mjs:36` and
`features/apps/controllers/publicAppPageController.mjs:26`. Browsers omit
`Sec-Fetch-*` entirely on non-trustworthy origins, so the whole server — not
just one app — is unreachable over plain HTTP from anything but localhost. Proven
end to end with a throwaway echo server: `http://localhost:3999` receives
`sec-fetch-mode: navigate`, `http://<host>.ts.net:3999` receives nothing.

freezr already ships the right helper: `isPageBrowserRequest(req)` in
`common/helpers/utils.mjs`, which falls back to `Accept` negotiation when no
`Sec-Fetch-*` header is present. The three controllers simply do not call it.
Swapping each raw comparison for that helper is a one-line fix per controller.
(The helper's comment — *"Modern browsers always send at least one Sec-Fetch-\*
header"* — is the wrong premise, but its fallback path handles the case
correctly anyway.)

---

## 6. Two notes on the document as a whole

**The Output Format section is wrong outside the in-browser creator.** The
`<<<FREEZR_START type="file">>>` protocol, the "explanation → files → summary"
ordering and the search/replace block format describe how the creator's own
model must emit files. An agent working in a checkout with real file tools has
to ignore all of it — this app's session did. Since the document explicitly
invites being dropped into a repo for Claude Code / Cursor / Codex, that section
should be conditional, or moved out of the shared context and into the creator's
own prompt.

**Roughly two-thirds of the file was never relevant.** This app declares exactly
one permission (`use_llm`). Across the entire session there were zero mentions of
`shareRecords`, `pcard`, `public_pages`, `publicquery`, `freezr.upload`,
`freezr.perms`, `use_mail`, `freezr.jobs`, `external_fetch` or `unsafe_eval`.
That is not a complaint — the reference has to cover the platform — but it is an
argument for splitting it: a short always-loaded core (hard rules, manifest, CRUD,
CSP, dev tokens, local-serving caveats) plus per-capability sections pulled in
when an app actually declares that permission.

## What did work, so it does not get lost in a rewrite

- **Hard rule 10** (the injected 32×32 `#freezer_img_button`, top-right) was the
  single most load-bearing line in the file for this build. It shaped every
  screen's layout and earned a permanent regression test — *"phone Doing header
  keeps Pause clear of the injected freezr button"*.
- **Hard rule 1** (no inline `<script>`) paid off diagnostically as well as
  structurally: when Firefox reported an inline-script CSP violation, the agent
  could rule the app out immediately because it knew it had complied.
- **The "Local Dev Access & Tokens" section was the most-used part of the whole
  file** — around 30 `curl` calls to `/ceps/query/<app>.<collection>` with the
  dev `appToken` to verify behaviour against real records. Zero token errors,
  zero 401s. The ready-made examples in `.freezr-access.local.json` were used
  verbatim.
- **Rule 9 (indexing)** held without friction: everything sorts on
  `_date_modified` and nothing needed a manual index.
