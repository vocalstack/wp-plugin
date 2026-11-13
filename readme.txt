=== VocalStack ===
Contributors: vocalstack
Tags: transcription, captions, podcast, speech to text, subtitles
Requires at least: 6.6
Tested up to: 7.1
Requires PHP: 8.1
Stable tag: 0.4.0
License: MIT
License URI: https://opensource.org/licenses/MIT

Transcribe the audio and video in your Media Library, and show transcripts and captions on your site.

== Description ==

VocalStack adds a Transcribe button to every audio and video file in your Media Library and to Audio and Video blocks. Transcripts are saved with the file, and you can edit them.

* Show a transcript with the VocalStack Transcript block or the `[vocalstack_transcript id="123"]` shortcode. Click any sentence to jump to that moment.
* Speakers are told apart, and paragraphs break where the speaker changes.
* Videos get captions automatically.
* Transcribe new uploads automatically, or only when you click.

Connect with one click: press Connect VocalStack, sign in, pick the VocalStack workspace this site should use, and the site gets its own API key. Settings shows the workspace the site is connected to, with its icon, and Change picks another one. Everything the site transcribes lands in that workspace and is billed there. You can paste an API key instead.

Read more about this plugin on the VocalStack website: https://vocalstack.com/wordpress-transcription-and-translation-plugin/

== External services ==

This plugin relies on VocalStack (https://vocalstack.com), a speech-to-text service, and needs a VocalStack account and API key. The key stays on your server; visitors' browsers never receive it.

What is sent, and when:

* Transcribing a Media Library file (by clicking Transcribe, automatically on upload if you turn that on, or through an Upload widget): the file's address, or the file itself if your site is not reachable from the internet, with its title and your language and speaker settings. The plugin then asks VocalStack for progress and downloads the transcript.
* Record widget: when a visitor allowed by your widget settings presses Record, your server creates a live transcription and the visitor's browser streams the audio from the chosen source (microphone or a browser tab) directly to VocalStack, which sends the transcript back to that browser. For a stream source you configure, VocalStack fetches the stream itself.
* Player widget: playing a VocalStack transcription loads its audio and transcript from VocalStack; following a public broadcast opens a connection from the visitor's browser to VocalStack to receive the live transcript and, if the visitor presses Listen, the live audio.
* Admin screens (Transcriptions, Broadcasts): your administrators' actions are sent to VocalStack through your server: listing, creating, renaming, sharing, exporting, archiving and deleting transcriptions and broadcasts.
* Connecting or testing your key, opening the VocalStack page, and the Remaining card: the key's name, its workspace (name and icon), plan and balance are read. The workspace's icon is an image your administrators' browsers load from VocalStack.
* One-click Connect: when an administrator presses Connect VocalStack or Change, their browser opens VocalStack's dashboard (https://app.vocalstack.com) with your site's name and the address to come back to. After they approve, your server exchanges the code VocalStack sent back for an API key.

Transcription is billed to your VocalStack account; the Widgets section of the VocalStack settings limits how much visitors can use. VocalStack Terms of Service: https://vocalstack.com/terms. Privacy Policy: https://vocalstack.com/privacy.

== Source code and build ==

The full source code is public at https://github.com/vocalstack/wp-plugin.

The JavaScript and CSS in `build/` are compiled with @wordpress/scripts (webpack) from readable source that ships in this plugin:

* `assets/src/` – the admin screens (`build/admin/`) and the front-end widgets (`build/widgets/`).
* `blocks/` – the blocks (`build/blocks/`).

To rebuild them: `npm install`, then `npm run build` (see `package.json`). The bundles include icons from @wordpress/icons (https://github.com/WordPress/gutenberg/tree/trunk/packages/icons); every other `@wordpress/*` package is loaded from WordPress itself.

The PHP SDK in `vendor-prefixed/` is vocalstack/sdk (https://github.com/vocalstack/php-sdk), moved under the plugin's own namespace with Strauss (`scripts/build-release.sh` in the repository).

== Installation ==

1. Install and activate the plugin.
2. Open VocalStack in the admin menu, go to Settings and press Connect VocalStack: sign in, pick a workspace and click Authenticate. On a site without https, paste an API key from https://app.vocalstack.com/developers/keys instead.
3. Open an audio or video file in the Media Library and click Transcribe.

== Frequently Asked Questions ==

= Can I edit a transcript? =

Yes, on the file's edit screen. An edited transcript shows as plain text on your site, without timestamps.

= Where is my key stored? =

In your site's database, never sent to browsers. You can define `VOCALSTACK_API_KEY` in wp-config.php instead.

= How do I use another VocalStack workspace? =

In Settings, press Change next to the workspace and pick another one in VocalStack. The site gets a new key for that workspace; the old key keeps working until you revoke it in VocalStack under Developers → API keys. A key belongs to one workspace, so a pasted key or one set in wp-config.php is changed by replacing it with a key made in the other workspace. Transcripts already saved with your files stay; a transcription still running in the old workspace has to be started again.

= Why is there no Connect VocalStack button? =

One-click Connect needs a site served over https (or a local site on localhost). On a plain http site, paste an API key.

== Changelog ==

= 0.4.0 =
* Works with VocalStack's API where a transcription is one continuous transcript: everything the plugin reads, starts, pauses, stops, exports and plays is addressed by the transcription. Needs this version from the day VocalStack drops recordings from its API.
* The player's source is "A VocalStack transcription". Players and shortcodes saved with `source="recording"` keep working: a transcription id beside it plays as before, and a recording id says the transcription is no longer available; choose the transcription again in the block or the Widgets tab.
* A broadcast's Transcriptions tab lists the transcriptions that fed it; a live transcription's detail shows its one transcript, with no recording picker.
* Media Library jobs started before this version are followed by their transcription id.
* Built on the VocalStack PHP SDK 2.2.

= 0.3.1 =
* Change, next to the workspace, opens VocalStack's consent screen on the workspace the site is connected to.

= 0.3.0 =
* Settings shows the VocalStack workspace the site is connected to, with its icon, for a pasted key and a wp-config.php key too.
* One-click Connect: press Connect VocalStack, sign in and pick a workspace, and the site gets its own key. Pasting a key still works.
* Change, next to the workspace, connects again to pick another workspace. The key in use is replaced only once the new one is issued.
* A transcription that belongs to another workspace than the connected one says so in plain words and can be started again.

= 0.2.0 =
* Renaming a speaker in a transcript works with VocalStack's new speakers API (transcription appearances), and still with the one before it.

= 0.1.0 =
* First version.
