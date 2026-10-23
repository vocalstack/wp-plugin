# VocalStack for WordPress

The VocalStack dashboard inside wp-admin, a Transcribe button on every audio and video file, and public widgets (players, record buttons, upload buttons) as blocks and shortcodes.

Read more about the [VocalStack transcription and translation plugin for WordPress](https://vocalstack.com/wordpress-transcription-and-translation-plugin/) on the [VocalStack website](https://vocalstack.com/).

Built on the PHP SDK [`vocalstack/sdk`](https://github.com/vocalstack/php-sdk). The API key stays on the server: browsers never receive it.

## In wp-admin: VocalStack (below Media)

| Tab | |
|---|---|
| **Transcriptions** | Every transcription on the account, like app.vocalstack.com/transcriptions: search, active/archived, "From this site", select and archive, restore, delete permanently. **New transcription** from an upload (into the Media Library), a link, or live (microphone, a tab's sound, or a stream URL). The detail screen has the player, timed transcript, speaker names, translation, summary, share links, export (PDF, XLSX, SRT, JSON), settings, retry and rename. |
| **Broadcasts** | Like app.vocalstack.com/broadcasts: list, create, settings (code, access, language), audio sources (add, check, record from), recordings, share links, archive. |
| **Media Library** | Every audio and video file with its transcript state, language, speakers and a play button. |
| **Widgets** | A shortcode generator with preview, and how to restyle widgets. |
| **Settings** | Account (connection, minutes remaining), Transcription defaults, Display (captions), Widgets (who may record or upload, and how much). |

Each audio/video attachment also gets a transcript panel on its edit screen, and Audio/Video blocks get one in the block editor.

**Who sees it:** the `vocalstack_manage` capability, which administrators have. Grant it to other roles with a role editor; changing the API key still needs `manage_options`.

## Widgets

Each widget is a block and a shortcode, with the same options.

```
[vocalstack_player source="media" id="123"]                  a Media Library file
[vocalstack_player source="recording" id="<transcription or recording id>"]
[vocalstack_player source="broadcast" id="<broadcast id>"]   follow a public broadcast live
[vocalstack_record sources="mic,tab" max_record_minutes="10" language="en"]
[vocalstack_record sources="stream:https://radio.example/live.mp3"]
[vocalstack_upload accept="audio" max_upload_mb="100"]
[vocalstack_transcript id="123" player="1"]
```

Common options: `title`, `transcript`, `timestamps`, `speakers`, `style="card|minimal"`; record and upload also take `access="logged_in|roles|nobody"` with `roles="editor,author"`, and `label`.

- **Player.** A Media Library file plays from the site. A VocalStack recording plays from VocalStack with a media token that reads only that recording. A broadcast is followed over VocalStack's sockets: the transcript as it is spoken, the live audio on **Listen live** (WebCodecs browsers), and the last recording between broadcasts. **Only public broadcasts**: the public API can't issue listener tokens for private ones.
- **Record.** **Signed-in users only.** WordPress opens the recording and the browser streams to VocalStack with a socket URL good for that one recording; the transcript appears as people speak. Tab audio works in Chrome and Edge on a computer. A stream source is fetched by VocalStack.
- **Upload.** The file goes into the Media Library and is transcribed; the visitor sees the transcript when it is ready.

### Spending limits

Everything a widget does is billed to the site's VocalStack account. In **Settings → Widgets** an administrator sets ceilings that no block or shortcode can exceed: who may use the widgets (everyone applies to uploads only; recording always needs a login), the longest recording, minutes per user and per site per day, upload size and uploads per user per day. A recording reserves its maximum length when it starts and is settled to its real length when it ends.

Widget options travel through the visitor's browser signed with the site's salts (`Widgets\Ticket`); an edited option is refused.

### Restyling

1. **Custom properties.** Widgets read their look from `--vocalstack-*` properties that default to the theme's presets; all plugin selectors sit in `:where()`, so any theme rule wins:
   ```css
   .vocalstack-widget {
     --vocalstack-accent: #b91c1c;
     --vocalstack-radius: 0;
   }
   ```
2. **Templates.** Copy `templates/<name>.php` (`player`, `record`, `upload`, `transcript`) to `yourtheme/vocalstack/<name>.php`. The scripts find elements by `data-part`, so classes and markup can change. Filter: `vocalstack_template`.
3. **Blocks.** Colour, typography, spacing and border supports, and Card / Minimal styles, so theme.json and the Site Editor style them.

A widget's stylesheet loads only on pages that show it; `add_filter( 'vocalstack_load_styles', '__return_false' )` drops them all.

## Configuration

| | |
|---|---|
| `VOCALSTACK_API_KEY` | Wins over a key pasted in the settings. |
| `VOCALSTACK_API_URL`, `VOCALSTACK_DASHBOARD_URL` | Another environment, such as staging. |
| `vocalstack_file_url` | The address VocalStack fetches a Media Library file from; `''` uploads the file. |
| `vocalstack_can_transcribe`, `vocalstack_is_transcribable` | Who may transcribe, and which files. |
| `vocalstack_speaker_label` | Name the speakers. |
| `vocalstack_visitor_ip` | The visitor IP for daily limits behind a proxy. |
| `vocalstack_transcriber`, `vocalstack_http_client` | Swap the VocalStack client or its HTTP layer (tests do). |

## Develop

Requires Docker (Colima works), Node and Composer.

```sh
composer install
npm install
npm run build          # admin, widgets and blocks
npx wp-env start       # http://localhost:8888 (admin / password)
```

VocalStack can't reach `localhost`, so locally a Media Library file is uploaded rather than fetched by URL. For the URL path, expose the site with a tunnel or return a public address from `vocalstack_file_url`.

## Test

```sh
npm run test:php       # PHPUnit in wp-env's tests container
composer lint          # PHPCS: WordPress Coding Standards + PHP 8.1 compatibility
```

The tests never reach VocalStack: the bootstrap fails any request to it. They run the real SDK over `tests/php/FakeHttp.php`, or `FakeTranscriber.php` for the Media Library jobs. Check against the real API by hand with short clips; live and file transcriptions are billed per minute, with a minimum per transcription.
