export const YOUTUBE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>yt:video:abcDEF_1234</id>
    <yt:videoId>abcDEF_1234</yt:videoId>
    <title>A founder conversation &amp; product lesson</title>
    <link rel="alternate" href="https://www.youtube.com/shorts/abcDEF_1234?feature=share"/>
    <published>2026-08-28T16:30:06+00:00</published>
    <media:group>
      <media:thumbnail url="https://i.ytimg.com/vi/abcDEF_1234/hqdefault.jpg"/>
      <media:description><![CDATA[<p>${'Useful feed description. '.repeat(40)}</p>]]></media:description>
    </media:group>
  </entry>
</feed>`;

export const PODCAST_FEED = `<?xml version="1.0"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <item>
      <guid>episode-42</guid>
      <title>对谈陌生 AI 创始人</title>
      <link>https://example.com/episodes/42?utm_source=feed&amp;ref=home</link>
      <pubDate>Fri, 28 Aug 2026 10:00:00 GMT</pubDate>
      <description><![CDATA[<p>这是一段用于准入判断的节目介绍。</p>]]></description>
      <enclosure url="https://cdn.example.com/42.m4a" type="audio/mp4"/>
      <itunes:duration>01:02:03</itunes:duration>
      <itunes:image href="https://cdn.example.com/cover.jpg"/>
    </item>
  </channel>
</rss>`;
