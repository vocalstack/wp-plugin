=== VocalStack ===
Contributors: vocalstack
Tags: transcription, captions, podcast, speech to text, subtitles
Requires at least: 6.6
Tested up to: 7.1
Requires PHP: 8.1
Stable tag: 0.1.0
License: MIT
License URI: https://opensource.org/licenses/MIT

Transcribe the audio and video in your Media Library, and show transcripts and captions on your site.

== Description ==

VocalStack adds a Transcribe button to every audio and video file in your Media Library and to Audio and Video blocks. Transcripts are saved with the file, and you can edit them.

* Show a transcript with the VocalStack Transcript block or the `[vocalstack_transcript id="123"]` shortcode. Click any sentence to jump to that moment.
* Speakers are told apart, and paragraphs break where the speaker changes.
* Videos get captions automatically.
* Transcribe new uploads automatically, or only when you click.

Read more about this plugin on the VocalStack website: https://vocalstack.com/wordpress-transcription-and-translation-plugin/

== External services ==

This plugin relies on VocalStack (https://vocalstack.com), a speech-to-text service, and needs a VocalStack account and API key. The key stays on your server; visitors' browsers never receive it.

What is sent, and when:

* Transcribing a Media Library file (by clicking Transcribe, automatically on upload if you turn that on, or through an Upload widget): the file's address, or the file itself if your site is not reachable from the internet, with its title and your language and speaker settings. The plugin then asks VocalStack for progress and downloads the transcript.
* Record widget: when a visitor allowed by your widget settings presses Record, your server creates a live transcription and the visitor's browser streams the audio from the chosen source (microphone or a browser tab) directly to VocalStack, which sends the transcript back to that browser. For a stream source you configure, VocalStack fetches the stream itself.
* Player widget: playing a VocalStack recording loads its audio and transcript from VocalStack; following a public broadcast opens a connection from the visitor's browser to VocalStack to receive the live transcript and, if the visitor presses Listen, the live audio.
* Admin screens (Transcriptions, Broadcasts): your administrators' actions are sent to VocalStack through your server: listing, creating, renaming, sharing, exporting, archiving and deleting transcriptions and broadcasts.
* Connecting or testing your key, and the Remaining card: your account's name, plan and balance are read.

Transcription is billed to your VocalStack account; the Widgets section of the VocalStack settings limits how much visitors can use. VocalStack Terms of Service: https://vocalstack.com/terms. Privacy Policy: https://vocalstack.com/privacy.

== Installation ==

1. Install and activate the plugin.
2. Open VocalStack in the admin menu and paste an API key from https://app.vocalstack.com/developers/keys.
3. Open an audio or video file in the Media Library and click Transcribe.

== Frequently Asked Questions ==

= Can I edit a transcript? =

Yes, on the file's edit screen. An edited transcript shows as plain text on your site, without timestamps.

= Where is my key stored? =

In your site's database, never sent to browsers. You can define `VOCALSTACK_API_KEY` in wp-config.php instead.

== Changelog ==

= 0.1.0 =
* First version.
