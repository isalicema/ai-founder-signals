import type { Metadata } from 'next';
import { Bricolage_Grotesque, IBM_Plex_Mono } from 'next/font/google';
import type { ReactNode } from 'react';
import { SignalFieldCanvas } from '../components/signal-field-canvas';
import './globals.css';
import './aurora.css';

const displayFont = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
});

const monoFont = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
  display: 'swap',
});

const skinInitScript = `try{const skin=localStorage.getItem('afs-feed-skin');document.documentElement.dataset.skin=skin==='aurora'?'aurora':'editorial'}catch{document.documentElement.dataset.skin='editorial'}`;

export const metadata: Metadata = {
  title: 'AI Founder Signals · 晨间信号台',
  description: '30 秒扫完今天的 AI 创始人一手访谈信号',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html
      lang="zh-CN"
      data-skin="editorial"
      className={`${displayFont.variable} ${monoFont.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: skinInitScript }} />
      </head>
      <body>
        <div className="aurora" aria-hidden="true">
          <i className="blob blob-a" />
          <i className="blob blob-b" />
          <i className="blob blob-c" />
          <i className="blob blob-d" />
        </div>
        <SignalFieldCanvas />
        {children}
      </body>
    </html>
  );
}
