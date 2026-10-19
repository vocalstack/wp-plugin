# VocalStack for WordPress: architecture

How the plugin reproduces the VocalStack dashboard inside wp-admin and offers
public widgets, without ever giving a browser the site's API key.

## Decisions (2026-10-19)

| | |
|---|---|
| Transcriptions tab | The whole VocalStack account, like app.vocalstack.com/transcriptions, with a "From this site" filter; rows link to their Media Library file when there is one. |
| Broadcasts tab | Like app.vocalstack.com/broadcasts. |
| Detail screens | Full detail views inside WordPress (player, timed transcript, summary, speakers, languages, share links, rename, archive/restore, purge). |
| Admin look | WordPress-native styling, dashboard layout and information. |
| Admin actions | Create, edit, archive/restore, purge (typed confirmation). |
| Widgets | Audio player, Record (live transcript; microphone, tab/screen audio, stream URL), Upload. Each is a block **and** a shortcode, one renderer. |
| Player sources | Media Library files, VocalStack recordings, live broadcasts. |
| Upload target | Media Library attachment, then transcribed. |
| Widget access | The site owner decides per widget (everyone / logged-in / roles) with limits. |
| Styling | CSS custom properties + stable classes, theme template overrides, theme.json / block supports. |
| Delivery | All at once. |

## Two kinds of server routes

**Admin (dashboard mirror).** The admin screens talk to VocalStack through
one authenticated pass-through, `/wp-json/vocalstack/v1/api/<path>`, instead
of forty hand-written routes. It:

- requires the `vocalstack_manage` capability (administrators by default; a
  site can grant it to other roles) and WordPress's REST nonce;
- forwards only an allowlist of method + path patterns (transcriptions,
  broadcasts, recordings, share links, languages, billing reads), never
  `connect/*`, billing writes or anything not listed;
- adds the key server-side, streams uploads, and passes VocalStack's status
  and error envelope through unchanged so the UI shows VocalStack's messages.

**Public (widgets).** Narrow routes, one per job, each checking a signed
widget ticket and the site's policy before spending anything:

- `POST widgets/record/start`: creates the live transcription, returns a
  short-lived publish token and socket URL for that one recording.
- `POST widgets/record/stop`.
- `POST widgets/upload`: the file goes into the Media Library, then the
  existing transcription job runs.
- `GET widgets/player/source`: a short-lived media URL for a VocalStack
  recording, or the follow credentials for a live broadcast.

## Widget tickets: why a visitor can't tamper with a widget

A widget's configuration (what it records into, max duration, who may use it,
which recording it plays) is written by a post author. That configuration is
rendered into the page, and the visitor's browser sends it back when it acts.
So the server signs it:

    ticket = base64(config) . "." . hmac_sha256(config, wp_salt('auth') . 'vocalstack-widget')

Public routes verify the ticket and act on the signed config only. A visitor
who edits the HTML gets a signature mismatch. A ticket names one widget's
config, so it can't be reused to play another recording or raise a limit.

## Spending policy

Global ceilings, set by administrators in Settings → Widgets, which no
shortcode or block can exceed:

- who may use billable widgets at all: everyone / logged-in / roles;
- max minutes per recording, per user (or per IP for visitors) per day, and
  site-wide per day;
- whether visitors may upload, and the largest file.

A widget's own options can only narrow these. Counters live in a small table
keyed by user ID or a hashed IP and day, so a refused request costs nothing.
VocalStack's own limits (balance, concurrency, `maxLiveSeconds`) still apply
on top; the widget shows their refusal.

## Styling a theme can override

1. **Classes and custom properties.** Every widget uses `vocalstack-*` BEM
   classes and reads its look from `--vocalstack-*` custom properties
   (accent, text, surface, border, radius, font, gap). Their defaults fall back to the
   theme's presets: `--vocalstack-accent: var(--wp--preset--color--primary, #245b8f)`.
   A theme overrides a property in its own CSS, at the low specificity of
   `:where()`.
2. **Template overrides.** Each widget's HTML comes from
   `templates/<widget>.php`; a theme can copy it to
   `yourtheme/vocalstack/<widget>.php` (child theme first), as WooCommerce
   does. Filter: `vocalstack_template`.
3. **theme.json / blocks.** The blocks declare `color`, `typography`,
   `spacing` and `border` supports, so the Site Editor and theme.json style
   them; block style variations (`is-style-minimal`, `is-style-card`) ship too.

The stylesheet is split per widget and only enqueued when a widget renders.

## Admin app

One React app on the VocalStack page, with hash routes:

    #/transcriptions            list (search, active/archived, select mode)
    #/transcriptions/<id>       detail
    #/broadcasts, #/broadcasts/<id>
    #/media                     Media Library audio/video (the current table)
    #/widgets                   shortcode generator + live preview
    #/settings/<section>        account, transcription, display, widgets

The current tabs become routes; `&tab=` links keep working.
